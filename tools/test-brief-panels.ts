// Рендер панелей брифу на збережених реальних відповідях (без мережі).
//   DATABASE_URL=postgres://x node --import=tsx/esm tools/test-brief-panels.ts <dir-з-json> [sleep|readiness|day|all] [--no-garmin]
// У каталозі: garmin_samples/{sleep,hrv,readiness,training_status,user_summary}.json,
// wellness_75d.json, acts_year.json, weather.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseHrv, parseReadiness, parseSleep, parseTrainingStatus, type GarminMorning } from '../src/services/garmin/morning.js';
import { computeBriefStats, shiftDate } from '../src/services/brief/stats.js';
import { parseWeather } from '../src/services/brief/weather.js';
import type { BriefData } from '../src/services/brief/data.js';

const dir = process.argv[2];
const which = process.argv[3] ?? 'all';
const noGarmin = process.argv.includes('--no-garmin');
const j = (p: string) => (existsSync(path.join(dir, p)) ? JSON.parse(readFileSync(path.join(dir, p), 'utf8')) : null);

const date = '2026-09-15';
const summary = j('garmin_samples/user_summary.json');
const garmin: GarminMorning = noGarmin
  ? { sleep: null, hrv: null, readiness: null, status: null, restingHr: null, restingHr7d: null, bodyBatteryWake: null, yesterday: null, errors: [], fatal: new Error('test: no garmin') }
  : {
    sleep: parseSleep(j('garmin_samples/sleep.json')),
    hrv: parseHrv(j('garmin_samples/hrv.json')),
    readiness: parseReadiness(j('garmin_samples/readiness.json')),
    status: parseTrainingStatus(j('garmin_samples/training_status.json')),
    restingHr: summary?.restingHeartRate ?? null,
    restingHr7d: summary?.lastSevenDaysAvgRestingHeartRate ?? null,
    bodyBatteryWake: summary?.bodyBatteryAtWakeTime ?? null,
    yesterday: { steps: 8120, stepGoal: 7930, stressAvg: 27, intensityMin: 64 },
    errors: [], fatal: null,
  };
const wellness = (j('wellness_75d.json') ?? []).filter((r: any) => r.id >= shiftDate(date, -30) && r.id <= date);
const activities = (j('acts_year.json') ?? []).filter((a: any) => a.start_date_local.slice(0, 10) >= shiftDate(date, -6));
const data: BriefData = {
  plan: [
    { time: '10:00', title: 'Дзвінок з командою', kind: 'event' },
    { time: '13:30', title: 'Обід з Андрієм', kind: 'event' },
    { time: '18:00', title: 'Бокс', kind: 'event' },
    { time: '20:30', title: 'Подзвонити батькам і обговорити поїздку на вихідні', kind: 'event' },
    { time: null, title: 'День 1 · Груди + біцепс', kind: 'gym' },
  ],
  date, dateLabel: 'вівторок, 15 вересня', garmin, wellness, activities,
  weather: j('weather.json') ? parseWeather(j('weather.json'), 'Київ') : null,
  stats: computeBriefStats(wellness, date),
  sources: [],
};

const out = (name: string, png: Buffer) => { const p = path.join(dir, `panel-${name}${noGarmin ? '-fallback' : ''}.png`); writeFileSync(p, png); console.log(name, png.length, '->', p); };
if (which === 'sleep' || which === 'all') out('sleep', await (await import('../src/services/brief/panelSleep.js')).renderSleepPanel(data));
if ((which === 'readiness' || which === 'all') && existsSync(new URL('../src/services/brief/panelReadiness.ts', import.meta.url))) out('readiness', await (await import('../src/services/brief/panelReadiness.js')).renderReadinessPanel(data));
if ((which === 'day' || which === 'all') && existsSync(new URL('../src/services/brief/panelDay.ts', import.meta.url))) out('day', await (await import('../src/services/brief/panelDay.js')).renderDayPanel(data));
