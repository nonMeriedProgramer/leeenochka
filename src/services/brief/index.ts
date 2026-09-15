import { InputFile, type Api } from 'grammy';
import { isCalendarConnected, getUpcomingEvents } from '../calendar/index.js';
import { todaySession } from '../training/index.js';
import { kyivNow, timeKyiv } from '../../utils/kyiv.js';
import { generateBriefImage } from './image.js';
import { fetchBriefStats, formLabel, type BriefStats, type Trend } from './stats.js';

interface Brief {
  text: string;
  stats: BriefStats | null;
  dateLabel: string;
}

/** "82 (↑6 від сер. 30д)" — той самий підхід, що й у картинці, текстом. */
function fmtTrend(t: Trend | null, unit: string, digits = 0): string {
  if (!t) return '';
  const val = digits ? t.value.toFixed(digits) : String(Math.round(t.value));
  const threshold = digits ? 0.05 : 1;
  if (t.delta == null || Math.abs(t.delta) < threshold) return `${val}${unit}`;
  const arrow = t.delta > 0 ? '↑' : '↓';
  const d = digits ? Math.abs(t.delta).toFixed(digits) : String(Math.abs(Math.round(t.delta)));
  return `${val}${unit} (${arrow}${d}${unit} від сер. 30д)`;
}

function wellnessLines(stats: BriefStats | null): string[] {
  if (!stats) return [];
  const lines: string[] = [];
  if (stats.fitness != null && stats.fatigue != null && stats.form != null) {
    const sign = stats.form > 0 ? '+' : '';
    lines.push(`💪 Фітнес ${stats.fitness} · Втома ${stats.fatigue} · Форма ${sign}${stats.form} (${formLabel(stats.form)})`);
  }
  if (stats.sleepScore) {
    lines.push(`😴 Сон: ${fmtTrend(stats.sleepScore, '')}${stats.sleepHours != null ? ` · ${stats.sleepHours} год` : ''}`);
  } else if (stats.sleepHours != null) {
    lines.push(`😴 Сон: ${stats.sleepHours} год`);
  }
  if (stats.hrv) lines.push(`❤️ HRV: ${fmtTrend(stats.hrv, ' мс')}`);
  if (stats.restingHr) lines.push(`🫀 Пульс спокою: ${fmtTrend(stats.restingHr, ' уд/хв')}`);
  if (stats.stepsYesterday) lines.push(`👟 Кроки (вчора): ${fmtTrend(stats.stepsYesterday, '')}`);
  if (stats.readiness != null) lines.push(`🎯 Готовність: ${stats.readiness}/100`);
  return lines;
}

async function buildBrief(): Promise<Brief> {
  const todayStr = new Date().toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' });
  const dateLabel = new Date().toLocaleDateString('uk-UA', {
    timeZone: 'Europe/Kyiv', weekday: 'long', day: 'numeric', month: 'long',
  });

  const planItems: string[] = [];
  if (isCalendarConnected()) {
    const events = (await getUpcomingEvents(1))
      .filter(e => e.start && new Date(e.start).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' }) === todayStr);
    planItems.push(...events.map(e => `• ${timeKyiv(e.start)} ${e.title}`));
  }
  try {
    const session = await todaySession();
    if (session) planItems.push(`🏋️ ${session.day.title} · ${session.day.subtitle}`);
  } catch { /* без тренування — не критично */ }
  const planLines = planItems.length ? planItems.join('\n') : 'на сьогодні нічого не заплановано.';

  let stats: BriefStats | null = null;
  try {
    stats = await fetchBriefStats();
  } catch { /* без даних з intervals.icu — бриф іде без них */ }
  const wLines = wellnessLines(stats);
  const wellnessBlock = wLines.length ? `\n\n${wLines.join('\n')}` : '';

  const text = `☀️ Доброго ранку!${wellnessBlock}\n\n📅 План на сьогодні:\n${planLines}`;
  return { text, stats, dateLabel };
}

/** Текст ранкового брифу (без картинки) — для швидких місць/тестів. */
export async function buildMorningBrief(): Promise<string> {
  return (await buildBrief()).text;
}

/**
 * Надсилає ранковий бриф у чат: якщо є дані intervals.icu і вдалось згенерувати
 * картинку — шле фото з текстом-підписом; інакше просто текст. Картинка не
 * критична: будь-яка помилка генерації тихо відкочується на текстовий варіант.
 */
export async function sendMorningBrief(api: Api, chatId: number): Promise<void> {
  const { text, stats, dateLabel } = await buildBrief();

  if (stats) {
    const png = await generateBriefImage(stats, dateLabel);
    if (png) {
      try {
        await api.sendPhoto(chatId, new InputFile(png, 'brief.png'), { caption: text });
        return;
      } catch { /* фото не пройшло — шлемо текст нижче */ }
    }
  }

  await api.sendMessage(chatId, text);
}
