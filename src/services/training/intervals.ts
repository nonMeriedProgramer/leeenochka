import db from '../../db/index.js';
import { kyivNow } from '../../utils/kyiv.js';

// ─── Wellness з Intervals.icu ─────────────────────────────────────
// Intervals.icu підключений до Garmin Connect офіційно (через сторінку згоди Garmin),
// тож тут жодного логіну в Garmin і блокувань: беремо дані за постійним API-ключем.
// Пишемо в ту саму таблицю garmin_wellness, з якою вже працюють бриф, картинка й агент.
// Body Battery і Training Readiness Garmin стороннім сервісам не віддає, тому ці поля
// зазвичай лишаються null (readiness заповниться, якщо Intervals її таки отримає).

interface IntervalsWellness {
  id: string;               // дата 'YYYY-MM-DD'
  restingHR?: number | null;
  hrv?: number | null;      // rMSSD, мс
  sleepSecs?: number | null;
  sleepScore?: number | null;
  stress?: number | null;
  steps?: number | null;
  readiness?: number | null;
}

// Колонки garmin_wellness — INTEGER, а Intervals може віддати дробове значення.
const int = (v: number | null | undefined) => (v == null ? null : Math.round(v));

function shiftDate(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Тягне wellness за останні 3 дні з Intervals.icu і upsert-ить у garmin_wellness. Повертає короткий звіт. */
export async function syncWellnessFromIntervals(): Promise<string> {
  const apiKey = process.env.INTERVALS_API_KEY;
  if (!apiKey) throw new Error('Не задано INTERVALS_API_KEY (Intervals.icu → Settings → Developer Settings).');
  const athlete = process.env.INTERVALS_ATHLETE_ID || '0'; // '0' — атлет, якому належить ключ

  const newest = kyivNow().date;
  const oldest = shiftDate(newest, -2);
  const url = `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athlete)}/wellness?oldest=${oldest}&newest=${newest}`;

  const res = await fetch(url, {
    headers: { Authorization: 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64') },
  });
  if (!res.ok) {
    throw new Error(`Intervals.icu відповів ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const days = await res.json() as IntervalsWellness[];

  let written = 0;
  for (const w of days) {
    if (!w?.id) continue;
    const sleepHours = w.sleepSecs ? Math.round((w.sleepSecs / 3600) * 10) / 10 : null;
    await db.run(
      `INSERT INTO garmin_wellness
         (date, resting_hr, hrv_ms, sleep_hours, sleep_score, stress_avg, steps, training_readiness, raw, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb, now())
       ON CONFLICT (date) DO UPDATE SET
         resting_hr = EXCLUDED.resting_hr, hrv_ms = EXCLUDED.hrv_ms,
         sleep_hours = EXCLUDED.sleep_hours, sleep_score = EXCLUDED.sleep_score,
         stress_avg = EXCLUDED.stress_avg, steps = EXCLUDED.steps,
         training_readiness = EXCLUDED.training_readiness,
         raw = EXCLUDED.raw, updated_at = now()`,
      [w.id, int(w.restingHR), int(w.hrv), sleepHours,
        int(w.sleepScore), int(w.stress), int(w.steps), int(w.readiness), JSON.stringify(w)],
    );
    written++;
  }
  return `Intervals.icu: оновлено днів — ${written} (${oldest}…${newest}).`;
}
