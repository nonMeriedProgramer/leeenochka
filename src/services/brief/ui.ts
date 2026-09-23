// ─── Спільне для панелей брифу: рендер, картки, підписи ──────────────
// Обмеження satori, на які вже наступили: кожен <div> — display:flex;
// Unicode-стрілок (→ ↑ ↓) і емодзі у шрифті немає — лише текст і SVG;
// HTML-сутності (&nbsp;) satori-html не декодує.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { html } from 'satori-html';
import { Resvg } from '@resvg/resvg-js';
import { PAL } from './svg.js';

export const W = 1080;
export const H = 1720;
export const PAD = 48;
export const INNER = W - PAD * 2;

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts');
let _fonts: Array<{ name: string; data: Buffer; weight: 400 | 700; style: 'normal' }> | null = null;
function fonts() {
  return _fonts ??= [
    { name: 'Noto Sans', data: readFileSync(path.join(FONT_DIR, 'NotoSans-Regular.ttf')), weight: 400, style: 'normal' },
    { name: 'Noto Sans', data: readFileSync(path.join(FONT_DIR, 'NotoSans-Bold.ttf')), weight: 700, style: 'normal' },
  ];
}

export async function renderPanel(body: string, height = H): Promise<Buffer> {
  const markup = html(`<div style="display:flex;flex-direction:column;width:${W}px;height:${height}px;background:${PAL.bg};padding:${PAD}px;font-family:'Noto Sans';color:${PAL.text};">${body}</div>`);
  const svg = await satori(markup as Parameters<typeof satori>[0], { width: W, height, fonts: fonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng());
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Будівельні блоки ─────────────────────────────────────────────────
export function header(title: string, right: string): string {
  return `<div style="display:flex;flex-direction:row;justify-content:space-between;align-items:flex-end;">
    <div style="display:flex;font-size:58px;font-weight:700;">${esc(title)}</div>
    <div style="display:flex;font-size:26px;color:${PAL.muted};margin-bottom:10px;">${esc(right)}</div>
  </div>`;
}

export function card(inner: string, style = ''): string {
  return `<div style="display:flex;flex-direction:column;background:${PAL.card};border:1px solid ${PAL.border};border-radius:28px;padding:30px 32px;${style}">${inner}</div>`;
}

export function cardTitle(text: string, right = ''): string {
  return `<div style="display:flex;flex-direction:row;justify-content:space-between;align-items:center;margin-bottom:18px;">
    <div style="display:flex;font-size:28px;color:${PAL.label};">${esc(text)}</div>
    ${right ? `<div style="display:flex;font-size:24px;color:${PAL.muted};">${esc(right)}</div>` : ''}
  </div>`;
}

export function badge(text: string, color: string): string {
  return `<div style="display:flex;padding:6px 16px;border-radius:14px;background:${color}22;color:${color};font-size:24px;">${esc(text)}</div>`;
}

export function row(items: string[], gap = 20, style = ''): string {
  return `<div style="display:flex;flex-direction:row;${style}">${items.join(`<div style="display:flex;width:${gap}px;"></div>`)}</div>`;
}

export function gap(h: number): string {
  return `<div style="display:flex;height:${h}px;"></div>`;
}

/** Невелика плитка: підпис, значення, підпис-колір. */
export function tile(label: string, value: string, sub = '', subColor: string = PAL.muted): string {
  return card(`
    <div style="display:flex;font-size:24px;color:${PAL.label};">${esc(label)}</div>
    <div style="display:flex;font-size:44px;font-weight:700;margin-top:6px;">${esc(value)}</div>
    ${sub ? `<div style="display:flex;font-size:22px;color:${subColor};margin-top:4px;">${esc(sub)}</div>` : ''}
  `, 'flex:1;padding:24px 26px;');
}

// ─── Формат ────────────────────────────────────────────────────────────
export function dur(sec: number | null | undefined, compact = false): string {
  if (!sec || sec <= 0) return compact ? '0хв' : '0 хв';
  const m = Math.round(sec / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (compact) return h ? `${h}г ${mm}хв` : `${mm}хв`;
  return h ? `${h} год ${mm} хв` : `${mm} хв`;
}

/** «Локальний» epoch Garmin (настінний час, закодований як UTC) → "23:15". */
export function hhmmLocal(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16);
}

export function thousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function signed(n: number, digits = 0): string {
  const v = digits ? n.toFixed(digits) : String(Math.round(n));
  return n > 0 ? `+${v}` : v;
}

// ─── Українські назви для кодів Garmin ────────────────────────────────
export function qualifierUa(q: string | null): { text: string; color: string } {
  switch (q) {
    case 'EXCELLENT': return { text: 'Відмінно', color: PAL.green };
    case 'GOOD': return { text: 'Добре', color: PAL.green };
    case 'FAIR': return { text: 'Посередньо', color: PAL.amber };
    case 'POOR': return { text: 'Погано', color: PAL.red };
    default: return { text: '—', color: PAL.muted };
  }
}

export function scoreQualifier(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 90) return 'EXCELLENT';
  if (score >= 80) return 'GOOD';
  if (score >= 60) return 'FAIR';
  return 'POOR';
}

export function feedbackUa(f: string | null): { text: string; color: string } {
  switch (f) {
    case 'EXCELLENT': return { text: 'Відмінно', color: PAL.green };
    case 'VERY_GOOD': return { text: 'Дуже добре', color: PAL.green };
    case 'GOOD': return { text: 'Добре', color: PAL.green };
    case 'MODERATE': return { text: 'Помірно', color: PAL.amber };
    case 'LOW': return { text: 'Низько', color: PAL.amber };
    case 'HIGH': return { text: 'Високо', color: PAL.amber };
    case 'POOR': return { text: 'Погано', color: PAL.red };
    case 'VERY_POOR': return { text: 'Дуже погано', color: PAL.red };
    default: return { text: f ? f.toLowerCase().replace(/_/g, ' ') : '—', color: PAL.muted };
  }
}

export function readinessLevelUa(level: string | null, score: number): { text: string; color: string } {
  const l = level ?? (score >= 95 ? 'PRIME' : score >= 75 ? 'HIGH' : score >= 50 ? 'MODERATE' : score >= 25 ? 'LOW' : 'POOR');
  switch (l) {
    case 'PRIME': return { text: 'Пікова', color: PAL.green };
    case 'HIGH': return { text: 'Висока', color: PAL.green };
    case 'MODERATE': return { text: 'Помірна', color: PAL.amber };
    case 'LOW': return { text: 'Низька', color: PAL.red };
    default: return { text: 'Дуже низька', color: PAL.red };
  }
}

export function hrvStatusUa(s: string | null): { text: string; color: string } {
  switch (s) {
    case 'BALANCED': return { text: 'Збалансовано', color: PAL.green };
    case 'UNBALANCED': return { text: 'Незбалансовано', color: PAL.amber };
    case 'LOW': return { text: 'Низький', color: PAL.amber };
    case 'POOR': return { text: 'Дуже низький', color: PAL.red };
    default: return { text: 'Калібрується', color: PAL.muted };
  }
}

export function trainingStatusUa(p: string | null): { text: string; color: string } {
  switch (p) {
    case 'PRODUCTIVE': return { text: 'Продуктивний', color: PAL.green };
    case 'PEAKING': return { text: 'Пік форми', color: PAL.green };
    case 'MAINTAINING': return { text: 'Підтримка форми', color: PAL.green };
    case 'RECOVERY': return { text: 'Відновлення', color: PAL.blue };
    case 'UNPRODUCTIVE': return { text: 'Непродуктивний', color: PAL.amber };
    case 'OVERREACHING': return { text: 'Перевантаження', color: PAL.red };
    case 'STRAINED': return { text: 'Напруження', color: PAL.red };
    case 'DETRAINING': return { text: 'Втрата форми', color: PAL.amber };
    case 'PAUSED': return { text: 'Пауза', color: PAL.muted };
    default: return { text: 'Немає статусу', color: PAL.muted };
  }
}

export function acwrUa(s: string | null): { text: string; color: string } {
  switch (s) {
    case 'LOW': return { text: 'Низьке', color: PAL.blue };
    case 'OPTIMAL': return { text: 'Оптимальне', color: PAL.green };
    case 'HIGH': return { text: 'Високе', color: PAL.amber };
    case 'VERY_HIGH': return { text: 'Дуже високе', color: PAL.red };
    default: return { text: '—', color: PAL.muted };
  }
}

export function balanceUa(f: string | null): string {
  switch (f) {
    case 'ABOVE_TARGETS': return 'вище цілей';
    case 'BELOW_TARGETS': return 'нижче цілей';
    case 'BALANCED': case 'ON_TARGET': case 'WITHIN_TARGETS': return 'у межах цілей';
    default: return f ? f.toLowerCase().replace(/_/g, ' ') : '';
  }
}

export const DAY_SHORT = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/** Процентилі для «твого звичного діапазону» (стійко на малій вибірці). */
export function typicalRange(values: Array<number | null | undefined>): { low: number; high: number } | null {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 4) return null;
  const q = (p: number) => {
    const i = (v.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return v[lo] + (v[hi] - v[lo]) * (i - lo);
  };
  return { low: Math.round(q(0.25)), high: Math.round(q(0.75)) };
}
