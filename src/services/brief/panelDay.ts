// ─── Панель 3: Сьогодні — погода, здоров'я, план ─────────────────────
import type { BriefData } from './data.js';
import { PAL, rangeBar, weatherIcon } from './svg.js';
import {
  INNER, badge, card, cardTitle, esc, gap, header, hrvStatusUa, renderPanel, row, thousands,
  tile, typicalRange,
} from './ui.js';
import { weatherIconFor, weatherLabel, weatherTrainingHint, type Weather } from './weather.js';

const deg = (t: number) => `${Math.round(t)}°`;

function chip(label: string, value: string): string {
  return `<div style="display:flex;flex-direction:column;flex:1;align-items:center;background:${PAL.card2};border-radius:18px;padding:14px 6px;">
    <div style="display:flex;font-size:20px;color:${PAL.muted};">${esc(label)}</div>
    <div style="display:flex;font-size:28px;font-weight:700;margin-top:2px;">${esc(value)}</div>
  </div>`;
}

function weatherCard(w: Weather): string {
  const icon = weatherIcon(weatherIconFor(w.day.code, true), 160);
  const hero = row([
    icon,
    `<div style="display:flex;flex-direction:column;justify-content:center;flex:1;">
      <div style="display:flex;flex-direction:row;align-items:flex-end;">
        <div style="display:flex;font-size:82px;font-weight:700;">${deg(w.day.tMax)}</div>
        <div style="display:flex;font-size:48px;color:${PAL.muted};margin-left:14px;margin-bottom:14px;">/ ${deg(w.day.tMin)}</div>
      </div>
      <div style="display:flex;font-size:36px;">${esc(weatherLabel(w.day.code))}</div>
      <div style="display:flex;font-size:25px;color:${PAL.muted};margin-top:6px;">зараз ${deg(w.now.temp)}, відчувається як ${deg(w.now.feels)}</div>
    </div>`,
  ], 30, 'align-items:center;');
  const chips = row([
    chip('Опади', w.day.precipProb != null ? `${Math.round(w.day.precipProb)}%` : '—'),
    chip('Вітер', w.day.windMax != null ? `${Math.round(w.day.windMax)} м/с` : `${Math.round(w.now.wind)} м/с`),
    chip('УФ', w.day.uv != null ? `${Math.round(w.day.uv)}` : '—'),
    chip('Схід', w.day.sunrise ?? '—'),
    chip('Захід', w.day.sunset ?? '—'),
  ], 12);
  return card(`
    ${hero}
    ${gap(20)}
    ${chips}
    ${gap(18)}
    <div style="display:flex;font-size:26px;color:${PAL.green};">${esc(weatherTrainingHint(w))}</div>
  `);
}

function hourlyCard(w: Weather): string {
  const cols = w.hourly.map((h) => `<div style="display:flex;flex-direction:column;align-items:center;flex:1;">
    <div style="display:flex;font-size:23px;color:${PAL.muted};">${h.hour}:00</div>
    ${weatherIcon(weatherIconFor(h.code, h.isDay), 60)}
    <div style="display:flex;font-size:32px;font-weight:700;">${deg(h.temp)}</div>
    <div style="display:flex;font-size:20px;color:${(h.precip ?? 0) >= 30 ? PAL.blue : PAL.faint};margin-top:2px;">${h.precip != null ? `${Math.round(h.precip)}%` : ''}</div>
  </div>`).join('');
  return card(`${cardTitle('Протягом дня', 'ймовірність опадів')}<div style="display:flex;flex-direction:row;">${cols}</div>`);
}

function rangeCard(label: string, value: number | null, unit: string, range: { low: number; high: number } | null, note: string, statusBadge: string): string {
  const inside = value != null && range != null && value >= range.low && value <= range.high;
  const auto = value == null || range == null ? ''
    : inside ? badge('у нормі', PAL.green)
    : value > range.high ? badge('вище норми', PAL.amber) : badge('нижче норми', PAL.amber);
  return card(`
    <div style="display:flex;flex-direction:row;justify-content:space-between;align-items:center;">
      <div style="display:flex;font-size:26px;color:${PAL.label};">${esc(label)}</div>
      ${statusBadge || auto}
    </div>
    <div style="display:flex;flex-direction:row;align-items:flex-end;margin-top:8px;">
      <div style="display:flex;font-size:54px;font-weight:700;">${value != null ? Math.round(value) : '—'}</div>
      <div style="display:flex;font-size:26px;color:${PAL.muted};margin-left:10px;margin-bottom:12px;">${esc(unit)}</div>
    </div>
    <div style="display:flex;font-size:22px;color:${PAL.muted};">${range ? `твій звичний діапазон ${range.low}–${range.high}` : esc(note)}</div>
    ${value != null && range ? `<div style="display:flex;margin-top:8px;">${rangeBar(value, range.low, range.high, (INNER - 20) / 2 - 64, 34)}</div>` : ''}
  `, 'flex:1;');
}

function planCard(d: BriefData): string {
  const MAX = 3;
  // Зала першою — це бриф про тренування; далі події за часом.
  const ordered = [...d.plan].sort((a, b) => (a.kind === 'gym' ? -1 : b.kind === 'gym' ? 1 : (a.time ?? '').localeCompare(b.time ?? '')));
  const items = ordered.slice(0, MAX).map((p) => `<div style="display:flex;flex-direction:row;align-items:center;height:48px;">
    <div style="display:flex;width:110px;font-size:26px;font-weight:700;color:${p.kind === 'gym' ? PAL.green : PAL.text};">${esc(p.time ?? (p.kind === 'gym' ? 'Зала' : 'день'))}</div>
    <div style="display:flex;flex:1;font-size:26px;">${esc(p.title.length > 44 ? `${p.title.slice(0, 43)}…` : p.title)}</div>
  </div>`).join('');
  const more = ordered.length > MAX ? `<div style="display:flex;font-size:22px;color:${PAL.muted};">і ще ${ordered.length - MAX} — у підписі</div>` : '';
  return card(`${cardTitle('План на сьогодні')}${items || `<div style="display:flex;font-size:26px;color:${PAL.muted};">Нічого не заплановано</div>`}${more}`);
}

export async function renderDayPanel(d: BriefData): Promise<Buffer> {
  const g = d.garmin;
  const blocks: string[] = [];
  if (d.weather) {
    blocks.push(weatherCard(d.weather), gap(18), hourlyCard(d.weather), gap(18));
  } else {
    blocks.push(card(`<div style="display:flex;font-size:28px;color:${PAL.muted};">Погода зараз недоступна</div>`), gap(22));
  }

  // Звичні діапазони: HRV — базова лінія самого Garmin; пульс спокою — міжквартильний
  // розмах за 30 днів з intervals.icu, а якщо історії замало — середнє Garmin за 7 днів ±2.
  const rhr = g.restingHr ?? d.stats?.restingHr?.value ?? null;
  const rhrRange = typicalRange(d.wellness.map((r) => r.restingHR))
    ?? (g.restingHr7d != null ? { low: g.restingHr7d - 2, high: g.restingHr7d + 2 } : null);
  const hrv = g.hrv?.lastNight ?? g.sleep?.hrvAvg ?? d.stats?.hrv?.value ?? null;
  const hrvRange = g.hrv?.low != null && g.hrv.high != null ? { low: g.hrv.low, high: g.hrv.high } : typicalRange(d.wellness.map((r) => r.hrv));
  const hrvBadge = g.hrv?.status ? (() => { const s = hrvStatusUa(g.hrv!.status); return badge(s.text, s.color); })() : '';
  blocks.push(row([
    rangeCard('Пульс спокою', rhr, 'уд/хв', rhrRange, 'діапазон з’явиться за кілька днів', ''),
    rangeCard('HRV за ніч', hrv, 'мс', hrvRange, 'діапазон з’явиться за кілька днів', hrvBadge),
  ], 20), gap(18));

  const y = g.yesterday;
  blocks.push(row([
    tile('Заряд тіла', g.bodyBatteryWake != null ? String(g.bodyBatteryWake) : '—',
      g.sleep?.bodyBatteryChange != null ? `+${g.sleep.bodyBatteryChange} за ніч` : 'при пробудженні'),
    tile('Кроки вчора', y?.steps != null ? thousands(y.steps) : '—',
      y?.stepGoal ? `ціль ${thousands(y.stepGoal)}` : '', y?.steps != null && y.stepGoal != null && y.steps >= y.stepGoal ? PAL.green : PAL.muted),
    tile('Стрес вчора', y?.stressAvg != null ? String(y.stressAvg) : '—', 'середній, 0–100'),
  ], 16), gap(18));

  blocks.push(planCard(d));
  return renderPanel(`${header('Сьогодні', d.weather ? `${d.weather.city} · ${d.dateLabel}` : d.dateLabel)}${gap(22)}${blocks.join('')}`);
}
