// ─── Назви вправ Garmin → назви в нашому лозі ──────────────────────
// Спільне для garmin.ts (garminconnect, UPPER_SNAKE з API) та intervals.ts
// (FIT-файл, camelCase) — обидва приводять категорію до UPPER_SNAKE.
// Без БД, щоб форматування постів можна було перевіряти локально.

import { MAIN_EXERCISES, type MainKey } from './program.js';

// Категорія (+ підвправа, коли треба розрізнити варіант) → наша головна вправа.
// PULL_UP охоплює як турнік, так і верхній блок у каталозі Garmin — обидва
// рахуємо як pulldown, бо це один пункт нашої програми.
export function toMainKey(category: string, name: string | null): MainKey | null {
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
  UNKNOWN: 'Вправа', WARM_UP: 'Розминка', CARDIO: 'Кардіо', CARRY: 'Прогулянка фермера',
};

export function humanize(category: string): string {
  return ACCESSORY_NAMES[category]
    ?? category.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');
}

/** Назва для логу/каналу: головна вправа програми або зрозуміла назва допоміжної. */
export function exerciseDisplayName(category: string, name: string | null): string {
  const key = toMainKey(category, name);
  return key ? MAIN_EXERCISES[key] : humanize(category);
}

/** Категорії, де вага за замовчуванням — власна (0 кг означає «в/в», а не «не вписано»). */
export const BODYWEIGHT_CATEGORIES = new Set([
  'PULL_UP', 'PUSH_UP', 'PLANK', 'CRUNCH', 'SIT_UP', 'CORE', 'LEG_RAISE', 'HYPEREXTENSION',
]);

/** benchPress / inclineBarbellBenchPress → BENCH_PRESS / INCLINE_BARBELL_BENCH_PRESS */
export function camelToUpperSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}
