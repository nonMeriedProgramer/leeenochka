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

// Очікувані дії (бот однокористувацький — owner-only, module-level стан ок)
let pendingAction: { execute: () => Promise<string> } | null = null;     // ✅/❌ підтвердження
let pendingUndo: (() => Promise<string>) | null = null;                    // ↩️ скасувати останнє
let pendingOptions: Array<{ label: string; execute: () => Promise<string> }> | null = null; // вибір зі списку

function clearPending() { pendingAction = null; pendingUndo = null; pendingOptions = null; }

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

  // ─── Inline-кнопки ────────────────────────────────────────────
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();

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
    } else if (data === 'undo_last' && pendingUndo) {
      const undo = pendingUndo; clearPending(); await run(undo);
    } else if (data.startsWith('pick_') && pendingOptions) {
      const opt = pendingOptions[parseInt(data.slice(5))]; clearPending();
      if (opt) await run(opt.execute);
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
    } catch {
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
    } else if (r.undo) {
      clearPending();
      pendingUndo = r.undo;
      await edit(r.text, new InlineKeyboard().text('↩️ Скасувати', 'undo_last'));
    } else {
      clearPending();
      await edit(r.text);
    }
  } catch (e) {
    await edit(`❌ ${e instanceof Error ? e.message : 'Помилка'}`);
  }
}
