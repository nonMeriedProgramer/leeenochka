import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import satori from 'satori';
import { html } from 'satori-html';
import { Resvg } from '@resvg/resvg-js';
import { formLabel, type BriefStats, type Trend } from './stats.js';

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
  green: '#8fe3a0', violet: '#9b8cf2', amber: '#f2b84c',
};

function gap(): string {
  return '<div style="display:flex;width:22px;"></div>';
}

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
      <div style="display:flex;color:${C.text};font-size:56px;font-weight:700;">${value}</div>
    </div>
    <div style="display:flex;color:${accent};font-size:24px;margin-top:6px;">${sub}</div>
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

/**
 * Підпис-дельта під карткою: "+14 від сер. 30д" / "−7 мс від сер. 30д" + колір.
 * Знак замість стрілки — Unicode-стрілки й CSS-трикутники (border-hack) у
 * satori/Noto Sans із цим набором шрифтів не рендерились (тофу-квадрат).
 * invert=true для метрик, де НИЖЧЕ за середнє — краще (пульс спокою); для
 * решти вище — краще.
 */
function trendSub(t: Trend, unit: string, digits = 0, invert = false): { text: string; accent: string } {
  const threshold = digits ? 0.05 : 1;
  if (t.delta == null || Math.abs(t.delta) < threshold) {
    return { text: 'як зазвичай', accent: C.muted };
  }
  const up = t.delta > 0;
  const good = invert ? !up : up;
  const accent = good ? C.green : C.amber;
  const sign = up ? '+' : '-';
  const d = digits ? Math.abs(t.delta).toFixed(digits) : String(Math.abs(Math.round(t.delta)));
  return { text: `${sign}${d}${unit} від сер. 30д`, accent };
}

function fmtVal(t: Trend, digits = 0): string {
  return digits ? t.value.toFixed(digits) : String(Math.round(t.value));
}

function buildHtml(s: BriefStats, dateLabel: string): string {
  const rows: string[] = [];

  // Ряд 1: Fitness / Fatigue / Form — тренувальне навантаження, рахує intervals.icu
  // з усієї історії, тож щодня реально рухається (на відміну від static "готовності").
  if (s.fitness != null && s.fatigue != null && s.form != null) {
    const sign = s.form > 0 ? '+' : '';
    const top = [
      statCard('Фітнес', String(s.fitness), 'CTL · довге навантаження', C.green),
      statCard('Втома', String(s.fatigue), 'ATL · останній тиждень', C.amber),
      statCard('Форма', `${sign}${s.form}`, formLabel(s.form), s.form >= 0 ? C.green : C.amber),
    ];
    rows.push(`<div style="display:flex;flex-direction:row;margin-top:26px;">${top.join(gap())}</div>`);
  }

  // Ряд 2: Сон (з дельтою) + кільце готовності, якщо є
  const mid: string[] = [];
  if (s.sleepScore) {
    const sub = trendSub(s.sleepScore, '', 0);
    const subText = s.sleepHours != null ? `${sub.text} · ${s.sleepHours} год` : sub.text;
    mid.push(wideCard('Сон', fmtVal(s.sleepScore), subText, sub.accent));
  } else if (s.sleepHours != null) {
    mid.push(wideCard('Сон', String(s.sleepHours), 'год', C.muted));
  }
  if (s.readiness != null) mid.push(readinessCard(s.readiness));
  if (mid.length) rows.push(`<div style="display:flex;flex-direction:row;margin-top:22px;">${mid.join(gap())}</div>`);

  // Ряд 3: HRV (вище — краще) + пульс спокою (нижче — краще)
  const hr: string[] = [];
  if (s.hrv) {
    const sub = trendSub(s.hrv, ' мс');
    hr.push(wideCard('HRV', `${fmtVal(s.hrv)} мс`, sub.text, sub.accent));
  }
  if (s.restingHr) {
    const sub = trendSub(s.restingHr, ' уд/хв', 0, true);
    hr.push(wideCard('Пульс спокою', fmtVal(s.restingHr), sub.text, sub.accent));
  }
  if (hr.length) rows.push(`<div style="display:flex;flex-direction:row;margin-top:22px;">${hr.join(gap())}</div>`);

  // Ряд 4: кроки за ВЧОРА (завершений день, не "0 о 8 ранку")
  if (s.stepsYesterday) {
    const sub = trendSub(s.stepsYesterday, '');
    rows.push(`<div style="display:flex;flex-direction:row;margin-top:22px;">${wideCard(
      'Кроки (вчора)', Math.round(s.stepsYesterday.value).toLocaleString('uk-UA'), sub.text, sub.accent,
    )}</div>`);
  }

  return `<div style="display:flex;flex-direction:column;width:100%;height:100%;background:${C.bg};padding:56px;font-family:'Noto Sans';">
    <div style="display:flex;flex-direction:column;">
      <div style="display:flex;color:${C.text};font-size:52px;font-weight:700;">Доброго ранку</div>
      <div style="display:flex;color:${C.muted};font-size:28px;margin-top:6px;">${dateLabel}</div>
    </div>
    ${rows.join('')}
  </div>`;
}

// Приблизна висота полотна від кількості рядків (щоб контент не обрізало і не було порожнечі).
// Емпірично підібрано з запасом (перший варіант обрізав останню картку) — краще
// зайвий чорний простір знизу, ніж обрізаний текст.
function canvasHeight(s: BriefStats): number {
  let h = 56 + 120 + 56 + 40; // паддінги + шапка + запас
  if (s.fitness != null && s.fatigue != null && s.form != null) h += 26 + 210;
  if (s.sleepScore || s.sleepHours != null || s.readiness != null) h += 22 + (s.readiness != null ? 360 : 210);
  if (s.hrv || s.restingHr) h += 22 + 210;
  if (s.stepsYesterday) h += 22 + 210;
  return h;
}

/** Рендерить PNG дашборду; КИДАЄ помилку (для діагностики). */
export async function renderBriefImage(s: BriefStats, dateLabel: string): Promise<Buffer> {
  const width = 1080;
  const height = canvasHeight(s);
  const markup = html(buildHtml(s, dateLabel));
  const svg = await satori(markup as Parameters<typeof satori>[0], { width, height, fonts: fonts() });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  return Buffer.from(png);
}

/** Генерує PNG ранкового дашборду; null якщо рендер не вдався (безпечна обгортка). */
export async function generateBriefImage(s: BriefStats, dateLabel: string): Promise<Buffer | null> {
  try {
    return await renderBriefImage(s, dateLabel);
  } catch (e) {
    console.error('generateBriefImage failed:', e instanceof Error ? e.message : e);
    return null;
  }
}
