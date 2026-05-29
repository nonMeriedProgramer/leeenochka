import { Bot, Context } from 'grammy';
import { parseIntent, formatConfirmation } from '../ai/claude.js';
import { transcribeAudio } from '../transcription/whisper.js';
import { createEvent, findFreeSlot, getAuthUrl, exchangeCode } from '../services/calendar/index.js';
import { createTask } from '../services/notion/index.js';
import type { UserState } from '../types/index.js';
import { downloadVoice } from '../utils/telegram.js';

// In-memory store (replace with DB for multi-user)
const users = new Map<number, UserState>();

function getUser(id: number): UserState {
  if (!users.has(id)) {
    users.set(id, {
      telegramId: id,
      preferences: {
        workingHoursStart: 9,
        workingHoursEnd: 18,
        lunchStart: 12,
        lunchEnd: 13,
        deepWorkHours: [9, 10, 11],
        timezone: 'Europe/Kyiv',
      },
    });
  }
  return users.get(id)!;
}

export function createBot(token: string) {
  const bot = new Bot(token);

  bot.command('start', async (ctx) => {
    await ctx.reply(
      '👋 Привіт! Я твій AI-помічник.\n\n' +
      'Просто напиши або надішли голосове — я розберу що треба зробити і внесу в календар або Notion.\n\n' +
      'Приклади:\n' +
      '• "Завтра о 15:00 дзвінок з Артемом на годину"\n' +
      '• "Задача: написати пропозицію для клієнта, дедлайн п\'ятниця"\n' +
      '• "Нотатка: придумати назву для нового продукту"\n\n' +
      '/connect — підключити Google Calendar',
    );
  });

  bot.command('connect', async (ctx) => {
    const user = getUser(ctx.from!.id);
    if (user.googleTokens) {
      await ctx.reply('✅ Google Calendar вже підключено.');
      return;
    }
    const url = getAuthUrl(ctx.from!.id);
    await ctx.reply(`🔗 Авторизуй доступ до Calendar:\n${url}`);
  });

  // OAuth callback via deep link: /auth_<code>
  bot.hears(/^\/auth_(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const user = getUser(ctx.from!.id);
    try {
      user.googleTokens = await exchangeCode(code) as UserState['googleTokens'];
      await ctx.reply('✅ Google Calendar підключено!');
    } catch {
      await ctx.reply('❌ Помилка авторизації. Спробуй /connect ще раз.');
    }
  });

  // Text messages
  bot.on('message:text', async (ctx) => {
    const user = getUser(ctx.from!.id);
    const text = ctx.message.text;

    // Handle confirmation reply
    if (user.pendingConfirmation) {
      const answer = text.toLowerCase();
      if (answer === 'так' || answer === 'yes' || answer === '✅') {
        await handleConfirmedIntent(ctx, user);
        return;
      }
      if (answer === 'ні' || answer === 'no' || answer === '❌') {
        user.pendingConfirmation = undefined;
        await ctx.reply('Скасовано.');
        return;
      }
    }

    await processMessage(ctx, user, text);
  });

  // Voice messages
  bot.on('message:voice', async (ctx) => {
    const user = getUser(ctx.from!.id);
    const waitMsg = await ctx.reply('🎙 Транскрибую...');

    try {
      const filePath = await downloadVoice(ctx.api, ctx.message.voice.file_id);
      const text = await transcribeAudio(filePath);
      await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, `📝 "${text}"`);
      await processMessage(ctx, user, text);
    } catch (e) {
      await ctx.reply('❌ Не вдалось розпізнати голос. Спробуй текстом.');
    }
  });

  return bot;
}

async function processMessage(ctx: Context, user: UserState, text: string) {
  const thinking = await ctx.reply('🤔...');
  try {
    const intent = await parseIntent(text);

    if (intent.clarificationNeeded) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        thinking.message_id,
        `❓ ${intent.clarificationNeeded}`,
      );
      return;
    }

    user.pendingConfirmation = intent;
    const summary = await formatConfirmation(intent);

    await ctx.api.editMessageText(
      ctx.chat!.id,
      thinking.message_id,
      `${summary}\n\n✅ Так   ❌ Ні`,
      { parse_mode: 'Markdown' },
    );
  } catch {
    await ctx.api.editMessageText(ctx.chat!.id, thinking.message_id, '❌ Помилка. Спробуй ще раз.');
  }
}

async function handleConfirmedIntent(ctx: Context, user: UserState) {
  const intent = user.pendingConfirmation!;
  user.pendingConfirmation = undefined;

  try {
    if (intent.type === 'event') {
      if (!user.googleTokens) {
        await ctx.reply('⚠️ Підключи Google Calendar через /connect');
        return;
      }
      let startTime = intent.datetime ?? new Date().toISOString();
      if (!intent.datetime) {
        const freeSlot = await findFreeSlot(user.googleTokens, intent.duration ?? 60);
        if (freeSlot) startTime = freeSlot.toISOString();
      }
      const event = await createEvent(user.googleTokens, {
        title: intent.title,
        start: startTime,
        durationMinutes: intent.duration ?? 60,
        description: intent.description,
      });
      await ctx.reply(`✅ Подію додано: ${event.htmlLink}`);

    } else if (intent.type === 'task') {
      const url = await createTask(intent);
      await ctx.reply(`✅ Задачу додано в Notion: ${url}`);

    } else {
      await ctx.reply('✅ Зафіксовано.');
    }
  } catch (e) {
    await ctx.reply(`❌ Помилка: ${e instanceof Error ? e.message : 'невідома'}`);
  }
}
