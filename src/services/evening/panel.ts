// ─── Вечірній звіт: сітка 4×4 у стилі Apple Watch-віджетів ────────────
// Чорний фон, без карток і рамок; велика цифра + дрібний юніт угорі, під нею
// своя форма графіка на кожну плитку (widgets.ts), знизу — підпис капсом.
import type { EveningData } from './data.js';
import { dominantZone } from '../training/intervals.js';
import { esc } from '../brief/ui.js';
import { renderBlackPanel } from './render.js';
import {
  C, areaChart, barMeter, capsules, clockDial, dayDots, dialScale, dotMatrix,
  gradientTrack, quadRings, spectrumBar, sunArc, timeline, tripleRing, waveform, zoneStadium,
} from './widgets.js';

const TILE_W = 247;
const TILE_H = 176;
const GAP = 12;

/** Плитка: рядок «значення + юніт … мітка», далі графіка, знизу підпис. */
function tile(top: string, art: string, bottom = ''): string {
  return `<div style="display:flex;flex-direction:column;width:${TILE_W}px;height:${TILE_H}px;background:${C.tile};border-radius:18px;padding:14px 16px;">
    <div style="display:flex;flex-direction:row;align-items:baseline;width:100%;justify-content:space-between;">${top}</div>
    <div style="display:flex;flex:1;align-items:center;margin-top:8px;">${art}</div>
    ${bottom ? `<div style="display:flex;flex-direction:row;width:100%;justify-content:space-between;font-size:14px;color:${C.dim};">${bottom}</div>` : ''}
  </div>`;
}

/** Велике число + дрібний юніт поруч (як «95db», «1 065hPa»). */
function val(value: string, unit = '', color = C.text, size = 40): string {
  return `<div style="display:flex;flex-direction:row;align-items:baseline;">
    <div style="display:flex;font-size:${size}px;font-weight:700;color:${color};">${esc(value)}</div>
    ${unit ? `<div style="display:flex;font-size:16px;color:${C.dim};margin-left:4px;">${esc(unit)}</div>` : ''}
  </div>`;
}

/** Кілька значень як одна ліва група (щоб space-between не розкидав їх по кутах). */
function group(...parts: string[]): string {
  const items = parts.filter(Boolean)
    .map((p, i) => (i ? `<div style="display:flex;margin-left:6px;">${p}</div>` : p));
  return `<div style="display:flex;flex-direction:row;align-items:baseline;">${items.join('')}</div>`;
}

/** Мітка праворуч угорі (як «LOUD», «RISING», «UNHEALTHY»). */
function tag(text: string, color: string): string {
  if (!text) return '<div style="display:flex;"></div>';
  return `<div style="display:flex;font-size:14px;font-weight:700;color:${color};margin-left:10px;">${esc(text.toUpperCase())}</div>`;
}

/** Підпис зі шкалою під графікою (як «30 · 80 · 120»). */
function scale(labels: string[]): string {
  return labels.map((l) => `<div style="display:flex;">${esc(l)}</div>`).join('');
}

const pctOf = (v: number | null | undefined, max: number): number | null =>
  v == null ? null : Math.max(0, Math.min(100, (v / max) * 100));

export async function renderEveningPanel(d: EveningData): Promise<Buffer> {
  const g = d.garmin;
  const art = TILE_W - 32;
  const tiles: string[] = [];

  // 1. Кроки — стовпчики, як «гучність»
  const stepsPct = g?.steps != null && g.stepGoal ? pctOf(g.steps, g.stepGoal) : null;
  tiles.push(tile(
    val(g?.steps != null ? g.steps.toLocaleString('uk-UA').replace(/ /g, ' ') : '—', 'кроків')
      + tag(stepsPct != null && stepsPct >= 100 ? 'ціль' : '', C.green),
    barMeter(stepsPct, art, 52),
    scale(['0', g?.stepGoal ? String(g.stepGoal) : '—']),
  ));

  // 2. Заряд тіла — градієнтна шкала з маркером, як «тиск»
  const bb = g?.bodyBattery;
  tiles.push(tile(
    val(bb?.now != null ? String(bb.now) : '—', 'заряд')
      + tag(bb?.now == null ? '' : bb.now >= 50 ? 'ок' : 'низько', bb?.now != null && bb.now >= 50 ? C.green : C.orange),
    gradientTrack(bb?.now ?? null, art, 42, C.red, C.green),
    scale(['мін ' + (bb?.lowest ?? '—'), 'макс ' + (bb?.highest ?? '—')]),
  ));

  // 3. Тренування — стадіон із зонами, як «пульс/зона»
  const zone = d.todayActivity ? dominantZone(d.todayActivity.icu_hr_zone_times) : null;
  const mins = d.todayActivity ? Math.round((d.todayActivity.moving_time ?? 0) / 60) : null;
  const zoneColors = [C.blue, C.cyan, C.green, C.yellow, C.orange, C.red, C.pink];
  const zoneColor = zone ? zoneColors[Math.min(zone.zone - 1, zoneColors.length - 1)] : C.dim;
  tiles.push(tile(
    d.todayActivity
      ? val(`${mins}`, 'хв', C.text) + tag(zone ? `зона ${zone.zone}` : 'є', zoneColor)
      : val(d.daysSinceTraining != null ? String(d.daysSinceTraining) : '—', 'днів', C.dim) + tag('пауза', C.dim),
    zoneStadium(zone?.zone ?? null, d.todayActivity?.icu_hr_zone_times?.length ?? 7, art, 54),
    d.todayActivity?.average_heartrate ? scale([`сер ${Math.round(d.todayActivity.average_heartrate)} уд/хв`]) : scale(['без тренування сьогодні']),
  ));

  // 4. Пульс спокою — циферблат зі стрілкою, як «радіо»
  const rhrLow = (d.rhrRange?.low ?? 45) - 6;
  const rhrHigh = (d.rhrRange?.high ?? 65) + 6;
  const rhrPct = g?.restingHr != null ? pctOf(g.restingHr - rhrLow, rhrHigh - rhrLow) : null;
  tiles.push(tile(
    val(g?.restingHr != null ? String(g.restingHr) : '—', 'уд/хв')
      + tag(g?.restingHr == null || !d.rhrRange ? '' : g.restingHr <= d.rhrRange.high ? 'норма' : 'вище',
        d.rhrRange && g?.restingHr != null && g.restingHr <= d.rhrRange.high ? C.green : C.orange),
    dialScale(rhrPct, art, 50),
    scale([String(Math.round(rhrLow)), d.rhrRange ? `${d.rhrRange.low}–${d.rhrRange.high}` : '', String(Math.round(rhrHigh))]),
  ));

  // 5. Сон — чотири кільця з фазами
  const s = d.sleep;
  const sleepH = s ? Math.floor(s.totalSec / 3600) : null;
  const sleepM = s ? Math.round((s.totalSec % 3600) / 60) : null;
  tiles.push(tile(
    group(val(s ? `${sleepH}` : '—', 'год', C.text), s ? val(`${sleepM}`, 'хв', C.text, 26) : '')
      + tag(s?.avgHr ? `${Math.round(s.avgHr)} пульс` : 'сон', C.pink),
    quadRings([
      { pct: s?.deep.pct ?? null, color: C.blue },
      { pct: s?.light.pct ?? null, color: C.cyan },
      { pct: s?.rem.pct ?? null, color: C.purple },
      { pct: s ? (s.awakeSec / Math.max(1, s.totalSec)) * 100 : null, color: C.orange },
    ], 52),
    scale(['глиб', 'легк', 'REM', 'неспан']),
  ));

  // 6. Поверхи — площа з градієнтом, як «підйом»
  tiles.push(tile(
    val(g?.floors != null ? String(Math.round(g.floors)) : '—', 'поверхів') + tag(g?.floors != null ? 'підйом' : '', C.red),
    areaChart(pctOf(g?.floors ?? null, 20), art, 54, C.red),
    scale(['0', '10', '20']),
  ));

  // 7. Дистанція — капсули, як «вода»
  tiles.push(tile(
    val(g?.distanceM != null ? (g.distanceM / 1000).toFixed(1).replace('.', ',') : '—', 'з 8,0 км'),
    capsules(pctOf(g?.distanceM ?? null, 8000), 7, art, 46, C.cyan),
    scale(['пройдено за день']),
  ));

  // 8. Стрес — веселкова шкала з маркером, як «якість повітря»
  const st = g?.stress;
  const stressTag = st?.avg == null ? '—' : st.avg >= 50 ? 'високий' : st.avg >= 25 ? 'помірний' : 'спокій';
  const stressColor = st?.avg == null ? C.dim : st.avg >= 50 ? C.red : st.avg >= 25 ? C.orange : C.green;
  tiles.push(tile(
    val(st?.avg != null ? String(Math.round(st.avg)) : '—', 'стрес') + tag(stressTag, stressColor),
    spectrumBar(st?.avg ?? null, art, 42),
    scale(['0', '25', '50', '75', '100']),
  ));

  // 9. SpO2 — хвиля
  tiles.push(tile(
    val(g?.spo2Avg != null ? `${Math.round(g.spo2Avg)}` : '—', '%', C.text) + tag('SpO2', C.cyan),
    waveform(art, 56, C.red, g?.spo2Avg != null),
    scale(['середнє за добу']),
  ));

  // 10. План дня — кружечки по пунктах, як «серія читання»
  tiles.push(tile(
    val(d.plan.total ? `${d.plan.done}` : '—', d.plan.total ? `з ${d.plan.total}` : 'плану нема')
      + tag(d.plan.total && d.plan.done >= d.plan.total ? 'готово' : 'план', d.plan.total && d.plan.done >= d.plan.total ? C.green : C.dim),
    dayDots(d.plan.total, d.plan.done, 34, C.green),
    scale(['виконано пунктів сьогодні']),
  ));

  // 11. Завтра з ранку — смужка дня з блоком події, як «календар»
  const evMin = d.tomorrowEvent ? Number(d.tomorrowEvent.time.slice(0, 2)) * 60 + Number(d.tomorrowEvent.time.slice(3, 5)) : null;
  tiles.push(tile(
    val(d.tomorrowEvent ? d.tomorrowEvent.time : '—', d.tomorrowEvent ? '' : 'вільно') + tag('завтра', C.teal),
    timeline(evMin != null ? [{ pct: pctOf(evMin - 360, 900) ?? 0, width: 46, color: C.teal }] : [], art, 34),
    scale([d.tomorrowEvent ? (d.tomorrowEvent.title.length > 24 ? `${d.tomorrowEvent.title.slice(0, 23)}…` : d.tomorrowEvent.title) : 'подій не заплановано']),
  ));

  // 12. Кільця дня — три кільця активності
  const intensityPct = g?.intensityMin != null && g.intensityGoal ? pctOf(g.intensityMin, g.intensityGoal) : null;
  const distPct = pctOf(g?.distanceM ?? null, 8000);
  tiles.push(tile(
    val(g?.activeKcal != null ? String(Math.round(g.activeKcal)) : '—', 'ккал', C.pink, 34) + tag('активність', C.dim),
    tripleRing([{ pct: stepsPct, color: C.green }, { pct: intensityPct, color: C.pink }, { pct: distPct, color: C.cyan }], 50),
    scale(['кроки', 'рух', 'шлях']),
  ));

  // 13. Погода завтра — градієнт температур із маркером
  const tw = d.tomorrowWeather;
  tiles.push(tile(
    val(tw ? `${Math.round(tw.tMax)}°` : '—', tw ? `/ ${Math.round(tw.tMin)}°` : 'нема даних') + tag('завтра', C.orange),
    gradientTrack(tw ? 70 : null, art, 42, C.cyan, C.orange),
    scale([tw ? `${Math.round(tw.tMin)}°` : '', tw ? `${Math.round(tw.tMax)}°` : '']),
  ));

  // 14. Хвилини руху — крапки по колу, як «години стояння»
  tiles.push(tile(
    val(g?.intensityMin != null ? String(g.intensityMin) : '—', g?.intensityGoal ? `з ${g.intensityGoal}` : 'хв') + tag('рух', C.mint),
    `<div style="display:flex;width:100%;justify-content:center;">${clockDial(intensityPct, 84, C.mint)}</div>`,
    scale(['інтенсивні хвилини']),
  ));

  // 15. Тиждень — крапкова матриця, як «дистанція»
  const weekPct = pctOf(d.weekMinutes, 300);
  tiles.push(tile(
    val(d.weekMinutes != null ? String(d.weekMinutes) : '—', 'хв за 7 днів') + tag(weekPct != null && weekPct >= 100 ? 'ціль' : '', weekPct != null && weekPct >= 100 ? C.green : C.dim),
    dotMatrix(weekPct, art, 46, C.green),
    scale(['0', '150', '300']),
  ));

  // 16. Схід і захід — сонце над горизонтом
  tiles.push(tile(
    val(tw?.sunset ?? '—', '', C.text, 34) + tag('захід', C.orange),
    sunArc(tw ? 35 : null, art, 54),
    scale([tw?.sunrise ? `схід ${tw.sunrise}` : 'схід —', tw?.sunset ? `захід ${tw.sunset}` : '']),
  ));

  const rows: string[] = [];
  for (let i = 0; i < tiles.length; i += 4) {
    rows.push(`<div style="display:flex;flex-direction:row;">${tiles.slice(i, i + 4).map((t, j) =>
      (j ? `<div style="display:flex;width:${GAP}px;"></div>` : '') + t).join('')}</div>`);
  }
  const grid = rows.join(`<div style="display:flex;height:${GAP}px;"></div>`);

  const head = `<div style="display:flex;flex-direction:row;align-items:baseline;margin-bottom:18px;">
    <div style="display:flex;font-size:34px;font-weight:700;">Підсумок дня</div>
    <div style="display:flex;margin-left:auto;font-size:18px;color:${C.dim};">${esc(d.dateLabel)}</div>
  </div>`;

  const width = TILE_W * 4 + GAP * 3 + 40;
  const height = TILE_H * 4 + GAP * 3 + 40 + 56;
  return renderBlackPanel(head + grid, width, height);
}
