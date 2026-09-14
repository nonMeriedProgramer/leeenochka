// ─── Garmin → training_logs (мапінг + confirm-флоу) ───────────────
// tools/garmin_sync.py (окремий процес, офлайн-friendly) пише сирі й легко
// розпарсені силові сети в garmin_activities (processed=false). Тут ми
// перетворюємо їх на пропозиції для бота: людина підтверджує — тоді запис
// іде в training_logs. Ніякого автозапису без підтвердження (Garmin іноді
// плутає вправу або не бачить вагу).
// У канал звідси НЕ постимо: пост зали йде автоматично о 21:00 з intervals.icu
// (див. eveningPost.ts), інакше та сама сесія з'явилась би в каналі двічі.

import db from '../../db/index.js';
import { exerciseDisplayName } from './exerciseNames.js';
import { logWorkout } from './index.js';

interface GarminSetGroup {
  category: string;
  name: string | null;
  weight_kg: number | null;
  reps: number[];
}

interface GarminActivityRow {
  garmin_id: string;
  activity_date: string | null;
  type: string | null;
  name: string | null;
  parsed: GarminSetGroup[] | null;
}

export interface GarminProposal { label: string; create: () => Promise<string>; }

// ─── Wellness (сон, HRV, body battery, ...) — пише tools/garmin_sync.py ────
export interface WellnessRow {
  date: string;
  resting_hr: number | null;
  hrv_ms: number | null;
  sleep_hours: number | null;
  sleep_score: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  body_battery_current: number | null;
  stress_avg: number | null;
  steps: number | null;
  training_readiness: number | null;
}

export async function wellnessFor(date: string): Promise<WellnessRow | null> {
  const row = await db.get<WellnessRow>('SELECT * FROM garmin_wellness WHERE date = $1', [date]);
  return row ?? null;
}

/** Один рядок для ранкового брифу; null, якщо по цій даті ще нічого не засинхронізовано. */
export function renderWellness(w: WellnessRow): string | null {
  const parts: string[] = [];
  if (w.sleep_score != null) {
    parts.push(`😴 Сон: ${w.sleep_score}/100${w.sleep_hours != null ? ` (${w.sleep_hours} год)` : ''}`);
  } else if (w.sleep_hours != null) {
    parts.push(`😴 Сон: ${w.sleep_hours} год`);
  }
  if (w.body_battery_current != null) parts.push(`🔋 ${w.body_battery_current}`);
  if (w.training_readiness != null) parts.push(`💪 Готовність: ${w.training_readiness}`);
  return parts.length ? parts.join(' · ') : null;
}

/** Детальний багаторядковий опис усіх наявних метрик — для AI-агента (питання про сон/стрес/пульс/…). */
export function renderWellnessDetail(w: WellnessRow): string {
  const lines: string[] = [];
  if (w.sleep_score != null || w.sleep_hours != null) {
    const score = w.sleep_score != null ? `${w.sleep_score}/100` : '';
    const hours = w.sleep_hours != null ? `${w.sleep_hours} год` : '';
    lines.push(`😴 Сон: ${[score, hours].filter(Boolean).join(', ')}`);
  }
  if (w.body_battery_current != null) {
    const range = (w.body_battery_high != null && w.body_battery_low != null)
      ? ` (за день ${w.body_battery_high}→${w.body_battery_low})` : '';
    lines.push(`🔋 Body Battery зараз: ${w.body_battery_current}${range}`);
  }
  if (w.training_readiness != null) lines.push(`💪 Готовність до тренування: ${w.training_readiness}/100`);
  if (w.hrv_ms != null) lines.push(`❤️ HRV (за ніч): ${w.hrv_ms} мс`);
  if (w.resting_hr != null) lines.push(`🫀 Пульс спокою: ${w.resting_hr} уд/хв`);
  if (w.stress_avg != null) lines.push(`😰 Середній стрес: ${w.stress_avg}`);
  if (w.steps != null) lines.push(`👟 Кроки: ${w.steps}`);
  return lines.length ? lines.join('\n') : 'По цій даті ще немає даних з Garmin.';
}

export async function pendingGarminActivities(): Promise<GarminActivityRow[]> {
  return db.query<GarminActivityRow>(
    "SELECT garmin_id, activity_date, type, name, parsed FROM garmin_activities WHERE processed = false ORDER BY activity_date DESC",
  );
}

export async function markGarminProcessed(garminId: string): Promise<void> {
  await db.run('UPDATE garmin_activities SET processed = true WHERE garmin_id = $1', [garminId]);
}

/** Будує пункти чеклиста для одної Garmin-активності (один пункт = одна вправа). */
export function proposalsFromActivity(row: GarminActivityRow): GarminProposal[] {
  const groups = row.parsed ?? [];
  const date = row.activity_date ?? new Date().toISOString().slice(0, 10);
  return groups
    .filter((g) => g.reps.length > 0)
    .map((g) => {
      const exerciseName = exerciseDisplayName(g.category, g.name);
      const weightStr = g.weight_kg != null ? `${g.weight_kg} кг` : 'без ваги';
      const label = `${exerciseName}: ${weightStr} × ${g.reps.join(',')}`;
      return {
        label,
        create: async () => {
          await logWorkout({
            exercise: exerciseName, weight: g.weight_kg, reps: g.reps,
            source: 'garmin', garminActivityId: row.garmin_id, date,
          });
          return `⌚ ${label}`;
        },
      };
    });
}
