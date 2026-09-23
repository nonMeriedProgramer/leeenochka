// ─── Усі дані вечірнього звіту одним викликом ──────────────────────────
// Підсумок дня о 22:00: Garmin (кроки/заряд/стрес/дистанція — майже остаточні
// цифри дня), intervals.icu (тренування сьогодні, звичні діапазони RHR/HRV),
// план на сьогодні, погода й перша подія завтра. Кожне джерело незалежне —
// збій одного не валить решту (той самий підхід, що в brief/data.ts).

import { kyivNow } from '../../utils/kyiv.js';
import { safe } from '../../utils/safe.js';
import { getUpcomingEvents, isCalendarConnected } from '../calendar/index.js';
import { getWeekItems, todayDayKey } from '../plan/index.js';
import { fetchGarminDayStats, type GarminDayStats } from '../garmin/today.js';
import { fetchActivities, fetchWellness, intervalsConfigured, type IcuActivity } from '../training/intervals.js';
import { shiftDate } from '../brief/stats.js';
import { typicalRange } from '../brief/ui.js';
import { fetchWeather } from '../brief/weather.js';

export interface EveningData {
  date: string;
  dateLabel: string;
  garmin: GarminDayStats | null;
  todayActivity: IcuActivity | null;
  daysSinceTraining: number | null; // 0, якщо тренувався сьогодні
  plan: { done: number; total: number };
  rhrRange: { low: number; high: number } | null;
  hrvAvg: number | null;
  hrvRange: { low: number; high: number } | null;
  tomorrowWeather: { code: number; tMax: number; tMin: number } | null;
  tomorrowEvent: { time: string; title: string } | null;
  sources: string[];
}

async function gatherTraining(date: string, sources: string[]): Promise<{ today: IcuActivity | null; daysSince: number | null }> {
  const acts = await safe('intervals.icu тренування', sources, () => fetchActivities(shiftDate(date, -14), date), [] as IcuActivity[]);
  if (!acts.length) return { today: null, daysSince: null };

  const byDate = (a: IcuActivity) => (a.start_date_local ?? '').slice(0, 10);
  const todayActs = acts.filter((a) => byDate(a) === date);
  const today = todayActs.length
    ? todayActs.reduce((longest, a) => ((a.moving_time ?? 0) > (longest.moving_time ?? 0) ? a : longest))
    : null;
  if (today) return { today, daysSince: 0 };

  const lastDate = acts.map(byDate).sort().at(-1) ?? null;
  const daysSince = lastDate ? Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${lastDate}T12:00:00Z`)) / 86_400_000) : null;
  return { today: null, daysSince };
}

async function gatherPlanToday(sources: string[]): Promise<{ done: number; total: number }> {
  const items = await safe('план', sources, () => getWeekItems(), []);
  const today = items.filter((i) => i.day === todayDayKey());
  return { done: today.filter((i) => i.done).length, total: today.length };
}

async function gatherTomorrowEvent(date: string, sources: string[]): Promise<{ time: string; title: string } | null> {
  if (!isCalendarConnected()) return null;
  const tomorrow = shiftDate(date, 1);
  const events = await safe('календар', sources, () => getUpcomingEvents(2), []);
  const first = events.find((e) => e.start && e.start.length > 10 && e.start.slice(0, 10) === tomorrow);
  if (!first?.start) return null;
  const time = new Date(first.start).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
  return { time, title: first.title };
}

export async function gatherEveningData(): Promise<EveningData> {
  const date = kyivNow().date;
  const dateLabel = new Date().toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', weekday: 'long', day: 'numeric', month: 'long' });
  const sources: string[] = [];
  const icu = intervalsConfigured();

  const [garmin, training, plan, wellness, weather, tomorrowEvent] = await Promise.all([
    safe('Garmin', sources, () => fetchGarminDayStats(date), null as GarminDayStats | null),
    gatherTraining(date, sources),
    gatherPlanToday(sources),
    icu ? safe('intervals.icu wellness', sources, () => fetchWellness(shiftDate(date, -30), date), [] as Awaited<ReturnType<typeof fetchWellness>>) : Promise.resolve([]),
    fetchWeather(),
    gatherTomorrowEvent(date, sources),
  ]);

  if (!weather) sources.push('погода: Open-Meteo недоступний');

  // HRV за ніч intervals.icu дає у wellness (Garmin daily-summary його не містить) —
  // сьогоднішній рядок, а якщо ще не прийшов, останній наявний.
  const sorted = [...wellness].sort((a, b) => a.id.localeCompare(b.id));
  const hrvAvg = (sorted.find((r) => r.id === date) ?? sorted.at(-1))?.hrv ?? null;

  return {
    date, dateLabel, garmin,
    todayActivity: training.today, daysSinceTraining: training.daysSince,
    plan,
    rhrRange: typicalRange(wellness.map((r) => r.restingHR)),
    hrvAvg,
    hrvRange: typicalRange(wellness.map((r) => r.hrv)),
    tomorrowWeather: weather?.tomorrow ?? null,
    tomorrowEvent,
    sources,
  };
}
