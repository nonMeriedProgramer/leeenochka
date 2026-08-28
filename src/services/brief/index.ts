import { InputFile, type Api } from 'grammy';
import { isCalendarConnected, getUpcomingEvents } from '../calendar/index.js';
import { todaySession } from '../training/index.js';
import { wellnessFor, renderWellness, type WellnessRow } from '../training/garmin.js';
import { kyivNow, timeKyiv } from '../../utils/kyiv.js';
import { generateBriefImage } from './image.js';

interface Brief {
  text: string;
  wellness: WellnessRow | null;
  dateLabel: string;
}

async function buildBrief(): Promise<Brief> {
  const { date } = kyivNow();
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

  let wellness: WellnessRow | null = null;
  let wellnessLine = '';
  try {
    wellness = await wellnessFor(date);
    const rendered = wellness ? renderWellness(wellness) : null;
    if (rendered) wellnessLine = `\n\n${rendered}`;
  } catch { /* без даних Garmin — не критично */ }

  const text = `☀️ Доброго ранку!${wellnessLine}\n\n📅 План на сьогодні:\n${planLines}`;
  return { text, wellness, dateLabel };
}

/** Текст ранкового брифу (без картинки) — для швидких місць/тестів. */
export async function buildMorningBrief(): Promise<string> {
  return (await buildBrief()).text;
}

/**
 * Надсилає ранковий бриф у чат: якщо є Garmin-дані і вдалось згенерувати картинку —
 * шле фото з текстом-підписом; інакше просто текст. Картинка не критична: будь-яка
 * помилка генерації тихо відкочується на текстовий варіант.
 */
export async function sendMorningBrief(api: Api, chatId: number): Promise<void> {
  const { text, wellness, dateLabel } = await buildBrief();

  if (wellness) {
    const png = await generateBriefImage(wellness, dateLabel);
    if (png) {
      try {
        await api.sendPhoto(chatId, new InputFile(png, 'brief.png'), { caption: text });
        return;
      } catch { /* фото не пройшло — шлемо текст нижче */ }
    }
  }

  await api.sendMessage(chatId, text);
}
