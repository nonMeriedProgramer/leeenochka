// ─── Вечірній звіт: одна картинка + короткий підпис ────────────────────
import { InputFile, type Api } from 'grammy';
import { gatherEveningData, type EveningData } from './data.js';
import { renderEveningPanel } from './panel.js';

export function eveningCaption(d: EveningData): string {
  const lines = ['🌙 Підсумок дня'];
  if (d.plan.total) lines.push(`✅ План: ${d.plan.done}/${d.plan.total}`);
  if (d.todayActivity) lines.push('💪 Тренування сьогодні є — деталі в каналі.');
  else if (d.daysSinceTraining != null) lines.push(`🛌 Без тренування вже ${d.daysSinceTraining} дн.`);

  if (d.tomorrowEvent) lines.push(`📅 Завтра з ранку: ${d.tomorrowEvent.time} — ${d.tomorrowEvent.title}`);
  else lines.push('📅 Завтра з ранку нічого не заплановано.');

  return lines.join('\n');
}

export async function sendEveningReport(api: Api, chatId: number): Promise<void> {
  const data = await gatherEveningData();
  const caption = eveningCaption(data);
  try {
    const png = await renderEveningPanel(data);
    await api.sendPhoto(chatId, new InputFile(png, 'evening.png'), { caption });
  } catch (e) {
    console.error('sendEveningReport render/send failed, falling back to text:', e instanceof Error ? e.message : e);
    await api.sendMessage(chatId, caption);
  }
}

export { gatherEveningData, renderEveningPanel };
export type { EveningData };
