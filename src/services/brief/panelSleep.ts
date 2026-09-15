// ─── Панель 1: Сон ────────────────────────────────────────────────────
import type { BriefData } from './data.js';
import type { GarminSleep, StageInfo } from '../garmin/morning.js';
import { PAL, columns, gauge, hypnogram, ring, type Stage } from './svg.js';
import {
  DAY_SHORT, INNER, badge, card, cardTitle, dur, esc, gap, header, hhmmLocal, qualifierUa,
  renderPanel, row, scoreQualifier, tile,
} from './ui.js';
import { shiftDate } from './stats.js';

const STAGE_UA: Record<Stage, string> = { awake: 'Пробудження', rem: 'REM', light: 'Легкий', deep: 'Глибокий' };
const STAGE_COLOR: Record<Stage, string> = { awake: PAL.awake, rem: PAL.rem, light: PAL.light, deep: PAL.deep };

function weekStrip(d: BriefData, todayScore: number | null): string {
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(d.date, i - 6));
  const cells = days.map((day) => {
    const isToday = day === d.date;
    const w = d.wellness.find((r) => r.id === day);
    const score = isToday && todayScore != null ? todayScore : (w?.sleepScore ?? null);
    const color = qualifierUa(scoreQualifier(score)).color;
    const dow = DAY_SHORT[new Date(`${day}T12:00:00Z`).getUTCDay()];
    return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;">
      <div style="display:flex;position:relative;width:88px;height:88px;">
        ${ring(score, color === PAL.muted ? PAL.faint : color, 88, 9, isToday)}
        <div style="display:flex;position:absolute;top:0;left:0;width:88px;height:88px;align-items:center;justify-content:center;font-size:26px;font-weight:700;color:${score == null ? PAL.faint : PAL.text};">${score == null ? '–' : Math.round(score)}</div>
      </div>
      <div style="display:flex;margin-top:8px;font-size:22px;color:${isToday ? PAL.text : PAL.muted};">${dow}</div>
    </div>`;
  });
  return `<div style="display:flex;flex-direction:row;">${cells.join('')}</div>`;
}

function scoreBlock(score: number | null, qualifier: string | null): string {
  const q = qualifierUa(qualifier ?? scoreQualifier(score));
  return `<div style="display:flex;position:relative;width:300px;height:300px;">
    ${gauge(score, q.color === PAL.muted ? PAL.faint : PAL.blue, 300, 26)}
    <div style="display:flex;position:absolute;top:0;left:0;width:300px;height:300px;flex-direction:column;align-items:center;justify-content:center;">
      <div style="display:flex;font-size:96px;font-weight:700;">${score == null ? '–' : Math.round(score)}</div>
      <div style="display:flex;margin-top:4px;">${badge(q.text, q.color)}</div>
    </div>
  </div>`;
}

function statLine(label: string, value: string, extra = ''): string {
  return `<div style="display:flex;flex-direction:column;">
    <div style="display:flex;font-size:24px;color:${PAL.label};">${esc(label)}</div>
    <div style="display:flex;flex-direction:row;align-items:center;margin-top:2px;">
      <div style="display:flex;font-size:40px;font-weight:700;">${esc(value)}</div>
      ${extra ? `<div style="display:flex;margin-left:14px;">${extra}</div>` : ''}
    </div>
  </div>`;
}

function hypnoBlock(s: GarminSleep): string {
  const chartW = INNER - 64 - 150;
  const chartH = 240;
  const labels = (['awake', 'rem', 'light', 'deep'] as Stage[]).map((st) => `
    <div style="display:flex;height:${chartH / 4}px;align-items:center;font-size:22px;color:${PAL.label};">
      <div style="display:flex;width:14px;height:14px;border-radius:7px;background:${STAGE_COLOR[st]};margin-right:10px;"></div>${STAGE_UA[st]}
    </div>`).join('');

  const t0 = s.segments[0].start;
  const t1 = s.segments[s.segments.length - 1].end;
  const ticks: string[] = [];
  const hourMs = 3_600_000;
  // перша повна година за локальним часом після засинання
  let t = Math.ceil((t0 + s.tzOffsetMs) / hourMs) * hourMs - s.tzOffsetMs;
  for (; t < t1; t += hourMs) {
    const x = ((t - t0) / (t1 - t0)) * chartW;
    if (x < 14 || x > chartW - 14) continue;
    const label = new Date(t + s.tzOffsetMs).toISOString().slice(11, 13);
    ticks.push(`<div style="display:flex;position:absolute;left:${Math.round(x - 20)}px;top:0;width:40px;justify-content:center;font-size:20px;color:${PAL.muted};">${label}</div>`);
  }

  return `<div style="display:flex;flex-direction:row;">
    <div style="display:flex;flex-direction:column;width:150px;">${labels}</div>
    <div style="display:flex;flex-direction:column;">
      ${hypnogram(s.segments, chartW, chartH)}
      <div style="display:flex;position:relative;width:${chartW}px;height:30px;margin-top:6px;">${ticks.join('')}</div>
    </div>
  </div>`;
}

function stageCell(st: Stage, info: StageInfo | null, seconds: number, extra = ''): string {
  const q = info?.qualifier ? qualifierUa(info.qualifier) : null;
  const norm = info?.optimalLow != null && info.optimalHigh != null
    ? ` · норма ${Math.round(info.optimalLow)}–${Math.round(info.optimalHigh)}%` : '';
  const pct = info?.pct != null ? `${Math.round(info.pct)}%${norm}` : extra;
  return `<div style="display:flex;flex-direction:column;flex:1;background:${PAL.card2};border-radius:20px;padding:18px 20px;">
    <div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;">
      <div style="display:flex;flex-direction:row;align-items:center;font-size:24px;color:${PAL.label};">
        <div style="display:flex;width:16px;height:16px;border-radius:8px;background:${STAGE_COLOR[st]};margin-right:10px;"></div>${STAGE_UA[st]}
      </div>
      ${q ? badge(q.text, q.color) : ''}
    </div>
    <div style="display:flex;font-size:36px;font-weight:700;margin-top:6px;">${dur(seconds)}</div>
    <div style="display:flex;font-size:21px;color:${PAL.muted};margin-top:2px;">${esc(pct)}</div>
  </div>`;
}

function garminBody(d: BriefData, s: GarminSleep): string {
  const dq = s.durationQualifier ? qualifierUa(s.durationQualifier) : null;
  const need = s.needMin != null ? dur(s.needMin * 60) : '—';
  const nextNeed = s.nextNeedMin != null && s.nextNeedMin !== s.needMin ? `завтра ${dur(s.nextNeedMin * 60)}` : '';

  const hero = card(row([
    scoreBlock(s.score, s.qualifier),
    `<div style="display:flex;flex-direction:column;justify-content:space-between;flex:1;padding:6px 0;">
      ${statLine('Тривалість', dur(s.totalSec), dq ? badge(dq.text, dq.color) : '')}
      ${statLine('Відбій – підйом', `${hhmmLocal(s.startLocal)} – ${hhmmLocal(s.endLocal)}`)}
      ${statLine('Потреба у сні', need, nextNeed ? `<div style="display:flex;font-size:22px;color:${PAL.muted};">${esc(nextNeed)}</div>` : '')}
      <div style="display:flex;font-size:23px;color:${PAL.muted};">Пробуджень ${s.awakeCount ?? 0} · неспокій ${s.restlessMoments ?? 0} разів</div>
    </div>`,
  ], 36));

  const stages = card(`
    ${cardTitle('Фази сну', `${dur(s.totalSec)} уві сні`)}
    ${s.segments.length ? hypnoBlock(s) : `<div style="display:flex;font-size:24px;color:${PAL.muted};">Графік фаз недоступний</div>`}
    ${gap(18)}
    ${row([stageCell('deep', s.deep, s.deep.seconds), stageCell('rem', s.rem, s.rem.seconds)], 16)}
    ${gap(16)}
    ${row([stageCell('light', s.light, s.light.seconds), stageCell('awake', null, s.awakeSec, 'не рахується в сон')], 16)}
  `);

  const hrvTile = s.hrvAvg != null ? tile('HRV за ніч', `${Math.round(s.hrvAvg)} мс`) : tile('HRV за ніч', '—');
  const bottom = row([
    tile('Пульс уві сні', s.avgHr != null ? `${Math.round(s.avgHr)}` : '—', 'уд/хв'),
    hrvTile,
    tile('SpO2', s.spo2Avg != null ? `${Math.round(s.spo2Avg)}%` : '—', 'середнє'),
    tile('Дихання', s.respirationAvg != null ? `${Math.round(s.respirationAvg)}` : '—', 'вдихів/хв'),
  ], 16);

  return `${hero}${gap(22)}${stages}${gap(22)}${bottom}`;
}

function fallbackBody(d: BriefData): string {
  const st = d.stats;
  const score = st?.sleepScore?.value ?? null;
  const q = scoreQualifier(score);
  const delta = st?.sleepScore?.delta;
  const hero = card(row([
    scoreBlock(score, q),
    `<div style="display:flex;flex-direction:column;justify-content:center;flex:1;">
      ${statLine('Тривалість', st?.sleepHours != null ? dur(st.sleepHours * 3600) : '—')}
      ${gap(18)}
      ${statLine('Від твоєї норми', delta != null ? `${delta > 0 ? '+' : ''}${Math.round(delta)}` : '—')}
      ${gap(18)}
      <div style="display:flex;font-size:23px;color:${PAL.muted};">Джерело: intervals.icu</div>
    </div>`,
  ], 36));

  const days = Array.from({ length: 7 }, (_, i) => shiftDate(d.date, i - 6));
  const hours = days.map((day) => {
    const secs = d.wellness.find((r) => r.id === day)?.sleepSecs;
    return secs ? Math.round((secs / 3600) * 10) / 10 : null;
  });
  const chartW = INNER - 64;
  const week = card(`
    ${cardTitle('Сон за 7 днів', 'години')}
    ${columns(hours, [PAL.light], chartW, 260, Math.max(9, ...hours.map((h) => h ?? 0)))}
    <div style="display:flex;flex-direction:row;margin-top:10px;">
      ${days.map((day, i) => `<div style="display:flex;flex-direction:column;align-items:center;flex:1;font-size:21px;color:${PAL.muted};">
        <div style="display:flex;color:${PAL.text};">${hours[i] ?? '–'}</div>
        <div style="display:flex;">${DAY_SHORT[new Date(`${day}T12:00:00Z`).getUTCDay()]}</div></div>`).join('')}
    </div>
    ${gap(16)}
    <div style="display:flex;font-size:23px;color:${PAL.amber};">${d.garmin.fatal
      ? 'Фази сну недоступні: Garmin зараз не відповідає'
      : 'Фази сну ще не прийшли — синхронізуй годинник і надішли /brief'}</div>
  `);

  const bottom = row([
    tile('HRV', st?.hrv ? `${Math.round(st.hrv.value)} мс` : '—'),
    tile('Пульс спокою', st?.restingHr ? `${Math.round(st.restingHr.value)}` : '—', 'уд/хв'),
  ], 16);
  return `${hero}${gap(22)}${week}${gap(22)}${bottom}`;
}

export async function renderSleepPanel(d: BriefData): Promise<Buffer> {
  const s = d.garmin.sleep;
  const body = s ? garminBody(d, s) : fallbackBody(d);
  return renderPanel(`
    ${header('Сон', d.dateLabel)}
    ${gap(24)}
    ${weekStrip(d, s?.score ?? null)}
    ${gap(24)}
    ${body}
  `);
}
