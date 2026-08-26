// ─── Автопост тренувань у Telegram-канал «gym table» ───────────────
// Продовжує твою звичну стрічку — щойно запис іде в training_logs (вручну
// через бота або підтверджено з Garmin), Лєночка публікує його в канал у
// тому ж стилі, що й твої власні пости. Бота треба додати АДМІНОМ каналу
// з правом "Post Messages"; GYM_CHANNEL_ID береться з .env. Якщо змінна не
// задана — тихо нічого не постить (фіча повністю опційна).

import { Api } from 'grammy';
import { todaySession } from './index.js';

function hashtagForDay(dayNumber: 1 | 2 | 3): string {
  return dayNumber === 1 ? '#груди' : dayNumber === 2 ? '#спина' : '#fullbody';
}

function todayDateUk(): string {
  return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: '2-digit' })
    .format(new Date());
}

export interface ChannelLogLine { exercise: string; weight: number | null; reps: number[] }

/** lines — усі вправи з одного виклику логування (одна репліка → один пост, як у твоїй історії). */
export async function postWorkoutToChannel(lines: ChannelLogLine[], sourceTag?: string): Promise<void> {
  const channelId = process.env.GYM_CHANNEL_ID;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!channelId || !token || !lines.length) return;

  let hashtag = '';
  try {
    const session = await todaySession();
    if (session) hashtag = ' ' + hashtagForDay(session.day.dayNumber);
  } catch { /* без хештегу — не критично */ }

  const body = lines
    .map((l) => `▪ ${l.exercise} ${l.weight != null ? l.weight + 'кг' : 'в/в'} × ${l.reps.length ? l.reps.join(',') : '—'}`)
    .join('\n');
  const text = `<b>${todayDateUk()}</b>${hashtag}${sourceTag ? ' ' + sourceTag : ''}\n\n${body}`;

  try {
    await new Api(token).sendMessage(Number(channelId), text, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('postWorkoutToChannel failed:', e instanceof Error ? e.message : e);
  }
}
