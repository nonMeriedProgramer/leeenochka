// ─── Графіка плиток вечірнього звіту (стиль Apple Watch-віджетів) ─────
// Кожен віджет — окрема форма: стовпчики, градієнтні шкали з маркером,
// кільця з відсотками, циферблат зі стрілкою, хвиля, крапкова матриця.
// Тільки фігури: увесь текст лишається в HTML-шарі (у SVG data-URI немає
// доступу до шрифтів, кирилиця там не відрендериться).
import { img } from '../brief/svg.js';

// Палітра системних кольорів iOS на чорному — як у референсі
export const C = {
  bg: '#000000', tile: '#0b0b0d', text: '#ffffff', dim: '#8e8e93', track: '#2c2c2e',
  green: '#30d158', yellow: '#ffd60a', orange: '#ff9f0a', red: '#ff453a', pink: '#ff375f',
  purple: '#bf5af2', blue: '#0a84ff', cyan: '#64d2ff', teal: '#40cbe0', mint: '#66d4cf',
  deepNight: '#1c1c4a', dawn: '#ff9f6b',
};

const f1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (v: number) => Math.max(0, Math.min(100, v));
const svg = (w: number, h: number, inner: string) =>
  img(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`, w, h);

/** Вертикальні стовпчики з переходом кольору — «гучність» у референсі (кроки). */
export function barMeter(pct: number | null, w: number, h: number, n = 18): string {
  const filled = pct == null ? 0 : Math.round((clamp(pct) / 100) * n);
  const gap = 4;
  const bw = (w - gap * (n - 1)) / n;
  const bars = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const bh = h * (0.32 + t * 0.68);
    const color = i < filled ? (t < 0.55 ? C.green : t < 0.8 ? C.yellow : C.orange) : C.track;
    return `<rect x="${f1(i * (bw + gap))}" y="${f1(h - bh)}" width="${f1(bw)}" height="${f1(bh)}" rx="2" fill="${color}"/>`;
  }).join('');
  return svg(w, h, bars);
}

/** Горизонтальна градієнтна шкала з білим маркером — «тиск» у референсі. */
export function gradientTrack(pct: number | null, w: number, h: number, from: string, to: string): string {
  // Без даних — сіра смуга: кольоровий градієнт читався б як «показник є».
  if (pct == null) return svg(w, h, `<rect x="0" y="0" width="${w}" height="${h}" rx="${h / 4}" fill="${C.track}"/>`);
  const x = 3 + (clamp(pct) / 100) * (w - 6);
  return svg(w, h, `
    <defs><linearGradient id="gt" x1="0" x2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <rect x="0" y="0" width="${w}" height="${h}" rx="${h / 4}" fill="url(#gt)"/>
    <rect x="${f1(x - 3)}" y="-2" width="6" height="${h + 4}" rx="3" fill="#ffffff"/>
  `);
}

/** Стадіон із вкладених кольорових контурів — «пульс/зона» у референсі. */
export function zoneStadium(zone: number | null, zones: number, w: number, h: number): string {
  const colors = [C.blue, C.cyan, C.green, C.yellow, C.orange, C.red, C.pink];
  const active = zone == null ? -1 : Math.min(zone, zones) - 1;
  const rings = Array.from({ length: 4 }, (_, i) => {
    const inset = i * 7;
    const on = active >= 0 && i <= Math.min(3, Math.round((active / Math.max(1, zones - 1)) * 3));
    const color = on ? colors[Math.min(active, colors.length - 1)] : C.track;
    const rw = w - inset * 2;
    const rh = h - inset * 2;
    return `<rect x="${inset}" y="${inset}" width="${f1(rw)}" height="${f1(rh)}" rx="${f1(rh / 2)}" fill="none" stroke="${color}" stroke-width="5" opacity="${on ? 1 - i * 0.18 : 1}"/>`;
  }).join('');
  return svg(w, h, rings);
}

/** Шкала з рисками і червоною стрілкою — «радіо» у референсі (пульс спокою). */
export function dialScale(pct: number | null, w: number, h: number): string {
  const n = 41;
  const ticks = Array.from({ length: n }, (_, i) => {
    const x = 2 + (i / (n - 1)) * (w - 4);
    const major = i % 10 === 0;
    const th = major ? h * 0.75 : h * (i % 5 === 0 ? 0.5 : 0.32);
    return `<rect x="${f1(x)}" y="${f1(h - th)}" width="2" height="${f1(th)}" rx="1" fill="${major ? C.text : C.dim}" opacity="${major ? 0.9 : 0.5}"/>`;
  }).join('');
  const x = pct == null ? null : 2 + (clamp(pct) / 100) * (w - 4);
  return svg(w, h, `${ticks}${x != null ? `<rect x="${f1(x - 1.5)}" y="0" width="3" height="${h}" rx="1.5" fill="${C.red}"/>` : ''}`);
}

/**
 * Кільце з числом усередині. Текст — HTML-шаром поверх SVG: у data-URI
 * немає доступу до шрифтів, кирилиця й цифри там не відрендеряться.
 */
export function ringGauge(pct: number | null, size: number, color: string, label = ''): string {
  const c = size / 2;
  const stroke = Math.round(size * 0.13);
  const r = c - stroke / 2 - 1;
  const circ = 2 * Math.PI * r;
  const v = pct == null ? 0 : clamp(pct);
  const ring = svg(size, size, `
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${C.track}" stroke-width="${stroke}"/>
    ${v > 0 ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${f1((circ * v) / 100)} ${f1(circ)}" transform="rotate(-90 ${c} ${c})"/>` : ''}
  `);
  if (!label) return ring;
  return `<div style="display:flex;position:relative;width:${size}px;height:${size}px;">${ring}
    <div style="display:flex;position:absolute;top:0;left:0;width:${size}px;height:${size}px;align-items:center;justify-content:center;font-size:${Math.round(size * 0.26)}px;font-weight:700;color:${C.text};">${label}</div>
  </div>`;
}

/**
 * Кілька підписаних смужок одна під одною (фактори готовності).
 * Підписи — HTML-шаром, смужки — SVG; разом складаються тут, бо в SVG
 * data-URI кирилиця не відрендериться.
 */
export function levelBars(items: Array<{ label: string; pct: number | null; color: string }>, w: number): string {
  if (!items.length) return `<div style="display:flex;width:${w}px;height:86px;"></div>`;
  const barW = Math.round(w * 0.5);
  const rows = items.slice(0, 6).map((it) => {
    const v = it.pct == null ? 0 : clamp(it.pct);
    const bar = svg(barW, 8, `<rect x="0" y="0" width="${barW}" height="8" rx="4" fill="${C.track}"/>
      ${v > 0 ? `<rect x="0" y="0" width="${f1(Math.max(8, (barW * v) / 100))}" height="8" rx="4" fill="${it.color}"/>` : ''}`);
    return `<div style="display:flex;flex-direction:row;align-items:center;width:${w}px;height:19px;">
      <div style="display:flex;width:${w - barW - 40}px;font-size:13px;color:${C.dim};">${it.label}</div>
      ${bar}
      <div style="display:flex;width:36px;justify-content:flex-end;font-size:13px;color:${C.text};">${it.pct == null ? '—' : Math.round(it.pct)}</div>
    </div>`;
  }).join('');
  return `<div style="display:flex;flex-direction:column;width:${w}px;">${rows}</div>`;
}

/** Чотири кільця з відсотками поруч — «фази сну» у референсі. */
export function quadRings(values: Array<{ pct: number | null; color: string }>, size: number): string {
  const r = size / 2 - 4;
  const circ = 2 * Math.PI * r;
  const step = size * 0.78;
  const w = Math.round(step * (values.length - 1) + size);
  const rings = values.map(({ pct, color }, i) => {
    const cx = size / 2 + i * step;
    const v = pct == null ? 0 : clamp(pct);
    return `<circle cx="${f1(cx)}" cy="${size / 2}" r="${r}" fill="${C.bg}"/>
      <circle cx="${f1(cx)}" cy="${size / 2}" r="${r}" fill="none" stroke="${C.track}" stroke-width="6"/>
      ${v > 0 ? `<circle cx="${f1(cx)}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"
        stroke-dasharray="${f1((circ * v) / 100)} ${f1(circ)}" transform="rotate(-90 ${f1(cx)} ${size / 2})"/>` : ''}`;
  }).reverse().join('');
  return svg(w, size, rings);
}

/** Площа з градієнтом і стрілкою на вершині — «підйом» у референсі (поверхи). */
export function areaChart(pct: number | null, w: number, h: number, color: string): string {
  const gridOnly = [0.25, 0.5, 0.75].map((t) => `<line x1="${f1(t * w)}" x2="${f1(t * w)}" y1="0" y2="${h}" stroke="${C.track}" stroke-width="1"/>`).join('');
  if (pct == null) return svg(w, h, gridOnly);
  const v = clamp(pct) / 100;
  const peakX = Math.max(8, v * (w - 10));
  const pts = Array.from({ length: 14 }, (_, i) => {
    const t = i / 13;
    const x = t * peakX;
    const y = h - (h - 6) * Math.pow(t, 1.6) * (0.7 + 0.3 * Math.sin(t * 7));
    return `${f1(x)},${f1(Math.max(4, y))}`;
  });
  return svg(w, h, `
    <defs><linearGradient id="ac" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.75"/><stop offset="1" stop-color="${color}" stop-opacity="0.05"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map((t) => `<line x1="${f1(t * w)}" x2="${f1(t * w)}" y1="0" y2="${h}" stroke="${C.track}" stroke-width="1"/>`).join('')}
    <polygon points="0,${h} ${pts.join(' ')} ${f1(peakX)},${h}" fill="url(#ac)"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>
    ${v > 0 ? `<polygon points="${f1(peakX)},${f1(Math.max(4, h - (h - 6) * 1))} ${f1(peakX - 9)},${f1(Math.max(4, h - (h - 6)) + 9)} ${f1(peakX + 4)},${f1(Math.max(4, h - (h - 6)) + 11)}" fill="${color}"/>` : ''}
  `);
}

/** Ряд капсул, частина заповнена — «вода» у референсі (дистанція). */
export function capsules(pct: number | null, n: number, w: number, h: number, color: string): string {
  const v = pct == null ? 0 : clamp(pct) / 100;
  const gap = 8;
  const cw = (w - gap * (n - 1)) / n;
  const items = Array.from({ length: n }, (_, i) => {
    const x = i * (cw + gap);
    const fill = Math.max(0, Math.min(1, v * n - i));
    const body = `<rect x="${f1(x)}" y="0" width="${f1(cw)}" height="${h}" rx="${f1(cw / 2)}" fill="${C.track}"/>`;
    const lit = fill > 0
      ? `<rect x="${f1(x)}" y="${f1(h * (1 - fill))}" width="${f1(cw)}" height="${f1(h * fill)}" rx="${f1(cw / 2)}" fill="${color}" opacity="${0.55 + fill * 0.45}"/>`
      : '';
    return body + lit;
  }).join('');
  return svg(w, h, items);
}

/** Веселкова шкала з маркером — «якість повітря» у референсі (стрес). */
export function spectrumBar(pct: number | null, w: number, h: number): string {
  if (pct == null) return svg(w, h, `<rect x="0" y="0" width="${w}" height="${h}" rx="${h / 4}" fill="${C.track}"/>`);
  const x = 3 + (clamp(pct) / 100) * (w - 6);
  return svg(w, h, `
    <defs><linearGradient id="sp" x1="0" x2="1">
      <stop offset="0" stop-color="${C.green}"/><stop offset="0.35" stop-color="${C.yellow}"/>
      <stop offset="0.6" stop-color="${C.orange}"/><stop offset="0.8" stop-color="${C.red}"/><stop offset="1" stop-color="${C.purple}"/>
    </linearGradient></defs>
    <rect x="0" y="0" width="${w}" height="${h}" rx="${h / 4}" fill="url(#sp)"/>
    ${x != null ? `<rect x="${f1(x - 3)}" y="-2" width="6" height="${h + 4}" rx="3" fill="#ffffff"/>` : ''}
  `);
}

/** Інтерференційна хвиля — «SpO2» у референсі. */
export function waveform(w: number, h: number, color: string, hasData = true): string {
  if (!hasData) return svg(w, h, `<line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="${C.track}" stroke-width="3"/>`);
  const lines = Array.from({ length: 7 }, (_, i) => {
    const amp = (h / 2 - 4) * (1 - i * 0.13);
    const pts = Array.from({ length: 60 }, (_, j) => {
      const t = j / 59;
      const y = h / 2 + Math.sin(t * Math.PI * 6 + i * 0.5) * amp * Math.sin(t * Math.PI);
      return `${f1(t * w)},${f1(y)}`;
    }).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${i % 2 ? color : C.text}" stroke-width="1.6" opacity="${i % 2 ? 0.85 : 0.35}"/>`;
  }).join('');
  return svg(w, h, lines);
}

/** Кільце з крапок по колу — «години стояння» у референсі (інтенсивність). */
export function clockDial(pct: number | null, size: number, color: string): string {
  const n = 12;
  const c = size / 2;
  const r = c - 10;
  const filled = pct == null ? 0 : Math.round((clamp(pct) / 100) * n);
  const dots = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return `<circle cx="${f1(c + Math.cos(a) * r)}" cy="${f1(c + Math.sin(a) * r)}" r="${i < filled ? 6 : 4}" fill="${i < filled ? color : C.track}"/>`;
  }).join('');
  return svg(size, size, dots);
}

/** Крапкова матриця прогресу — «дистанція» у референсі (тиждень тренувань). */
export function dotMatrix(pct: number | null, w: number, h: number, color: string): string {
  const cols = 26;
  const rows = 5;
  const filledCols = pct == null ? 0 : Math.round((clamp(pct) / 100) * cols);
  const dx = w / cols;
  const dy = h / rows;
  const dots = Array.from({ length: cols * rows }, (_, i) => {
    const col = i % cols;
    const rw = Math.floor(i / cols);
    return `<rect x="${f1(col * dx)}" y="${f1(rw * dy)}" width="${f1(dx - 2)}" height="${f1(dy - 2)}" rx="1.5" fill="${col < filledCols ? color : C.track}"/>`;
  }).join('');
  const markX = filledCols > 0 ? filledCols * dx - 1 : null;
  return svg(w, h, `${dots}${markX != null ? `<rect x="${f1(markX)}" y="-2" width="2" height="${h + 4}" fill="${C.text}"/>` : ''}`);
}

/** Сонце над горизонтом із градієнтом неба — «захід» у референсі. */
export function sunArc(pct: number | null, w: number, h: number): string {
  if (pct == null) return svg(w, h, `<rect x="0" y="0" width="${w}" height="${h}" rx="10" fill="${C.track}"/>`);
  const v = clamp(pct) / 100;
  const cx = 12 + v * (w - 24);
  return svg(w, h, `
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1c1c3a"/><stop offset="0.55" stop-color="#7a3b8f"/>
        <stop offset="0.8" stop-color="${C.orange}"/><stop offset="1" stop-color="${C.yellow}"/>
      </linearGradient>
      <clipPath id="clipSky"><rect x="0" y="0" width="${w}" height="${h}" rx="10"/></clipPath>
    </defs>
    <g clip-path="url(#clipSky)">
      <rect x="0" y="0" width="${w}" height="${h}" fill="url(#sky)"/>
      <circle cx="${f1(cx)}" cy="${f1(h - 6)}" r="${f1(h * 0.42)}" fill="#ffe9a8"/>
    </g>
  `);
}

/** Смужка дня з блоками подій — «календар» у референсі (завтра). */
export function timeline(marks: Array<{ pct: number; width: number; color: string }>, w: number, h: number): string {
  const base = `<rect x="0" y="${f1(h / 2 - 2)}" width="${w}" height="4" rx="2" fill="${C.track}"/>`;
  const blocks = marks.map((m) => `<rect x="${f1((clamp(m.pct) / 100) * (w - m.width))}" y="0" width="${m.width}" height="${h}" rx="6" fill="${m.color}"/>`).join('');
  return svg(w, h, base + blocks);
}

/** Кружечки по днях — «серія читання» у референсі (виконання плану). */
export function dayDots(total: number, done: number, size: number, color: string): string {
  const n = Math.max(1, Math.min(7, total || 1));
  const gap = 10;
  const w = n * size + (n - 1) * gap;
  const dots = Array.from({ length: n }, (_, i) => {
    const on = i < done;
    const cx = size / 2 + i * (size + gap);
    return `<circle cx="${f1(cx)}" cy="${size / 2}" r="${size / 2 - 2}" fill="${on ? color : 'none'}" stroke="${on ? color : C.track}" stroke-width="3"/>`;
  }).join('');
  return svg(w, size, dots);
}

/** Три окремі кільця активності — «калорії/хвилини/години» у референсі. */
export function tripleRing(values: Array<{ pct: number | null; color: string }>, size: number): string {
  const gap = 14;
  const w = values.length * size + (values.length - 1) * gap;
  const r = size / 2 - 7;
  const circ = 2 * Math.PI * r;
  const rings = values.map(({ pct, color }, i) => {
    const cx = size / 2 + i * (size + gap);
    const v = pct == null ? 0 : clamp(pct);
    return `<circle cx="${f1(cx)}" cy="${size / 2}" r="${r}" fill="none" stroke="${C.track}" stroke-width="10"/>
      ${v > 0 ? `<circle cx="${f1(cx)}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"
        stroke-dasharray="${f1((circ * v) / 100)} ${f1(circ)}" transform="rotate(-90 ${f1(cx)} ${size / 2})"/>` : ''}`;
  }).join('');
  return svg(w, size, rings);
}
