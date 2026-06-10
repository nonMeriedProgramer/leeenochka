import { Bot, InlineKeyboard } from 'grammy';
import { ownerGuard } from './guard.js';
import { runAgent } from '../ai/agent.js';
import { saveMessage } from '../ai/claude.js';
import { transcribeAudio } from '../transcription/whisper.js';
import { isCalendarConnected, getUpcomingEvents } from '../services/calendar/index.js';
import { getReminders, isRemindersConnected } from '../services/reminders/index.js';
import { downloadVoice } from '../utils/telegram.js';
import { saveAppleCredentials } from '../auth/tokens.js';
import db from '../db/index.js';
import {
  type Day, type PlanItem, DAY_ORDER, dayUk, todayDayKey, kyivWeekStart, nextWeekStart,
  getWeekItems, togglePlanItem, categoriesOf, weekScore, trendAndStreak,
  carryables, carryItems, ensureWeekSeeded, PLAN_GOAL_PCT, bar, plural,
} from '../services/plan/index.js';

// Очікувані дії (бот однокористувацький — owner-only, module-level стан ок)
let pendingAction: { execute: () => Promise<string> } | null = null;     // ✅/❌ підтвердження
let pendingOptions: Array<{ label: string; execute: () => Promise<string> }> | null = null; // вибір зі списку
let pendingChecklist: { items: Array<{ label: string; create: () => Promise<string> }>; selected: boolean[] } | null = null;
let pendingCarry: { items: Array<{ id: number; label: string }>; selected: boolean[]; toWs: string } | null = null; // ↪️ перенос пунктів плану

// Кожне створення реєструє свій undo під унікальним id → кнопка «Скасувати» відміняє саме свою подію, а не останню
const pendingUndos = new Map<string, () => Promise<string>>();
let undoSeq = 0;
function addUndo(fn: () => Promise<string>): string {
  const id = String(++undoSeq);
  pendingUndos.set(id, fn);
  if (pendingUndos.size > 50) { const k = pendingUndos.keys().next().value; if (k !== undefined) pendingUndos.delete(k); } // обмежуємо памʼять
  return id;
}

function clearPending() { pendingAction = null; pendingOptions = null; pendingChecklist = null; pendingCarry = null; }

// Клавіатура чеклиста: ☐/☑ на кожен пункт + "➕ Додати"
function checklistKeyboard(cl: NonNullable<typeof pendingChecklist>): InlineKeyboard {
  const kb = new InlineKeyboard();
  cl.items.forEach((it, i) => kb.text(`${cl.selected[i] ? '☑' : '☐'} ${it.label}`, `toggle_${i}`).row());
  const n = cl.selected.filter(Boolean).length;
  kb.text(n ? `➕ Додати (${n})` : '➕ Додати', 'checklist_add').text('❌', 'confirm_no');
  return kb;
}

// Проактивно надіслати чеклист (для планувальника / ранкового брифа)
export async function presentChecklist(
  bot: Bot, chatId: number, card: string,
  items: Array<{ label: string; create: () => Promise<string> }>,
): Promise<void> {
  if (!items.length) return;
  clearPending();
  pendingChecklist = { items, selected: items.map(() => false) };
  await bot.api.sendMessage(chatId, card, { reply_markup: checklistKeyboard(pendingChecklist) });
}

// ─── Тижневий план: рендерери дошки ─────────────────────────────
const CAT_EMOJI: Record<string, string> = {
  'Робота': '💼', 'Життя': '🏠', 'Спорт': '🏋️', 'Спорт-здоровʼя': '🏋️', "Спорт-здоров'я": '🏋️',
  'Здоровʼя': '🏋️', 'Особисте': '✨', 'Навчання': '📚', 'Інше': '•',
};
function catIcon(c: string): string { return CAT_EMOJI[c] ?? '•'; }

function dayLabel(day: Day): string {
  const monday = new Date(kyivWeekStart() + 'T12:00:00+03:00');
  const d = new Date(monday.getTime() + DAY_ORDER.indexOf(day) * 86400000);
  return d.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', weekday: 'long', day: 'numeric', month: 'short' });
}

function itemRows(kb: InlineKeyboard, items: PlanItem[], ctx: string, groupByCategory: boolean): void {
  const add = (it: PlanItem) => kb.text(`${it.done ? '☑' : '☐'} ${it.title}${it.recurring ? ' 🔁' : ''}`, `pln:tog:${it.id}:${ctx}`).row();
  if (groupByCategory) {
    for (const c of [...new Set(items.map(i => i.category))]) {
      kb.text(`${catIcon(c)} ${c}`, 'pln:noop').row();
      items.filter(x => x.category === c).forEach(add);
    }
  } else {
    items.forEach(add);
  }
}

function viewDay(day: Day): { text: string; kb: InlineKeyboard } {
  const all = getWeekItems();
  const dayItems = all.filter(i => i.day === day);
  const floatN = all.filter(i => i.day === null).length;
  const kb = new InlineKeyboard();
  if (dayItems.length) itemRows(kb, dayItems, `d:${day}`, true);
  DAY_ORDER.forEach(d => kb.text(d === day ? `·${dayUk(d)}·` : dayUk(d), `pln:v:d:${d}`));
  kb.row();
  kb.text('🗂 По категоріях', 'pln:axis:c').text('📊', 'pln:score');
  const s = weekScore();
  let text = `📅 ${dayLabel(day)}`;
  if (!dayItems.length) text += '\n(на цей день нічого не заплановано)';
  if (floatN) text += `\n🗒 +${floatN} без дня — у «По категоріях»`;
  text += `\nТиждень: ${s.done}/${s.total} ${bar(s.pct)} ${s.pct}%`;
  return { text, kb };
}

function viewCategoryPicker(): { text: string; kb: InlineKeyboard } {
  const cats = categoriesOf();
  const s = weekScore();
  const kb = new InlineKeyboard();
  if (!cats.length) { kb.text('📅 По днях', 'pln:axis:d'); return { text: 'План порожній. Встав список — заповню.', kb }; }
  cats.forEach((c, i) => {
    const cs = s.perCategory[c] ?? { done: 0, total: 0, pct: 0 };
    kb.text(`${catIcon(c)} ${c} ${cs.done}/${cs.total} ${bar(cs.pct, 4)}`, `pln:v:c:${i}`).row();
  });
  kb.text('📅 По днях', 'pln:axis:d').text('📊', 'pln:score');
  return { text: '🗂 План на тиждень — обери категорію:', kb };
}

function viewCategory(idx: number): { text: string; kb: InlineKeyboard } {
  const cats = categoriesOf();
  const c = cats[idx];
  if (!c) return viewCategoryPicker();
  const items = getWeekItems().filter(i => i.category === c);
  const kb = new InlineKeyboard();
  itemRows(kb, items, `c:${idx}`, false);
  kb.text('‹ Категорії', 'pln:axis:c').text('📊', 'pln:score');
  const cs = weekScore().perCategory[c] ?? { done: 0, total: 0, pct: 0 };
  return { text: `${catIcon(c)} ${c} — ${cs.done}/${cs.total} ${bar(cs.pct)} ${cs.pct}%`, kb };
}

function viewScore(): string {
  const s = weekScore();
  const t = trendAndStreak();
  const lines = [`📊 Тиждень — ${s.done}/${s.total} ${bar(s.pct)} ${s.pct}%${t.lastPct != null ? ` (минулий ${t.lastPct}% ${t.arrow})` : ''}`];
  for (const c of categoriesOf()) {
    const cs = s.perCategory[c];
    if (cs) lines.push(`${catIcon(c)} ${c} ${cs.done}/${cs.total} ${bar(cs.pct)} ${cs.pct}%`);
  }
  lines.push(`🎯 Ціль ${PLAN_GOAL_PCT}% — ${s.pct >= PLAN_GOAL_PCT ? 'досягнуто ✅' : `недобір ${PLAN_GOAL_PCT - s.pct}%`}`);
  lines.push(`🔥 Стрік: ${t.streak} тиж. ≥ ${PLAN_GOAL_PCT}%`);
  return lines.join('\n');
}

function carryKeyboard(): InlineKeyboard {
  const cl = pendingCarry!;
  const kb = new InlineKeyboard();
  cl.items.forEach((it, i) => kb.text(`${cl.selected[i] ? '☑' : '☐'} ${it.label}`, `pln:carry:t:${i}`).row());
  const n = cl.selected.filter(Boolean).length;
  kb.text(n ? `↪️ Перенести (${n})` : '↪️ Перенести', 'pln:carry:go').text('❌', 'confirm_no');
  return kb;
}

// ─── Проактивні відправки плану (для планувальника) ─────────────
export async function sendPlanBoard(bot: Bot, chatId: number, silent = false): Promise<void> {
  ensureWeekSeeded();
  if (!getWeekItems().length) return; // порожній план — не спамимо
  const { text, kb } = viewDay(todayDayKey());
  await bot.api.sendMessage(chatId, text, { reply_markup: kb, disable_notification: silent });
}
export async function sendWeeklyReport(bot: Bot, chatId: number): Promise<void> {
  if (!getWeekItems().length) return;
  const kb = new InlineKeyboard().text('📅 До плану', `pln:v:d:${todayDayKey()}`);
  await bot.api.sendMessage(chatId, viewScore(), { reply_markup: kb });
}
export async function sendPlanPrompt(bot: Bot, chatId: number): Promise<void> {
  const seeded = ensureWeekSeeded(nextWeekStart());
  const m = carryables(kyivWeekStart()).length;
  const kb = new InlineKeyboard();
  if (m) kb.text(`↪️ Перенести невиконане (${m})`, 'pln:carry:open').row();
  kb.text('➕ Додати нове', 'pln:plan:add');
  const text = `🗓 Час планувати наступний тиждень!\n${seeded ? `🔁 Додано ${seeded} ${plural(seeded, 'щотижневу справу', 'щотижневі справи', 'щотижневих справ')}.\n` : ''}${m ? `↪️ Є ${m} ${plural(m, 'невиконаний пункт', 'невиконані пункти', 'невиконаних пунктів')} — перенести?` : 'Цей тиждень закрито 👏'}`;
  await bot.api.sendMessage(chatId, text, { reply_markup: kb });
}

// ─── Обробка callback-ів плану (pln:*) ──────────────────────────
async function handlePlanCallback(ctx: any, data: string): Promise<void> {
  const p = data.split(':'); // pln:<action>:...
  const action = p[1];
  const reRender = (v: { text: string; kb: InlineKeyboard }) =>
    ctx.editMessageText(v.text, { reply_markup: v.kb }).catch(() => {});

  if (action === 'noop') return;
  if (action === 'v' && p[2] === 'd') { await reRender(viewDay(p[3] as Day)); return; }
  if (action === 'v' && p[2] === 'c') { await reRender(viewCategory(Number(p[3]))); return; }
  if (action === 'axis' && p[2] === 'c') { await reRender(viewCategoryPicker()); return; }
  if (action === 'axis' && p[2] === 'd') { await reRender(viewDay(todayDayKey())); return; }
  if (action === 'score') {
    const kb = new InlineKeyboard().text('📅 До плану', `pln:v:d:${todayDayKey()}`);
    await ctx.editMessageText(viewScore(), { reply_markup: kb }).catch(() => {});
    return;
  }
  if (action === 'tog') {
    togglePlanItem(Number(p[2]));
    if (p[3] === 'd') await reRender(viewDay(p[4] as Day));
    else if (p[3] === 'c') await reRender(viewCategory(Number(p[4])));
    return;
  }
  if (action === 'plan' && p[2] === 'add') {
    await ctx.reply('Напиши або встав пункти плану — додам (можна списком, з категоріями і днями).');
    return;
  }
  if (action === 'carry') { await handleCarryCallback(ctx, p); return; }
}

async function handleCarryCallback(ctx: any, p: string[]): Promise<void> {
  const sub = p[2];
  if (sub === 'open') {
    const items = carryables(kyivWeekStart()).map(i => ({ id: i.id, label: `${catIcon(i.category)} ${i.title}` }));
    if (!items.length) { await ctx.editMessageText('Невиконаного нема — все закрито 👏').catch(() => {}); return; }
    pendingCarry = { items, selected: items.map(() => false), toWs: nextWeekStart() };
    await ctx.editMessageText('Познач, що перенести на наступний тиждень:', { reply_markup: carryKeyboard() }).catch(() => {});
    return;
  }
  if (!pendingCarry) return;
  if (sub === 't') {
    const i = Number(p[3]);
    if (i >= 0 && i < pendingCarry.selected.length) {
      pendingCarry.selected[i] = !pendingCarry.selected[i];
      await ctx.editMessageReplyMarkup({ reply_markup: carryKeyboard() }).catch(() => {});
    }
    return;
  }
  if (sub === 'go') {
    const ids = pendingCarry.items.filter((_, i) => pendingCarry!.selected[i]).map(it => it.id);
    const toWs = pendingCarry.toWs; pendingCarry = null;
    const n = carryItems(ids, toWs);
    await ctx.editMessageText(n ? `↪️ Перенесено ${n} на наступний тиждень.` : 'Нічого не обрано.').catch(() => {});
    return;
  }
}

export function createBot(token: string) {
  const bot = new Bot(token);
  bot.use(ownerGuard);

  // ─── /start ───────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    const calStatus = isCalendarConnected() ? '✅' : '❌';
    await ctx.reply(
      '👋 Привіт! Я Leeenochka.\n\n' +
      `📅 Apple Calendar: ${calStatus}\n` +
      `⏰ Apple Reminders: ${calStatus}\n\n` +
      'Просто пиши або надсилай голосові:\n' +
      '• "Завтра о 15 зустріч з Андрієм"\n' +
      '• "Нагадай купити молоко о 18"\n' +
      '• "Перенеси зал на 17"\n' +
      '• "Що в мене завтра?"\n\n' +
      '/setup — підключити Apple Calendar\n' +
      '/today — розклад на сьогодні\n' +
      '/week — на тиждень\n' +
      '/reminders — список нагадувань',
    );
  });

  // ─── /setup — підключення Apple Calendar ─────────────────────
  bot.command('setup', async (ctx) => {
    if (isCalendarConnected()) { await ctx.reply('✅ Apple Calendar вже підключено!'); return; }
    const args = ctx.match?.trim();
    if (args && args.includes(' ')) {
      const [email, ...rest] = args.split(' ');
      saveAppleCredentials(email, rest.join(' ').trim());
      await ctx.reply('✅ Apple Calendar підключено!');
      return;
    }
    await ctx.reply(
      '📱 Підключення Apple Calendar:\n\n' +
      '1. Відкрий appleid.apple.com\n' +
      '2. Увійди → Безпека → Паролі для додатків\n' +
      '3. Натисни "+" → назви "Leeenochka" → скопіюй\n\n' +
      'Надішли одним повідомленням:\n' +
      '`/setup email@icloud.com xxxx-xxxx-xxxx-xxxx`',
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('connect', async (ctx) => {
    await ctx.reply('Використовуй /setup щоб підключити Apple Calendar.');
  });

  // ─── /today ───────────────────────────────────────────────────
  bot.command('today', async (ctx) => {
    if (!isCalendarConnected()) { await ctx.reply('Спочатку підключи Apple Calendar: /setup'); return; }
    try {
      const events = await getUpcomingEvents(1);
      if (!events.length) { await ctx.reply('📅 Сьогодні нічого немає.'); return; }
      const lines = events.map(e => {
        const t = e.start ? new Date(e.start).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }) : '';
        return `• ${t} ${e.title}`;
      });
      await ctx.reply(`📅 *Сьогодні:*\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
    } catch { await ctx.reply('Не вдалось отримати події.'); }
  });

  // ─── /week ────────────────────────────────────────────────────
  bot.command('week', async (ctx) => {
    if (!isCalendarConnected()) { await ctx.reply('Спочатку підключи Apple Calendar: /setup'); return; }
    try {
      const events = await getUpcomingEvents(7);
      if (!events.length) { await ctx.reply('📅 На тижні нічого немає.'); return; }
      const lines = events.map(e => {
        const d = e.start ? new Date(e.start) : null;
        const label = d ? d.toLocaleString('uk-UA', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }) : '';
        return `• ${label} — ${e.title}`;
      });
      await ctx.reply(`📅 *Найближчі 7 днів:*\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
    } catch { await ctx.reply('Не вдалось отримати події.'); }
  });

  // ─── /reminders ───────────────────────────────────────────────
  bot.command('reminders', async (ctx) => {
    if (!isRemindersConnected()) { await ctx.reply('Спочатку підключи Apple: /setup'); return; }
    try {
      const items = await getReminders();
      if (!items.length) { await ctx.reply('⏰ Нагадувань немає.'); return; }
      const lines = items.map(r => {
        const due = r.due ? ` — ${new Date(r.due).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' })}` : '';
        return `• ${r.title}${due}`;
      });
      await ctx.reply(`⏰ *Нагадування:*\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
    } catch { await ctx.reply('Не вдалось отримати нагадування.'); }
  });

  // ─── /memory ──────────────────────────────────────────────────
  bot.command('memory', async (ctx) => {
    const rows = db.prepare('SELECT kind, content FROM memories ORDER BY id DESC LIMIT 20').all() as Array<{ kind: string; content: string }>;
    if (!rows.length) { await ctx.reply('Пам\'ять порожня.'); return; }
    const text = rows.map(r => `• [${r.kind}] ${r.content}`).join('\n');
    await ctx.reply(`🧠 *Що я про тебе знаю:*\n${text}`, { parse_mode: 'Markdown' });
  });

  // ─── /plan ────────────────────────────────────────────────────
  bot.command('plan', async (ctx) => {
    ensureWeekSeeded();
    const { text, kb } = viewDay(todayDayKey());
    await ctx.reply(text, { reply_markup: kb });
  });

  // ─── /progress ────────────────────────────────────────────────
  bot.command('progress', async (ctx) => {
    const kb = new InlineKeyboard().text('📅 До плану', `pln:v:d:${todayDayKey()}`);
    await ctx.reply(viewScore(), { reply_markup: kb });
  });

  // ─── Inline-кнопки ────────────────────────────────────────────
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();

    if (data.startsWith('pln:')) { await handlePlanCallback(ctx, data); return; }

    const run = async (fn: () => Promise<string>) => {
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      try {
        const msg = await fn();
        saveMessage('assistant', msg);
        await ctx.reply(msg);
      } catch (e) {
        await ctx.reply(`❌ ${e instanceof Error ? e.message : 'Помилка'}`);
      }
    };

    if (data === 'confirm_yes' && pendingAction) {
      const exec = pendingAction.execute; clearPending(); await run(exec);
    } else if (data.startsWith('undo_')) {
      const id = data.slice(5);
      const undo = pendingUndos.get(id);
      if (undo) { pendingUndos.delete(id); await run(undo); }
    } else if (data.startsWith('pick_') && pendingOptions) {
      const opt = pendingOptions[parseInt(data.slice(5))]; clearPending();
      if (opt) await run(opt.execute);
    } else if (data.startsWith('toggle_') && pendingChecklist) {
      const i = parseInt(data.slice(7));
      if (i >= 0 && i < pendingChecklist.selected.length) {
        pendingChecklist.selected[i] = !pendingChecklist.selected[i];
        await ctx.editMessageReplyMarkup({ reply_markup: checklistKeyboard(pendingChecklist) }).catch(() => {});
      }
    } else if (data === 'checklist_add' && pendingChecklist) {
      const cl = pendingChecklist; clearPending();
      const chosen = cl.items.filter((_, i) => cl.selected[i]);
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      if (!chosen.length) { await ctx.reply('Нічого не обрано.'); return; }
      const results: string[] = [];
      for (const it of chosen) {
        try { results.push(await it.create()); }
        catch (e) { results.push(`❌ ${it.label}: ${e instanceof Error ? e.message : 'помилка'}`); }
      }
      const msg = results.join('\n');
      saveMessage('assistant', msg);
      await ctx.reply(msg);
    } else if (data === 'confirm_no') {
      clearPending();
      await ctx.editMessageText('❌ Скасовано.').catch(() => {});
    }
  });

  // ─── Текст ────────────────────────────────────────────────────
  bot.on('message:text', async (ctx) => { await handleInput(ctx, ctx.message.text); });

  // ─── Голос ────────────────────────────────────────────────────
  bot.on('message:voice', async (ctx) => {
    const wait = await ctx.reply('🎙 Транскрибую…');
    try {
      const file = await downloadVoice(ctx.api, ctx.message.voice.file_id);
      const text = await transcribeAudio(file);
      await ctx.api.editMessageText(ctx.chat.id, wait.message_id, `📝 "${text}"`);
      await handleInput(ctx, text);
    } catch (e) {
      console.error('Voice transcription failed:', e);
      await ctx.api.editMessageText(ctx.chat.id, wait.message_id, '❌ Не вдалось розпізнати голос.');
    }
  });

  return bot;
}

// ─── Ядро: усе через агента, без if/else по типах ───────────────
async function handleInput(ctx: any, text: string) {
  const thinking = await ctx.reply('🤔…');
  const edit = (t: string, kb?: InlineKeyboard) =>
    ctx.api.editMessageText(ctx.chat.id, thinking.message_id, t, kb ? { reply_markup: kb } : undefined);

  try {
    const r = await runAgent(text);

    if (r.kind === 'confirm') {
      clearPending();
      pendingAction = { execute: r.execute };
      await edit(r.card, new InlineKeyboard().text('✅ Так', 'confirm_yes').text('❌ Ні', 'confirm_no'));
    } else if (r.kind === 'ambiguous') {
      clearPending();
      pendingOptions = r.options;
      const kb = new InlineKeyboard();
      r.options.forEach((o, i) => kb.text(o.label, `pick_${i}`).row());
      kb.text('❌ Ні', 'confirm_no');
      await edit(r.card, kb);
    } else if (r.kind === 'checklist') {
      clearPending();
      pendingChecklist = { items: r.items, selected: r.items.map(() => false) };
      await edit(r.card, checklistKeyboard(pendingChecklist));
    } else if (r.undo) {
      clearPending();
      const id = addUndo(r.undo);
      await edit(r.text, new InlineKeyboard().text('↩️ Скасувати', `undo_${id}`));
    } else {
      clearPending();
      await edit(r.text);
    }
  } catch (e) {
    await edit(`❌ ${e instanceof Error ? e.message : 'Помилка'}`);
  }
}
