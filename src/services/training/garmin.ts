// ─── Garmin → training_logs (мапінг + confirm-флоу) ───────────────
// tools/garmin_sync.py (окремий процес, офлайн-friendly) пише сирі й легко
// розпарсені силові сети в garmin_activities (processed=false). Тут ми
// перетворюємо їх на пропозиції для бота: людина підтверджує — тоді запис
// іде в training_logs. Ніякого автозапису без підтвердження (Garmin іноді
// плутає вправу або не бачить вагу).

import db from '../../db/index.js';
import { MAIN_EXERCISES, type MainKey } from './program.js';
import { logWorkout } from './index.js';
import { postWorkoutToChannel } from './channel.js';

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

// Категорія (+ підвправа, коли треба розрізнити варіант) → наша головна вправа.
// PULL_UP охоплює як турнік, так і верхній блок у каталозі Garmin — обидва
// рахуємо як pulldown, бо це один пункт нашої програми.
function toMainKey(category: string, name: string | null): MainKey | null {
  const n = (name ?? '').toUpperCase();
  switch (category) {
    case 'BENCH_PRESS': return n.includes('INCLINE') ? 'incline' : 'bench';
    case 'SHOULDER_PRESS': return 'ohp';
    case 'PULL_UP': return 'pulldown';
    case 'ROW': return (n.includes('DUMBBELL') || n.includes('ONE_ARM')) ? 'dbrow' : null;
    default: return null;
  }
}

const ACCESSORY_NAMES: Record<string, string> = {
  LATERAL_RAISE: 'Розводка на плечі', TRICEPS_EXTENSION: 'Розгинання на трицепс',
  CURL: 'Підйом на біцепс', SHRUG: 'Шраги', FLYE: 'Розведення (флай)',
  CALF_RAISE: 'Литки', LEG_CURL: 'Розгинання/згинання ніг', SQUAT: 'Присід',
  LUNGE: 'Випади', DEADLIFT: 'Тяга (станова — увага, поза програмою)',
  PLANK: 'Планка', CRUNCH: 'Прес', SIT_UP: 'Прес', CORE: 'Кор',
  PUSH_UP: 'Віджимання', HYPEREXTENSION: 'Гіперекстензія',
};

function humanize(category: string): string {
  return ACCESSORY_NAMES[category]
    ?? category.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');
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
      const key = toMainKey(g.category, g.name);
      const exerciseName = key ? MAIN_EXERCISES[key] : humanize(g.category);
      const weightStr = g.weight_kg != null ? `${g.weight_kg} кг` : 'без ваги';
      const label = `${exerciseName}: ${weightStr} × ${g.reps.join(',')}`;
      return {
        label,
        create: async () => {
          await logWorkout({
            exercise: exerciseName, weight: g.weight_kg, reps: g.reps,
            source: 'garmin', garminActivityId: row.garmin_id, date,
          });
          postWorkoutToChannel([{ exercise: exerciseName, weight: g.weight_kg, reps: g.reps }], '⌚').catch(() => {});
          return `⌚ ${label}`;
        },
      };
    });
}
