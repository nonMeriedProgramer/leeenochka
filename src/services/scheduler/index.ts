import type { Bot } from 'grammy';
import db from '../../db/index.js';
import { presentChecklist } from '../../bot/index.js';
import { generateIdeas } from '../../ai/agent.js';
import { isCalendarConnected, getUpcomingEvents } from '../calendar/index.js';

const TICK_MS = 30_000; // перевірка кожні 30с

function ownerId(): number | null {
  const id = Number(process.env.OWNER_TELEGRAM_ID);
  return Number.isFinite(id) ? id : null;
}

// Поточний час у Києві
function kyivNow(): { hour: number; minute: number; date: string } {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '';
  return { hour: Number(g('hour')), minute: Number(g('minute')), date: `${g('year')}-${g('month')}-${g('day')}` };
}

function timeKyiv(iso: string): string {
  return new Date(iso).toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' });
}

// ─── Нагадування, яким настав час ───────────────────────────────
async function fireDueReminders(bot: Bot) {
  const owner = ownerId();
  if (!owner) return;
  const rows = db.prepare("SELECT id, fire_at, text FROM reminders WHERE status = 'scheduled'")
    .all() as Array<{ id: number; fire_at: string; text: string }>;
  const now = Date.now();
  for (const r of rows) {
    const t = new Date(r.fire_at).getTime();
    if (!Number.isFinite(t) || t > now) continue;
    try {
      await bot.api.sendMessage(owner, `⏰ Нагадування: ${r.text}`);
      db.prepare("UPDATE reminders SET status = 'sent' WHERE id = ?").run(r.id);
    } catch { /* спробуємо наступного тіку */ }
  }
}

// ─── Ранковий бриф — раз на день, вікно 08:00–08:05 ────────────
let lastBriefDate = '';
async function maybeMorningBrief(bot: Bot) {
  const owner = ownerId();
  if (!owner) return;
  const { hour, minute, date } = kyivNow();
  if (hour !== 8 || minute > 5 || lastBriefDate === date) return;
  lastBriefDate = date;

  const todayStr = new Date().toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' });
  let planLines = 'на сьогодні нічого не заплановано.';
  if (isCalendarConnected()) {
    const events = (await getUpcomingEvents(1))
      .filter(e => e.start && new Date(e.start).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' }) === todayStr);
    if (events.length) planLines = events.map(e => `• ${timeKyiv(e.start)} ${e.title}`).join('\n');
  }

  try {
    await bot.api.sendMessage(owner, `☀️ Доброго ранку!\n\n📅 План на сьогодні:\n${planLines}`);
  } catch { return; }

  // Ідеї заповнити день (чеклист з галочками)
  try {
    const ideas = await generateIdeas(
      `Розклад на сьогодні:\n${planLines}\nЗапропонуй 3 короткі корисні справи заповнити вільний час, врахуй вподобання користувача.`,
    );
    if (ideas.length) await presentChecklist(bot, owner, '💡 Ідеї на день — познач що додати:', ideas);
  } catch { /* без ідей — не критично */ }
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

export function startScheduler(bot: Bot) {
  const tick = async () => {
    try { await fireDueReminders(bot); } catch { /* ignore */ }
    try { await fireCalendarReminders(bot); } catch { /* ignore */ }
    try { await maybeMorningBrief(bot); } catch { /* ignore */ }
  };
  setInterval(tick, TICK_MS);
  console.log('⏰ Scheduler started (reminders + calendar + morning brief)');
}
