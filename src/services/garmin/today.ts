// ─── Повний денний знімок Garmin — для вечірнього звіту ────────────────
// На відміну від morning.ts (оптимізований під момент пробудження: сон,
// готовність, статус), тут один запит о 22:00, коли добові цифри вже майже
// остаточні: кроки, заряд тіла, стрес, дистанція, поверхи, SpO2.
import { garminDisplayName, garminGet } from './client.js';

export interface GarminDayStats {
  steps: number | null;
  stepGoal: number | null;
  distanceM: number | null;
  floors: number | null;
  activeKcal: number | null;
  totalKcal: number | null;
  intensityMin: number | null;
  intensityGoal: number | null;
  restingHr: number | null;
  spo2Avg: number | null;
  /** Коли годинник востаннє синхронізувався — цифри дня свіжі рівно до цієї миті. */
  lastSync: number | null;
  bodyBattery: { now: number | null; highest: number | null; lowest: number | null };
  stress: {
    avg: number | null; qualifier: string | null;
    restPct: number | null; lowPct: number | null; mediumPct: number | null; highPct: number | null;
  };
}

type J = Record<string, any>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function parseDayStats(d: J): GarminDayStats {
  const mod = num(d.moderateIntensityMinutes);
  const vig = num(d.vigorousIntensityMinutes);
  return {
    steps: num(d.totalSteps),
    stepGoal: num(d.dailyStepGoal),
    distanceM: num(d.totalDistanceMeters),
    floors: num(d.floorsAscended),
    activeKcal: num(d.activeKilocalories),
    totalKcal: num(d.totalKilocalories),
    intensityMin: mod == null && vig == null ? null : (mod ?? 0) + 2 * (vig ?? 0),
    intensityGoal: num(d.intensityMinutesGoal),
    restingHr: num(d.restingHeartRate),
    spo2Avg: num(d.averageSpo2),
    // Garmin віддає без зони — це UTC, дарма що поле зветься просто timestamp.
    lastSync: typeof d.lastSyncTimestampGMT === 'string' ? Date.parse(`${d.lastSyncTimestampGMT}Z`) || null : null,
    bodyBattery: { now: num(d.bodyBatteryMostRecentValue), highest: num(d.bodyBatteryHighestValue), lowest: num(d.bodyBatteryLowestValue) },
    stress: {
      avg: num(d.averageStressLevel), qualifier: str(d.stressQualifier),
      restPct: num(d.restStressPercentage), lowPct: num(d.lowStressPercentage),
      mediumPct: num(d.mediumStressPercentage), highPct: num(d.highStressPercentage),
    },
  };
}

export interface GarminActivity {
  id: string;
  name: string | null;
  type: string | null;
  seconds: number | null;
  avgHr: number | null;
  maxHr: number | null;
  distanceM: number | null;
  calories: number | null;
}

/**
 * Тренування за день напряму з Garmin. Потрібно саме це, а не intervals.icu:
 * туди активність приїжджає з затримкою і о 22:00 сьогоднішнього ще може не бути.
 */
export async function fetchGarminActivities(date: string): Promise<GarminActivity[]> {
  const list = await garminGet<J[]>('/activitylist-service/activities/search/activities', { startDate: date, endDate: date });
  if (!Array.isArray(list)) return [];
  return list.map((a) => ({
    id: String(a.activityId ?? ''),
    name: str(a.activityName),
    type: str(a.activityType?.typeKey),
    seconds: num(a.duration),
    avgHr: num(a.averageHR),
    maxHr: num(a.maxHR),
    distanceM: num(a.distance),
    calories: num(a.calories),
  }));
}

export async function fetchGarminDayStats(date: string): Promise<GarminDayStats> {
  const name = await garminDisplayName();
  const data = await garminGet<J>(`/usersummary-service/usersummary/daily/${name}`, { calendarDate: date });
  return parseDayStats(data);
}
