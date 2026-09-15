// ─── Ранкові дані Garmin для брифу ────────────────────────────────────
// Сон із фазами, HRV зі звичним діапазоном, Training Readiness із часом
// відновлення, статус тренувань із гострим/хронічним навантаженням, денна
// статистика. Кожен запит незалежний: якщо впав один (напр. readiness ще не
// порахувався), решта панелей лишається. Якщо ж токен мертвий чи Garmin
// відбиває — fatal, і бриф повністю бере дані з intervals.icu.
//
// Формати звірені з реальними відповідями connectapi (вересень 2026).

import type { StageSegment } from '../brief/svg.js';
import { GarminAuthError, GarminBlockedError, garminConfigured, garminDisplayName, garminGet } from './client.js';

export interface StageInfo { seconds: number; pct: number | null; optimalLow: number | null; optimalHigh: number | null; qualifier: string | null }

export interface GarminSleep {
  score: number | null;
  qualifier: string | null;        // EXCELLENT | GOOD | FAIR | POOR
  totalSec: number;
  startLocal: number;              // «локальний» epoch: настінний час, закодований як UTC
  endLocal: number;
  tzOffsetMs: number;              // local - GMT
  durationQualifier: string | null;
  deep: StageInfo; light: StageInfo; rem: StageInfo;
  awakeSec: number;
  segments: StageSegment[];        // справжній epoch (GMT)
  awakeCount: number | null;
  restlessMoments: number | null;
  avgHr: number | null;
  avgStress: number | null;
  spo2Avg: number | null;
  respirationAvg: number | null;
  hrvAvg: number | null;
  bodyBatteryChange: number | null;
  needMin: number | null;          // потреба у сні на сьогодні
  nextNeedMin: number | null;      // на наступну ніч
  heartRate: Array<{ t: number; v: number }>;
}

export interface GarminHrv { lastNight: number | null; weeklyAvg: number | null; low: number | null; high: number | null; status: string | null }

export type FactorKey = 'sleep' | 'recovery' | 'acwr' | 'hrv' | 'stress' | 'sleepHistory';
export interface ReadinessFactor { key: FactorKey; pct: number | null; feedback: string | null }
export interface GarminReadiness {
  score: number;
  level: string | null;            // PRIME | HIGH | MODERATE | LOW | POOR
  feedbackShort: string | null;
  recoveryHours: number | null;
  factors: ReadinessFactor[];
  acuteLoad: number | null;
  updatedLocal: string | null;
}

export interface LoadBand { value: number; min: number; max: number }
export interface GarminTrainingStatus {
  phrase: string | null;           // RECOVERY | PRODUCTIVE | ...
  acute: number | null;
  chronicMin: number | null;
  chronicMax: number | null;
  acwrStatus: string | null;
  vo2max: number | null;
  balance: { aerobicLow: LoadBand; aerobicHigh: LoadBand; anaerobic: LoadBand; feedback: string | null } | null;
}

export interface GarminDaySummary { steps: number | null; stepGoal: number | null; stressAvg: number | null; intensityMin: number | null }

export interface GarminMorning {
  sleep: GarminSleep | null;
  hrv: GarminHrv | null;
  readiness: GarminReadiness | null;
  status: GarminTrainingStatus | null;
  restingHr: number | null;
  restingHr7d: number | null;
  bodyBatteryWake: number | null;
  yesterday: GarminDaySummary | null;
  errors: string[];                // нефатальні збої окремих запитів
  fatal: Error | null;             // токен/блок — усе з intervals.icu
}

type J = Record<string, any>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const gmt = (s: string): number => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);

const STAGE_BY_LEVEL: Record<number, StageSegment['stage']> = { 0: 'deep', 1: 'light', 2: 'rem', 3: 'awake' };

function stage(seconds: unknown, score: J | undefined): StageInfo {
  return {
    seconds: num(seconds) ?? 0,
    pct: num(score?.value),
    optimalLow: num(score?.optimalStart),
    optimalHigh: num(score?.optimalEnd),
    qualifier: str(score?.qualifierKey),
  };
}

export function parseSleep(data: J): GarminSleep | null {
  const d: J | undefined = data?.dailySleepDTO;
  const total = num(d?.sleepTimeSeconds);
  if (!d || !total) return null;
  const scores: J = d.sleepScores ?? {};

  const segments: StageSegment[] = (Array.isArray(data.sleepLevels) ? data.sleepLevels : [])
    .map((x: J) => ({ start: gmt(x.startGMT), end: gmt(x.endGMT), stage: STAGE_BY_LEVEL[Math.round(x.activityLevel)] }))
    .filter((s: StageSegment) => s.stage && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a: StageSegment, b: StageSegment) => a.start - b.start);

  const startLocal = num(d.sleepStartTimestampLocal) ?? 0;
  const startGmt = num(d.sleepStartTimestampGMT) ?? startLocal;

  return {
    score: num(scores.overall?.value),
    qualifier: str(scores.overall?.qualifierKey),
    totalSec: total,
    startLocal,
    endLocal: num(d.sleepEndTimestampLocal) ?? 0,
    tzOffsetMs: startLocal - startGmt,
    durationQualifier: str(scores.totalDuration?.qualifierKey),
    deep: stage(d.deepSleepSeconds, scores.deepPercentage),
    light: stage(d.lightSleepSeconds, scores.lightPercentage),
    rem: stage(d.remSleepSeconds, scores.remPercentage),
    awakeSec: num(d.awakeSleepSeconds) ?? 0,
    segments,
    awakeCount: num(d.awakeCount),
    restlessMoments: num(data.restlessMomentsCount),
    avgHr: num(d.avgHeartRate),
    avgStress: num(d.avgSleepStress),
    spo2Avg: num(d.averageSpO2Value),
    respirationAvg: num(d.averageRespirationValue),
    hrvAvg: num(data.avgOvernightHrv),
    bodyBatteryChange: num(data.bodyBatteryChange),
    needMin: num(d.sleepNeed?.actual),
    nextNeedMin: num(d.nextSleepNeed?.actual),
    heartRate: (Array.isArray(data.sleepHeartRate) ? data.sleepHeartRate : [])
      .map((p: J) => ({ t: num(p.startGMT) ?? NaN, v: num(p.value) ?? NaN }))
      .filter((p: { t: number; v: number }) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0),
  };
}

export function parseHrv(data: J): GarminHrv | null {
  const s: J | undefined = data?.hrvSummary;
  if (!s) return null;
  return {
    lastNight: num(s.lastNightAvg),
    weeklyAvg: num(s.weeklyAvg),
    low: num(s.baseline?.balancedLow),
    high: num(s.baseline?.balancedUpper),
    status: str(s.status),
  };
}

export function parseReadiness(data: unknown): GarminReadiness | null {
  const list: J[] = Array.isArray(data) ? data : [];
  const r = list
    .filter((x) => num(x.score) != null)
    .sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')))[0];
  if (!r) return null;
  const f = (key: FactorKey, pct: string, fb: string): ReadinessFactor => ({ key, pct: num(r[pct]), feedback: str(r[fb]) });
  return {
    score: r.score,
    level: str(r.level),
    feedbackShort: str(r.feedbackShort),
    recoveryHours: num(r.recoveryTime),
    factors: [
      f('sleep', 'sleepScoreFactorPercent', 'sleepScoreFactorFeedback'),
      f('recovery', 'recoveryTimeFactorPercent', 'recoveryTimeFactorFeedback'),
      f('hrv', 'hrvFactorPercent', 'hrvFactorFeedback'),
      f('acwr', 'acwrFactorPercent', 'acwrFactorFeedback'),
      f('sleepHistory', 'sleepHistoryFactorPercent', 'sleepHistoryFactorFeedback'),
      f('stress', 'stressHistoryFactorPercent', 'stressHistoryFactorFeedback'),
    ].filter((x) => x.pct != null),
    acuteLoad: num(r.acuteLoad),
    updatedLocal: str(r.timestampLocal),
  };
}

/** Garmin віддає дані по пристроях — беремо основний, інакше перший. */
function primary(map: J | undefined): J | null {
  const vals = Object.values(map ?? {}) as J[];
  return vals.find((v) => v?.primaryTrainingDevice) ?? vals[0] ?? null;
}

export function parseTrainingStatus(data: J): GarminTrainingStatus | null {
  if (!data) return null;
  const st = primary(data.mostRecentTrainingStatus?.latestTrainingStatusData);
  const lb = primary(data.mostRecentTrainingLoadBalance?.metricsTrainingLoadBalanceDTOMap);
  const acute: J | undefined = st?.acuteTrainingLoadDTO;
  const band = (v: string, lo: string, hi: string): LoadBand | null => {
    const value = num(lb?.[v]);
    const min = num(lb?.[lo]);
    const max = num(lb?.[hi]);
    return value != null && min != null && max != null ? { value, min, max } : null;
  };
  const aerobicLow = band('monthlyLoadAerobicLow', 'monthlyLoadAerobicLowTargetMin', 'monthlyLoadAerobicLowTargetMax');
  const aerobicHigh = band('monthlyLoadAerobicHigh', 'monthlyLoadAerobicHighTargetMin', 'monthlyLoadAerobicHighTargetMax');
  const anaerobic = band('monthlyLoadAnaerobic', 'monthlyLoadAnaerobicTargetMin', 'monthlyLoadAnaerobicTargetMax');
  const phrase = str(st?.trainingStatusFeedbackPhrase);
  const vo2 = data.mostRecentVO2Max ?? {};
  return {
    phrase: phrase ? phrase.replace(/_\d+$/, '') : null,
    acute: num(acute?.dailyTrainingLoadAcute),
    chronicMin: num(acute?.minTrainingLoadChronic),
    chronicMax: num(acute?.maxTrainingLoadChronic),
    acwrStatus: str(acute?.acwrStatus),
    vo2max: num(vo2.generic?.vo2MaxPreciseValue) ?? num(vo2.cycling?.vo2MaxPreciseValue),
    balance: aerobicLow && aerobicHigh && anaerobic
      ? { aerobicLow, aerobicHigh, anaerobic, feedback: str(lb?.trainingBalanceFeedbackPhrase) }
      : null,
  };
}

/**
 * Реальний (UTC) час завершення сну за цю дату, або null, якщо Garmin ще
 * не синхронізував сон (спиш або годинник ще не скинув дані). Легкий запит —
 * для опитування «прокинувся?» без витягання решти брифу щоразу.
 */
export async function fetchSleepEndReal(date: string): Promise<number | null> {
  if (!garminConfigured()) return null;
  const name = await garminDisplayName();
  const data = await garminGet<J>(`/wellness-service/wellness/dailySleepData/${name}`, { date, nonSleepBufferMinutes: 60 });
  const sleep = parseSleep(data);
  return sleep ? sleep.endLocal - sleep.tzOffsetMs : null;
}

export async function fetchGarminMorning(date: string, yesterday: string): Promise<GarminMorning> {
  const out: GarminMorning = {
    sleep: null, hrv: null, readiness: null, status: null,
    restingHr: null, restingHr7d: null, bodyBatteryWake: null, yesterday: null,
    errors: [], fatal: null,
  };
  if (!garminConfigured()) {
    out.fatal = new GarminAuthError('Garmin не підключений (немає GARMIN_TOKEN_B64)');
    return out;
  }

  let name: string;
  try {
    name = await garminDisplayName();
  } catch (e) {
    out.fatal = e instanceof Error ? e : new Error(String(e));
    return out;
  }

  const run = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      if ((e instanceof GarminAuthError || e instanceof GarminBlockedError) && !out.fatal) out.fatal = e;
      out.errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  const [sleep, hrv, readiness, status, today, yday] = await Promise.all([
    run('сон', () => garminGet<J>(`/wellness-service/wellness/dailySleepData/${name}`, { date, nonSleepBufferMinutes: 60 })),
    run('HRV', () => garminGet<J>(`/hrv-service/hrv/${date}`)),
    run('готовність', () => garminGet<unknown>(`/metrics-service/metrics/trainingreadiness/${date}`)),
    run('статус', () => garminGet<J>(`/metrics-service/metrics/trainingstatus/aggregated/${date}`)),
    run('день', () => garminGet<J>(`/usersummary-service/usersummary/daily/${name}`, { calendarDate: date })),
    run('вчора', () => garminGet<J>(`/usersummary-service/usersummary/daily/${name}`, { calendarDate: yesterday })),
  ]);

  out.sleep = sleep ? parseSleep(sleep) : null;
  out.hrv = hrv ? parseHrv(hrv) : null;
  out.readiness = readiness ? parseReadiness(readiness) : null;
  out.status = status ? parseTrainingStatus(status) : null;
  out.restingHr = num(today?.restingHeartRate) ?? num(sleep?.restingHeartRate);
  out.restingHr7d = num(today?.lastSevenDaysAvgRestingHeartRate);
  out.bodyBatteryWake = num(today?.bodyBatteryAtWakeTime);
  if (yday) {
    const mod = num(yday.moderateIntensityMinutes);
    const vig = num(yday.vigorousIntensityMinutes);
    out.yesterday = {
      steps: num(yday.totalSteps),
      stepGoal: num(yday.dailyStepGoal),
      stressAvg: num(yday.averageStressLevel),
      intensityMin: mod == null && vig == null ? null : (mod ?? 0) + 2 * (vig ?? 0),
    };
  }
  return out;
}
