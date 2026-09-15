// ─── Динамічна статистика ранкового брифу ───────────────────────────
// На відміну від garmin.ts (WellnessRow — знімок одного дня з локальної БД;
// саме звідти йшов баг "кроки під час пробудження" — о 8:00 їх ще майже нема),
// тут щоранку свіжий запит в intervals.icu за останні 30 днів: Fitness/Fatigue/
// Form (CTL/ATL/Form — власні тренувальні метрики intervals.icu, рахуються з
// усієї історії навантаження, а не з Garmin) і дельта сьогодні-проти-особистого-
// середнього для сну/HRV/пульсу спокою — так само, як показує сам Гармін.
// Кроки — за ВЧОРА (завершений день), не за сьогодні.

import { kyivNow } from '../../utils/kyiv.js';
import { fetchWellness, intervalsConfigured, type IcuWellness } from '../training/intervals.js';

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function avg(nums: Array<number | null | undefined>): number | null {
  const v = nums.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  return v.length ? v.reduce((s, n) => s + n, 0) / v.length : null;
}

export interface Trend { value: number; delta: number | null }
function trend(value: number | null | undefined, baseline: number | null): Trend | null {
  if (value == null) return null;
  return { value, delta: baseline != null ? Math.round((value - baseline) * 10) / 10 : null };
}

export interface BriefStats {
  fitness: number | null;  // CTL
  fatigue: number | null;  // ATL
  form: number | null;     // CTL - ATL
  sleepScore: Trend | null;
  sleepHours: number | null;
  hrv: Trend | null;
  restingHr: Trend | null;
  stepsYesterday: Trend | null;
  readiness: number | null;
}

/** null — intervals.icu не підключено, або за 30 днів узагалі нема жодного запису. */
export async function fetchBriefStats(): Promise<BriefStats | null> {
  if (!intervalsConfigured()) return null;
  const today = kyivNow().date;
  let rows: IcuWellness[];
  try {
    rows = await fetchWellness(shiftDate(today, -30), today);
  } catch (e) {
    console.error('fetchBriefStats: intervals.icu wellness failed:', e instanceof Error ? e.message : e);
    return null;
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.id.localeCompare(b.id));

  // О 8 ранку сьогоднішній рядок може ще не встигнути прийти (сон синкається
  // після пробудження) — тоді беремо останній наявний, а не показуємо пустку.
  const todayRow = rows.find((r) => r.id === today) ?? rows[rows.length - 1];
  const history = rows.filter((r) => r.id !== todayRow.id);

  const yesterday = shiftDate(today, -1);
  const yesterdayRow = rows.find((r) => r.id === yesterday);
  const stepsBaseline = history.filter((r) => r.id !== yesterday); // вчора не порівнюємо саме з собою

  return {
    fitness: todayRow.ctl != null ? Math.round(todayRow.ctl) : null,
    fatigue: todayRow.atl != null ? Math.round(todayRow.atl) : null,
    form: todayRow.ctl != null && todayRow.atl != null ? Math.round(todayRow.ctl - todayRow.atl) : null,
    sleepScore: trend(todayRow.sleepScore, avg(history.map((r) => r.sleepScore))),
    sleepHours: todayRow.sleepSecs ? Math.round((todayRow.sleepSecs / 3600) * 10) / 10 : null,
    hrv: trend(todayRow.hrv, avg(history.map((r) => r.hrv))),
    restingHr: trend(todayRow.restingHR, avg(history.map((r) => r.restingHR))),
    stepsYesterday: yesterdayRow ? trend(yesterdayRow.steps, avg(stepsBaseline.map((r) => r.steps))) : null,
    readiness: todayRow.readiness != null ? Math.round(todayRow.readiness) : null,
  };
}

/** Form (CTL−ATL) по-людськи: додатне — свіжий, сильно від'ємне — накопичена втома. */
export function formLabel(form: number): string {
  if (form > 5) return 'свіжий';
  if (form < -15) return 'втома накопичується';
  return 'збалансовано';
}
