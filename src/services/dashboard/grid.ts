// ─── Сітка плиток-віджетів (спільна для вечірнього звіту й ранкових панелей) ──
// Візуальна мова: чорне тло, плитка без рамок, угорі велике число з дрібним
// юнітом і кольоровою міткою капсом, під ним графік своєї форми, знизу підпис.
import { esc } from '../brief/ui.js';
import { C } from './widgets.js';
import { renderBlackPanel } from './render.js';

export const TILE_W = 247;
export const TILE_H = 176;
export const GAP = 12;
export const COLS = 4;
/** Ширина малюнка всередині звичайної плитки. */
export const ART = TILE_W - 32;
/** Ширина малюнка всередині плитки на дві колонки. */
export const ART_WIDE = TILE_W * 2 + GAP - 32;

export interface Tile { html: string; span: number }

export function tile(top: string, art: string, bottom = '', span = 1): Tile {
  const w = TILE_W * span + GAP * (span - 1);
  return {
    span,
    html: `<div style="display:flex;flex-direction:column;width:${w}px;height:${TILE_H}px;background:${C.tile};border-radius:18px;padding:14px 16px;">
      <div style="display:flex;flex-direction:row;align-items:baseline;width:100%;justify-content:space-between;">${top}</div>
      <div style="display:flex;flex:1;align-items:center;margin-top:8px;">${art}</div>
      ${bottom ? `<div style="display:flex;flex-direction:row;width:100%;justify-content:space-between;font-size:14px;color:${C.dim};">${bottom}</div>` : ''}
    </div>`,
  };
}

/** Велике число + дрібний юніт поруч (як «95db»). */
export function val(value: string, unit = '', color = C.text, size = 40): string {
  return `<div style="display:flex;flex-direction:row;align-items:baseline;">
    <div style="display:flex;font-size:${size}px;font-weight:700;color:${color};">${esc(value)}</div>
    ${unit ? `<div style="display:flex;font-size:16px;color:${C.dim};margin-left:4px;">${esc(unit)}</div>` : ''}
  </div>`;
}

/** Кілька значень як одна ліва група (щоб space-between не розкидав їх по кутах). */
export function group(...parts: string[]): string {
  const items = parts.filter(Boolean).map((p, i) => (i ? `<div style="display:flex;margin-left:6px;">${p}</div>` : p));
  return `<div style="display:flex;flex-direction:row;align-items:baseline;">${items.join('')}</div>`;
}

/** Мітка праворуч угорі (як «LOUD», «RISING»). Порожній текст — порожнє місце. */
export function tag(text: string, color: string): string {
  if (!text) return '<div style="display:flex;"></div>';
  return `<div style="display:flex;font-size:14px;font-weight:700;color:${color};margin-left:10px;">${esc(text.toUpperCase())}</div>`;
}

/** Підписи під графіком, розтягнуті по ширині (як «30 · 80 · 120»). */
export function scale(labels: string[]): string {
  return labels.map((l) => `<div style="display:flex;">${esc(l)}</div>`).join('');
}

/** Легенда з кольоровими крапками — коли підписи стосуються кольорів, а не шкали. */
export function legend(items: Array<[string, string]>): string {
  return items.map(([label, color]) => `<div style="display:flex;flex-direction:row;align-items:center;">
    <div style="display:flex;width:9px;height:9px;border-radius:5px;background:${color};margin-right:6px;"></div>${esc(label)}
  </div>`).join('');
}

/** Центрує малюнок у плитці (для круглих форм). */
export function center(art: string): string {
  return `<div style="display:flex;width:100%;justify-content:center;">${art}</div>`;
}

/** Розкладає плитки по рядках, поважаючи span, і рендерить готову панель. */
export async function renderGrid(title: string, right: string, tiles: Tile[]): Promise<Buffer> {
  const rows: Tile[][] = [];
  let row: Tile[] = [];
  let used = 0;
  for (const t of tiles) {
    if (used + t.span > COLS) { rows.push(row); row = []; used = 0; }
    row.push(t);
    used += t.span;
  }
  if (row.length) rows.push(row);

  const grid = rows.map((r) => `<div style="display:flex;flex-direction:row;">${r
    .map((t, i) => (i ? `<div style="display:flex;width:${GAP}px;"></div>` : '') + t.html)
    .join('')}</div>`).join(`<div style="display:flex;height:${GAP}px;"></div>`);

  const head = `<div style="display:flex;flex-direction:row;align-items:baseline;margin-bottom:18px;">
    <div style="display:flex;font-size:34px;font-weight:700;">${esc(title)}</div>
    <div style="display:flex;margin-left:auto;font-size:18px;color:${C.dim};">${esc(right)}</div>
  </div>`;

  const width = TILE_W * COLS + GAP * (COLS - 1) + 40;
  const height = TILE_H * rows.length + GAP * (rows.length - 1) + 40 + 56;
  return renderBlackPanel(head + grid, width, height);
}
