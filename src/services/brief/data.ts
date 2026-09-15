// ─── Усі дані ранкового брифу одним викликом ─────────────────────────
// Garmin (сон із фазами, готовність, статус), intervals.icu (тиждень сну,
// звичні діапазони, навантаження по днях, резервні тренди) і погода —
// паралельно й незалежно: збій одного джерела не валить решту.

import { kyivNow, timeKyiv } from '../../utils/kyiv.js';
import { getUpcomingEvents, isCalendarConnected } from '../calendar/index.js';
import { todaySession } from '../training/index.js';
import { fetchGarminMorning, type GarminMorning } from '../garmin/morning.js';
import { fetchActivities, fetchWellness, intervalsConfigured, type IcuActivity, type IcuWellness } from '../training/intervals.js';
import { computeBriefStats, shiftDate, type BriefStats } from './stats.js';
import { fetchWeather, type Weather } from './weather.js';

export interface PlanItem { time: string | null; title: string; kind: 'event' | 'gym' }

export interface BriefData {
  plan: PlanItem[];
  date: string;            // YYYY-MM-DD, Київ
  dateLabel: string;       // "вівторок, 15 вересня"
  garmin: GarminMorning;
  wellness: IcuWellness[]; // 30 днів, за зростанням дати
  activities: IcuActivity[]; // останні 7 днів
  weather: Weather | null;
  stats: BriefStats | null;
  sources: string[];       // що саме не вдалось (для /brief_debug)
}

async function safe<T>(label: string, sources: string[], fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    sources.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    return fallback;
  }
}

async function gatherPlan(sources: string[]): Promise<PlanItem[]> {
  const items: PlanItem[] = [];
  const todayStr = new Date().toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' });
  if (isCalendarConnected()) {
    const events = await safe('календар', sources, () => getUpcomingEvents(1), []);
    for (const e of events) {
      if (!e.start || new Date(e.start).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' }) !== todayStr) continue;
      items.push({ time: e.start.length > 10 ? timeKyiv(e.start) : null, title: e.title, kind: 'event' });
    }
  }
  const session = await safe('зала', sources, () => todaySession(), null);
  if (session) items.push({ time: null, title: `${session.day.title} · ${session.day.subtitle}`, kind: 'gym' });
  return items;
}

export async function gatherBriefData(): Promise<BriefData> {
  const date = kyivNow().date;
  const dateLabel = new Date().toLocaleDateString('uk-UA', {
    timeZone: 'Europe/Kyiv', weekday: 'long', day: 'numeric', month: 'long',
  });
  const sources: string[] = [];
  const icu = intervalsConfigured();

  const [plan, garmin, wellness, activities, weather] = await Promise.all([
    gatherPlan(sources),
    fetchGarminMorning(date, shiftDate(date, -1)),
    icu ? safe('intervals.icu wellness', sources, () => fetchWellness(shiftDate(date, -30), date), [] as IcuWellness[]) : Promise.resolve([] as IcuWellness[]),
    icu ? safe('intervals.icu активності', sources, () => fetchActivities(shiftDate(date, -6), date), [] as IcuActivity[]) : Promise.resolve([] as IcuActivity[]),
    fetchWeather(),
  ]);

  if (garmin.fatal) sources.push(`Garmin: ${garmin.fatal.message}`);
  sources.push(...garmin.errors.map((e) => `Garmin ${e}`));
  if (!weather) sources.push('погода: Open-Meteo недоступний');

  wellness.sort((a, b) => a.id.localeCompare(b.id));
  return {
    plan, date, dateLabel, garmin, wellness, activities, weather,
    stats: computeBriefStats(wellness, date),
    sources,
  };
}
