// Локальний тест генерації картинки брифу (малюється кодом, ключі не потрібні).
// Запуск (з D:\openclaw):
//   node --import=tsx/esm tools/test_brief_image.ts
// Результат — файл brief.png у корені проєкту.
import * as fs from 'node:fs';
import { generateBriefImage } from '../src/services/brief/image.js';
import type { WellnessRow } from '../src/services/training/garmin.js';

const sample: WellnessRow = {
  date: '2026-08-28',
  resting_hr: 55,
  hrv_ms: 49,
  sleep_hours: 6.9,
  sleep_score: 80,
  body_battery_high: 82,
  body_battery_low: 24,
  body_battery_current: 44,
  stress_avg: 23,
  steps: 3566,
  training_readiness: 71,
};

const png = await generateBriefImage(sample, 'четвер, 28 серпня');
if (!png) {
  console.error('❌ Картинку не згенеровано (помилка рендеру).');
  process.exit(1);
}
fs.writeFileSync('brief.png', png);
console.log(`✅ Збережено brief.png (${png.length} байт).`);
