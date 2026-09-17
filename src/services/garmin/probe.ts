// ─── Розвідка: що Garmin реально віддає за день ────────────────────────
// Одноразова діагностика під вечірній звіт. Ходить у кожен ендпоінт окремо
// й описує, що прийшло (скільки точок, ключові поля), без сирого JSON —
// щоб рішення «яку плитку малювати» спиралось на факти, а не на здогадки.
// Команда: /garmin_probe [YYYY-MM-DD]

import { garminDisplayName, garminGet } from './client.js';

type J = Record<string, any>;

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Скільки «живих» точок у серії виду [[ts, value], ...] і діапазон значень. */
function series(arr: unknown, valueIdx = 1): string {
  if (!Array.isArray(arr) || !arr.length) return 'порожньо';
  const vals = arr
    .map((p: any) => (Array.isArray(p) ? n(p[valueIdx]) : n(p?.value)))
    .filter((v): v is number => v != null && v >= 0);
  if (!vals.length) return `${arr.length} точок, але значень немає`;
  return `${arr.length} точок, значення ${Math.min(...vals)}…${Math.max(...vals)}`;
}

interface Probe { label: string; run: (date: string, name: string) => Promise<string> }

const PROBES: Probe[] = [
  {
    label: 'Крива Body Battery',
    run: async (date) => {
      const d = await garminGet<J[]>('/wellness-service/wellness/bodyBattery/reports/daily', { startDate: date, endDate: date });
      const day = Array.isArray(d) ? d[0] : null;
      if (!day) return 'порожньо';
      // [timestamp, status, level, version]
      return `${series(day.bodyBatteryValuesArray, 2)}; заряджено +${n(day.charged) ?? '?'}, злито −${n(day.drained) ?? '?'}`;
    },
  },
  {
    label: 'Події Body Battery',
    run: async (date) => {
      const ev = await garminGet<J[]>(`/wellness-service/wellness/bodyBattery/events/${date}`);
      if (!Array.isArray(ev) || !ev.length) return 'порожньо';
      const kinds = [...new Set(ev.map((e) => String(e.event?.eventType ?? e.eventType ?? '?')))];
      return `${ev.length} подій: ${kinds.join(', ')}`;
    },
  },
  {
    label: 'Крива стресу',
    run: async (date) => {
      const d = await garminGet<J>(`/wellness-service/wellness/dailyStress/${date}`);
      return `${series(d.stressValuesArray)}; сер. ${n(d.avgStressLevel) ?? '?'}, макс ${n(d.maxStressLevel) ?? '?'}`;
    },
  },
  {
    label: 'Пульс за добу',
    run: async (date, name) => {
      const d = await garminGet<J>(`/wellness-service/wellness/dailyHeartRate/${name}`, { date });
      return `${series(d.heartRateValues)}; спокою ${n(d.restingHeartRate) ?? '?'}, min ${n(d.minHeartRate) ?? '?'}, max ${n(d.maxHeartRate) ?? '?'}`;
    },
  },
  {
    label: 'Кроки по інтервалах',
    run: async (date, name) => {
      const d = await garminGet<J[]>(`/wellness-service/wellness/dailySummaryChart/${name}`, { date });
      if (!Array.isArray(d) || !d.length) return 'порожньо';
      const steps = d.reduce((s, x) => s + (n(x.steps) ?? 0), 0);
      return `${d.length} інтервалів, разом ${steps} кроків`;
    },
  },
  {
    label: 'Поверхи',
    run: async (date) => {
      const d = await garminGet<J>(`/wellness-service/wellness/floorsChartData/daily/${date}`);
      const rows = Array.isArray(d.floorValuesArray) ? d.floorValuesArray : [];
      return rows.length ? `${rows.length} інтервалів` : 'порожньо';
    },
  },
  {
    label: 'Дихання за добу',
    run: async (date) => {
      const d = await garminGet<J>(`/wellness-service/wellness/daily/respiration/${date}`);
      return `${series(d.respirationValuesArray)}; сер. ${n(d.avgSleepRespirationValue) ?? n(d.avgWakingRespirationValue) ?? '?'}`;
    },
  },
  {
    label: 'SpO2 за добу',
    run: async (date) => {
      const d = await garminGet<J>(`/wellness-service/wellness/daily/spo2/${date}`);
      return `сер. ${n(d.averageSpO2) ?? '?'}, найнижчий ${n(d.lowestSpO2) ?? '?'}; ${series(d.spO2HourlyAverages)}`;
    },
  },
  {
    label: 'Інтенсивні хвилини',
    run: async (date) => {
      const d = await garminGet<J>(`/wellness-service/wellness/daily/im/${date}`);
      return `помірні ${n(d.moderateMinutes) ?? '?'}, інтенсивні ${n(d.vigorousMinutes) ?? '?'}, тиждень ${n(d.weeklyTotal) ?? '?'}`;
    },
  },
  {
    label: 'Endurance score',
    run: async (date) => {
      const d = await garminGet<J>('/metrics-service/metrics/endurancescore', { startDate: date, endDate: date });
      return `${n(d.avg) ?? n(d.overallScore) ?? '—'} (${str(d.classification) ?? 'без класифікації'})`;
    },
  },
  {
    label: 'Hill score',
    run: async (date) => {
      const d = await garminGet<J>('/metrics-service/metrics/hillscore', { startDate: date, endDate: date });
      return `${n(d.overallScore) ?? n(d.avg) ?? '—'}`;
    },
  },
  {
    label: 'Тренування за день',
    run: async (date) => {
      const acts = await garminGet<J[]>('/activitylist-service/activities/search/activities', { startDate: date, endDate: date });
      if (!Array.isArray(acts) || !acts.length) return 'немає';
      return acts.map((a) => `${a.activityName ?? a.activityType?.typeKey ?? '?'} ${Math.round((n(a.duration) ?? 0) / 60)} хв`).join('; ');
    },
  },
];

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

// ─── Сира відповідь одного ендпоінта (щоб розібрати незрозумілу структуру) ──
const RAW: Record<string, (date: string, name: string) => Promise<unknown>> = {
  bb: (date) => garminGet('/wellness-service/wellness/bodyBattery/reports/daily', { startDate: date, endDate: date }),
  bbe: (date) => garminGet(`/wellness-service/wellness/bodyBattery/events/${date}`),
  stress: (date) => garminGet(`/wellness-service/wellness/dailyStress/${date}`),
  hr: (date, name) => garminGet(`/wellness-service/wellness/dailyHeartRate/${name}`, { date }),
  steps: (date, name) => garminGet(`/wellness-service/wellness/dailySummaryChart/${name}`, { date }),
  floors: (date) => garminGet(`/wellness-service/wellness/floorsChartData/daily/${date}`),
  resp: (date) => garminGet(`/wellness-service/wellness/daily/respiration/${date}`),
  spo2: (date) => garminGet(`/wellness-service/wellness/daily/spo2/${date}`),
  im: (date) => garminGet(`/wellness-service/wellness/daily/im/${date}`),
  endurance: (date) => garminGet('/metrics-service/metrics/endurancescore', { startDate: date, endDate: date }),
  hill: (date) => garminGet('/metrics-service/metrics/hillscore', { startDate: date, endDate: date }),
};

export const RAW_KEYS = Object.keys(RAW);

/**
 * Сирий JSON ендпоінта, скорочений під ліміт Telegram. Довгі масиви значень
 * ріжемо до кількох елементів — потрібна структура, а не всі точки.
 */
export async function rawGarminSample(key: string, date: string): Promise<string> {
  const fn = RAW[key];
  if (!fn) return `Невідомий ключ. Доступні: ${RAW_KEYS.join(', ')}`;
  let name = '';
  try { name = await garminDisplayName(); } catch { /* більшості ендпоінтів ім'я не треба */ }

  const data = await fn(date, name);
  const short = JSON.parse(JSON.stringify(data), (_k, v) =>
    (Array.isArray(v) && v.length > 4 ? [...v.slice(0, 3), `…ще ${v.length - 3}`] : v));
  return JSON.stringify(short, null, 1).slice(0, 3500);
}

/** Звіт по всіх ендпоінтах: що доступне для вечірньої панелі, а що ні. */
export async function probeGarminDay(date: string): Promise<string> {
  let name: string;
  try {
    name = await garminDisplayName();
  } catch (e) {
    return `✗ Garmin недоступний: ${e instanceof Error ? e.message : String(e)}`;
  }

  const lines = await Promise.all(PROBES.map(async (p) => {
    try {
      return `✅ ${p.label}: ${await p.run(date, name)}`;
    } catch (e) {
      return `❌ ${p.label}: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`;
    }
  }));
  return `Розвідка Garmin за ${date}:\n\n${lines.join('\n')}`;
}
