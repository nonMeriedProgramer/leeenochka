// ─── Ранкова панель 3: Сьогодні — погода, здоров'я, план ──────────────
import type { BriefData } from './data.js';
import { weatherIcon } from './svg.js';
import { thousands, typicalRange } from './ui.js';
import { weatherIconFor, weatherLabel, weatherTrainingHint, type Weather } from './weather.js';
import { ART, ART_WIDE, center, group, renderGrid, scale, tag, tile, val, type Tile } from '../dashboard/grid.js';
import { C, barMeter, capsules, clockDial, dayDots, dialScale, gradientTrack, spectrumBar, sunArc, timeline } from '../dashboard/widgets.js';

const deg = (t: number) => `${Math.round(t)}°`;
const pct = (v: number | null | undefined, max: number): number | null =>
  v == null ? null : Math.max(0, Math.min(100, (v / max) * 100));

/** Погодинний прогноз: іконка + температура під кожною годиною (HTML-шаром). */
function hourlyStrip(w: Weather, width: number): string {
  const cols = w.hourly.map((h) => `<div style="display:flex;flex-direction:column;align-items:center;flex:1;">
    <div style="display:flex;font-size:14px;color:${C.dim};">${h.hour}</div>
    ${weatherIcon(weatherIconFor(h.code, h.isDay), 34)}
    <div style="display:flex;font-size:18px;font-weight:700;">${deg(h.temp)}</div>
  </div>`).join('');
  return `<div style="display:flex;flex-direction:row;width:${width}px;">${cols}</div>`;
}

export async function renderDayPanel(d: BriefData): Promise<Buffer> {
  const w = d.weather;
  const g = d.garmin;
  const y = g.yesterday;
  const tiles: Tile[] = [];

  // 1. Погода зараз — іконка і температура
  tiles.push(tile(
    val(w ? deg(w.now.temp) : '—', w ? `як ${deg(w.now.feels)}` : 'нема даних')
      + tag(w ? weatherLabel(w.day.code) : '', C.cyan),
    w ? center(weatherIcon(weatherIconFor(w.now.code, w.now.isDay), 84)) : '',
    scale([w ? w.city : '']),
  ));

  // 2. Діапазон дня
  tiles.push(tile(
    group(val(w ? deg(w.day.tMax) : '—', '', C.text), w ? val(deg(w.day.tMin), 'мін', C.dim, 26) : '')
      + tag('сьогодні', C.orange),
    gradientTrack(w ? 72 : null, ART, 42, C.cyan, C.orange),
    scale([w ? deg(w.day.tMin) : '', w ? deg(w.day.tMax) : '']),
  ));

  // 3. Опади
  tiles.push(tile(
    val(w?.day.precipProb != null ? `${Math.round(w.day.precipProb)}` : '—', '%')
      + tag(w?.day.precipProb != null && w.day.precipProb >= 50 ? 'парасоля' : '', C.blue),
    capsules(w?.day.precipProb ?? null, 7, ART, 44, C.blue),
    scale(['ймовірність опадів']),
  ));

  // 4. Вітер і УФ
  tiles.push(tile(
    group(val(w?.day.windMax != null ? String(Math.round(w.day.windMax)) : '—', 'м/с', C.text, 34),
      w?.day.uv != null ? val(String(Math.round(w.day.uv)), 'УФ', C.text, 24) : '') + tag('вітер', C.teal),
    barMeter(pct(w?.day.windMax ?? null, 15), ART, 44, 12),
    scale(['0', '15 м/с']),
  ));

  // 5. Погодинно — на дві колонки
  tiles.push(tile(
    val('Протягом дня', '', C.text, 28) + tag(w ? 'прогноз' : '', C.dim),
    w ? hourlyStrip(w, ART_WIDE) : `<div style="display:flex;width:${ART_WIDE}px;height:74px;"></div>`,
    scale([w ? weatherTrainingHint(w) : 'погода недоступна']),
    2,
  ));

  // 6. Схід і захід
  tiles.push(tile(
    val(w?.day.sunrise ?? '—', '', C.text, 34) + tag('схід', C.orange),
    sunArc(w ? 20 : null, ART, 50),
    scale([w?.day.sunset ? `захід ${w.day.sunset}` : '']),
  ));

  // 7. Пульс спокою проти звичного
  const rhr = g.restingHr ?? d.stats?.restingHr?.value ?? null;
  const rhrRange = typicalRange(d.wellness.map((r) => r.restingHR))
    ?? (g.restingHr7d != null ? { low: g.restingHr7d - 2, high: g.restingHr7d + 2 } : null);
  const rhrLo = (rhrRange?.low ?? 45) - 6;
  const rhrHi = (rhrRange?.high ?? 65) + 6;
  tiles.push(tile(
    val(rhr != null ? String(Math.round(rhr)) : '—', 'уд/хв')
      + tag(rhr == null || !rhrRange ? '' : rhr <= rhrRange.high ? 'у нормі' : 'вище', rhrRange && rhr != null && rhr <= rhrRange.high ? C.green : C.orange),
    dialScale(rhr != null ? pct(rhr - rhrLo, rhrHi - rhrLo) : null, ART, 48),
    scale([rhrRange ? `звичне ${rhrRange.low}–${rhrRange.high}` : 'пульс спокою']),
  ));

  // 8. Кроки вчора
  tiles.push(tile(
    val(y?.steps != null ? thousands(y.steps) : '—', 'кроків учора')
      + tag(y?.steps != null && y.stepGoal != null && y.steps >= y.stepGoal ? 'ціль' : '', C.green),
    barMeter(y?.steps != null && y.stepGoal ? pct(y.steps, y.stepGoal) : null, ART, 46),
    scale(['0', y?.stepGoal ? thousands(y.stepGoal) : '']),
  ));

  // 9. Стрес учора
  const stress = y?.stressAvg ?? null;
  tiles.push(tile(
    val(stress != null ? String(Math.round(stress)) : '—', 'стрес учора')
      + tag(stress == null ? '' : stress >= 50 ? 'високий' : stress >= 25 ? 'помірний' : 'спокій',
        stress == null ? C.dim : stress >= 50 ? C.red : stress >= 25 ? C.orange : C.green),
    spectrumBar(stress, ART, 42),
    scale(['0', '50', '100']),
  ));

  // 10. Інтенсивні хвилини вчора
  tiles.push(tile(
    val(y?.intensityMin != null ? String(y.intensityMin) : '—', 'хв руху') + tag('учора', C.mint),
    center(clockDial(pct(y?.intensityMin ?? null, 150 / 7), 78, C.mint)),
    scale(['інтенсивні хвилини']),
  ));

  // 11. Зала сьогодні
  const gym = d.plan.find((p) => p.kind === 'gym');
  tiles.push(tile(
    val(gym ? 'Зала' : '—', gym ? '' : 'не заплановано', gym ? C.green : C.dim, 34) + tag(gym ? 'сьогодні' : '', C.green),
    dayDots(1, gym ? 1 : 0, 34, C.green),
    scale([gym ? (gym.title.length > 26 ? `${gym.title.slice(0, 25)}…` : gym.title) : 'день без зали']),
  ));

  // 12. План на сьогодні — на дві колонки
  const events = d.plan.filter((p) => p.kind === 'event' && p.time).slice(0, 4);
  const marks = events.map((e) => {
    const min = Number(e.time!.slice(0, 2)) * 60 + Number(e.time!.slice(3, 5));
    return { pct: pct(min - 360, 960) ?? 0, width: 34, color: C.teal };
  });
  tiles.push(tile(
    val(String(d.plan.length), d.plan.length ? 'у плані' : 'нічого не заплановано') + tag('сьогодні', C.teal),
    timeline(marks, ART_WIDE, 40),
    scale(events.length ? events.map((e) => `${e.time} ${e.title.length > 14 ? `${e.title.slice(0, 13)}…` : e.title}`) : ['подій немає']),
    2,
  ));

  return renderGrid('Сьогодні', w ? `${w.city} · ${d.dateLabel}` : d.dateLabel, tiles);
}
