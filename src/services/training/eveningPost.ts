// ─── Публікація тренувань у «gym table» ─────────────────────────────
// Два входи в одну й ту саму логіку (postOne): postNewTrainings — щоденний
// автопост за 21:00 (сьогодні + учора, щоб не губити пізній бокс і те, що
// Garmin досинхронізував після 21:00); postLastN — вручну, "останні N
// тренувань", незалежно від того, скільки днів тому вони були. Обидва
// пишуть у training_posts, тож один раз запощене вдруге не піде — байдуже,
// яким шляхом його запостили.

import type { Api } from 'grammy';
import db from '../../db/index.js';
import { kyivNow } from '../../utils/kyiv.js';
import { retry } from '../../utils/retry.js';
import { hashtagForDay } from './channel.js';
import { todaySession } from './index.js';
import { buildTrainingPost, fetchActivities, intervalsConfigured, type IcuActivity, type TrainingPost } from './intervals.js';

export function trainingPostsEnabled(): boolean {
  return intervalsConfigured() && !!process.env.GYM_CHANNEL_ID;
}

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Хештег залового дня (#груди/#спина/#fullbody) — лише для сьогоднішньої дати, бо розклад знає тільки «сьогодні». */
async function gymHashtag(date: string, today: string): Promise<string> {
  if (date !== today) return '#зал';
  try {
    const session = await todaySession();
    return session ? hashtagForDay(session.day.dayNumber) : '#зал';
  } catch {
    return '#зал';
  }
}

export interface PostResult { posted: TrainingPost[]; skipped: string[] }

/** Одна активність: пропустити, якщо вже постили; пропустити зал, якщо той день уже є вручну; інакше — постити й записати. */
async function postOne(api: Api, a: IcuActivity, today: string, result: PostResult): Promise<void> {
  const done = await db.get('SELECT 1 FROM training_posts WHERE activity_id = $1', [a.id]);
  if (done) return;

  const date = (a.start_date_local ?? '').slice(0, 10);
  const post = await buildTrainingPost(a, await gymHashtag(date, today));

  // Залу того дня вже запостили вручну через бота (ai/tools → postWorkoutToChannel) — не дублюємо.
  if (post.kind === 'gym') {
    const manual = await db.get(
      "SELECT 1 FROM training_logs WHERE log_date = $1 AND source = 'manual' LIMIT 1", [post.date],
    );
    if (manual) {
      await db.run(
        `INSERT INTO training_posts (activity_id, activity_date, kind, status) VALUES ($1,$2,$3,'skipped_manual')
         ON CONFLICT (activity_id) DO NOTHING`,
        [post.activityId, post.date, post.kind],
      );
      result.skipped.push(`${post.date} ${post.kind}: уже є ручний пост`);
      return;
    }
  }

  // Разовий мережевий обрив ("Network request for 'sendMessage' failed!") не мав
  // рахуватись за фінальну відмову — з такого одна спроба падає, друга проходить.
  await retry(() => api.sendMessage(Number(process.env.GYM_CHANNEL_ID), post.text, { parse_mode: 'HTML' }));
  await db.run(
    `INSERT INTO training_posts (activity_id, activity_date, kind) VALUES ($1,$2,$3)
     ON CONFLICT (activity_id) DO NOTHING`,
    [post.activityId, post.date, post.kind],
  );
  result.posted.push(post);
}

/** Щоденний автопост: усе непощене за останні lookbackDays днів + сьогодні, від старішого до новішого. */
export async function postNewTrainings(api: Api, lookbackDays = 1): Promise<PostResult> {
  const result: PostResult = { posted: [], skipped: [] };
  if (!trainingPostsEnabled()) return result;

  const { date: today } = kyivNow();
  const activities = await fetchActivities(shiftDate(today, -lookbackDays), today);
  activities.sort((x, y) => (x.start_date_local ?? '').localeCompare(y.start_date_local ?? ''));
  for (const a of activities) await postOne(api, a, today, result);
  return result;
}

/**
 * Останні n тренувань за датою — незалежно від того, скільки днів тому вони
 * були (на відміну від postNewTrainings, тут не вікно дат, а рахунок).
 * Уже запощені мовчки пропускаються (postOne), тож повторний виклик безпечний.
 */
export async function postLastN(api: Api, n: number): Promise<PostResult> {
  const result: PostResult = { posted: [], skipped: [] };
  if (!trainingPostsEnabled()) return result;

  const { date: today } = kyivNow();
  // API віддає активності в порядку спадання дати — 60 днів з запасом,
  // щоб навіть при рідких тренуваннях гарантовано набрати n штук.
  const activities = (await fetchActivities(shiftDate(today, -60), today)).slice(0, n).reverse();
  for (const a of activities) await postOne(api, a, today, result);
  return result;
}
