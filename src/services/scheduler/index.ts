import type { Bot } from 'grammy';
import db from '../../db/index.js';
import { presentChecklist, sendPlanBoard, sendWeeklyReport, sendPlanPrompt, sendGymPicker } from '../../bot/index.js';
import { isCalendarConnected, getUpcomingEvents } from '../calendar/index.js';
import { kyivWeekStart, nextWeekStart, closePastWeeks, ensureWeekSeeded } from '../plan/index.js';
import { pendingGarminActivities, markGarminProcessed, proposalsFromActivity } from '../training/garmin.js';
import { sendMorningBrief } from '../brief/index.js';
import { syncWellnessFromIntervals } from '../training/intervals.js';
import { fetchSleepEndReal } from '../garmin/morning.js';
import { fetchGarminDayStats } from '../garmin/today.js';
import { garminConfigured } from '../garmin/client.js';
import { postNewTrainings, trainingPostsEnabled } from '../training/eveningPost.js';
import { sendEveningReport } from '../evening/index.js';
import { kyivNow, timeKyiv } from '../../utils/kyiv.js';

const TICK_MS = 30_000; // перевірка кожні 30с

function ownerId(): number | null {
  const id = Number(process.env.OWNER_TELEGRAM_ID);
  return Number.isFinite(id) ? id : null;
}

// ─── Нагадування, яким настав час ───────────────────────────────
async function fireDueReminders(bot: Bot) {
  const owner = ownerId();
  if (!owner) return;
  const rows = await db.query<{ id: number; fire_at: string; text: string }>("SELECT id, fire_at, text FROM reminders WHERE status = 'scheduled'");
  const now = Date.now();
  for (const r of rows) {
    const t = new Date(r.fire_at).getTime();
    if (!Number.isFinite(t) || t > now) continue;
    try {
      await bot.api.sendMessage(owner, `⏰ Нагадування: ${r.text}`);
      await db.run("UPDATE reminders SET status = 'sent' WHERE id = $1", [r.id]);
    } catch { /* спробуємо наступного тіку */ }
  }
}

// ─── Ранковий бриф — через 10 хв після завершення сну (за Garmin) ──────
// Опитуємо Garmin не частіше ніж раз на 5 хв (не з кожним тіком), щоб не
// довбати їхній API щоразу, поки ще спиш. Якщо Garmin не підключений або сон
// так і не прийшов — запасний вихід о 11:00, щоб бриф не загубився зовсім.
const WAKE_CHECK_INTERVAL_MS = 5 * 60_000;
const WAKE_DELAY_MS = 10 * 60_000;
const FALLBACK_HOUR = 11;

let lastBriefDate = '';
let lastWakeCheckAt = 0;

async function maybeMorningBrief(bot: Bot) {
  const owner = ownerId();
  if (!owner) return;
  const { hour, minute, date } = kyivNow();
  if (lastBriefDate === date || hour < 6) return; // вночі до сну не перевіряємо

  let shouldSend = false;
  const now = Date.now();

  if (garminConfigured() && now - lastWakeCheckAt >= WAKE_CHECK_INTERVAL_MS) {
    lastWakeCheckAt = now;
    try {
      const wokeAt = await fetchSleepEndReal(date);
      if (wokeAt != null && now >= wokeAt + WAKE_DELAY_MS) shouldSend = true;
    } catch { /* спробуємо за 5 хв ще раз */ }
  }

  // Запасний вихід: сон так і не з'явився (нема Garmin, не засинхронився,
  // помилка) — все одно шлемо бриф, щоб день не лишився без нього.
  if (!shouldSend && hour >= FALLBACK_HOUR && minute <= 5) shouldSend = true;

  if (!shouldSend) return;
  lastBriefDate = date;

  // Спершу підтягуємо свіжі дані з Garmin, щоб бриф уже мав сон/body battery за ніч.
  try { await syncWellnessFromIntervals(); } catch { /* синк не вдався — шлемо бриф без wellness */ }

  try {
    await sendMorningBrief(bot.api, owner);
  } catch { /* нема кому слати */ }
}

// ─── Нагадування про події календаря (за LEAD хв до початку) ────
const LEAD_MIN = Number(process.env.CALENDAR_LEAD_MINUTES) || 15;
const LEAD_MS = LEAD_MIN * 60_000;
const notifiedEvents = new Map<string, number>(); // ключ події -> startMs (дедуплікація)

async function fireCalendarReminders(bot: Bot) {
  const owner = ownerId();
  if (!owner || !isCalendarConnected()) return;

  const now = Date.now();
  // прибираємо старі ключі, щоб мапа не росла безкінечно
  for (const [k, ms] of notifiedEvents) if (ms < now - 3600_000) notifiedEvents.delete(k);

  for (const e of await getUpcomingEvents(1)) {
    if (!e.start || e.start.length <= 10) continue;       // пропускаємо події «на весь день»
    const startMs = new Date(e.start).getTime();
    if (!Number.isFinite(startMs)) continue;
    const delta = startMs - now;
    if (delta > LEAD_MS || delta < -60_000) continue;     // лише вікно [−1 хв; +LEAD хв]

    const key = `${e.start}|${e.title}`;
    if (notifiedEvents.has(key)) continue;
    notifiedEvents.set(key, startMs);

    const mins = Math.round(delta / 60_000);
    const when = mins <= 0 ? 'починається' : `через ${mins} хв`;
    try {
      // беззвучно: айфон уже дзвонить нативно (за годину), цей пінг — тихе нагадування за 15 хв
      await bot.api.sendMessage(owner, `🔔 Подія ${when}: «${e.title}» о ${timeKyiv(e.start)}`, { disable_notification: true });
    } catch { notifiedEvents.delete(key); /* повторимо наступного тіку */ }
  }
}

// ─── Тижневий план: ранкова дошка / звіт / нагадування ──────────
let lastPlanBoardDate = '';
async function maybePlanBoard(bot: Bot) {
  const owner = ownerId();
  if (!owner) return;
  const { hour, minute, date } = kyivNow();
  if (hour !== 8 || minute > 5 || lastPlanBoardDate === date) return;
  lastPlanBoardDate = date;
  try { await sendPlanBoard(bot, owner, true); } catch { /* ignore */ }
}

let lastReportDate = '';
async function maybeWeeklyReport(bot: Bot) {
  const owner = ownerId();
  if (!owner) return;
  const { hour, minute, date, weekday } = kyivNow();
  if (weekday !== 'Sun' || hour !== 18 || minute > 5 || lastReportDate === date) return;
  lastReportDate = date;
  try { await sendWeeklyReport(bot, owner); } catch { /* ignore */ }
}

let lastPlanPromptDate = '';
async function maybePlanPrompt(bot: Bot) {
  const owner = ownerId();
  if (!owner) return;
  const { hour, minute, date, weekday } = kyivNow();
  if (weekday !== 'Sun' || hour !== 20 || minute > 5 || lastPlanPromptDate === date) return;
  lastPlanPromptDate = date;
  try { await sendPlanPrompt(bot, owner); } catch { /* ignore */ }
  // Одразу після тижневого плану — вибір днів залу на наступний тиждень
  try { await sendGymPicker(bot, owner, nextWeekStart()); } catch { /* ignore */ }
}

// ─── Нові Garmin-сети (силові) — пропонуємо чеклистом на підтвердження ──
// tools/garmin_sync.py пише в garmin_activities незалежно від того, чи бот
// запущений; цей тік просто підбирає те, що ще не оброблено.
async function maybeProposeGarminSets(bot: Bot) {
  const owner = ownerId();
  if (!owner) return;
  const rows = await pendingGarminActivities();
  for (const row of rows) {
    const items = proposalsFromActivity(row);
    await markGarminProcessed(row.garmin_id); // пропонуємо один раз — не спамимо повторно
    if (!items.length) continue;
    try {
      await presentChecklist(bot, owner, `⌚ З Garmin (${row.activity_date ?? ''}) — що записати в тренування?`, items);
    } catch { /* ignore */ }
  }
}

// ─── Автопост тренувань дня в «gym table» — раз на день, вікно 21:00–21:05 ──
// Помилку (напр. протух ключ intervals.icu) шлемо власнику в приват, не в канал,
// інакше фіча мовчки перестала б працювати.
let lastTrainingPostDate = '';
async function maybeEveningTrainingPost(bot: Bot) {
  if (!trainingPostsEnabled()) return;
  const { hour, minute, date } = kyivNow();
  if (hour !== 21 || minute > 5 || lastTrainingPostDate === date) return;
  lastTrainingPostDate = date;
  try {
    await postNewTrainings(bot.api, 1);
  } catch (e) {
    const owner = ownerId();
    const msg = e instanceof Error ? e.message : String(e);
    console.error('evening training post failed:', msg);
    if (owner) await bot.api.sendMessage(owner, `⚠️ Автопост тренувань не вийшов:\n${msg.slice(0, 500)}`).catch(() => {});
  }
}

// ─── Вечірній звіт — з 22:00, але тільки коли годинник синхронізувався ──
// Наосліп о 22:00 звіт показував цифри станом на ранок: якщо телефон не
// відкривали, Garmin віддає дані з моменту останнього синку. Тож від 22:00
// перевіряємо свіжість раз на 10 хв і шлемо, щойно дані свіжі; о 23:30 —
// однаково шлемо, із позначкою «станом на» в заголовку.
const EVENING_HOUR = 22;
const EVENING_DEADLINE_MIN = 23 * 60 + 30;
const SYNC_CHECK_INTERVAL_MS = 10 * 60_000;
const SYNC_FRESH_MS = 45 * 60_000;

let lastEveningReportDate = '';
let lastSyncCheckAt = 0;

async function maybeEveningReport(bot: Bot) {
  const owner = ownerId();
  if (!owner) return;
  const { hour, minute, date } = kyivNow();
  if (lastEveningReportDate === date || hour < EVENING_HOUR) return;

  const now = Date.now();
  let send = !garminConfigured(); // нема Garmin — нема чого чекати

  if (garminConfigured() && now - lastSyncCheckAt >= SYNC_CHECK_INTERVAL_MS) {
    lastSyncCheckAt = now;
    try {
      const stats = await fetchGarminDayStats(date);
      if (stats.lastSync != null && now - stats.lastSync <= SYNC_FRESH_MS) send = true;
    } catch { /* спробуємо за 10 хв */ }
  }
  if (!send && hour * 60 + minute >= EVENING_DEADLINE_MIN) send = true;
  if (!send) return;

  lastEveningReportDate = date;
  try {
    await sendEveningReport(bot.api, owner);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('evening report failed:', msg);
    await bot.api.sendMessage(owner, `⚠️ Вечірній звіт не вийшов:\n${msg.slice(0, 500)}`).catch(() => {});
  }
}

// Ролл тижня — ідемпотентно щотіку: зафіксувати минулі тижні (знімок) + засіяти повтори
async function rollWeek() {
  const ws = kyivWeekStart();
  await closePastWeeks(ws);
  await ensureWeekSeeded(ws);
}

export function startScheduler(bot: Bot) {
  const tick = async () => {
    try { await rollWeek(); } catch { /* ignore */ }
    try { await fireDueReminders(bot); } catch { /* ignore */ }
    try { await fireCalendarReminders(bot); } catch { /* ignore */ }
    try { await maybeMorningBrief(bot); } catch { /* ignore */ }
    try { await maybePlanBoard(bot); } catch { /* ignore */ }
    try { await maybeWeeklyReport(bot); } catch { /* ignore */ }
    try { await maybePlanPrompt(bot); } catch { /* ignore */ }
    try { await maybeProposeGarminSets(bot); } catch { /* ignore */ }
    try { await maybeEveningTrainingPost(bot); } catch { /* ignore */ }
    try { await maybeEveningReport(bot); } catch { /* ignore */ }
  };
  setInterval(tick, TICK_MS);
  console.log('⏰ Scheduler started (reminders + calendar + brief + plan)');
}
