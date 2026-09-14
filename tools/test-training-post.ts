// ─── Перевірка постів тренувань без БД і без Telegram ──────────────
//   node --import=tsx/esm tools/test-training-post.ts            синтетичні дані (без мережі)
//   INTERVALS_API_KEY=... node --import=tsx/esm tools/test-training-post.ts --latest
//                                                                останнє реальне тренування з intervals.icu

import { Encoder, Profile } from '@garmin/fitsdk';
import {
  buildTrainingPost, fetchActivities, formatGym, parseFit, type IcuActivity,
} from '../src/services/training/intervals.js';

function syntheticGymFit(): Buffer {
  const t0 = new Date('2026-09-13T15:00:00Z');
  const enc = new Encoder();
  enc.onMesg(Profile.MesgNum.FILE_ID, { manufacturer: 'development', product: 1, timeCreated: t0, type: 'activity' });
  enc.onMesg(Profile.MesgNum.SPORT, { sport: 'training', subSport: 'strengthTraining' });
  // [тип, секунди, повтори, кг, категорія, індекс варіанту в *ExerciseName]
  const plan: Array<[string, number, number?, number?, string?, number?]> = [
    ['active', 45, 8, 80, 'benchPress', 1], ['rest', 120],
    ['active', 42, 8, 80, 'benchPress', 1], ['rest', 150],
    ['active', 40, 6, 85, 'benchPress', 1], ['rest', 180],
    ['active', 40, 10, 22, 'benchPress', 9], ['rest', 90],       // жим гантелей на скосі
    ['active', 50, 10, 0, 'pullUp', 0], ['rest', 60],             // суперсет: підтягування в/в
    ['active', 35, 12, 14, 'curl', 0], ['rest', 60],
    ['active', 50, 9, 0, 'pullUp', 0], ['rest', 60],
    ['active', 33, 12, 14, 'curl', 0], ['rest', 60],
    ['active', 38, 12, undefined, 'lateralRaise', 0],               // вагу на годиннику не вписав
    ['rest', 400],                                                  // хвіст після останнього підходу — не рахується
  ];
  let t = t0.getTime();
  for (const [setType, dur, reps, weight, cat, sub] of plan) {
    const m: Record<string, unknown> = { startTime: new Date(t), timestamp: new Date(t + dur * 1000), duration: dur, setType };
    if (setType === 'active') {
      Object.assign(m, { repetitions: reps, category: [cat], categorySubtype: [sub] });
      if (weight !== undefined) m.weight = weight;
    }
    enc.onMesg(Profile.MesgNum.SET, m);
    t += dur * 1000;
  }
  const elapsed = (t - t0.getTime()) / 1000;
  enc.onMesg(Profile.MesgNum.SESSION, { startTime: t0, timestamp: new Date(t), sport: 'training', subSport: 'strengthTraining', totalElapsedTime: elapsed, totalTimerTime: elapsed });
  return Buffer.from(enc.close());
}

async function synthetic() {
  const gym: IcuActivity = { id: 'test-gym', type: 'WeightTraining', start_date_local: '2026-09-13T18:00:00', elapsed_time: 1873, average_heartrate: 112, max_heartrate: 151 };
  console.log(formatGym('2026-09-13', '#груди', parseFit(syntheticGymFit()), gym), '\n' + '─'.repeat(40));

  const run: IcuActivity = { id: 'test-run', type: 'Run', start_date_local: '2026-09-13T19:05:00', moving_time: 2710, distance: 8020, average_speed: 2.96, average_heartrate: 152, max_heartrate: 176, icu_hr_zone_times: [300, 1500, 900, 420, 60], average_cadence: 86, total_elevation_gain: 85, icu_training_load: 64 };
  const ride: IcuActivity = { id: 'test-ride', type: 'Ride', start_date_local: '2026-09-13T08:00:00', moving_time: 9000, distance: 72400, average_speed: 8.05, max_speed: 15.2, average_heartrate: 138, max_heartrate: 171, icu_hr_zone_times: [1200, 5000, 2200, 600, 0], icu_average_watts: 182, icu_weighted_avg_watts: 201, average_cadence: 88, total_elevation_gain: 610, icu_training_load: 142 };
  for (const a of [run, ride]) console.log((await buildTrainingPost(a)).text, '\n' + '─'.repeat(40));
}

async function latest() {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [a] = await fetchActivities(from, today);
  if (!a) { console.log('За 30 днів тренувань немає — перевір підключення Garmin в intervals.icu.'); return; }
  console.log('RAW:', JSON.stringify(a, null, 2).slice(0, 2500), '\n');
  const post = await buildTrainingPost(a);
  console.log(`kind=${post.kind} date=${post.date}\n\n${post.text}`);
}

(process.argv.includes('--latest') ? latest() : synthetic()).catch((e) => { console.error(e); process.exit(1); });
