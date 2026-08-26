import db from '../../db/index.js';
import {
  DAYS, DEFAULT_MAXES, MAIN_EXERCISES, TOTAL_WEEKS, BODYWEIGHT_ADDED,
  m25, weekSpec, weightFromRV6,
  type DayTemplate, type MainKey, type SessionExercise, type WeekSpec,
} from './program.js';
import { DAY_ORDER, dayUk, kyivWeekStart, todayDayKey, type Day } from '../plan/index.js';

export type { Day } from '../plan/index.js';
export { DAY_ORDER, dayUk } from '../plan/index.js';

// ─── Робочі ваги (РВ6) ────────────────────────────────────────────
export async function getMaxes(): Promise<Record<MainKey, number>> {
  const rows = await db.query<{ exercise: string; rv6: string }>('SELECT exercise, rv6 FROM training_maxes');
  const map: Record<string, number> = { ...DEFAULT_MAXES };
  for (const r of rows) map[r.exercise] = Number(r.rv6);
  return map as Record<MainKey, number>;
}

export async function setMax(key: MainKey, rv6: number): Promise<void> {
  await db.run(
    `INSERT INTO training_maxes (exercise, rv6, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (exercise) DO UPDATE SET rv6 = $2, updated_at = now()`,
    [key, rv6],
  );
}

// ─── Тиждень циклу ─────────────────────────────────────────────────
// pg повертає DATE-колонки як JS Date, а не рядок — приводимо явно до
// 'YYYY-MM-DD', інакше нижче зламається парсинг дати.
function toDateStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

export async function cycleStart(): Promise<string | null> {
  const row = await db.get<{ started_on: unknown }>('SELECT started_on FROM training_state WHERE id = 1');
  return toDateStr(row?.started_on);
}

export { toDateStr };

export async function startCycle(date = new Date().toISOString().slice(0, 10)): Promise<void> {
  await db.run(
    `INSERT INTO training_state (id, started_on) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET started_on = $1`,
    [date],
  );
}

export async function currentWeek(): Promise<number> {
  const start = await cycleStart();
  if (!start) return 1;
  const days = Math.floor((Date.now() - new Date(start + 'T00:00:00Z').getTime()) / 86_400_000);
  const week = Math.floor(days / 7) + 1;
  return Math.max(1, Math.min(TOTAL_WEEKS, week));
}

// ─── Розрахунок сесії дня для конкретного тижня ────────────────────
export interface ResolvedExercise { name: string; goal: string; weight: string; }
export interface ResolvedSession {
  day: DayTemplate;
  week: number;
  spec: WeekSpec;
  exercises: ResolvedExercise[];
}

function resolveWeight(it: SessionExercise, week: number, maxes: Record<MainKey, number>, spec: WeekSpec): string {
  if (it.kind === 'main' && it.mainKey) {
    const w = weightFromRV6(maxes[it.mainKey], spec.pct);
    return BODYWEIGHT_ADDED[it.mainKey] ? `+${w} кг` : `${w} кг`;
  }
  if (it.kind === 'acc' && it.w) return `${it.w[week - 1]} кг`;
  if (it.kind === 'acc_bw' && it.w) {
    const add = it.w[week - 1];
    return add > 0 ? `в/в +${add} кг` : 'в/в';
  }
  return it.txt ?? '';
}

export async function resolveDay(day: DayTemplate, week?: number): Promise<ResolvedSession> {
  const wk = week ?? (await currentWeek());
  const spec = weekSpec(wk);
  const maxes = await getMaxes();
  const exercises = day.items.map((it) => ({
    name: it.name, goal: it.goal, weight: resolveWeight(it, wk, maxes, spec),
  }));
  return { day, week: wk, spec, exercises };
}

export function renderSession(s: ResolvedSession): string {
  const lines = [
    `🏋️ ${s.day.title} · ${s.day.subtitle}`,
    `Тиждень ${s.week} · ${s.spec.phase} · головні ${s.spec.sets}×${s.spec.reps}, RIR ${s.spec.rir}`,
    '',
    ...s.exercises.map((e) => `▪ ${e.name}: ${e.weight}${e.goal !== 'за схемою тижня' && e.goal !== s.spec.reps ? ` · ${e.goal}` : ''}`),
  ];
  return lines.join('\n');
}

// ─── Прив'язка дня тижня → День 1/2/3 (обраний розклад) ────────────
export async function gymScheduleFor(ws = kyivWeekStart()): Promise<Day[]> {
  const row = await db.get<{ days: Day[] }>('SELECT days FROM gym_schedule WHERE week_start = $1', [ws]);
  return row?.days ?? [];
}

export async function setGymSchedule(days: Day[], ws = kyivWeekStart()): Promise<void> {
  await db.run(
    `INSERT INTO gym_schedule (week_start, days) VALUES ($1, $2::jsonb)
     ON CONFLICT (week_start) DO UPDATE SET days = $2::jsonb`,
    [ws, JSON.stringify(days)],
  );
}

export async function lastWeekGymDays(ws = kyivWeekStart()): Promise<Day[]> {
  const prev = new Date(ws + 'T12:00:00+03:00');
  prev.setUTCDate(prev.getUTCDate() - 7);
  const prevWs = prev.toISOString().slice(0, 10);
  return gymScheduleFor(prevWs);
}

/** Індекс дня тижня (обраного розкладу) → який зі 1..3 залових днів це. */
export function dayIndexInSchedule(schedule: Day[], day: Day): number | null {
  const i = schedule.indexOf(day);
  return i >= 0 ? i % 3 : null; // якщо обрано >3 днів — циклічно; типово рівно 3
}

/** Сьогоднішня залова сесія, якщо сьогодні є в обраному розкладі. */
export async function todaySession(): Promise<ResolvedSession | null> {
  const schedule = await gymScheduleFor();
  const today = todayDayKey();
  const idx = dayIndexInSchedule(schedule, today);
  if (idx === null) return null;
  return resolveDay(DAYS[idx]);
}

// ─── Лог виконання ──────────────────────────────────────────────────
export interface LogEntry {
  exercise: string; weight?: number | null; reps: number[]; rir?: string; note?: string;
  source?: 'manual' | 'garmin'; garminActivityId?: string; date?: string; week?: number; dayKey?: string;
}

export async function logWorkout(e: LogEntry): Promise<number> {
  const week = e.week ?? (await currentWeek());
  const date = e.date ?? new Date().toISOString().slice(0, 10);
  const rows = await db.query<{ id: number }>(
    `INSERT INTO training_logs (log_date, week, day_key, exercise, weight, reps_json, rir, note, source, garmin_activity_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) RETURNING id`,
    [date, week, e.dayKey ?? null, e.exercise, e.weight ?? null, JSON.stringify(e.reps), e.rir ?? null,
      e.note ?? null, e.source ?? 'manual', e.garminActivityId ?? null],
  );
  return rows[0].id;
}

export async function recentLogs(limit = 20): Promise<Array<LogEntry & { id: number; log_date: string }>> {
  return db.query('SELECT id, log_date, exercise, weight, reps_json AS reps, rir, note, source FROM training_logs ORDER BY log_date DESC, id DESC LIMIT $1', [limit]);
}

export async function logsForExercise(exercise: string, limit = 12): Promise<Array<{ log_date: string; weight: number; reps: number[] }>> {
  return db.query(
    'SELECT log_date, weight, reps_json AS reps FROM training_logs WHERE exercise = $1 AND weight IS NOT NULL ORDER BY log_date DESC LIMIT $2',
    [exercise, limit],
  );
}

export { DAYS, MAIN_EXERCISES, m25, weekSpec };
export type { MainKey, ResolvedSession as Session };
