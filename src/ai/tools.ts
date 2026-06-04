import type OpenAI from 'openai';
import {
  createEvent, deleteEvent, findEventByTitle,
  getUpcomingEvents, findFreeSlot, isCalendarConnected,
} from '../services/calendar/index.js';
import { createReminder, getReminders, isRemindersConnected } from '../services/reminders/index.js';
import { createTask } from '../services/notion/index.js';
import db from '../db/index.js';

// ─── Результат виклику інструмента ──────────────────────────────
// observation — дані назад моделі (read), цикл триває
// done        — дія виконана, показати текст (+ опційний undo)
// confirm     — потрібне ✅/❌ перед виконанням
// ambiguous   — кілька варіантів, користувач обирає
export type ToolOutcome =
  | { kind: 'observation'; data: string }
  | { kind: 'done'; message: string; undo?: () => Promise<string> }
  | { kind: 'confirm'; card: string; execute: () => Promise<string> }
  | { kind: 'ambiguous'; card: string; options: Array<{ label: string; execute: () => Promise<string> }> };

// ─── Хелпери таймзони/форматування ──────────────────────────────
export function ensureKyivTz(dt: string): string {
  if (!dt) return dt;
  return /Z$|[+-]\d{2}:?\d{2}$/.test(dt) ? dt : dt + '+03:00';
}

function fmtKyiv(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' });
}

function sameKyivDay(iso: string, ref: Date): boolean {
  const opt = { timeZone: 'Europe/Kyiv' } as const;
  return new Date(iso).toLocaleDateString('uk-UA', opt) === ref.toLocaleDateString('uk-UA', opt);
}

// ─── Хендлери (по одному на дію — жодного if/else по типах) ──────
type Handler = (args: Record<string, any>) => Promise<ToolOutcome>;

const HANDLERS: Record<string, Handler> = {
  async create_event(args) {
    if (!isCalendarConnected()) return { kind: 'done', message: '⚠️ Спочатку підключи Apple Calendar: /setup' };
    const start = ensureKyivTz(String(args.datetime ?? ''));
    const duration = Number(args.duration_minutes) || 60;
    const ev = await createEvent({ title: args.title, start, durationMinutes: duration, description: args.description });
    return {
      kind: 'done',
      message: `✅ Додав «${ev.title}» — ${fmtKyiv(start)}`,
      undo: async () => { await deleteEvent(ev.href); return `↩️ Скасовано: «${ev.title}»`; },
    };
  },

  async create_task(args) {
    await createTask({
      type: 'task', title: args.title,
      deadline: args.deadline ? ensureKyivTz(String(args.deadline)) : undefined,
      priority: args.priority, description: args.description,
    });
    return { kind: 'done', message: `✅ Задача в Notion: «${args.title}»` };
  },

  async create_note(args) {
    await createTask({ type: 'note', title: args.title, description: args.description });
    return { kind: 'done', message: `📝 Нотатка в Notion: «${args.title}»` };
  },

  async create_reminder(args) {
    const due = ensureKyivTz(String(args.datetime ?? ''));
    if (isRemindersConnected()) {
      await createReminder({ title: args.title, due });
      return { kind: 'done', message: `⏰ Нагадування в Apple Reminders: «${args.title}» — ${fmtKyiv(due)}` };
    }
    db.prepare('INSERT INTO reminders (fire_at, text) VALUES (?, ?)').run(due, args.title);
    return { kind: 'done', message: `⏰ Нагадаю: «${args.title}» — ${fmtKyiv(due)}` };
  },

  async query_schedule(args) {
    if (!isCalendarConnected()) return { kind: 'observation', data: 'Календар не підключено (/setup).' };
    const range: string = args.range ?? 'today';
    const days = range === 'week' ? 7 : range === 'tomorrow' ? 2 : 1;
    let events = await getUpcomingEvents(days);
    if (range === 'today') events = events.filter(e => sameKyivDay(e.start, new Date()));
    else if (range === 'tomorrow') events = events.filter(e => sameKyivDay(e.start, new Date(Date.now() + 86400000)));
    if (!events.length) return { kind: 'observation', data: `Розклад (${range}): порожньо.` };
    const lines = events.map(e => `- ${fmtKyiv(e.start)} ${e.title}`);
    return { kind: 'observation', data: `Розклад (${range}):\n${lines.join('\n')}` };
  },

  async list_reminders() {
    if (!isRemindersConnected()) return { kind: 'observation', data: 'Reminders не підключено (/setup).' };
    const items = await getReminders();
    if (!items.length) return { kind: 'observation', data: 'Нагадувань немає.' };
    return { kind: 'observation', data: `Нагадування:\n${items.map(r => `- ${r.title}`).join('\n')}` };
  },

  async find_free_slot(args) {
    const slot = await findFreeSlot(Number(args.duration_minutes) || 60);
    if (!slot) return { kind: 'observation', data: 'Вільних слотів у найближчий тиждень немає.' };
    return { kind: 'observation', data: `Найближчий вільний слот: ${fmtKyiv(slot.toISOString())}` };
  },

  async cancel_event(args) {
    if (!isCalendarConnected()) return { kind: 'done', message: '⚠️ Календар не підключено: /setup' };
    const matches = await findEventByTitle(String(args.title_query ?? ''));
    if (!matches.length) return { kind: 'done', message: `Не знайшов події «${args.title_query}».` };
    const del = (m: typeof matches[number]) => async () => { await deleteEvent(m.href); return `✅ Видалено «${m.title}»`; };
    if (matches.length === 1) {
      const m = matches[0];
      return { kind: 'confirm', card: `🗑 Видалити «${m.title}» — ${fmtKyiv(m.start)}?`, execute: del(m) };
    }
    return {
      kind: 'ambiguous', card: 'Знайшов кілька — що видалити?',
      options: matches.map(m => ({ label: `${m.title} — ${fmtKyiv(m.start)}`, execute: del(m) })),
    };
  },

  async reschedule_event(args) {
    if (!isCalendarConnected()) return { kind: 'done', message: '⚠️ Календар не підключено: /setup' };
    const newStart = ensureKyivTz(String(args.new_datetime ?? ''));
    const matches = await findEventByTitle(String(args.title_query ?? ''));
    if (!matches.length) return { kind: 'done', message: `Не знайшов події «${args.title_query}».` };
    const move = (m: typeof matches[number]) => async () => {
      const dur = Math.round((new Date(m.end).getTime() - new Date(m.start).getTime()) / 60000) || 60;
      await deleteEvent(m.href);
      await createEvent({ title: m.title, start: newStart, durationMinutes: Math.max(15, dur) || 60 });
      return `✅ Перенесено «${m.title}» → ${fmtKyiv(newStart)}`;
    };
    if (matches.length === 1) return { kind: 'done', message: await move(matches[0])() };
    return {
      kind: 'ambiguous', card: `Знайшов кілька — що перенести на ${fmtKyiv(newStart)}?`,
      options: matches.map(m => ({ label: `${m.title} — ${fmtKyiv(m.start)}`, execute: move(m) })),
    };
  },
};

// Єдиний диспетч — без if/else по типах
export async function dispatch(name: string, args: Record<string, any>): Promise<ToolOutcome> {
  const handler = HANDLERS[name];
  if (!handler) return { kind: 'observation', data: `Невідомий інструмент: ${name}` };
  try {
    return await handler(args ?? {});
  } catch (e) {
    return { kind: 'done', message: `❌ ${e instanceof Error ? e.message : 'Помилка виконання'}` };
  }
}

// ─── Декларативні схеми для моделі ──────────────────────────────
const DT = 'ISO-8601 з таймзоною Києва, напр. 2026-06-04T19:00:00+03:00';

export const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_event', description: 'Створити подію в Apple Calendar (зустріч, тренування, прийом — те, що має конкретний час). title — ЩО відбувається (наприклад "Зал", "Дзвінок з Андрієм"). "вечір", "ранок", "завтра" — це datetime, не title.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Назва події — ЩО відбувається, не час і не дата' },
          datetime: { type: 'string', description: `Початок, ${DT}. "вечір"=19:00, "ранок"=9:00, "обід"=13:00, "ніч"=22:00` },
          duration_minutes: { type: 'integer', description: 'Тривалість у хвилинах (за замовч. 60)' },
          description: { type: 'string' },
        },
        required: ['title', 'datetime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task', description: 'Створити задачу (todo) в Notion — справа без конкретного часу.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          deadline: { type: 'string', description: `Дедлайн (опц.), ${DT}` },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          description: { type: 'string' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_note', description: 'Зберегти нотатку/ідею в Notion.',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string' }, description: { type: 'string' } },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_reminder', description: 'Поставити нагадування в Apple Reminders на конкретний час.',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string' }, datetime: { type: 'string', description: `Коли нагадати, ${DT}` } },
        required: ['title', 'datetime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_schedule', description: 'Подивитись розклад користувача з календаря.',
      parameters: {
        type: 'object',
        properties: { range: { type: 'string', enum: ['today', 'tomorrow', 'week'], description: 'Період' } },
        required: ['range'],
      },
    },
  },
  {
    type: 'function',
    function: { name: 'list_reminders', description: 'Показати активні нагадування.', parameters: { type: 'object', properties: {} } },
  },
  {
    type: 'function',
    function: {
      name: 'find_free_slot', description: 'Знайти найближче вільне вікно в розкладі (робочі години 9–18).',
      parameters: {
        type: 'object',
        properties: { duration_minutes: { type: 'integer', description: 'Скільки часу потрібно (хв)' } },
        required: ['duration_minutes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_event', description: 'Перенести існуючу подію на новий час.',
      parameters: {
        type: 'object',
        properties: {
          title_query: { type: 'string', description: 'Частина назви події з ПОТОЧНОГО повідомлення користувача, не з контексту' },
          new_datetime: { type: 'string', description: `Новий час, ${DT}` },
        },
        required: ['title_query', 'new_datetime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_event', description: 'Відмінити/видалити подію з календаря.',
      parameters: {
        type: 'object',
        properties: { title_query: { type: 'string', description: 'Частина назви події з ПОТОЧНОГО повідомлення користувача, не з контексту' } },
        required: ['title_query'],
      },
    },
  },
];
