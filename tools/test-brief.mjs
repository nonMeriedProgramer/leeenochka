// Перевірка логіки нового брифу без мережі: підставляємо власний масив
// wellness-рядків замість запиту в intervals.icu, рахуємо тренди, рендеримо
// картинку. node --import=tsx/esm tools/test-brief.mjs
import { writeFileSync } from 'node:fs';

// ── та сама математика, що в stats.ts (копія для offline-тесту) ──────────
function avg(nums) {
  const v = nums.filter((n) => typeof n === 'number' && Number.isFinite(n));
  return v.length ? v.reduce((s, n) => s + n, 0) / v.length : null;
}
function trend(value, baseline) {
  if (value == null) return null;
  return { value, delta: baseline != null ? Math.round((value - baseline) * 10) / 10 : null };
}

// 31 день: стабільний фон + сьогодні свідомо гірший сон/вищий пульс/нижчий HRV,
// і вчора багато кроків — щоб перевірити, що дельти й кольори рахуються вірно.
const rows = [];
for (let i = 30; i >= 1; i--) {
  const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
  rows.push({ id: d, ctl: 40 + (30 - i) * 0.3, atl: 35, restingHR: 50, hrv: 65, sleepScore: 78, sleepSecs: 7.5 * 3600, steps: 8000 });
}
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
rows.push({ id: today, ctl: 49, atl: 42, restingHR: 55, hrv: 58, sleepScore: 64, sleepSecs: 6.1 * 3600, steps: 1200 });
rows[rows.length - 2].steps = 13400; // вчора — активний день

const todayRow = rows.find((r) => r.id === today);
const history = rows.filter((r) => r.id !== todayRow.id);
const yesterdayRow = rows.find((r) => r.id === yesterday);
const stepsBaseline = history.filter((r) => r.id !== yesterday);

const stats = {
  fitness: Math.round(todayRow.ctl),
  fatigue: Math.round(todayRow.atl),
  form: Math.round(todayRow.ctl - todayRow.atl),
  sleepScore: trend(todayRow.sleepScore, avg(history.map((r) => r.sleepScore))),
  sleepHours: Math.round((todayRow.sleepSecs / 3600) * 10) / 10,
  hrv: trend(todayRow.hrv, avg(history.map((r) => r.hrv))),
  restingHr: trend(todayRow.restingHR, avg(history.map((r) => r.restingHR))),
  stepsYesterday: trend(yesterdayRow.steps, avg(stepsBaseline.map((r) => r.steps))),
  readiness: null,
};

console.log('=== stats ===');
console.log(JSON.stringify(stats, null, 1));

const { formLabel } = await import('../dist/services/brief/stats.js');
console.log('form label:', formLabel(stats.form));

const { renderBriefImage } = await import('../dist/services/brief/image.js');
const dateLabel = new Date().toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', weekday: 'long', day: 'numeric', month: 'long' });
const png = await renderBriefImage(stats, dateLabel);
writeFileSync(new URL('./brief-test.png', import.meta.url), png);
console.log('PNG bytes:', png.length, '-> tools/brief-test.png');

// Граничний випадок: майже нема даних (свіжий INTERVALS_API_KEY, тільки 1 день).
const minimalStats = { fitness: null, fatigue: null, form: null, sleepScore: null, sleepHours: null, hrv: null, restingHr: null, stepsYesterday: null, readiness: null };
const pngMin = await renderBriefImage(minimalStats, dateLabel);
writeFileSync(new URL('./brief-test-empty.png', import.meta.url), pngMin);
console.log('empty-state PNG bytes:', pngMin.length, '-> tools/brief-test-empty.png');
