// ─── Вечірній звіт: 1 картинка, сітка різнокольорових плиток ──────────
// На відміну від ранкового брифу (однакові прямокутні картки), тут форма
// плитки залежить від даних — кільця, дуги, сегментна смуга, градієнтна
// шкала — як на референсі власника (темний віджет-грід).
import type { EveningData } from './data.js';
import { dominantZone } from '../training/intervals.js';
import { PAL, gauge, rangeBar, ringStack, stackedBar, weatherIcon } from '../brief/svg.js';
import { esc, gap, header, PAD, renderPanel, row, thousands } from '../brief/ui.js';
import { weatherIconFor, weatherLabel } from '../brief/weather.js';

// Без емоджі: Noto Sans, яким рендериться панель, не має цих гліфів — лише
// кольорова крапка-маркер, як для фаз сну в ранковому брифі.
function widget(dotColor: string, label: string, body: string, sub = ''): string {
  return `<div style="display:flex;flex-direction:column;flex:1;background:${PAL.card};border:1px solid ${PAL.border};border-radius:26px;padding:22px 22px 20px;min-height:220px;">
    <div style="display:flex;flex-direction:row;align-items:center;font-size:22px;color:${PAL.label};">
      <div style="display:flex;width:14px;height:14px;border-radius:7px;background:${dotColor};margin-right:10px;"></div>${esc(label)}
    </div>
    <div style="display:flex;flex:1;align-items:center;justify-content:center;margin-top:16px;">${body}</div>
    ${sub ? `<div style="display:flex;font-size:20px;color:${PAL.muted};justify-content:center;">${esc(sub)}</div>` : ''}
  </div>`;
}

function bigNum(value: string, unit = '', color = PAL.text): string {
  return `<div style="display:flex;flex-direction:row;align-items:baseline;">
    <div style="display:flex;font-size:52px;font-weight:700;color:${color};">${esc(value)}</div>
    ${unit ? `<div style="display:flex;font-size:22px;color:${PAL.muted};margin-left:6px;">${esc(unit)}</div>` : ''}
  </div>`;
}

function gaugeWidget(label: string, value: number | null, unit: string, color: string, pct: number | null, sub: string): string {
  return widget(color, label, `<div style="display:flex;position:relative;width:140px;height:140px;">
    ${gauge(pct, color, 140, 14)}
    <div style="display:flex;position:absolute;top:0;left:0;width:140px;height:140px;flex-direction:column;align-items:center;justify-content:center;">
      <div style="display:flex;font-size:34px;font-weight:700;">${value != null ? esc(String(Math.round(value))) : '—'}</div>
      ${unit ? `<div style="display:flex;font-size:18px;color:${PAL.muted};">${esc(unit)}</div>` : ''}
    </div>
  </div>`, sub);
}

const ZONE_COLOR = [PAL.blue, PAL.blue, PAL.green, PAL.amber, PAL.amber, PAL.red, PAL.red];

export async function renderEveningPanel(d: EveningData): Promise<Buffer> {
  const g = d.garmin;
  const tiles: string[] = [];

  // 1. Кроки
  tiles.push(gaugeWidget('Кроки', g?.steps ?? null, '', PAL.green,
    g?.steps != null && g.stepGoal ? Math.min(100, (g.steps / g.stepGoal) * 100) : null,
    g?.steps != null ? `${thousands(g.steps)}${g.stepGoal ? ` з ${thousands(g.stepGoal)}` : ''}` : '—'));

  // 2. Кільця активності
  const stepsPct = g?.steps != null && g.stepGoal ? Math.min(100, (g.steps / g.stepGoal) * 100) : null;
  const intensityPct = g?.intensityMin != null && g.intensityGoal ? Math.min(100, (g.intensityMin / g.intensityGoal) * 100) : null;
  const distPct = g?.distanceM != null ? Math.min(100, (g.distanceM / 8000) * 100) : null; // 8км — орієнтовний активний день
  tiles.push(widget(PAL.violet, 'Кільця дня', `<div style="display:flex;position:relative;width:140px;height:140px;">
      ${ringStack([{ pct: stepsPct, color: PAL.green }, { pct: intensityPct, color: PAL.blue }, { pct: distPct, color: PAL.violet }], 140, 15)}
    </div>`, 'кроки · рух · дистанція'));

  // 3. Заряд тіла
  const bb = g?.bodyBattery;
  tiles.push(gaugeWidget('Заряд тіла', bb?.now ?? null, '', PAL.blue, bb?.now ?? null,
    bb?.highest != null ? `макс ${bb.highest} · мін ${bb.lowest ?? '—'}` : '—'));

  // 4. Стрес
  const st = g?.stress;
  const stressColor = st?.avg == null ? PAL.muted : st.avg >= 50 ? PAL.red : st.avg >= 25 ? PAL.amber : PAL.green;
  tiles.push(widget(stressColor, 'Стрес', `<div style="display:flex;flex-direction:column;align-items:center;">
      ${bigNum(st?.avg != null ? String(Math.round(st.avg)) : '—', '', stressColor)}
      <div style="display:flex;margin-top:10px;">${stackedBar([
        { pct: st?.restPct ?? 0, color: PAL.track },
        { pct: st?.lowPct ?? 0, color: PAL.green },
        { pct: st?.mediumPct ?? 0, color: PAL.amber },
        { pct: st?.highPct ?? 0, color: PAL.red },
      ], 180, 16)}</div>
    </div>`));

  // 5. Пульс спокою — звичний діапазон
  tiles.push(widget(PAL.red, 'Пульс спокою', `<div style="display:flex;flex-direction:column;align-items:center;">
      ${bigNum(g?.restingHr != null ? String(g.restingHr) : '—', 'уд/хв')}
      ${g?.restingHr != null && d.rhrRange ? `<div style="display:flex;margin-top:10px;">${rangeBar(g.restingHr, d.rhrRange.low, d.rhrRange.high, 200, 28)}</div>` : ''}
    </div>`, d.rhrRange ? `норма ${d.rhrRange.low}–${d.rhrRange.high}` : ''));

  // 6. SpO2
  tiles.push(gaugeWidget('SpO2', g?.spo2Avg ?? null, '%', PAL.blue, g?.spo2Avg ?? null, 'середнє за день'));

  // 7. Поверхи
  tiles.push(widget(PAL.amber, 'Поверхи', bigNum(g?.floors != null ? String(Math.round(g.floors)) : '—')));

  // 8. Дистанція
  tiles.push(widget(PAL.violet, 'Дистанція', bigNum(g?.distanceM != null ? (g.distanceM / 1000).toFixed(1) : '—', 'км')));

  // 9. Тренування сьогодні / днів без тренування
  if (d.todayActivity) {
    const zone = dominantZone(d.todayActivity.icu_hr_zone_times);
    const mins = Math.round((d.todayActivity.moving_time ?? 0) / 60);
    const zoneColor = zone ? ZONE_COLOR[Math.min(zone.zone - 1, ZONE_COLOR.length - 1)] : PAL.green;
    tiles.push(widget(zoneColor, 'Тренування', `<div style="display:flex;flex-direction:column;align-items:center;">
        ${bigNum(zone ? `Z${zone.zone}` : '✓', '', zoneColor)}
      </div>`, `${mins} хв${d.todayActivity.average_heartrate ? ` · ${Math.round(d.todayActivity.average_heartrate)} уд/хв` : ''}`));
  } else {
    tiles.push(widget(PAL.muted, 'Тренування', bigNum(d.daysSinceTraining != null ? String(d.daysSinceTraining) : '—', 'днів тому', PAL.muted), 'без тренування сьогодні'));
  }

  // 10. План дня
  const planPct = d.plan.total ? Math.round((d.plan.done / d.plan.total) * 100) : null;
  tiles.push(gaugeWidget('План дня', planPct, '%', PAL.green, planPct, d.plan.total ? `${d.plan.done} з ${d.plan.total}` : 'план порожній'));

  // 11. HRV
  tiles.push(widget(PAL.blue, 'HRV за ніч', `<div style="display:flex;flex-direction:column;align-items:center;">
      ${bigNum(d.hrvAvg != null ? String(Math.round(d.hrvAvg)) : '—', 'мс')}
      ${d.hrvAvg != null && d.hrvRange ? `<div style="display:flex;margin-top:10px;">${rangeBar(d.hrvAvg, d.hrvRange.low, d.hrvRange.high, 200, 28)}</div>` : ''}
    </div>`, d.hrvRange ? `норма ${d.hrvRange.low}–${d.hrvRange.high}` : ''));

  // 12. Погода завтра
  const tw = d.tomorrowWeather;
  tiles.push(widget(PAL.blue, 'Погода завтра', tw ? weatherIcon(weatherIconFor(tw.code, true), 90) : bigNum('—'),
    tw ? `${Math.round(tw.tMax)}° / ${Math.round(tw.tMin)}° · ${weatherLabel(tw.code)}` : 'недоступно'));

  // 13. Перша подія завтра
  tiles.push(widget(PAL.violet, 'Завтра з ранку', d.tomorrowEvent
    ? `<div style="display:flex;font-size:38px;font-weight:700;">${esc(d.tomorrowEvent.time)}</div>`
    : bigNum('—'),
    d.tomorrowEvent ? (d.tomorrowEvent.title.length > 26 ? `${d.tomorrowEvent.title.slice(0, 25)}…` : d.tomorrowEvent.title) : 'нічого не заплановано'));

  const rows: string[] = [];
  for (let i = 0; i < tiles.length; i += 3) rows.push(row(tiles.slice(i, i + 3), 18));

  // Висота під контент: заголовок + рядки плиток (4 повні по 3 + 1 неповний), не фіксовані 1720 брифу.
  const rowCount = Math.ceil(tiles.length / 3);
  const height = PAD * 2 + 100 + 24 + rowCount * 220 + (rowCount - 1) * 18;

  return renderPanel(`
    ${header('Підсумок дня', d.dateLabel)}
    ${gap(24)}
    ${rows.join(gap(18))}
  `, height);
}
