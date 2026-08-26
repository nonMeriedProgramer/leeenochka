// ─── Тренувальна програма (дані) ─────────────────────────────────
// Верх тіла, 16 тижнів, гібрид сила+маса. Головні вправи рахуються від
// РВ6 (робоча вага на чистих 6 повторів) — та сама логіка, що в
// Gym_Upper_16weeks.xlsx. Підсобка — фіксовані стартові ваги, ведуться
// подвійною прогресією вручну (через лог).

export type Phase = 'Реінтро' | 'Накопичення A' | 'Відкат' | 'Накопичення B' | 'Пік' | 'Ретест';

export interface WeekSpec {
  week: number;
  phase: Phase;
  pct: number;      // % від РВ6
  reps: string;      // текст для відображення, напр. "6–8"
  sets: number;
  rir: string;
}

export const TOTAL_WEEKS = 16;

export const WEEKS: WeekSpec[] = [
  { week: 1, phase: 'Реінтро', pct: 85, reps: '6–8', sets: 2, rir: '3–4' },
  { week: 2, phase: 'Реінтро', pct: 90, reps: '6–8', sets: 2, rir: '3' },
  { week: 3, phase: 'Накопичення A', pct: 92.5, reps: '6', sets: 3, rir: '2–3' },
  { week: 4, phase: 'Накопичення A', pct: 95, reps: '6', sets: 3, rir: '2' },
  { week: 5, phase: 'Накопичення A', pct: 97.5, reps: '6', sets: 3, rir: '2' },
  { week: 6, phase: 'Накопичення A', pct: 100, reps: '6', sets: 3, rir: '1–2' },
  { week: 7, phase: 'Відкат', pct: 80, reps: '6', sets: 2, rir: '4' },
  { week: 8, phase: 'Накопичення B', pct: 97.5, reps: '6', sets: 3, rir: '2' },
  { week: 9, phase: 'Накопичення B', pct: 100, reps: '6', sets: 3, rir: '2' },
  { week: 10, phase: 'Накопичення B', pct: 102.5, reps: '5', sets: 3, rir: '1–2' },
  { week: 11, phase: 'Накопичення B', pct: 105, reps: '5', sets: 3, rir: '1' },
  { week: 12, phase: 'Відкат', pct: 82.5, reps: '5', sets: 2, rir: '4' },
  { week: 13, phase: 'Пік', pct: 102.5, reps: '5', sets: 3, rir: '1–2' },
  { week: 14, phase: 'Пік', pct: 105, reps: '4', sets: 3, rir: '1' },
  { week: 15, phase: 'Пік', pct: 110, reps: '3', sets: 3, rir: '0–1' },
  { week: 16, phase: 'Ретест', pct: 100, reps: 'тест', sets: 2, rir: '—' },
];

export function weekSpec(week: number): WeekSpec {
  const w = Math.max(1, Math.min(TOTAL_WEEKS, week));
  return WEEKS[w - 1];
}

/** Округлення до кроку 2.5 кг (як млинці в залі). */
export function m25(v: number): number {
  return Math.round(v / 2.5) * 2.5;
}

export function weightFromRV6(rv6: number, pct: number): number {
  return m25(rv6 * (pct / 100));
}

// ─── Головні вправи (ключ = рядок у training_maxes) ───────────────
export const MAIN_EXERCISES = {
  bench: 'Жим лежачи',
  dbrow: 'Тяга гантелі в наклоні (в упорі)',
  incline: 'Жим гантелей на скосі',
  pulldown: 'Підтягування з довантаженням',
  ohp: 'Жим гантелей на плечі сидячи',
} as const;
export type MainKey = keyof typeof MAIN_EXERCISES;

// pulldown рахується не абсолютною вагою, а довантаженням понад власну вагу
// (РВ6=20 означає "+20кг на 6 повторів") — інша база, ніж у решти головних вправ.
export const BODYWEIGHT_ADDED: Partial<Record<MainKey, true>> = { pulldown: true };

export const DEFAULT_MAXES: Record<MainKey, number> = {
  bench: 100, dbrow: 40, incline: 30, pulldown: 20, ohp: 22,
};

// ─── Три дні (дані як в Excel/Огляд) ──────────────────────────────
export type DayKind = 'main' | 'acc' | 'acc_bw' | 'text';

export interface SessionExercise {
  name: string;
  goal: string;
  kind: DayKind;
  mainKey?: MainKey;   // для kind='main' — рахуємо від РВ6
  w?: number[];        // для kind='acc'/'acc_bw' — вага по тижнях (16 значень), 0 = без вихідної ваги
  txt?: string;         // для kind='text'
}

export interface DayTemplate {
  dayNumber: 1 | 2 | 3;
  key: string;          // 'd1' | 'd2' | 'd3'
  title: string;
  subtitle: string;
  items: SessionExercise[];
}

function ramp(vals: number[]): number[] {
  // допоміжне: масив із 16 значень уже прописаний вручну нижче (як в Excel-генераторі)
  return vals;
}

export const DAYS: DayTemplate[] = [
  {
    dayNumber: 1, key: 'd1', title: 'День 1 — Жим', subtitle: 'груди · трицепс · плечі',
    items: [
      { name: 'Жим лежачи', goal: 'за схемою тижня', kind: 'main', mainKey: 'bench' },
      { name: 'Жим гантелей на скосі', goal: 'за схемою тижня', kind: 'main', mainKey: 'incline' },
      { name: 'Розводка на плечі (сер. дельта)', goal: '3×12–15', kind: 'acc', w: ramp([12,12,14,14,14,16,12,16,16,16,18,14,18,18,18,14]) },
      { name: 'Розгинання на трицепс у блоці', goal: '3×10–12', kind: 'acc', w: ramp([45,45,50,55,55,60,45,60,60,65,65,55,65,70,70,55]) },
      { name: 'Французький жим / з-за голови', goal: '3×10–12', kind: 'acc', w: ramp([40,40,45,45,50,50,40,50,55,55,55,45,55,60,60,45]) },
      { name: 'Планка (кор, анти-екстензія)', goal: '3×45–75 с', kind: 'text', txt: 'власна вага' },
    ],
  },
  {
    dayNumber: 2, key: 'd2', title: 'День 2 — Тяга', subtitle: 'спина · біцепс',
    items: [
      { name: 'Тяга верхнього блоку / підтягування', goal: 'за схемою тижня', kind: 'main', mainKey: 'pulldown' },
      { name: 'Тяга гантелі в наклоні (в упорі)', goal: 'за схемою тижня', kind: 'main', mainKey: 'dbrow' },
      { name: 'Тяга на прямих руках', goal: '3×12', kind: 'acc', w: ramp([55,55,60,60,65,65,55,65,70,70,70,60,70,72.5,72.5,60]) },
      { name: 'Задня дельта (розводка/машина)', goal: '3×12–15', kind: 'acc', w: ramp([55,55,60,60,64,64,55,64,68,68,71,60,68,71,71,60]) },
      { name: 'Підйом гантелей на біцепс', goal: '3×10–12', kind: 'acc', w: ramp([16,16,18,18,20,20,16,20,22,22,22,18,22,24,24,18]) },
      { name: 'Молотки', goal: '3×10–12', kind: 'acc', w: ramp([16,16,18,18,18,20,16,20,20,22,22,18,22,22,24,18]) },
      { name: 'Планка (кор)', goal: '3×45–75 с', kind: 'text', txt: 'власна вага' },
    ],
  },
  {
    dayNumber: 3, key: 'd3', title: 'День 3 — Мікс + ноги', subtitle: 'плечі · руки · витривалість',
    items: [
      { name: 'Жим гантелей на плечі сидячи', goal: 'за схемою тижня', kind: 'main', mainKey: 'ohp' },
      { name: 'Жим у смітч / Хаммер (груди)', goal: '3×8–10', kind: 'acc', w: ramp([45,45,50,55,55,60,45,60,60,65,65,55,65,70,70,55]) },
      { name: 'Горизонтальна тяга (легша)', goal: '3×10–12', kind: 'acc', w: ramp([55,55,60,60,65,65,55,65,70,70,72.5,60,70,72.5,72.5,60]) },
      { name: 'Брусся в гравітроні', goal: '3×8–10', kind: 'acc_bw', w: ramp([0,0,5,5,10,10,0,10,15,15,20,5,20,24,24,10]) },
      { name: 'Штанга на біцепс', goal: '3×8–10', kind: 'acc', w: ramp([30,30,35,35,38,38,30,38,40,40,42.5,35,42.5,45,45,35]) },
      { name: 'Розгинання ніг (витривалість)', goal: '2–3×15–20', kind: 'acc', w: ramp([40,40,45,45,50,50,40,50,50,55,55,45,55,55,60,45]) },
      { name: 'Литки', goal: '3×15–20', kind: 'acc', w: ramp([40,40,50,50,60,60,40,60,60,70,70,50,70,70,80,50]) },
      { name: 'Скакалка / стрибки (спритність)', goal: '5–8 хв', kind: 'text', txt: 'кардіо/спритність' },
    ],
  },
];

export function dayByKey(key: string): DayTemplate | undefined {
  return DAYS.find((d) => d.key === key);
}
