// ─── Одноразовий імпорт історії з Telegram-логу «gym table» ───────
// Джерело: messages.html (експорт Telegram, січ–чер 2026), розібраний вручну.
// Імпортуються ЛИШЕ записи з однозначною нотацією ваги/повторів — усе, де
// особистий скоропис допускав кілька прочитань («90(5)-95(4х5)», «12-10х3»
// тощо), свідомо пропущено, а не вгадано. Ідемпотентно: пропускає рядок,
// якщо точно такий (дата, вправа, вага) уже є в training_logs.
//
// Запуск (треба DATABASE_URL тієї ж Postgres, що бачить бот):
//   DATABASE_URL=postgres://... node --import=tsx/esm tools/import-history.ts

import db, { initDb } from '../src/db/index.js';
import { setMax } from '../src/services/training/index.js';
import { MAIN_EXERCISES } from '../src/services/training/program.js';

interface HistEntry {
  date: string;         // YYYY-MM-DD (дата тренування з тексту повідомлення)
  exercise: string;     // назва з MAIN_EXERCISES
  weight: number;
  reps: number[];
  note?: string;
}

const BENCH = MAIN_EXERCISES.bench;
const DBROW = MAIN_EXERCISES.dbrow;
const OHP = MAIN_EXERCISES.ohp;
const PULLDOWN = MAIN_EXERCISES.pulldown; // вага = довантаження понад власну (0 = чисто власна вага)

// ── Жим лежачи (штанга, флет) — 15 однозначних точок ──────────────
const HISTORY: HistEntry[] = [
  { date: '2026-01-14', exercise: BENCH, weight: 100, reps: [6, 6, 6] },
  { date: '2026-01-25', exercise: BENCH, weight: 105, reps: [4, 4, 4, 4] },
  { date: '2026-02-01', exercise: BENCH, weight: 110, reps: [3, 3, 3] },
  { date: '2026-02-09', exercise: BENCH, weight: 120, reps: [2], note: 'з історії: розминка 100,115 перед робочим' },
  { date: '2026-02-27', exercise: BENCH, weight: 90, reps: [10, 10, 10] },
  { date: '2026-03-13', exercise: BENCH, weight: 100, reps: [9, 8, 6] },
  { date: '2026-03-23', exercise: BENCH, weight: 110, reps: [4, 4, 3], note: 'з історії: розминка 100х4 перед робочим' },
  { date: '2026-04-06', exercise: BENCH, weight: 100, reps: [8, 5, 4], note: 'з історії: розминка 90х6 перед робочим' },
  { date: '2026-04-14', exercise: BENCH, weight: 100, reps: [6, 5, 5, 5, 4] },
  { date: '2026-04-21', exercise: BENCH, weight: 100, reps: [5, 3], note: 'з історії: потім легше 90х6' },
  { date: '2026-04-29', exercise: BENCH, weight: 100, reps: [5, 6, 7] },
  { date: '2026-05-06', exercise: BENCH, weight: 110, reps: [4, 3, 3] },
  { date: '2026-05-19', exercise: BENCH, weight: 80, reps: [7, 10, 7], note: 'з історії: легка відновлювальна після спартану' },
  { date: '2026-06-09', exercise: BENCH, weight: 100, reps: [6, 5, 6, 5] },
  { date: '2026-06-22', exercise: BENCH, weight: 80, reps: [10, 10, 8, 6] },

  // ── Тяга гантелі в наклоні — 3 однозначні точки ──────────────────
  { date: '2026-04-08', exercise: DBROW, weight: 40, reps: [8], note: 'з історії: розминка 22,30,36 перед робочим' },
  { date: '2026-04-16', exercise: DBROW, weight: 40, reps: [8, 8, 8] },
  { date: '2026-05-27', exercise: DBROW, weight: 36, reps: [12, 12, 12] },

  // ── Жим гантелей на плечі сидячи — 2 точки ───────────────────────
  { date: '2026-01-08', exercise: OHP, weight: 22, reps: [8, 8], note: 'з історії: розминка 18,20 перед робочим' },
  { date: '2026-06-09', exercise: OHP, weight: 32, reps: [10, 10], note: 'з історії: "посидовий жим гантелей"' },

  // ── Підтягування з довантаженням (вага = лише довантаження, 0 = в/в) ──
  { date: '2026-01-17', exercise: PULLDOWN, weight: 16, reps: [7, 7, 7] },
  { date: '2026-02-12', exercise: PULLDOWN, weight: 15, reps: [8, 8, 8, 8] },
  { date: '2026-02-19', exercise: PULLDOWN, weight: 20, reps: [5, 5, 5, 5, 5], note: 'з історії: розминка +10х5 перед робочим' },
  { date: '2026-04-08', exercise: PULLDOWN, weight: 16, reps: [8, 8, 8, 8] },
  { date: '2026-04-24', exercise: PULLDOWN, weight: 0, reps: [10, 10, 10] },
  { date: '2026-05-02', exercise: PULLDOWN, weight: 0, reps: [10, 10, 10] },
  { date: '2026-05-07', exercise: PULLDOWN, weight: 0, reps: [10, 10, 10] },
  { date: '2026-05-24', exercise: PULLDOWN, weight: 8, reps: [8, 8, 8] },
  { date: '2026-05-27', exercise: PULLDOWN, weight: 20, reps: [5, 5, 5, 5, 5], note: 'з історії: з паузою внизу' },
  { date: '2026-06-14', exercise: PULLDOWN, weight: 0, reps: [10, 10, 10] },
];

async function alreadyImported(e: HistEntry): Promise<boolean> {
  const row = await db.get(
    'SELECT 1 FROM training_logs WHERE log_date = $1 AND exercise = $2 AND weight = $3 AND source = $4',
    [e.date, e.exercise, e.weight, 'manual'],
  );
  return !!row;
}

async function main() {
  await initDb();
  let inserted = 0, skipped = 0;

  for (const e of HISTORY) {
    if (await alreadyImported(e)) { skipped++; continue; }
    await db.run(
      `INSERT INTO training_logs (log_date, exercise, weight, reps_json, note, source)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'manual')`,
      [e.date, e.exercise, e.weight, JSON.stringify(e.reps), e.note ?? 'з історії Telegram-логу (січ–чер 2026)'],
    );
    inserted++;
  }

  // Найсвіжіші реальні робочі ваги з історії — точніші за початкові здогадки.
  await setMax('bench', 100);
  await setMax('dbrow', 40);
  await setMax('ohp', 32);
  await setMax('pulldown', 20); // довантаження, не абсолютна вага — див. коментар біля PULLDOWN

  console.log(`Готово: вставлено ${inserted}, пропущено (вже є) ${skipped}.`);
  console.log('РВ6 оновлено з історії: bench=100, dbrow=40, ohp=32, pulldown=+20 (довантаження). incline лишився без змін — у логу немає жодного явного запису цієї вправи.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
