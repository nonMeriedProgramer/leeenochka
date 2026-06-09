import type OpenAI from 'openai';
import {
  createEvent, deleteEvent, findEventByTitle,
  getUpcomingEvents, findFreeSlot, isCalendarConnected,
} from '../services/calendar/index.js';
import { createReminder, getReminders, isRemindersConnected } from '../services/reminders/index.js';
import { createTask } from '../services/notion/index.js';
import db from '../db/index.js';
import { addPlanItem, addRecurring, dayKeyFromText, findItemByTitle, makeRecurring, togglePlanItem } from '../services/plan/index.js';

// ─── Результат виклику інструмента ──────────────────────────────
// observation — дані назад моделі (read), цикл триває
// done        — дія виконана, показати текст (+ опційний undo)
// confirm     — потрібне ✅/❌ перед виконанням
// ambiguous   — кілька варіантів, користувач обирає
export type ToolOutcome =
  | { kind: 'observation'; data: string }
  | { kind: 'done'; message: string; undo?: () => Promise<string> }
  | { kind: 'confirm'; card: string; execute: () => Promise<string> }
  | { kind: 'ambiguous'; card: string; options: Array<{ label: string; execute: () => Promise<string> }> }
  | { kind: 'checklist'; card: string; items: Array<{ label: string; create: () => Promise<string> }> };

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

// Українське відмінювання за числом: 1→one, 2-4→few, 5+→many (з урахуванням 11-14)
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// ─── Єдиний creator: kind → виклик API (спільний для create-тулів і чеклиста) ──
type ItemKind = 'event' | 'task' | 'note' | 'reminder';
interface Item {
  kind: ItemKind; title: string; datetime?: string;
  duration_minutes?: number; priority?: 'high' | 'medium' | 'low'; description?: string;
}

async function createItem(item: Item): Promise<{ message: string; undo?: () => Promise<string> }> {
  switch (item.kind) {
    case 'event': {
      if (!isCalendarConnected()) return { message: '⚠️ Calendar не підключено: /setup' };
      const start = ensureKyivTz(String(item.datetime ?? ''));
      const ev = await createEvent({
        title: item.title, start,
        durationMinutes: Number(item.duration_minutes) || 60, description: item.description,
      });
      return {
        message: `✅ «${ev.title}» — ${fmtKyiv(start)}`,
        undo: async () => { await deleteEvent(ev.href); return `↩️ Скасовано: «${ev.title}»`; },
      };
    }
    case 'task': {
      const deadline = item.datetime ? ensureKyivTz(String(item.datetime)) : undefined;
      await createTask({
        type: 'task', title: item.title,
        deadline,
        priority: item.priority, description: item.description,
      });
      // Якщо є дедлайн — плануємо пінг у Telegram (інакше задача нікого не нагадає)
      if (deadline) db.prepare('INSERT INTO reminders (fire_at, text) VALUES (?, ?)').run(deadline, item.title);
      return { message: deadline ? `✅ Задача: «${item.title}» — нагадаю ${fmtKyiv(deadline)}` : `✅ Задача: «${item.title}»` };
    }
    case 'note': {
      await createTask({ type: 'note', title: item.title, description: item.description });
      return { message: `📝 Нотатка: «${item.title}»` };
    }
    case 'reminder': {
      const due = ensureKyivTz(String(item.datetime ?? ''));
      // Завжди в SQLite — щоб планувальник пінгнув у Telegram у потрібний час
      db.prepare('INSERT INTO reminders (fire_at, text) VALUES (?, ?)').run(due, item.title);
      // Додатково дзеркалимо в Apple Reminders, якщо підключено
      if (isRemindersConnected()) { try { await createReminder({ title: item.title, due }); } catch { /* не критично */ } }
      return { message: `⏰ Нагадаю: «${item.title}» — ${fmtKyiv(due)}` };
    }
    default:
      return { message: `• ${item.title}` };
  }
}

// Перетворює сирі пункти (від моделі) на пункти чеклиста з create-замиканнями
export function buildChecklist(rawItems: any[]): Array<{ label: string; create: () => Promise<string> }> {
  const items: Item[] = (Array.isArray(rawItems) ? rawItems : [])
    .map((it: any): Item => ({
      kind: (['event', 'task', 'note', 'reminder'].includes(it.kind) ? it.kind : 'task'),
      title: String(it.title ?? '').trim(),
      datetime: it.datetime ? ensureKyivTz(String(it.datetime)) : undefined,
      duration_minutes: it.duration_minutes,
      description: it.description,
    }))
    .filter((it: Item) => it.title);
  return items.map(it => ({
    label: it.datetime ? `${it.title} — ${fmtKyiv(it.datetime)}` : it.title,
    create: () => createItem(it).then(c => c.message),
  }));
}

// ─── Хендлери (по одному на дію — жодного if/else по типах) ──────
type Handler = (args: Record<string, any>) => Promise<ToolOutcome>;

const HANDLERS: Record<string, Handler> = {
  async create_event(args) {
    const c = await createItem({ kind: 'event', title: args.title, datetime: args.datetime, duration_minutes: args.duration_minutes, description: args.description });
    return { kind: 'done', message: c.message, undo: c.undo };
  },

  async create_task(args) {
    const c = await createItem({ kind: 'task', title: args.title, datetime: args.deadline, priority: args.priority, description: args.description });
    return { kind: 'done', message: c.message };
  },

  async create_note(args) {
    const c = await createItem({ kind: 'note', title: args.title, description: args.description });
    return { kind: 'done', message: c.message };
  },

  async create_reminder(args) {
    const c = await createItem({ kind: 'reminder', title: args.title, datetime: args.datetime });
    return { kind: 'done', message: c.message };
  },

  async propose_items(args) {
    const items = buildChecklist(args.items);
    if (!items.length) return { kind: 'observation', data: 'Немає чого запропонувати — придумай варіанти сам.' };
    return { kind: 'checklist', card: String(args.intro || 'Познач галочками, що додати:'), items };
  },

  async remember(args) {
    const allowed = ['fact', 'preference', 'routine', 'person', 'place'];
    const kind = allowed.includes(args.kind) ? args.kind : 'preference';
    const fact = String(args.fact ?? '').trim();
    if (!fact) return { kind: 'observation', data: 'Нема що запамʼятовувати.' };
    db.prepare("INSERT INTO memories (kind, content, source) VALUES (?, ?, 'told')").run(kind, fact);
    return { kind: 'done', message: `🧠 Запамʼятала: ${fact}` };
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

  // ─── Тижневий план ────────────────────────────────────────────
  async plan_seed(args) {
    const raw = Array.isArray(args.items) ? args.items : [];
    if (!raw.length) return { kind: 'done', message: 'Нема що додавати в план.' };
    const cats = new Set<string>(); let n = 0;
    for (const it of raw) {
      const title = String(it.title ?? '').trim();
      if (!title) continue;
      const category = String(it.category ?? '').trim() || 'Інше';
      const day = dayKeyFromText(it.day);
      const rec = it.recurring ? 1 : 0;
      addPlanItem({ category, title, day, recurring: rec });
      if (rec) addRecurring({ category, title, day });
      cats.add(category); n++;
    }
    return { kind: 'done', message: `🗂 Залито ${n} ${plural(n, 'пункт', 'пункти', 'пунктів')} у ${cats.size} ${plural(cats.size, 'категорію', 'категорії', 'категорій')}. Відкрий /plan` };
  },

  async plan_add(args) {
    const title = String(args.title ?? '').trim();
    if (!title) return { kind: 'done', message: 'Що додати в план?' };
    const category = String(args.category ?? '').trim() || 'Інше';
    const day = dayKeyFromText(args.day);
    const rec = args.recurring ? 1 : 0;
    addPlanItem({ category, title, day, recurring: rec });
    if (rec) addRecurring({ category, title, day });
    return { kind: 'done', message: `➕ У план: «${title}» (${category}${rec ? ', 🔁 щотижня' : ''}). /plan` };
  },

  async plan_repeat(args) {
    const item = findItemByTitle(String(args.title_query ?? ''));
    if (!item) return { kind: 'done', message: `Не знайшов у плані «${args.title_query}».` };
    makeRecurring(item.id);
    return { kind: 'done', message: `🔁 «${item.title}» тепер щотижнева.` };
  },

  async plan_done(args) {
    const item = findItemByTitle(String(args.title_query ?? ''));
    if (!item) return { kind: 'done', message: `Не знайшов у плані «${args.title_query}».` };
    if (item.done) return { kind: 'done', message: `«${item.title}» вже виконано.` };
    togglePlanItem(item.id);
    return { kind: 'done', message: `✅ Виконано: «${item.title}»` };
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
          datetime: { type: 'string', description: `Початок, ${DT}. "вечір"=19:00, "ранок"=9:00, "обід"=13:00, "ніч"=22:00. "16:11"/"16-11"=16 год 11 хв (час доби, НЕ дата)` },
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
      name: 'create_task', description: 'Створити задачу (todo) в Notion. Якщо вказано дедлайн — нагадаю про неї в той час.',
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
      name: 'remember',
      description: 'Запамʼятати стійкий факт/вподобання/звичку про користувача на майбутнє (напр. "не любить ранкові зустрічі", "зал зазвичай о 18", "працює віддалено"). Клич лише коли користувач повідомляє щось стале про себе, не для разових справ.',
      parameters: {
        type: 'object',
        properties: {
          fact: { type: 'string', description: 'Коротко, від 3 особи: "любить бігати вранці"' },
          kind: { type: 'string', enum: ['fact', 'preference', 'routine', 'person', 'place'] },
        },
        required: ['fact'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_items',
      description: 'Коли користувач просить ЗАПРОПОНУВАТИ / ПРИДУМАТИ / ПОРАДИТИ ідеї, справи, варіанти чи план — поверни список варіантів, з яких він сам познач галочками що додати. НЕ створюй їх одразу через create_*.',
      parameters: {
        type: 'object',
        properties: {
          intro: { type: 'string', description: 'Короткий вступ, напр. "Ідеї на вечір:"' },
          items: {
            type: 'array', description: '2–6 варіантів',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Що саме (коротко)' },
                kind: { type: 'string', enum: ['event', 'task', 'note', 'reminder'], description: 'event якщо є конкретний час, інакше task' },
                datetime: { type: 'string', description: `Опційно, ${DT}` },
                duration_minutes: { type: 'integer' },
                description: { type: 'string' },
              },
              required: ['title', 'kind'],
            },
          },
        },
        required: ['items'],
      },
    },
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
  {
    type: 'function',
    function: {
      name: 'plan_seed',
      description: 'Залити цілий ТИЖНЕВИЙ ПЛАН зі вставленого користувачем тексту-списку. Заголовки (Робота/Життя/Спорт/Особисте тощо) = category, рядки під ними = окремі пункти. День у тексті ("вівторок", "середа") → day. "щотижня/щочетверга/завжди/кожен тиждень" → recurring=true. Клич, коли користувач дає список планів на тиждень.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array', description: 'Усі пункти плану',
            items: {
              type: 'object',
              properties: {
                category: { type: 'string', description: 'Категорія із заголовка списку' },
                title: { type: 'string', description: 'Сам пункт' },
                day: { type: 'string', description: 'Опційно: день тижня українською, якщо вказано' },
                recurring: { type: 'boolean', description: 'true якщо це стандартна щотижнева справа' },
              },
              required: ['category', 'title'],
            },
          },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_add',
      description: 'Додати ОДИН пункт у тижневий план (не подію і не нагадування — пункт чеклиста на тиждень).',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Категорія, напр. Робота/Спорт' },
          title: { type: 'string' },
          day: { type: 'string', description: 'Опційно: день тижня українською' },
          recurring: { type: 'boolean', description: 'true якщо повторюється щотижня' },
        },
        required: ['category', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_repeat',
      description: 'Зробити наявний пункт тижневого плану щотижневим (повторюваним).',
      parameters: { type: 'object', properties: { title_query: { type: 'string', description: 'Частина назви пункту' } }, required: ['title_query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_done',
      description: 'Відмітити пункт тижневого плану виконаним за назвою.',
      parameters: { type: 'object', properties: { title_query: { type: 'string', description: 'Частина назви пункту' } }, required: ['title_query'] },
    },
  },
];
