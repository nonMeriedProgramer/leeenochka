// ─── Ранкова панель 2: Готовність і навантаження ───────────────────────
// Основа — Training Readiness і статус тренувань Garmin: вони рахуються з
// УСІЄЇ історії годинника (хронічне навантаження, HRV-базова лінія), тож
// точніші за Fitness/Fatigue intervals.icu, де історія починається з
// моменту підключення. Без Garmin — резервна оцінка з intervals.icu.

import type { BriefData } from './data.js';
import type { FactorKey, GarminReadiness } from '../garmin/morning.js';
import { PAL } from './svg.js';
import { acwrUa, trainingStatusUa } from './ui.js';
import { formLabel } from './stats.js';
import { ART, ART_WIDE, center, renderGrid, scale, tag, tile, val, type Tile } from '../dashboard/grid.js';
import { C, barMeter, clockDial, gradientTrack, levelBars, ringGauge, spectrumBar, zoneStadium } from '../dashboard/widgets.js';

const FACTOR_UA: Record<FactorKey, string> = {
  sleep: 'сон', recovery: 'відновлення', hrv: 'HRV',
  acwr: 'навантаження', sleepHistory: 'сон за тиждень', stress: 'стрес',
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

const pct = (v: number | null | undefined, max: number): number | null =>
  v == null ? null : Math.max(0, Math.min(100, (v / max) * 100));

function levelColor(score: number | null): string {
  if (score == null) return C.dim;
  if (score >= 75) return C.green;
  if (score >= 50) return C.yellow;
  if (score >= 25) return C.orange;
  return C.red;
}

export async function renderReadinessPanel(d: BriefData): Promise<Buffer> {
  const r = d.garmin.readiness;
  const st = d.garmin.status;
  const tiles: Tile[] = [];

  // 1. Готовність — велике кільце
  const score = r?.score ?? d.stats?.readiness ?? null;
  tiles.push(tile(
    val(score != null ? String(Math.round(score)) : '—', 'готовність')
      + tag(score == null ? '' : score >= 75 ? 'важке' : score >= 50 ? 'помірне' : score >= 25 ? 'легке' : 'відпочинок', levelColor(score)),
    center(ringGauge(score, 84, levelColor(score))),
    scale([score != null ? verdictFor(score).text : 'нема даних Garmin']),
  ));

  // 2. Відновлення — циферблат годин
  const rec = r?.recoveryHours ?? null;
  tiles.push(tile(
    val(rec != null ? String(rec) : '—', 'год')
      + tag(rec == null ? '' : rec === 0 ? 'готовий' : 'відновлення', rec === 0 ? C.green : C.orange),
    center(clockDial(rec != null ? 100 - (pct(rec, 48) ?? 0) : null, 76, C.mint)),
    scale([r ? recoveryText(r).replace('Відновлення ще ', '') : '']),
  ));

  // 3. Статус тренувань — стадіон
  const status = trainingStatusUa(st?.phrase ?? null);
  tiles.push(tile(
    val(st?.vo2max != null ? st.vo2max.toFixed(1).replace('.', ',') : '—', 'VO2max') + tag(st ? 'статус' : '', C.cyan),
    zoneStadium(st ? 3 : null, 5, ART, 52),
    scale([st?.phrase ? status.text : 'статус недоступний']),
  ));

  // 4. Гостре навантаження проти хронічного
  const acute = st?.acute ?? r?.acuteLoad ?? null;
  const acwr = acwrUa(st?.acwrStatus ?? null);
  tiles.push(tile(
    val(acute != null ? String(Math.round(acute)) : '—', 'гостре') + tag(acwr.text, st?.acwrStatus ? C.cyan : C.dim),
    gradientTrack(acute != null && st?.chronicMin != null && st.chronicMax != null
      ? pct(acute - st.chronicMin * 0.5, st.chronicMax * 1.5 - st.chronicMin * 0.5) : null, ART, 42, C.blue, C.red),
    scale([st?.chronicMin != null ? `норма ${Math.round(st.chronicMin)}–${Math.round(st.chronicMax ?? 0)}` : 'гостре за 7 днів']),
  ));

  // 5. Фактори готовності — на дві колонки, шість смужок
  const factors = r?.factors ?? [];
  tiles.push(tile(
    val('Фактори', '', C.text, 26) + tag(r ? 'готовності' : '', C.dim),
    levelBars(factors.map((f) => ({
      label: FACTOR_UA[f.key],
      pct: f.pct,
      color: f.pct == null ? C.track : f.pct >= 75 ? C.green : f.pct >= 40 ? C.yellow : C.red,
    })), ART_WIDE),
    '',
    2,
  ));

  // 6-7. Фітнес і втома (intervals.icu)
  tiles.push(tile(
    val(d.stats?.fitness != null ? String(d.stats.fitness) : '—', 'фітнес', C.cyan) + tag('CTL', C.dim),
    barMeter(pct(d.stats?.fitness ?? null, 80), ART, 46),
    scale(['хронічне навантаження']),
  ));
  tiles.push(tile(
    val(d.stats?.fatigue != null ? String(d.stats.fatigue) : '—', 'втома', C.orange) + tag('ATL', C.dim),
    barMeter(pct(d.stats?.fatigue ?? null, 80), ART, 46),
    scale(['гостре за тиждень']),
  ));

  // 8. Форма
  const form = d.stats?.form ?? null;
  tiles.push(tile(
    val(form != null ? (form > 0 ? `+${form}` : String(form)) : '—', 'форма')
      + tag(form == null ? '' : form > 5 ? 'свіжий' : form < -15 ? 'втома' : 'баланс',
        form != null && form > 5 ? C.green : form != null && form < -15 ? C.red : C.yellow),
    spectrumBar(form != null ? pct(form + 40, 80) : null, ART, 42),
    scale(['−40', '0', '+40']),
  ));

  // 9-11. Баланс навантаження за 4 тижні
  const b = st?.balance;
  const bands: Array<[string, typeof b extends null | undefined ? never : NonNullable<typeof b>['aerobicLow'] | undefined, string]> = [
    ['аеробне низьке', b?.aerobicLow, C.green],
    ['аеробне високе', b?.aerobicHigh, C.yellow],
    ['анаеробне', b?.anaerobic, C.pink],
  ];
  for (const [label, band, color] of bands) {
    tiles.push(tile(
      val(band ? String(Math.round(band.value)) : '—', '', C.text, 36)
        + tag(band ? (band.value < band.min ? 'мало' : band.value > band.max ? 'багато' : 'норма') : '',
          band && band.value >= band.min && band.value <= band.max ? C.green : C.orange),
      gradientTrack(band ? pct(band.value, band.max * 1.3) : null, ART, 38, C.track, color),
      scale([label, band ? `${Math.round(band.min)}–${Math.round(band.max)}` : '']),
    ));
  }

  return renderGrid('Готовність', d.dateLabel, tiles);
}
