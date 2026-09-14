// ─── intervals.icu → текст поста для каналу «gym table» ─────────────
// Garmin синхронізується в intervals.icu офіційно (партнерська інтеграція),
// тож тут ні логіну в Garmin, ні 429. Звідси беремо список активностей за
// API-ключем і оригінальний FIT-файл: у ньому силові підходи (вага, повтори,
// тривалість, відпочинок), яких intervals.icu у своєму API не віддає.
// Модуль свідомо без БД — пости можна перевірити локально
// (tools/test-training-post.ts). Публікація й анти-дублі — eveningPost.ts.

import { gunzipSync } from 'node:zlib';
import { Decoder, Profile, Stream } from '@garmin/fitsdk';
import { BODYWEIGHT_CATEGORIES, camelToUpperSnake, exerciseDisplayName } from './exerciseNames.js';

const API = 'https://intervals.icu/api/v1';

export interface IcuActivity {
  id: string;
  type?: string;
  name?: string;
  start_date_local?: string;
  moving_time?: number;
  elapsed_time?: number;
  distance?: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  total_elevation_gain?: number;
  calories?: number;
  icu_training_load?: number;
  icu_hr_zone_times?: number[];
  average_cadence?: number;
  icu_average_watts?: number;
  icu_weighted_avg_watts?: number;
}

export type TrainingKind = 'run' | 'ride' | 'boxing' | 'gym' | 'other';

export interface TrainingPost {
  activityId: string;
  date: string; // YYYY-MM-DD (локальна дата старту)
  kind: TrainingKind;
  text: string; // HTML для Telegram
}

const RUN = new Set(['Run', 'TrailRun', 'VirtualRun']);
const RIDE = new Set(['Ride', 'GravelRide', 'MountainBikeRide', 'VirtualRide', 'EBikeRide',
  'EMountainBikeRide', 'TrackRide', 'Cyclocross', 'Velomobile']);

export function intervalsConfigured(): boolean {
  return !!process.env.INTERVALS_API_KEY;
}

function headers(): Record<string, string> {
  // Логін базової авторизації — буквально рядок "API_KEY", пароль — сам ключ.
  const auth = Buffer.from(`API_KEY:${process.env.INTERVALS_API_KEY ?? ''}`).toString('base64');
  // Перед intervals.icu стоїть Cloudflare, який ріже запити без власного User-Agent.
  return { Authorization: `Basic ${auth}`, 'User-Agent': 'Leeenochka/1.0' };
}

/** Активності за діапазоном локальних дат (включно), від найновішої. */
export async function fetchActivities(oldest: string, newest: string): Promise<IcuActivity[]> {
  const athlete = process.env.INTERVALS_ATHLETE_ID || '0'; // "0" = власник ключа
  const url = `${API}/athlete/${athlete}/activities?oldest=${oldest}T00:00:00&newest=${newest}T23:59:59`;
  const res = await fetch(url, { headers: headers() });
  if (res.status === 401) throw new Error('intervals.icu 401: невірний або перевипущений API-ключ');
  if (!res.ok) throw new Error(`intervals.icu ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as IcuActivity[];
}

/** Одна активність напряму за id (без сканування діапазону дат). */
export async function fetchActivityById(id: string): Promise<IcuActivity> {
  const res = await fetch(`${API}/activity/${id}`, { headers: headers() });
  if (res.status === 401) throw new Error('intervals.icu 401: невірний або перевипущений API-ключ');
  if (res.status === 404) throw new Error(`intervals.icu: активність ${id} не знайдена`);
  if (!res.ok) throw new Error(`intervals.icu ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as IcuActivity;
}

export interface IcuWellness {
  id: string; // дата, YYYY-MM-DD
  ctl?: number; atl?: number; rampRate?: number;
  restingHR?: number; hrv?: number; hrvSDNN?: number;
  sleepSecs?: number; sleepScore?: number; sleepQuality?: number; avgSleepingHR?: number;
  weight?: number; bodyFat?: number; vo2max?: number;
  steps?: number; spO2?: number; readiness?: number;
  soreness?: number; fatigue?: number; stress?: number; mood?: number; motivation?: number;
  comments?: string;
}

/** Щоденні CTL/ATL (Fitness/Fatigue), сон, HRV, вага, кроки — те, з чого будуються графіки. */
export async function fetchWellness(oldest: string, newest: string): Promise<IcuWellness[]> {
  const athlete = process.env.INTERVALS_ATHLETE_ID || '0';
  const url = `${API}/athlete/${athlete}/wellness?oldest=${oldest}&newest=${newest}`;
  const res = await fetch(url, { headers: headers() });
  if (res.status === 401) throw new Error('intervals.icu 401: невірний або перевипущений API-ключ');
  if (!res.ok) throw new Error(`intervals.icu ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as IcuWellness[];
}

async function fetchOriginalFit(activityId: string): Promise<Buffer | null> {
  const res = await fetch(`${API}/activity/${activityId}/file`, { headers: headers() });
  if (!res.ok) return null;
  let buf = Buffer.from(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  return buf.length ? buf : null;
}

// ─── FIT ──────────────────────────────────────────────────────────
export interface FitSet {
  active: boolean;
  duration: number | null;  // с
  reps: number | null;
  weight: number | null;    // кг
  category: string | null;  // UPPER_SNAKE, напр. BENCH_PRESS
  exercise: string | null;  // UPPER_SNAKE варіант, напр. INCLINE_BARBELL_BENCH_PRESS
}

export interface FitInfo {
  sport: string | null;
  subSport: string | null;
  elapsed: number | null;   // с
  sets: FitSet[];
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function first<T>(v: T | T[] | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseFit(bytes: Buffer | null): FitInfo {
  const out: FitInfo = { sport: null, subSport: null, elapsed: null, sets: [] };
  if (!bytes) return out;
  try {
    const { messages } = new Decoder(Stream.fromBuffer(bytes)).read();
    const sport = messages.sportMesgs?.[0];
    const session = messages.sessionMesgs?.[0];
    out.sport = String(sport?.sport ?? session?.sport ?? '') || null;
    out.subSport = String(sport?.subSport ?? session?.subSport ?? '') || null;
    out.elapsed = num(session?.totalElapsedTime);

    const types = Profile.types as Record<string, Record<string, string> | undefined>;
    for (const s of messages.setMesgs ?? []) {
      const cat = first(s.category as string | string[] | undefined);
      const sub = first(s.categorySubtype as number | number[] | undefined);
      const variant = typeof cat === 'string' && typeof sub === 'number'
        ? types[`${cat}ExerciseName`]?.[String(sub)] : undefined;
      out.sets.push({
        active: s.setType === 'active',
        duration: num(s.duration),
        reps: num(s.repetitions),
        weight: num(s.weight),
        category: typeof cat === 'string' ? camelToUpperSnake(cat) : null,
        exercise: typeof variant === 'string' ? camelToUpperSnake(variant) : null,
      });
    }
  } catch (e) {
    console.error('parseFit failed:', e instanceof Error ? e.message : e);
  }
  return out;
}

// ─── Формат ───────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 2026-09-13 → 13.09.26 (як у твоїх постах у каналі). */
function dateUk(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

function hms(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return '—';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

function kg(w: number): string {
  return Number.isInteger(w) ? String(w) : w.toFixed(1).replace(/\.0$/, '');
}

function thousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function header(date: string, hashtag: string): string {
  return `<b>${dateUk(date)}</b> ${hashtag} ⌚`;
}

function hrLine(a: IcuActivity): string | null {
  if (!a.average_heartrate && !a.max_heartrate) return null;
  return `❤️ пульс сер ${a.average_heartrate ?? '—'} · макс ${a.max_heartrate ?? '—'}`;
}

// «Важко» = дві найвищі зони, скільки б їх у Гарміна не було налаштовано
// (стандартні 5 чи, як у нашому випадку, 6-7) — завжди підпис із двох
// РЕАЛЬНИХ номерів зон, а не захардкоджене "Z4+".
function zonesLine(a: IcuActivity): string | null {
  const times = a.icu_hr_zone_times ?? [];
  const total = times.reduce((s, t) => s + (t || 0), 0);
  if (!total) return null;
  const parts = times.map((t, i) => (t >= 30 ? `Z${i + 1} ${Math.round(t / 60)}′` : null)).filter(Boolean);
  const hardFrom = Math.max(0, times.length - 2);
  const hard = times.slice(hardFrom).reduce((s, t) => s + (t || 0), 0);
  const hardLabel = hardFrom === times.length - 1 ? `Z${times.length}` : `Z${hardFrom + 1}+`;
  return `📊 зони: ${parts.join(' · ')}${hard ? ` · ${hardLabel} ${Math.round((100 * hard) / total)}%` : ''}`;
}

function tailLine(bits: Array<string | null>): string | null {
  const b = bits.filter(Boolean);
  return b.length ? b.join(' · ') : null;
}

function pace(speed?: number): string {
  if (!speed || speed <= 0) return '—';
  const sec = Math.round(1000 / speed);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} /км`;
}

function formatRun(a: IcuActivity, date: string): string {
  const km = (a.distance ?? 0) / 1000;
  // Каденс бігу: одні джерела дають «на одну ногу» (~85), інші — кроки/хв (~170).
  const cad = a.average_cadence ? Math.round(a.average_cadence < 120 ? a.average_cadence * 2 : a.average_cadence) : null;
  return [
    header(date, '#біг'),
    '',
    `🏃 ${km.toFixed(2)} км · ${hms(a.moving_time ?? a.elapsed_time)} · темп ${pace(a.average_speed)}`,
    hrLine(a),
    zonesLine(a),
    tailLine([
      cad ? `👟 каденс ${cad}` : null,
      a.total_elevation_gain ? `⛰ +${Math.round(a.total_elevation_gain)} м` : null,
      a.icu_training_load ? `навантаження ${a.icu_training_load}` : null,
    ]),
  ].filter((l) => l !== null).join('\n');
}

function formatRide(a: IcuActivity, date: string): string {
  const km = (a.distance ?? 0) / 1000;
  const avg = (a.average_speed ?? 0) * 3.6;
  const max = (a.max_speed ?? 0) * 3.6;
  return [
    header(date, '#вело'),
    '',
    `🚴 ${km.toFixed(1)} км · ${hms(a.moving_time ?? a.elapsed_time)} · сер ${avg.toFixed(1)} км/год${max ? ` · макс ${Math.round(max)}` : ''}`,
    hrLine(a),
    zonesLine(a),
    tailLine([
      a.icu_average_watts ? `⚡ ${a.icu_average_watts} Вт${a.icu_weighted_avg_watts ? ` (NP ${a.icu_weighted_avg_watts})` : ''}` : null,
      a.average_cadence ? `🔄 ${Math.round(a.average_cadence)} об/хв` : null,
      a.total_elevation_gain ? `⛰ +${Math.round(a.total_elevation_gain)} м` : null,
      a.icu_training_load ? `навантаження ${a.icu_training_load}` : null,
    ]),
  ].filter((l) => l !== null).join('\n');
}

function formatBoxing(a: IcuActivity, date: string): string {
  return [
    header(date, '#бокс'),
    '',
    `🥊 ${hms(a.moving_time ?? a.elapsed_time)}`,
    hrLine(a),
    zonesLine(a),
    tailLine([
      a.calories ? `🔥 ${a.calories} ккал` : null,
      a.icu_training_load ? `навантаження ${a.icu_training_load}` : null,
    ]),
  ].filter((l) => l !== null).join('\n');
}

function formatOther(a: IcuActivity, date: string): string {
  return [
    header(date, `#${(a.type ?? 'тренування').toLowerCase()}`),
    '',
    `💪 ${esc(a.name ?? a.type ?? 'Тренування')} · ${hms(a.moving_time ?? a.elapsed_time)}`,
    hrLine(a),
    zonesLine(a),
  ].filter((l) => l !== null).join('\n');
}

/**
 * Зала у стилі каналу: «▪ Вправа 80кг × 8,8,6» (один рядок на вправу+вагу, у
 * порядку першої появи — суперсети не розсипаються), знизу підсумок.
 */
export function formatGym(date: string, hashtag: string, fit: FitInfo, a: IcuActivity): string {
  const active = fit.sets.filter((s) => s.active && (s.reps || s.weight || s.duration));
  const lines: string[] = [header(date, hashtag).trimEnd()];

  if (!active.length) {
    lines.push('', '📝 підходи на годиннику не записані');
  } else {
    const groups = new Map<string, { exercise: string; weight: string; reps: string[] }>();
    for (const s of active) {
      const category = s.category ?? 'UNKNOWN';
      const exercise = exerciseDisplayName(category, s.exercise);
      const weight = s.weight && s.weight > 0 ? `${kg(s.weight)}кг`
        : BODYWEIGHT_CATEGORIES.has(category) ? 'в/в' : '?кг';
      const key = `${exercise}|${weight}`;
      if (!groups.has(key)) groups.set(key, { exercise, weight, reps: [] });
      groups.get(key)!.reps.push(s.reps ? String(s.reps) : hms(s.duration));
    }
    lines.push('', ...[...groups.values()].map((g) => `▪ ${esc(g.exercise)} ${g.weight} × ${g.reps.join(',')}`));
  }

  // Підсумок. Відпочинок після останнього підходу не рахуємо (це вже кінець тренування).
  const lastActive = fit.sets.map((s) => s.active).lastIndexOf(true);
  const rests = fit.sets.slice(0, Math.max(lastActive, 0)).filter((s) => !s.active && s.duration);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const tonnage = active.reduce((s, x) => s + (x.weight && x.weight > 0 && x.reps ? x.weight * x.reps : 0), 0);
  const avgSet = avg(active.map((s) => s.duration ?? 0).filter((d) => d > 0));
  const avgRest = avg(rests.map((s) => s.duration!));
  const total = a.elapsed_time ?? fit.elapsed ?? a.moving_time ?? null;

  lines.push('');
  if (active.length) {
    lines.push(`📊 підходів ${active.length}${tonnage ? ` · тоннаж ${thousands(tonnage)} кг` : ''}`);
  }
  const timing = tailLine([
    avgSet ? `підхід ~${hms(avgSet)}` : null,
    avgRest ? `відпочинок ~${hms(avgRest)}` : null,
    total ? `всього ${hms(total)}` : null,
  ]);
  if (timing) lines.push(`⏱ ${timing}`);
  const hr = hrLine(a);
  if (hr) lines.push(hr);
  return lines.join('\n');
}

/**
 * Будує пост для однієї активності. Для не-біг/не-вело качає оригінальний FIT:
 * лише так можна відрізнити залу від боксу (в intervals.icu немає типу «бокс»,
 * він приходить як Workout/Other) і дістати підходи.
 */
/**
 * Посилання на все тренування — щоб узяти з каналу й вставити в чат Клода
 * (через MCP get_activity бере повну картку, включно з підходами зали).
 * Точний шлях на intervals.icu ніде офіційно не задокументований, але це не
 * критично: id читаємо самі з кінця рядка (activityIdFromInput нижче), тож
 * навіть якщо посилання колись не відкриється в браузері, вставлений текст
 * усе одно спрацює.
 */
function activityLink(id: string): string {
  return `https://intervals.icu/activities/${id}`;
}

export async function buildTrainingPost(a: IcuActivity, gymHashtag = '#зал'): Promise<TrainingPost> {
  const date = (a.start_date_local ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const type = a.type ?? '';
  const link = `\n\n🔗 ${activityLink(a.id)}`;

  if (RUN.has(type)) return { activityId: a.id, date, kind: 'run', text: formatRun(a, date) + link };
  if (RIDE.has(type)) return { activityId: a.id, date, kind: 'ride', text: formatRide(a, date) + link };

  const fit = parseFit(await fetchOriginalFit(a.id));
  const hint = `${fit.sport ?? ''} ${fit.subSport ?? ''} ${a.name ?? ''}`.toLowerCase();
  if (hint.includes('box') || hint.includes('бокс')) {
    return { activityId: a.id, date, kind: 'boxing', text: formatBoxing(a, date) + link };
  }
  if (type === 'WeightTraining' || fit.sets.length || hint.includes('strength')) {
    return { activityId: a.id, date, kind: 'gym', text: formatGym(date, gymHashtag, fit, a) + link };
  }
  return { activityId: a.id, date, kind: 'other', text: formatOther(a, date) + link };
}
