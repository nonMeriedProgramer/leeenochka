// ─── Панель 2: Готовність і відновлення ───────────────────────────────
// Основа — Training Readiness і статус тренувань Garmin: вони рахуються з
// УСІЄЇ історії годинника (хронічне навантаження, HRV-базова лінія), тож
// точніші за Fitness/Fatigue intervals.icu, де історія починається з
// моменту підключення. Без Garmin — резервна оцінка з intervals.icu.

import type { BriefData } from './data.js';
import type { FactorKey, GarminReadiness, GarminTrainingStatus, LoadBand } from '../garmin/morning.js';
import { PAL, barFill, gauge, rangeBar } from './svg.js';
import {
  INNER, acwrUa, badge, balanceUa, card, cardTitle, esc, feedbackUa, gap, header,
  readinessLevelUa, renderPanel, row, signed, tile, trainingStatusUa,
} from './ui.js';
import { formLabel } from './stats.js';

const FACTOR_UA: Record<FactorKey, string> = {
  sleep: 'Сон минулої ночі',
  recovery: 'Час відновлення',
  hrv: 'HRV',
  acwr: 'Гостре навантаження',
  sleepHistory: 'Сон за останні ночі',
  stress: 'Стрес і активність',
};

export function verdictFor(score: number): { text: string; color: string } {
  if (score >= 75) return { text: 'Можна важке тренування', color: PAL.green };
  if (score >= 50) return { text: 'Помірне тренування', color: PAL.amber };
  if (score >= 25) return { text: 'Легке відновлювальне', color: PAL.amber };
  return { text: 'Краще відпочити', color: PAL.red };
}

/** "Відновлення ще ~5 год · до 13:04" від моменту, коли Garmin порахував готовність. */
export function recoveryText(r: GarminReadiness): string {
  const h = r.recoveryHours ?? 0;
  if (h <= 0) return 'Повністю відновлений';
  const base = r.updatedLocal ? Date.parse(`${r.updatedLocal.slice(0, 19)}Z`) : NaN;
  if (!Number.isFinite(base)) return `Відновлення ще ~${h} год`;
  const until = new Date(base + h * 3_600_000);
  const sameDay = until.toISOString().slice(0, 10) === r.updatedLocal!.slice(0, 10);
  return `Відновлення ще ~${h} год · до ${sameDay ? '' : 'завтра '}${until.toISOString().slice(11, 16)}`;
}

function scoreBlock(score: number | null, color: string, center: string, sub: string): string {
  return `<div style="display:flex;position:relative;width:300px;height:300px;">
    ${gauge(score, color, 300, 26)}
    <div style="display:flex;position:absolute;top:0;left:0;width:300px;height:300px;flex-direction:column;align-items:center;justify-content:center;">
      <div style="display:flex;font-size:96px;font-weight:700;">${esc(center)}</div>
      <div style="display:flex;margin-top:4px;">${sub}</div>
    </div>
  </div>`;
}

function heroGarmin(r: GarminReadiness): string {
  const level = readinessLevelUa(r.level, r.score);
  const v = verdictFor(r.score);
  const updated = r.updatedLocal ? `Оновлено ${r.updatedLocal.slice(11, 16)}` : '';
  const fb = r.feedbackShort === 'EXCELLENT_RECOVERY' ? 'Відмінне відновлення'
    : r.feedbackShort === 'GOOD_RECOVERY' ? 'Добре відновлення' : '';
  return card(row([
    scoreBlock(r.score, level.color, String(r.score), badge(level.text, level.color)),
    `<div style="display:flex;flex-direction:column;justify-content:center;flex:1;">
      <div style="display:flex;font-size:24px;color:${PAL.label};">Рекомендація на сьогодні</div>
      <div style="display:flex;font-size:46px;font-weight:700;color:${v.color};margin-top:6px;">${esc(v.text)}</div>
      ${gap(22)}
      <div style="display:flex;font-size:32px;font-weight:700;">${esc(recoveryText(r))}</div>
      ${fb ? `<div style="display:flex;font-size:25px;color:${PAL.muted};margin-top:8px;">${esc(fb)}</div>` : ''}
      ${updated ? `<div style="display:flex;font-size:22px;color:${PAL.faint};margin-top:14px;">${esc(updated)} · Garmin Training Readiness</div>` : ''}
    </div>`,
  ], 36));
}

function factorsCard(r: GarminReadiness): string {
  const barW = 330;
  const rows = r.factors.map((f) => {
    const fb = feedbackUa(f.feedback);
    return `<div style="display:flex;flex-direction:row;align-items:center;height:58px;">
      <div style="display:flex;width:290px;font-size:25px;">${esc(FACTOR_UA[f.key])}</div>
      ${barFill(f.pct ?? 0, fb.color, barW, 16)}
      <div style="display:flex;width:84px;justify-content:flex-end;font-size:25px;font-weight:700;">${Math.round(f.pct ?? 0)}%</div>
      <div style="display:flex;flex:1;justify-content:flex-end;font-size:24px;color:${fb.color};">${esc(fb.text)}</div>
    </div>`;
  }).join('');
  return card(`${cardTitle('Що впливає на готовність')}${rows}`);
}

function bandRow(label: string, b: LoadBand): string {
  const inRange = b.value >= b.min && b.value <= b.max;
  const note = inRange ? 'у цілі' : b.value > b.max ? 'вище цілі' : 'нижче цілі';
  return `<div style="display:flex;flex-direction:row;align-items:center;height:84px;">
    <div style="display:flex;flex-direction:column;width:250px;">
      <div style="display:flex;font-size:24px;">${esc(label)}</div>
      <div style="display:flex;font-size:20px;color:${PAL.muted};margin-top:2px;">ціль ${Math.round(b.min)}–${Math.round(b.max)}</div>
    </div>
    ${rangeBar(b.value, b.min, b.max, 440, 34)}
    <div style="display:flex;flex-direction:column;flex:1;align-items:flex-end;">
      <div style="display:flex;font-size:28px;font-weight:700;">${Math.round(b.value)}</div>
      <div style="display:flex;font-size:20px;color:${inRange ? PAL.green : PAL.amber};margin-top:2px;">${note}</div>
    </div>
  </div>`;
}

function loadCard(s: GarminTrainingStatus, d: BriefData): string {
  const st = trainingStatusUa(s.phrase);
  const acwr = acwrUa(s.acwrStatus);
  const parts: string[] = [];

  parts.push(row([
    `<div style="display:flex;flex-direction:column;flex:1;">
      <div style="display:flex;font-size:24px;color:${PAL.label};">Статус тренувань</div>
      <div style="display:flex;font-size:40px;font-weight:700;color:${st.color};margin-top:2px;">${esc(st.text)}</div>
    </div>`,
    s.vo2max != null ? `<div style="display:flex;flex-direction:column;align-items:flex-end;">
      <div style="display:flex;font-size:24px;color:${PAL.label};">VO2 max</div>
      <div style="display:flex;font-size:40px;font-weight:700;margin-top:2px;">${s.vo2max.toFixed(1)}</div>
    </div>` : '',
  ].filter(Boolean), 20));

  if (s.acute != null && s.chronicMin != null && s.chronicMax != null) {
    parts.push(gap(22));
    parts.push(`<div style="display:flex;flex-direction:row;justify-content:space-between;align-items:center;">
      <div style="display:flex;font-size:24px;color:${PAL.label};">Гостре навантаження (7 днів)</div>
      <div style="display:flex;flex-direction:row;align-items:center;">
        <div style="display:flex;font-size:34px;font-weight:700;margin-right:14px;">${Math.round(s.acute)}</div>${badge(acwr.text, acwr.color)}
      </div>
    </div>`);
    parts.push(`<div style="display:flex;flex-direction:row;align-items:center;margin-top:8px;">
      ${rangeBar(s.acute, s.chronicMin, s.chronicMax, INNER - 64 - 220, 34)}
      <div style="display:flex;flex:1;justify-content:flex-end;font-size:21px;color:${PAL.muted};">оптимум ${Math.round(s.chronicMin)}–${Math.round(s.chronicMax)}</div>
    </div>`);
  }

  if (s.balance) {
    const fb = balanceUa(s.balance.feedback);
    parts.push(gap(22));
    parts.push(`<div style="display:flex;flex-direction:row;justify-content:space-between;">
      <div style="display:flex;font-size:24px;color:${PAL.label};">Баланс навантаження за 4 тижні</div>
      ${fb ? `<div style="display:flex;font-size:22px;color:${PAL.muted};">${esc(fb)}</div>` : ''}
    </div>`);
    parts.push(bandRow('Аеробне легке', s.balance.aerobicLow));
    parts.push(bandRow('Аеробне інтенсивне', s.balance.aerobicHigh));
    parts.push(bandRow('Анаеробне', s.balance.anaerobic));
  }

  const last = [...d.activities].sort((a, b) => (b.start_date_local ?? '').localeCompare(a.start_date_local ?? ''))[0];
  if (last) {
    const kind = last.type === 'Ride' || last.type?.includes('Ride') ? 'вело'
      : last.type === 'Run' || last.type?.includes('Run') ? 'біг'
      : last.type === 'WeightTraining' ? 'зала' : 'тренування';
    const day = last.start_date_local?.slice(0, 10) === d.date ? 'сьогодні'
      : `${last.start_date_local?.slice(8, 10)}.${last.start_date_local?.slice(5, 7)}`;
    const km = last.distance ? ` · ${(last.distance / 1000).toFixed(1)} км` : '';
    const load = last.icu_training_load ? ` · навантаження ${last.icu_training_load}` : '';
    parts.push(gap(14));
    parts.push(`<div style="display:flex;font-size:23px;color:${PAL.muted};">Останнє тренування: ${esc(day)}, ${esc(kind)}${esc(km)}${esc(load)}</div>`);
  }

  return card(parts.join(''));
}

function fallbackBody(d: BriefData): string {
  const st = d.stats;
  const form = st?.form ?? null;
  const verdict = form == null ? { text: 'Немає даних', color: PAL.muted }
    : form >= -10 ? { text: 'Можна тренуватись', color: PAL.green }
    : form >= -20 ? { text: 'Помірне тренування', color: PAL.amber }
    : { text: 'Краще відновлення', color: PAL.red };
  const hero = card(row([
    scoreBlock(null, PAL.faint, form == null ? '–' : signed(form), badge(form == null ? 'Форма' : formLabel(form), verdict.color)),
    `<div style="display:flex;flex-direction:column;justify-content:center;flex:1;">
      <div style="display:flex;font-size:24px;color:${PAL.label};">Оцінка з intervals.icu</div>
      <div style="display:flex;font-size:46px;font-weight:700;color:${verdict.color};margin-top:6px;">${esc(verdict.text)}</div>
      ${gap(18)}
      <div style="display:flex;font-size:24px;color:${PAL.amber};">${d.garmin.fatal
        ? 'Garmin недоступний — без часу відновлення'
        : 'Garmin ще не порахував готовність — синхронізуй годинник'}</div>
      <div style="display:flex;font-size:22px;color:${PAL.muted};margin-top:8px;">Форма рахується з історії intervals.icu і точна лише з повною історією тренувань</div>
    </div>`,
  ], 36));
  const tiles = row([
    tile('Фітнес', st?.fitness != null ? String(st.fitness) : '—', 'довге навантаження'),
    tile('Втома', st?.fatigue != null ? String(st.fatigue) : '—', 'останній тиждень'),
    tile('Форма', form != null ? signed(form) : '—', form != null ? formLabel(form) : ''),
  ], 16);
  const deltas = row([
    tile('HRV', st?.hrv ? `${Math.round(st.hrv.value)} мс` : '—', st?.hrv?.delta != null ? `${signed(st.hrv.delta)} від сер.` : ''),
    tile('Пульс спокою', st?.restingHr ? `${Math.round(st.restingHr.value)}` : '—', st?.restingHr?.delta != null ? `${signed(st.restingHr.delta)} від сер.` : ''),
  ], 16);
  return `${hero}${gap(22)}${tiles}${gap(22)}${deltas}`;
}

export async function renderReadinessPanel(d: BriefData): Promise<Buffer> {
  const g = d.garmin;
  let body: string;
  if (g.readiness) {
    body = heroGarmin(g.readiness) + gap(22) + factorsCard(g.readiness) + (g.status ? gap(22) + loadCard(g.status, d) : '');
  } else {
    body = fallbackBody(d);
  }
  return renderPanel(`${header('Готовність', d.dateLabel)}${gap(24)}${body}`);
}
