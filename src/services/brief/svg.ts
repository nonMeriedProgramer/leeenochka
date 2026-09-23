// ─── SVG-примітиви для панелей брифу ────────────────────────────────
// Satori не малює Unicode-стрілки й CSS-трикутники (перевірено), але <img> з
// SVG data-URI рендерить ідеально — тож усю графіку (дуги, графіки, іконки
// погоди) малюємо SVG-фігурами, а ВЕСЬ текст лишаємо в HTML-шарі: у data-URI
// SVG немає доступу до шрифтів Noto Sans, кирилиця там не відрендериться.
//
// Кожна функція повертає готовий <img> з розмірами через style (satori-html
// передає атрибути width/height рядками, а satori їх відкидає).

export const PAL = {
  bg: '#0b0f14', card: '#151b23', card2: '#1b2330', border: '#222c37',
  text: '#e8eef5', label: '#9aa4b0', muted: '#7d8894', faint: '#4a5561', track: '#232d3a',
  blue: '#4f7cff', green: '#8fe3a0', amber: '#f2b84c', red: '#ef6b6b', violet: '#9b8cf2',
  // фази сну (як на референсі: світле пробудження зверху → темний глибокий знизу)
  awake: '#c7cfda', rem: '#8fb0ff', light: '#4f7cff', deep: '#2a45b8',
};

export function img(svg: string, w: number, h: number, style = ''): string {
  const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  return `<img src="${uri}" style="width:${w}px;height:${h}px;${style}" />`;
}

const f1 = (n: number) => Math.round(n * 10) / 10;

// ─── Дуга-шкала 0..100 (відкрита знизу, 270°) ────────────────────────
function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x0 = cx + r * Math.cos(rad(fromDeg));
  const y0 = cy + r * Math.sin(rad(fromDeg));
  const x1 = cx + r * Math.cos(rad(toDeg));
  const y1 = cy + r * Math.sin(rad(toDeg));
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${f1(x0)} ${f1(y0)} A ${r} ${r} 0 ${large} 1 ${f1(x1)} ${f1(y1)}`;
}

export function gauge(value: number | null, color: string, size = 420, stroke = 30): string {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - stroke;
  const start = 135;
  const sweep = 270;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const track = `<path d="${arcPath(cx, cy, r, start, start + sweep)}" fill="none" stroke="${PAL.track}" stroke-width="${stroke}" stroke-linecap="round"/>`;
  const val = v > 0.5
    ? `<path d="${arcPath(cx, cy, r, start, start + (sweep * v) / 100)}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/>`
    : '';
  return img(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${track}${val}</svg>`, size, size);
}

/** Маленьке кільце для смужки тижня (як S M T W T F S на референсі). */
export function ring(value: number | null, color: string, size = 92, stroke = 9, highlight = false): string {
  const c = size / 2;
  const r = c - stroke / 2 - 1;
  const circ = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const dash = (circ * v) / 100;
  const hl = highlight ? `<circle cx="${c}" cy="${c}" r="${r + stroke / 2}" fill="${PAL.card2}"/>` : '';
  return img(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${hl}
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${PAL.track}" stroke-width="${stroke}"/>
    ${v > 0 ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${f1(dash)} ${f1(circ)}" transform="rotate(-90 ${c} ${c})"/>` : ''}
  </svg>`, size, size);
}

// ─── Кілька кілець в одному SVG (кільця активності, як в Apple Fitness) ──
export function ringStack(values: Array<{ pct: number | null; color: string }>, size = 320, stroke = 26): string {
  const c = size / 2;
  const gap = 6;
  const pad = 6; // трохи повітря зверху — на відміну від gauge() це повне коло, без відкритого низу
  const circles = values.map(({ pct, color }, i) => {
    const r = c - stroke / 2 - pad - i * (stroke + gap);
    if (r <= 0) return '';
    const circ = 2 * Math.PI * r;
    const v = pct == null ? 0 : Math.max(0, Math.min(100, pct));
    const dash = (circ * v) / 100;
    const track = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${PAL.track}" stroke-width="${stroke}"/>`;
    const val = v > 0
      ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
          stroke-dasharray="${f1(dash)} ${f1(circ)}" transform="rotate(-90 ${c} ${c})"/>` : '';
    return track + val;
  }).join('');
  return img(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${circles}</svg>`, size, size);
}

// ─── Горизонтальна смуга з кількох суцільних сегментів (розклад стресу за день) ──
export function stackedBar(parts: Array<{ pct: number; color: string }>, w = 300, h = 20): string {
  const total = parts.reduce((s, p) => s + Math.max(0, p.pct), 0) || 1;
  let x = 0;
  const segs = parts.filter((p) => p.pct > 0).map((p) => {
    const sw = (Math.max(0, p.pct) / total) * w;
    const rect = `<rect x="${f1(x)}" y="0" width="${f1(sw)}" height="${h}" fill="${p.color}"/>`;
    x += sw;
    return rect;
  }).join('');
  return img(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <clipPath id="sb"><rect x="0" y="0" width="${w}" height="${h}" rx="${h / 2}"/></clipPath>
    <g clip-path="url(#sb)"><rect x="0" y="0" width="${w}" height="${h}" fill="${PAL.track}"/>${segs}</g>
  </svg>`, w, h);
}

// ─── Горизонтальна смуга-частка (фаза сну, фактор готовності) ─────────
export function barFill(pct: number, color: string, w = 300, h = 14): string {
  const p = Math.max(0, Math.min(100, pct));
  return img(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect x="0" y="0" width="${w}" height="${h}" rx="${h / 2}" fill="${PAL.track}"/>
    ${p > 0 ? `<rect x="0" y="0" width="${f1(Math.max(h, (w * p) / 100))}" height="${h}" rx="${h / 2}" fill="${color}"/>` : ''}
  </svg>`, w, h);
}

// ─── «Твій звичний діапазон»: смуга норми + точка сьогодні ──────────
export function rangeBar(value: number, low: number, high: number, w = 420, h = 34): string {
  const pad = Math.max(1, (high - low) * 0.9);
  const min = Math.min(low - pad, value - pad * 0.3);
  const max = Math.max(high + pad, value + pad * 0.3);
  const x = (v: number) => 12 + ((v - min) / (max - min)) * (w - 24);
  const inRange = value >= low && value <= high;
  const dot = inRange ? PAL.green : PAL.amber;
  return img(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect x="12" y="${h / 2 - 4}" width="${w - 24}" height="8" rx="4" fill="${PAL.track}"/>
    <rect x="${f1(x(low))}" y="${h / 2 - 4}" width="${f1(Math.max(6, x(high) - x(low)))}" height="8" rx="4" fill="#2d4a3a"/>
    <circle cx="${f1(x(value))}" cy="${h / 2}" r="11" fill="${dot}" stroke="${PAL.card}" stroke-width="4"/>
  </svg>`, w, h);
}

// ─── Стовпчики (навантаження / тривалість сну по днях) ───────────────
export function columns(values: Array<number | null>, colors: string[], w: number, h: number, maxVal?: number): string {
  const n = values.length;
  const gap = 14;
  const bw = (w - gap * (n - 1)) / n;
  const top = maxVal ?? Math.max(1, ...values.map((v) => v ?? 0));
  const bars = values.map((v, i) => {
    const x = i * (bw + gap);
    const val = v ?? 0;
    const bh = val > 0 ? Math.max(6, (val / top) * (h - 4)) : 4;
    const fill = val > 0 ? colors[i % colors.length] : PAL.track;
    return `<rect x="${f1(x)}" y="${f1(h - bh)}" width="${f1(bw)}" height="${f1(bh)}" rx="8" fill="${fill}"/>`;
  }).join('');
  return img(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bars}</svg>`, w, h);
}

// ─── Лінійний графік Фітнес/Втома/Форма + прогноз пунктиром ─────────
export interface LineSeries { values: Array<number | null>; color: string; dashedFrom?: number; width?: number }

export function lineChart(series: LineSeries[], w: number, h: number, zeroLine = true): string {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  let min = Math.min(0, ...all);
  let max = Math.max(1, ...all);
  const span = max - min || 1;
  min -= span * 0.08;
  max += span * 0.08;
  const n = Math.max(...series.map((s) => s.values.length));
  const X = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * (w - 8) + 4);
  const Y = (v: number) => h - 4 - ((v - min) / (max - min)) * (h - 8);

  const grid = [0.25, 0.5, 0.75].map((t) => `<line x1="0" x2="${w}" y1="${f1(4 + t * (h - 8))}" y2="${f1(4 + t * (h - 8))}" stroke="${PAL.border}" stroke-width="1"/>`).join('');
  const zero = zeroLine && min < 0 && max > 0
    ? `<line x1="0" x2="${w}" y1="${f1(Y(0))}" y2="${f1(Y(0))}" stroke="${PAL.faint}" stroke-width="2" stroke-dasharray="6 6"/>`
    : '';

  const paths = series.map((s) => {
    const pts = s.values.map((v, i) => (v == null ? null : `${f1(X(i))},${f1(Y(v))}`));
    const solid: string[] = [];
    const dashed: string[] = [];
    pts.forEach((p, i) => {
      if (!p) return;
      if (s.dashedFrom != null && i >= s.dashedFrom) {
        if (dashed.length === 0 && i > 0 && pts[i - 1]) dashed.push(pts[i - 1]!);
        dashed.push(p);
      } else {
        solid.push(p);
      }
    });
    const sw = s.width ?? 4;
    return [
      solid.length > 1 ? `<polyline points="${solid.join(' ')}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>` : '',
      dashed.length > 1 ? `<polyline points="${dashed.join(' ')}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-dasharray="10 8" stroke-linecap="round" opacity="0.85"/>` : '',
    ].join('');
  }).join('');

  return img(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${grid}${zero}${paths}</svg>`, w, h);
}

// ─── Гіпнограма: фази сну в часі ─────────────────────────────────────
export type Stage = 'deep' | 'light' | 'rem' | 'awake';
export interface StageSegment { start: number; end: number; stage: Stage } // epoch ms

const STAGE_ROW: Record<Stage, number> = { awake: 0, rem: 1, light: 2, deep: 3 };

export function hypnogram(segments: StageSegment[], w: number, h: number): string {
  if (!segments.length) return img(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`, w, h);
  const t0 = segments[0].start;
  const t1 = segments[segments.length - 1].end;
  const rowH = h / 4;
  const barH = Math.min(34, rowH * 0.62);
  const X = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * w;
  const Yc = (s: Stage) => STAGE_ROW[s] * rowH + rowH / 2;
  const color: Record<Stage, string> = { awake: PAL.awake, rem: PAL.rem, light: PAL.light, deep: PAL.deep };

  const grid = [1, 2, 3].map((i) => `<line x1="0" x2="${w}" y1="${f1(i * rowH)}" y2="${f1(i * rowH)}" stroke="${PAL.border}" stroke-width="1"/>`).join('');
  const connectors = segments.slice(1).map((s, i) => {
    const prev = segments[i];
    const x = X(s.start);
    return `<line x1="${f1(x)}" x2="${f1(x)}" y1="${f1(Yc(prev.stage))}" y2="${f1(Yc(s.stage))}" stroke="${color[s.stage]}" stroke-width="2" opacity="0.6"/>`;
  }).join('');
  const blocks = segments.map((s) => {
    const x = X(s.start);
    const bw = Math.max(2, X(s.end) - x);
    return `<rect x="${f1(x)}" y="${f1(Yc(s.stage) - barH / 2)}" width="${f1(bw)}" height="${f1(barH)}" rx="${Math.min(6, bw / 2)}" fill="${color[s.stage]}"/>`;
  }).join('');
  return img(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${grid}${connectors}${blocks}</svg>`, w, h);
}

// ─── Іконки погоди (WMO weather codes з Open-Meteo) ─────────────────
export type WeatherIcon = 'sun' | 'moon' | 'sunCloud' | 'moonCloud' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder';

function cloudShape(dx: number, dy: number, s: number, fill: string): string {
  return `<g transform="translate(${dx} ${dy}) scale(${s})" fill="${fill}">
    <circle cx="34" cy="46" r="16"/><circle cx="54" cy="36" r="22"/><circle cx="76" cy="48" r="15"/>
    <rect x="20" y="46" width="70" height="20" rx="10"/></g>`;
}

export function weatherIcon(kind: WeatherIcon, size = 120): string {
  const sun = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PAL.amber}"/>
    <g stroke="${PAL.amber}" stroke-width="${r * 0.28}" stroke-linecap="round">
      ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const rad = (a * Math.PI) / 180;
        return `<line x1="${f1(cx + Math.cos(rad) * r * 1.45)}" y1="${f1(cy + Math.sin(rad) * r * 1.45)}" x2="${f1(cx + Math.cos(rad) * r * 1.95)}" y2="${f1(cy + Math.sin(rad) * r * 1.95)}"/>`;
      }).join('')}</g>`;
  const moon = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#dfe6f2"/><circle cx="${cx + r * 0.45}" cy="${cy - r * 0.3}" r="${r * 0.85}" fill="${PAL.card}"/>`;
  const drops = (color: string, n: number) => Array.from({ length: n }, (_, i) =>
    `<line x1="${36 + i * 18}" y1="80" x2="${30 + i * 18}" y2="94" stroke="${color}" stroke-width="6" stroke-linecap="round"/>`).join('');

  let body = '';
  switch (kind) {
    case 'sun': body = sun(60, 60, 20); break;
    case 'moon': body = moon(58, 60, 26); break;
    case 'sunCloud': body = sun(44, 40, 14) + cloudShape(14, 22, 0.95, '#cfd8e3'); break;
    case 'moonCloud': body = moon(44, 40, 18) + cloudShape(14, 22, 0.95, '#aab5c3'); break;
    case 'cloud': body = cloudShape(6, 14, 1.05, '#aab5c3'); break;
    case 'fog': body = cloudShape(6, 4, 1.0, '#8f9aa8') + [84, 98].map((y) => `<line x1="20" x2="100" y1="${y}" y2="${y}" stroke="#8f9aa8" stroke-width="6" stroke-linecap="round"/>`).join(''); break;
    case 'drizzle': body = cloudShape(6, 4, 1.0, '#aab5c3') + drops('#7fb2ff', 3); break;
    case 'rain': body = cloudShape(6, 4, 1.0, '#8f9aa8') + drops('#4f8cff', 4); break;
    case 'snow': body = cloudShape(6, 4, 1.0, '#cfd8e3') + [38, 60, 82].map((x) => `<circle cx="${x}" cy="90" r="5" fill="#eef3f8"/>`).join(''); break;
    case 'thunder': body = cloudShape(6, 4, 1.0, '#7d8894') + `<polygon points="62,70 48,94 60,94 52,114 76,86 64,86 72,70" fill="${PAL.amber}"/>`; break;
  }
  return img(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">${body}</svg>`, size, size);
}
