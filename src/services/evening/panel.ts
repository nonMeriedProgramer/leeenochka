// ─── Вечірній звіт: 1 картинка, різнокольоровий бенто-грід ────────────
// На відміну від ранкового брифу (однакові прямокутні картки), тут кожна
// плитка — свій колір і своя форма (дуга/кільця/VU-шкала/смуга), а рядки
// різної ширини (2+1, 3, 2, 1 на всю ширину) — не рівна сітка 3×3.
import type { EveningData } from './data.js';
import { dominantZone } from '../training/intervals.js';
import { PAL, gauge, levelMeter, rangeBar, ringStack, stackedBar, weatherIcon } from '../brief/svg.js';
import { esc, gap, header, PAD, renderPanel, row, thousands } from '../brief/ui.js';
import { weatherIconFor, weatherLabel } from '../brief/weather.js';

// Плитка своїм кольором: тонка акцентна смужка зверху + крапка-маркер (не емодзі —
// Noto Sans, яким рендериться панель, не має цих гліфів) — і своя форма всередині.
// minHeight — не косметика: satori не обрізає переповнення, і замала плитка
// призводить до того, що дуга чи смуга налізає на підпис зверху й знизу.
function widget(accent: string, label: string, body: string, sub = '', flex = 1, minHeight = 270): string {
  return `<div style="display:flex;flex-direction:column;flex:${flex};background:${PAL.card};border:1px solid ${PAL.border};border-top:4px solid ${accent};border-radius:24px;padding:22px 22px 20px;min-height:${minHeight}px;">
    <div style="display:flex;flex-direction:row;align-items:center;font-size:22px;color:${PAL.label};">
      <div style="display:flex;width:12px;height:12px;border-radius:6px;background:${accent};margin-right:10px;"></div>${esc(label)}
    </div>
    <div style="display:flex;flex:1;align-items:center;justify-content:center;margin-top:14px;">${body}</div>
    ${sub ? `<div style="display:flex;font-size:20px;color:${PAL.muted};justify-content:center;text-align:center;">${esc(sub)}</div>` : ''}
  </div>`;
}

function bigNum(value: string, unit = '', color = PAL.text, size = 52): string {
  return `<div style="display:flex;flex-direction:row;align-items:baseline;">
    <div style="display:flex;font-size:${size}px;font-weight:700;color:${color};">${esc(value)}</div>
    ${unit ? `<div style="display:flex;font-size:22px;color:${PAL.muted};margin-left:6px;">${esc(unit)}</div>` : ''}
  </div>`;
}

function gaugeBody(value: number | null, unit: string, color: string, pct: number | null, size = 140): string {
  return `<div style="display:flex;position:relative;width:${size}px;height:${size}px;">
    ${gauge(pct, color, size, Math.round(size * 0.1))}
    <div style="display:flex;position:absolute;top:0;left:0;width:${size}px;height:${size}px;flex-direction:column;align-items:center;justify-content:center;">
      <div style="display:flex;font-size:${Math.round(size * 0.24)}px;font-weight:700;">${value != null ? esc(String(Math.round(value))) : '—'}</div>
      ${unit ? `<div style="display:flex;font-size:18px;color:${PAL.muted};">${esc(unit)}</div>` : ''}
    </div>
  </div>`;
}

const ZONE_COLOR = [PAL.blue, PAL.blue, PAL.green, PAL.amber, PAL.amber, PAL.red, PAL.red];

export async function renderEveningPanel(d: EveningData): Promise<Buffer> {
  const g = d.garmin;
  const rows: string[] = [];

  // Рядок 1 — герой: кроки (широко, VU-шкала замість дуги) + заряд тіла (дуга, велика)
  const stepsPct = g?.steps != null && g.stepGoal ? Math.min(100, (g.steps / g.stepGoal) * 100) : null;
  rows.push(row([
    widget(PAL.lime, 'Кроки', `<div style="display:flex;flex-direction:column;align-items:center;">
        ${bigNum(g?.steps != null ? thousands(g.steps) : '—', g?.stepGoal ? `з ${thousands(g.stepGoal)}` : '', PAL.text, 60)}
        <div style="display:flex;margin-top:14px;">${levelMeter(stepsPct, 14, PAL.lime, 320, 50)}</div>
      </div>`, '', 2),
    widget(PAL.blue, 'Заряд тіла', gaugeBody(g?.bodyBattery.now ?? null, '', PAL.blue, g?.bodyBattery.now ?? null, 150),
      g?.bodyBattery.highest != null ? `макс ${g.bodyBattery.highest} · мін ${g.bodyBattery.lowest ?? '—'}` : '—', 1),
  ], 18));

  // Рядок 2 — стрес (широко, більше місця для сегментної смуги) + пульс спокою
  const st = g?.stress;
  const stressColor = st?.avg == null ? PAL.muted : st.avg >= 50 ? PAL.red : st.avg >= 25 ? PAL.amber : PAL.teal;
  rows.push(row([
    widget(PAL.pink, 'Стрес', `<div style="display:flex;flex-direction:row;align-items:center;">
        ${bigNum(st?.avg != null ? String(Math.round(st.avg)) : '—', '', stressColor, 58)}
        <div style="display:flex;margin-left:24px;">${stackedBar([
          { pct: st?.restPct ?? 0, color: PAL.track },
          { pct: st?.lowPct ?? 0, color: PAL.teal },
          { pct: st?.mediumPct ?? 0, color: PAL.amber },
          { pct: st?.highPct ?? 0, color: PAL.red },
        ], 260, 22)}</div>
      </div>`, st?.qualifier ? st.qualifier.toLowerCase() : '', 2),
    widget(PAL.red, 'Пульс спокою', `<div style="display:flex;flex-direction:column;align-items:center;">
        ${bigNum(g?.restingHr != null ? String(g.restingHr) : '—', 'уд/хв')}
        ${g?.restingHr != null && d.rhrRange ? `<div style="display:flex;margin-top:12px;">${rangeBar(g.restingHr, d.rhrRange.low, d.rhrRange.high, 200, 28)}</div>` : ''}
      </div>`, d.rhrRange ? `норма ${d.rhrRange.low}–${d.rhrRange.high}` : '', 1),
  ], 18));

  // Рядок 3 — три компактні числові плитки
  rows.push(row([
    widget(PAL.cyan, 'SpO2', gaugeBody(g?.spo2Avg ?? null, '%', PAL.cyan, g?.spo2Avg ?? null, 120), 'середнє за день'),
    widget(PAL.gold, 'Поверхи', bigNum(g?.floors != null ? String(Math.round(g.floors)) : '—', '', PAL.gold)),
    widget(PAL.teal, 'Дистанція', bigNum(g?.distanceM != null ? (g.distanceM / 1000).toFixed(1) : '—', 'км', PAL.teal)),
  ], 18));

  // Рядок 4 — кільця активності (широко) + тренування сьогодні / днів без нього
  const intensityPct = g?.intensityMin != null && g.intensityGoal ? Math.min(100, (g.intensityMin / g.intensityGoal) * 100) : null;
  const distPct = g?.distanceM != null ? Math.min(100, (g.distanceM / 8000) * 100) : null;
  rows.push(row([
    widget(PAL.violet, 'Кільця дня', `<div style="display:flex;flex-direction:row;align-items:center;">
        <div style="display:flex;position:relative;width:150px;height:150px;">
          ${ringStack([{ pct: stepsPct, color: PAL.lime }, { pct: intensityPct, color: PAL.blue }, { pct: distPct, color: PAL.violet }], 150, 16)}
        </div>
        <div style="display:flex;flex-direction:column;margin-left:26px;font-size:22px;color:${PAL.muted};">
          ${[['кроки', PAL.lime], ['рух', PAL.blue], ['дистанція', PAL.violet]].map(([t, c], i) =>
            `<div style="display:flex;flex-direction:row;align-items:center;${i ? 'margin-top:6px;' : ''}">
              <div style="display:flex;width:12px;height:12px;border-radius:6px;background:${c};margin-right:8px;"></div>${t}
            </div>`).join('')}
        </div>
      </div>`, '', 1),
    (() => {
      if (d.todayActivity) {
        const zone = dominantZone(d.todayActivity.icu_hr_zone_times);
        const mins = Math.round((d.todayActivity.moving_time ?? 0) / 60);
        const zoneColor = zone ? ZONE_COLOR[Math.min(zone.zone - 1, ZONE_COLOR.length - 1)] : PAL.green;
        return widget(zoneColor, 'Тренування', bigNum(zone ? `Zone ${zone.zone}` : '✓ Готово', '', zoneColor, 44),
          `${mins} хв${d.todayActivity.average_heartrate ? ` · ${Math.round(d.todayActivity.average_heartrate)} уд/хв` : ''}`, 1);
      }
      return widget(PAL.indigo, 'Тренування', bigNum(d.daysSinceTraining != null ? String(d.daysSinceTraining) : '—', 'днів тому', PAL.indigo, 44), 'без тренування сьогодні', 1);
    })(),
  ], 18));

  // Рядок 5 — план дня + HRV
  const planPct = d.plan.total ? Math.round((d.plan.done / d.plan.total) * 100) : null;
  rows.push(row([
    widget(PAL.green, 'План дня', gaugeBody(planPct, '%', PAL.green, planPct, 130), d.plan.total ? `${d.plan.done} з ${d.plan.total}` : 'план порожній'),
    widget(PAL.indigo, 'HRV за ніч', `<div style="display:flex;flex-direction:column;align-items:center;">
        ${bigNum(d.hrvAvg != null ? String(Math.round(d.hrvAvg)) : '—', 'мс')}
        ${d.hrvAvg != null && d.hrvRange ? `<div style="display:flex;margin-top:12px;">${rangeBar(d.hrvAvg, d.hrvRange.low, d.hrvRange.high, 200, 28)}</div>` : ''}
      </div>`, d.hrvRange ? `норма ${d.hrvRange.low}–${d.hrvRange.high}` : ''),
  ], 18));

  // Рядок 6 — «завтра» на всю ширину: погода + перша подія в одній широкій плитці
  const tw = d.tomorrowWeather;
  rows.push(widget(PAL.cyan, 'Завтра', `<div style="display:flex;flex-direction:row;align-items:center;width:100%;margin-top:-6px;">
      <div style="display:flex;flex-direction:row;align-items:center;flex:1;">
        ${tw ? weatherIcon(weatherIconFor(tw.code, true), 84) : ''}
        <div style="display:flex;flex-direction:column;margin-left:16px;">
          <div style="display:flex;font-size:38px;font-weight:700;">${tw ? `${Math.round(tw.tMax)}° / ${Math.round(tw.tMin)}°` : '—'}</div>
          <div style="display:flex;font-size:20px;color:${PAL.muted};">${tw ? esc(weatherLabel(tw.code)) : 'погода недоступна'}</div>
        </div>
      </div>
      <div style="display:flex;width:2px;height:70px;background:${PAL.border};margin:0 26px;"></div>
      <div style="display:flex;flex-direction:column;flex:1;">
        <div style="display:flex;font-size:38px;font-weight:700;">${d.tomorrowEvent ? esc(d.tomorrowEvent.time) : '—'}</div>
        <div style="display:flex;font-size:20px;color:${PAL.muted};">${d.tomorrowEvent ? esc(d.tomorrowEvent.title.length > 40 ? `${d.tomorrowEvent.title.slice(0, 39)}…` : d.tomorrowEvent.title) : 'нічого не заплановано з ранку'}</div>
      </div>
    </div>`, '', 1, 180));

  const body = [header('Підсумок дня', d.dateLabel), gap(24), rows.join(gap(18))].join('');
  const height = PAD * 2 + 100 + 24 + 5 * 270 + 5 * 18 + 180; // 5 рядків плиток + широка «завтра»
  return renderPanel(body, height);
}
