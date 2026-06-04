import OpenAI from 'openai';
import type { ParsedIntent } from '../types/index.js';
import type { CompoundIntent } from './parser.js';
import db from '../db/index.js';

let _client: OpenAI | null = null;
function client() {
  return _client ??= new OpenAI({
    apiKey: process.env.FREEMODEL_API_KEY!,
    baseURL: 'https://api.freemodel.dev/v1',
  });
}

const MODEL = 'gpt-5.5';

const PARSE_SYSTEM = `Parse the Ukrainian message and return ONLY a JSON object. No markdown, no explanation.

Format:
{"type":"event","title":"...","datetime":"2026-06-03T19:00:00","duration":60,"description":null,"project":null,"priority":null,"deadline":null,"clarificationNeeded":null}

Rules:
- type: "event" (meeting/appointment with time), "task" (todo), "reminder" (alert), "note" (save idea/thought to notes), "query" (question), "unknown"
- title: keep original names exactly
- datetime: full ISO8601, resolve relative dates. today=${new Date().toISOString().split('T')[0]}
- duration: INTEGER minutes only (e.g. 60). NOT a time string.
- timezone: Europe/Kyiv (UTC+3)`;

export async function parseIntent(text: string): Promise<ParsedIntent | CompoundIntent> {
  const { quickParseCompound } = await import('./parser.js');
  const quick = quickParseCompound(text);
  if (quick) return quick;

  try {
    const res = await client().chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: PARSE_SYSTEM },
        { role: 'user', content: text },
      ],
      temperature: 0,
    });
    const raw = res.choices[0]?.message?.content ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { type: 'unknown', title: text };
    const parsed = JSON.parse(match[0]) as ParsedIntent;
    if (!parsed.type || parsed.type === 'unknown') return { type: 'unknown', title: text };
    // AI повертає datetime без TZ — трактуємо як Kyiv (UTC+3)
    if (parsed.datetime && !/Z|[+-]\d{2}:\d{2}$/.test(parsed.datetime)) {
      parsed.datetime = parsed.datetime + '+03:00';
    }
    return parsed;
  } catch {
    return { type: 'unknown', title: text };
  }
}

const CHAT_SYSTEM = `Ти — Leeenochka, персональний AI-асистент. Відповідай українською, коротко.
Якщо отримуєш КАЛЕНДАР КОРИСТУВАЧА — використовуй ці реальні дані щоб відповісти на питання про розклад.
Якщо користувач хоче запланувати подію і ти зібрав всі деталі (назва, дата, час) — підтверди і ОБОВ'ЯЗКОВО в кінці додай JSON:
||{"type":"event","title":"...","datetime":"ISO8601+03:00","duration":60}||
Якщо деталей не вистачає — уточнюй. Не вигадуй деталі яких немає.`;

// Підтягує події з календаря якщо питання про розклад
async function fetchCalendarContext(msg: string): Promise<string> {
  const lower = msg.toLowerCase();
  if (!/розклад|план|сьогодні|завтра|тижн|календар|на день|що маю|що в мене/.test(lower)) return '';
  try {
    const { isCalendarConnected, getUpcomingEvents } = await import('../services/calendar/index.js');
    if (!isCalendarConnected()) return '';
    const events = await getUpcomingEvents(7);
    if (!events.length) return '\n\nКАЛЕНДАР: подій не знайдено.';
    const lines = events.map(e =>
      `- ${new Date(e.start).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' })} — ${e.title}`
    );
    return `\n\nКАЛЕНДАР КОРИСТУВАЧА (7 днів):\n${lines.join('\n')}`;
  } catch { return ''; }
}

export async function chat(userMessage: string): Promise<string> {
  const history = (db.prepare(
    'SELECT role, content FROM messages ORDER BY id DESC LIMIT 10'
  ).all() as Array<{ role: string; content: string }>).reverse();

  const calendarCtx = await fetchCalendarContext(userMessage);
  const systemContent = CHAT_SYSTEM + calendarCtx;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemContent },
    ...history.map(m => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const res = await client().chat.completions.create({ model: MODEL, messages });
  const text = res.choices[0]?.message?.content ?? '';

  saveMessage('user', userMessage);
  saveMessage('assistant', text);
  return text;
}

export function saveMessage(role: 'user' | 'assistant', content: string) {
  db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)').run(role, content);
  db.prepare('DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT 100)').run();
}

export function formatConfirmation(intent: ParsedIntent): string {
  const labels: Record<string, string> = {
    event: '📅 Подія', task: '✅ Задача', note: '📝 Нотатка',
    reminder: '⏰ Нагадування', query: '❓', unknown: '🤔',
  };
  const lines = [labels[intent.type] ?? '🤔', `*${intent.title}*`];
  if (intent.datetime) {
    const d = new Date(intent.datetime);
    lines.push(`🕐 ${d.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' })}`);
  }
  if (intent.duration)    lines.push(`⏱ ${intent.duration} хв`);
  if (intent.deadline)    lines.push(`📌 Дедлайн: ${intent.deadline}`);
  if (intent.project)     lines.push(`📁 ${intent.project}`);
  if (intent.description) lines.push(`💬 ${intent.description}`);
  return lines.join('\n');
}
