// ─── Ранкова панель 1: Сон ─────────────────────────────────────────────
// Та сама мова, що й вечірній звіт: чорна сітка віджетів, у кожній плитці
// своя форма графіка. Дані — Garmin напряму; якщо їх нема, плитки чесно
// порожні, а тривалість/оцінка беруться з intervals.icu.
import type { BriefData } from './data.js';
import { columns, hypnogram, PAL } from './svg.js';
import { dur, hhmmLocal } from './ui.js';
import { shiftDate } from './stats.js';
import { ART, ART_WIDE, center, group, legend, renderGrid, scale, tag, tile, val, type Tile } from '../dashboard/grid.js';
import { C, capsules, dialScale, gradientTrack, quadRings, ringGauge, waveform } from '../dashboard/widgets.js';

const pct = (v: number | null | undefined, max: number): number | null =>
  v == null ? null : Math.max(0, Math.min(100, (v / max) * 100));

// Коротко: у плитку 247px поруч зі значенням «відмінно/посередньо» не влазить.
function qualityTag(q: string | null, short = false): { text: string; color: string } {
  switch (q) {
    case 'EXCELLENT': return { text: short ? 'топ' : 'відмінно', color: C.green };
    case 'GOOD': return { text: 'добре', color: C.green };
    case 'FAIR': return { text: short ? 'норм' : 'посередньо', color: C.yellow };
    case 'POOR': return { text: 'мало', color: C.red };
    default: return { text: '', color: C.dim };
  }
}

/** Плитка фази: кільце з відсотком і норма знизу. */
function stageTile(label: string, color: string, seconds: number | null, stage: { pct: number | null; optimalLow: number | null; optimalHigh: number | null; qualifier: string | null } | null): Tile {
  const q = qualityTag(stage?.qualifier ?? null, true);
  const norm = stage?.optimalLow != null && stage.optimalHigh != null
    ? `норма ${Math.round(stage.optimalLow)}–${Math.round(stage.optimalHigh)}%` : '';
  return tile(
    val(seconds != null ? dur(seconds, true) : '—', label, C.text, 30) + tag(q.text, q.color),
    center(ringGauge(stage?.pct ?? null, 78, color, stage?.pct != null ? `${Math.round(stage.pct)}%` : '')),
    scale([norm]),
  );
}

export async function renderSleepPanel(d: BriefData): Promise<Buffer> {
  const s = d.garmin.sleep;
  const tiles: Tile[] = [];
  const score = s?.score ?? d.stats?.sleepScore?.value ?? null;
  const totalSec = s?.totalSec ?? (d.stats?.sleepHours != null ? d.stats.sleepHours * 3600 : null);

  // 1. Оцінка сну
  const sq = qualityTag(s?.qualifier ?? (score == null ? null : score >= 90 ? 'EXCELLENT' : score >= 80 ? 'GOOD' : score >= 60 ? 'FAIR' : 'POOR'));
  tiles.push(tile(
    val(score != null ? String(Math.round(score)) : '—', 'оцінка') + tag(sq.text, sq.color),
    center(ringGauge(score, 84, sq.color === C.dim ? C.track : sq.color)),
    scale([s ? 'Garmin' : 'intervals.icu']),
  ));

  // 2. Тривалість проти потреби — капсули
  const dq = qualityTag(s?.durationQualifier ?? null);
  tiles.push(tile(
    group(val(totalSec != null ? String(Math.floor(totalSec / 3600)) : '—', 'год', C.text),
      totalSec != null ? val(String(Math.round((totalSec % 3600) / 60)), 'хв', C.text, 26) : '') + tag(dq.text, dq.color),
    capsules(s?.needMin ? pct(totalSec, s.needMin * 60) : pct(totalSec, 8 * 3600), 8, ART, 44, C.cyan),
    scale([s?.needMin ? `потреба ${dur(s.needMin * 60)}` : 'потреба 8 год']),
  ));

  // 3. Відбій і підйом — смужка ночі
  tiles.push(tile(
    val(s ? hhmmLocal(s.startLocal) : '—', s ? `– ${hhmmLocal(s.endLocal)}` : 'нема даних') + tag('ніч', C.purple),
    gradientTrack(s ? 50 : null, ART, 42, C.deepNight, C.dawn),
    scale([s ? 'відбій' : '', s ? 'підйом' : '']),
  ));

  // 4. Неспокій за ніч
  tiles.push(tile(
    val(s?.awakeCount != null ? String(s.awakeCount) : '—', 'пробуджень')
      + tag(s?.restlessMoments != null ? `${s.restlessMoments} рухів` : '', C.dim),
    waveform(ART, 50, C.orange, s != null),
    scale([s?.awakeSec ? `неспання ${dur(s.awakeSec)}` : '']),
  ));

  // 5. Гіпнограма — на дві колонки
  tiles.push(tile(
    val('Фази', s ? dur(s.totalSec) : '', C.text, 30) + tag('уві сні', C.dim),
    s?.segments.length
      ? hypnogram(s.segments, ART_WIDE, 74)
      : `<div style="display:flex;width:${ART_WIDE}px;height:74px;"></div>`,
    legend([['неспання', PAL.awake], ['REM', PAL.rem], ['легкий', PAL.light], ['глибокий', PAL.deep]]),
    2,
  ));

  // 6-8. Фази
  tiles.push(stageTile('глибокий', C.blue, s?.deep.seconds ?? null, s?.deep ?? null));
  tiles.push(stageTile('REM', C.purple, s?.rem.seconds ?? null, s?.rem ?? null));
  tiles.push(stageTile('легкий', C.cyan, s?.light.seconds ?? null, s?.light ?? null));

  // 9. Пульс уві сні
  const hrLow = 40;
  const hrHigh = 90;
  tiles.push(tile(
    val(s?.avgHr != null ? String(Math.round(s.avgHr)) : '—', 'уд/хв') + tag('уві сні', C.red),
    dialScale(s?.avgHr != null ? pct(s.avgHr - hrLow, hrHigh - hrLow) : null, ART, 48),
    scale([String(hrLow), String(hrHigh)]),
  ));

  // 10. HRV за ніч
  const hrv = s?.hrvAvg ?? d.garmin.hrv?.lastNight ?? d.stats?.hrv?.value ?? null;
  const hrvRange = d.garmin.hrv?.low != null && d.garmin.hrv.high != null
    ? { low: d.garmin.hrv.low, high: d.garmin.hrv.high } : null;
  tiles.push(tile(
    val(hrv != null ? String(Math.round(hrv)) : '—', 'мс')
      + tag(hrv == null || !hrvRange ? '' : hrv >= hrvRange.low ? 'у нормі' : 'нижче', hrvRange && hrv != null && hrv >= hrvRange.low ? C.green : C.orange),
    dialScale(hrv != null && hrvRange ? pct(hrv - hrvRange.low + 10, (hrvRange.high - hrvRange.low) + 20) : null, ART, 48),
    scale([hrvRange ? `норма ${hrvRange.low}–${hrvRange.high}` : 'HRV']),
  ));

  // 11. Заряд тіла за ніч
  tiles.push(tile(
    val(s?.bodyBatteryChange != null ? `+${s.bodyBatteryChange}` : '—', 'за ніч', C.green)
      + tag(d.garmin.bodyBatteryWake != null ? `${d.garmin.bodyBatteryWake} зранку` : '', C.dim),
    gradientTrack(d.garmin.bodyBatteryWake ?? null, ART, 42, C.red, C.green),
    scale(['0', '100']),
  ));

  // 12. SpO2 і дихання
  tiles.push(tile(
    group(val(s?.spo2Avg != null ? String(Math.round(s.spo2Avg)) : '—', '%', C.text, 34),
      s?.respirationAvg != null ? val(String(Math.round(s.respirationAvg)), 'вд/хв', C.text, 24) : '') + tag('SpO2', C.cyan),
    waveform(ART, 50, C.cyan, s?.spo2Avg != null),
    scale(['кисень і дихання уві сні']),
  ));

  // 13. Фази одним поглядом — чотири кільця
  tiles.push(tile(
    val('Розподіл', '', C.text, 30) + tag('фази', C.dim),
    quadRings([
      { pct: s?.deep.pct ?? null, color: C.blue },
      { pct: s?.light.pct ?? null, color: C.cyan },
      { pct: s?.rem.pct ?? null, color: C.purple },
      { pct: s ? (s.awakeSec / Math.max(1, s.totalSec)) * 100 : null, color: C.orange },
    ], 50),
    legend([['глиб', C.blue], ['легк', C.cyan], ['REM', C.purple], ['неспан', C.orange]]),
  ));

  // 14. Тиждень сну — стовпчики годин (на дві колонки)
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(d.date, i - 6));
  const hours = days.map((day) => {
    const secs = day === d.date && s ? s.totalSec : d.wellness.find((r) => r.id === day)?.sleepSecs;
    return secs ? Math.round((secs / 3600) * 10) / 10 : null;
  });
  const avg = hours.filter((h): h is number => h != null);
  tiles.push(tile(
    val(avg.length ? (avg.reduce((a, b) => a + b, 0) / avg.length).toFixed(1).replace('.', ',') : '—', 'год у середньому')
      + tag('7 днів', C.dim),
    columns(hours, [PAL.blue], ART_WIDE, 74, Math.max(9, ...avg)),
    scale(days.map((day) => ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][new Date(`${day}T12:00:00Z`).getUTCDay()])),
    2,
  ));

  return renderGrid('Сон', d.dateLabel, tiles);
}
