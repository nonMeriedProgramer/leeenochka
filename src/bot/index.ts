import { Bot, InlineKeyboard } from 'grammy';
import { ownerGuard } from './guard.js';
import { parseIntent, formatConfirmation, chat, saveMessage } from '../ai/claude.js';
import { transcribeAudio } from '../transcription/whisper.js';
import {
  createEvent, findFreeSlot, isCalendarConnected, getUpcomingEvents,
} from '../services/calendar/index.js';
import { createReminder, getReminders, isRemindersConnected } from '../services/reminders/index.js';
import { createTask } from '../services/notion/index.js';
import { downloadVoice } from '../utils/telegram.js';
import { saveAppleCredentials } from '../auth/tokens.js';
import type { ParsedIntent } from '../types/index.js';
import db from '../db/index.js';

let pendingIntent: ParsedIntent | null = null;
let pendingCompound: ParsedIntent[] | null = null;
let lastUndoData: { type: string; externalId?: string } | null = null;


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
      '• "Запиши ідею: нова функція для бота"\n\n' +
      '/setup — підключити Apple Calendar\n' +
      '/today — розклад на сьогодні\n' +
      '/week — на тиждень\n' +
      '/reminders — список нагадувань',
    );
  });

  // ─── /setup — підключення Apple Calendar ─────────────────────
  bot.command('setup', async (ctx) => {
    if (isCalendarConnected()) {
      await ctx.reply('✅ Apple Calendar вже підключено!');
      return;
    }

    const args = ctx.match?.trim();

    // /setup email password — одна команда, нічого не зберігати
    if (args && args.includes(' ')) {
      const [email, ...rest] = args.split(' ');
      const password = rest.join(' ').trim();
      saveAppleCredentials(email, password);
      await ctx.reply('✅ Apple Calendar підключено!');
      return;
    }

    // Без аргументів — показуємо інструкцію
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

  // Тимчасова діагностика
  bot.command('debug', async (ctx) => {
    const { getAppleCredentials } = await import('../auth/tokens.js');
    const creds = getAppleCredentials();
    if (!creds) { await ctx.reply('Credentials не знайдено'); return; }
    const auth = 'Basic ' + Buffer.from(`${creds.email}:${creds.password}`).toString('base64');
    const BASE = 'https://caldav.icloud.com';
    try {
      // Крок 1
      const r1 = await fetch(BASE, { method: 'PROPFIND', headers: { Authorization: auth, 'Content-Type': 'application/xml', Depth: '0' }, body: `<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>` });
      const t1 = await r1.text();
      const principal = t1.match(/<current-user-principal[^>]*>[\s\S]*?<href[^>]*>([^<]+)<\/href>/)?.[1];
      await ctx.reply(`Крок 1 ✅ principal: ${principal}`);
      if (!principal) return;

      // Крок 2
      const r2 = await fetch(BASE + principal, { method: 'PROPFIND', headers: { Authorization: auth, 'Content-Type': 'application/xml', Depth: '0' }, body: `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>` });
      const t2 = await r2.text();
      await ctx.reply(`Крок 2 status: ${r2.status}\n${t2.slice(0, 800)}`);
      const homeSet = t2.match(/<calendar-home-set[^>]*>[\s\S]*?<href[^>]*>([^<]+)<\/href>/)?.[1];
      if (!homeSet) return;

      // Крок 3
      const r3 = await fetch(BASE + homeSet, { method: 'PROPFIND', headers: { Authorization: auth, 'Content-Type': 'application/xml', Depth: '1' }, body: `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>` });
      const t3 = await r3.text();
      await ctx.reply(`Крок 3 status: ${r3.status}\n${t3.slice(0, 1000)}`);
    } catch (e: any) {
      await ctx.reply(`❌ ${e.message}\nCause: ${e.cause?.message ?? 'none'}\nCode: ${e.cause?.code ?? ''}`);
    }
  });

  // ─── /today ───────────────────────────────────────────────────
  bot.command('today', async (ctx) => {
    if (!isCalendarConnected()) { await ctx.reply('Спочатку підключи Google Calendar: /connect'); return; }
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
    if (!isCalendarConnected()) { await ctx.reply('Спочатку підключи Google Calendar: /connect'); return; }
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

  // ─── /undo ────────────────────────────────────────────────────
  bot.command('undo', async (ctx) => {
    if (!lastUndoData) { await ctx.reply('Нічого відміняти.'); return; }
    await ctx.reply(`↩️ Відміна поки в розробці (${lastUndoData.type}). Видали вручну в Calendar/Notion.`);
    lastUndoData = null;
  });

  // ─── /memory ──────────────────────────────────────────────────
  bot.command('memory', async (ctx) => {
    const rows = db.prepare('SELECT kind, content FROM memories ORDER BY id DESC LIMIT 20').all() as Array<{ kind: string; content: string }>;
    if (!rows.length) { await ctx.reply('Пам\'ять порожня.'); return; }
    const text = rows.map(r => `• [${r.kind}] ${r.content}`).join('\n');
    await ctx.reply(`🧠 *Що я про тебе знаю:*\n${text}`, { parse_mode: 'Markdown' });
  });

  // ─── Inline button: так/ні/скасувати ─────────────────────────
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();

    if (data === 'confirm_yes' && pendingIntent) {
      await ctx.editMessageReplyMarkup(undefined);
      await executeIntent(ctx, pendingIntent);
      pendingIntent = null;
    } else if (data === 'confirm_compound' && pendingCompound) {
      await ctx.editMessageReplyMarkup(undefined);
      const events = pendingCompound;
      pendingCompound = null;
      let added = 0;
      for (const e of events) {
        try { await executeIntent(ctx, e); added++; } catch {}
      }
      await ctx.reply(`✅ Додано ${added} із ${events.length} подій`);
    } else if (data === 'confirm_no') {
      pendingIntent = null;
      pendingCompound = null;
      await ctx.editMessageText('❌ Скасовано.');
    }
  });

  // ─── Текстові повідомлення ────────────────────────────────────
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;

    await handleInput(ctx, text);
  });

  // ─── Голосові ─────────────────────────────────────────────────
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

// ─── Core logic ─────────────────────────────────────────────────

async function handleInput(ctx: any, text: string) {
  const thinking = await ctx.reply('🤔…');

  try {
    const intent = await parseIntent(text);
    saveMessage('user', text);

    if ('type' in intent && intent.type === 'compound') {
      const lines = intent.events.map((e, i) => {
        const d = new Date(e.datetime!);
        const t = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
        return `${i + 1}. *${e.title}* — ${t} (${e.duration} хв)`;
      });
      pendingCompound = intent.events;
      const kb = new InlineKeyboard().text('✅ Додати всі', 'confirm_compound').text('❌ Ні', 'confirm_no');
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id,
        `📅 Заплановано ${intent.events.length} події:\n${lines.join('\n')}`,
        { parse_mode: 'Markdown', reply_markup: kb });
      return;
    }

    if (intent.clarificationNeeded) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `❓ ${intent.clarificationNeeded}`);
      return;
    }

    if (intent.type === 'query') {
      if (intent.title === '__today__') {
        const events = await getUpcomingEvents(1);
        if (!events.length) { await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, '📅 Сьогодні нічого немає.'); return; }
        const lines = events.map(e => { const t = e.start ? new Date(e.start).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }) : ''; return `• ${t} ${e.title}`; });
        await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `📅 *Сьогодні:*\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
        return;
      }
      if (intent.title === '__tomorrow__') {
        const events = await getUpcomingEvents(2);
        const tomorrow = events.filter(e => { const d = new Date(e.start); const t = new Date(); return d.getDate() !== t.getDate(); });
        if (!tomorrow.length) { await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, '📅 Завтра нічого немає.'); return; }
        const lines = tomorrow.map(e => { const t = new Date(e.start).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }); return `• ${t} ${e.title}`; });
        await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `📅 *Завтра:*\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
        return;
      }
      if (intent.title === '__undo__') {
        if (lastUndoData) {
          await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `↩️ Відміна поки в розробці. Видали вручну в Calendar.`);
          lastUndoData = null;
        } else {
          await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, 'Нічого відміняти.');
        }
        return;
      }
      if (intent.title === '__reschedule__') {
        await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, '⚠️ Перенесення подій поки не підтримується.\nВидали стару подію вручну і створи нову.');
        return;
      }
      if (intent.title === '__week__') {
        const events = await getUpcomingEvents(7);
        if (!events.length) { await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, '📅 На тижні нічого немає.'); return; }
        const lines = events.map(e => { const d = new Date(e.start); const label = d.toLocaleString('uk-UA', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }); return `• ${label} — ${e.title}`; });
        await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `📅 *Тиждень:*\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
        return;
      }
      // Загальний query — через AI
      const reply = await chat(text); // saveMessage вже всередині chat()

      // Витягуємо ||{...}|| якщо Gemini зібрав деталі події
      const s = reply.indexOf('||');
      const e = reply.lastIndexOf('||');
      if (s !== -1 && e > s + 2) {
        const jsonStr = reply.slice(s + 2, e).trim();
        const cleanReply = reply.slice(0, s).trim();
        try {
          const parsed = JSON.parse(jsonStr) as ParsedIntent;
          pendingIntent = parsed;
          const kb = new InlineKeyboard().text('✅ Так', 'confirm_yes').text('❌ Ні', 'confirm_no');
          await ctx.api.editMessageText(ctx.chat.id, thinking.message_id,
            cleanReply || formatConfirmation(parsed),
            { parse_mode: 'Markdown', reply_markup: kb });
          return;
        } catch { /* JSON невалідний — показуємо без JSON */ }
      }

      // Прибираємо будь-які залишки ||...|| перед відображенням
      const cleanReply2 = reply.replace(/\|\|[\s\S]*?\|\|/g, '').trim();
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, cleanReply2 || reply);
      return;
    }

    if (intent.type === 'unknown') {
      const reply = await chat(text);
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, reply);
      return;
    }

    pendingIntent = intent;
    const summary = formatConfirmation(intent);
    const kb = new InlineKeyboard().text('✅ Так', 'confirm_yes').text('❌ Ні', 'confirm_no');

    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, summary, {
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `❌ ${e instanceof Error ? e.message : 'Помилка'}`);
  }
}

async function executeIntent(ctx: any, intent: ParsedIntent) {
  try {
    if (intent.type === 'event') {
      if (!isCalendarConnected()) { await ctx.reply('⚠️ Підключи Calendar: /connect'); return; }
      let start = intent.datetime ?? new Date().toISOString();
      if (!intent.datetime) {
        const slot = await findFreeSlot(intent.duration ?? 60);
        if (slot) start = slot.toISOString();
      }
      const event = await createEvent({ title: intent.title, start, durationMinutes: intent.duration ?? 60, description: intent.description ?? undefined });
      lastUndoData = { type: 'event', externalId: event.uid };
      await ctx.reply(`✅ "${event.title}" додано в Apple Calendar 📅`);

    } else if (intent.type === 'task') {
      const url = await createTask(intent);
      lastUndoData = { type: 'task' };
      await ctx.reply(`✅ Задачу додано в Notion!\n📝 [Відкрити](${url})`, { parse_mode: 'Markdown' });

    } else if (intent.type === 'reminder') {
      if (isRemindersConnected()) {
        await createReminder({ title: intent.title, due: intent.datetime ?? undefined });
        const d = intent.datetime ? new Date(intent.datetime) : null;
        const timeStr = d ? ` о ${d.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' })}` : '';
        await ctx.reply(`⏰ Нагадування додано в Apple Reminders: *${intent.title}*${timeStr}`, { parse_mode: 'Markdown' });
      } else {
        const fireAt = intent.datetime ?? new Date(Date.now() + 3600000).toISOString();
        db.prepare('INSERT INTO reminders (fire_at, text) VALUES (?, ?)').run(fireAt, intent.title);
        const d = new Date(fireAt);
        await ctx.reply(`⏰ Нагадаю: *${intent.title}*\n🕐 ${d.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}`, { parse_mode: 'Markdown' });
      }

    } else if (intent.type === 'note') {
      const url = await createTask({ ...intent, type: 'task' });
      await ctx.reply(`📝 Нотатку збережено в Notion: *${intent.title}*\n[Відкрити](${url})`, { parse_mode: 'Markdown' });

    } else {
      await ctx.reply(`📝 Зафіксовано: ${intent.title}`);
    }
    saveMessage('assistant', `Виконано: ${intent.type} — ${intent.title}`);
  } catch (e) {
    await ctx.reply(`❌ ${e instanceof Error ? e.message : 'Помилка виконання'}`);
  }
}
