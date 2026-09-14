// ─── Вечірній автопост тренувань у «gym table» ──────────────────────
// Раз на день (scheduler, 21:00 Київ) беремо з intervals.icu активності за
// сьогодні + учора й публікуємо ті, яких ще немає в training_posts. «Учора» —
// щоб не губити пізні тренування (бокс о 21:30) і ті, що Garmin досинхронізував
// уже після 21:00: вони вийдуть наступного вечора, без дублів.

import type { Api } from 'grammy';
import db from '../../db/index.js';
import { kyivNow } from '../../utils/kyiv.js';
import { hashtagForDay } from './channel.js';
import { todaySession } from './index.js';
import { buildTrainingPost, fetchActivities, intervalsConfigured, type TrainingPost } from './intervals.js';

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

export async function postNewTrainings(api: Api, lookbackDays = 1): Promise<PostResult> {
  const result: PostResult = { posted: [], skipped: [] };
  if (!trainingPostsEnabled()) return result;

  const { date: today } = kyivNow();
  const activities = await fetchActivities(shiftDate(today, -lookbackDays), today);
  activities.sort((x, y) => (x.start_date_local ?? '').localeCompare(y.start_date_local ?? ''));

  for (const a of activities) {
    const done = await db.get('SELECT 1 FROM training_posts WHERE activity_id = $1', [a.id]);
    if (done) continue;

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
        continue;
      }
    }

    await api.sendMessage(Number(process.env.GYM_CHANNEL_ID), post.text, { parse_mode: 'HTML' });
    await db.run(
      `INSERT INTO training_posts (activity_id, activity_date, kind) VALUES ($1,$2,$3)
       ON CONFLICT (activity_id) DO NOTHING`,
      [post.activityId, post.date, post.kind],
    );
    result.posted.push(post);
  }
  return result;
}
