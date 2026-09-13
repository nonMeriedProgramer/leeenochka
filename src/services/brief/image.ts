import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import satori from 'satori';
import { html } from 'satori-html';
import { Resvg } from '@resvg/resvg-js';
import type { WellnessRow } from '../training/garmin.js';

// Картинка ранкового брифу — малюється КОДОМ (satori → SVG → PNG), без AI і без
// жодних API-ключів чи оплати. Цифри й українські підписи завжди точні. Стиль —
// темний дашборд у дусі AlterMe. Це доповнення до тексту брифу; текст усе одно
// йде як підпис (caption), а будь-яка помилка рендеру тихо відкочується на текст.

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts');
let _fonts: Array<{ name: string; data: Buffer; weight: 400 | 700; style: 'normal' }> | null = null;
function fonts() {
  return _fonts ??= [
    { name: 'Noto Sans', data: readFileSync(path.join(FONT_DIR, 'NotoSans-Regular.ttf')), weight: 400, style: 'normal' },
    { name: 'Noto Sans', data: readFileSync(path.join(FONT_DIR, 'NotoSans-Bold.ttf')), weight: 700, style: 'normal' },
  ];
}

// Палітра
const C = {
  bg: '#0b0f14', card: '#151b23', border: '#222c37',
  text: '#e8eef5', label: '#9aa4b0', muted: '#7d8894',
  green: '#8fe3a0', violet: '#9b8cf2',
};

function statCard(label: string, value: string, sub: string, accent: string): string {
  return `<div style="display:flex;flex-direction:column;background:${C.card};border:1px solid ${C.border};border-radius:24px;padding:30px 26px;flex:1;">
    <div style="color:${C.label};font-size:26px;">${label}</div>
    <div style="display:flex;color:${accent};font-size:64px;font-weight:700;margin-top:6px;">${value}</div>
    <div style="display:flex;color:${C.muted};font-size:24px;margin-top:2px;">${sub}</div>
  </div>`;
}

function wideCard(label: string, value: string, sub: string, accent: string): string {
  return `<div style="display:flex;flex-direction:column;background:${C.card};border:1px solid ${C.border};border-radius:24px;padding:30px;flex:1;">
    <div style="color:${C.label};font-size:26px;">${label}</div>
    <div style="display:flex;align-items:flex-end;margin-top:8px;">
      <div style="display:flex;color:${accent};font-size:56px;font-weight:700;">${value}</div>
    </div>
    <div style="display:flex;color:${C.muted};font-size:24px;margin-top:4px;">${sub}</div>
  </div>`;
}

function readinessCard(score: number): string {
  return `<div style="display:flex;flex-direction:column;align-items:center;background:${C.card};border:1px solid ${C.border};border-radius:24px;padding:30px;flex:1;">
    <div style="display:flex;align-items:center;justify-content:center;width:230px;height:230px;border-radius:115px;border:16px solid ${C.green};">
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="display:flex;color:${C.text};font-size:76px;font-weight:700;">${score}</div>
        <div style="display:flex;color:${C.muted};font-size:22px;">/100</div>
      </div>
    </div>
    <div style="display:flex;color:${C.label};font-size:26px;margin-top:18px;">Готовність</div>
  </div>`;
}

function buildHtml(w: WellnessRow, dateLabel: string): string {
  const rows: string[] = [];

  // Верхній ряд: до трьох статкарток
  const top: string[] = [];
  if (w.sleep_score != null || w.sleep_hours != null) {
    top.push(statCard('Сон', String(w.sleep_score ?? '—'), w.sleep_hours != null ? `${w.sleep_hours} год` : 'сон', C.green));
  }
  if (w.body_battery_current != null) {
    top.push(statCard('Заряд тіла', String(w.body_battery_current), 'заряд', C.violet));
  }
  if (w.stress_avg != null) {
    top.push(statCard('Стрес', String(w.stress_avg), 'середній', C.violet));
  }
  if (top.length) rows.push(`<div style="display:flex;flex-direction:row;margin-top:26px;">${top.join('<div style="display:flex;width:22px;"></div>')}</div>`);

  // Середній ряд: кільце готовності + HRV
  const mid: string[] = [];
  if (w.training_readiness != null) mid.push(readinessCard(w.training_readiness));
  if (w.hrv_ms != null) mid.push(wideCard('Варіабельність пульсу', `${w.hrv_ms} мс`, 'HRV за ніч', C.green));
  if (mid.length) rows.push(`<div style="display:flex;flex-direction:row;margin-top:22px;">${mid.join('<div style="display:flex;width:22px;"></div>')}</div>`);

  // Нижній ряд: пульс спокою + кроки
  const bot: string[] = [];
  if (w.resting_hr != null) bot.push(wideCard('Пульс спокою', `${w.resting_hr}`, 'уд/хв', C.green));
  if (w.steps != null) bot.push(wideCard('Кроки', w.steps.toLocaleString('uk-UA'), 'за сьогодні', C.green));
  if (bot.length) rows.push(`<div style="display:flex;flex-direction:row;margin-top:22px;">${bot.join('<div style="display:flex;width:22px;"></div>')}</div>`);

  return `<div style="display:flex;flex-direction:column;width:100%;height:100%;background:${C.bg};padding:56px;font-family:'Noto Sans';">
    <div style="display:flex;flex-direction:column;">
      <div style="display:flex;color:${C.text};font-size:52px;font-weight:700;">Доброго ранку</div>
      <div style="display:flex;color:${C.muted};font-size:28px;margin-top:6px;">${dateLabel}</div>
    </div>
    ${rows.join('')}
  </div>`;
}

// Приблизна висота полотна від кількості рядків (щоб контент не обрізало і не було порожнечі).
function canvasHeight(w: WellnessRow): number {
  let h = 56 + 120 + 56; // паддінги + шапка
  if (w.sleep_score != null || w.sleep_hours != null || w.body_battery_current != null || w.stress_avg != null) h += 26 + 190;
  if (w.training_readiness != null || w.hrv_ms != null) h += 22 + 340;
  if (w.resting_hr != null || w.steps != null) h += 22 + 215;
  return h;
}

/** Генерує PNG ранкового дашборду; null якщо рендер не вдався. */
export async function generateBriefImage(w: WellnessRow, dateLabel: string): Promise<Buffer | null> {
  try {
    const width = 1080;
    const height = canvasHeight(w);
    const markup = html(buildHtml(w, dateLabel));
    const svg = await satori(markup as Parameters<typeof satori>[0], { width, height, fonts: fonts() });
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
    return Buffer.from(png);
  } catch (e) {
    console.error('generateBriefImage failed:', e instanceof Error ? e.message : e);
    return null;
  }
}
