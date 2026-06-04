import OpenAI from 'openai';
import type { ParsedIntent } from '../types/index.js';
import type { CompoundIntent } from './parser.js';
import db from '../db/index.js';

// Groq — Llama 3.3 70B для чату (швидкий, розумний, безкоштовний)
let _groq: OpenAI | null = null;
function groq() {
  return _groq ??= new OpenAI({
    apiKey: process.env.GROQ_API_KEY!,
    baseURL: 'https://api.groq.com/openai/v1',
  });
}

// FreeModel — для структурованого парсингу JSON (дешевший)
let _freemodel: OpenAI | null = null;
function freemodel() {
  return _freemodel ??= new OpenAI({
    apiKey: process.env.FREEMODEL_API_KEY!,
    baseURL: 'https://api.freemodel.dev/v1',
  });
}

const CHAT_MODEL = 'llama-3.3-70b-versatile';
const PARSE_MODEL = 'gpt-5.5';

const today = () => new Date().toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'long' });

const PARSE_SYSTEM = `Parse the Ukrainian message and return ONLY a JSON object. No markdown, no explanation.

Format:
{"type":"event","title":"...","datetime":"2026-06-04T19:00:00+03:00","duration":60,"description":null,"project":null,"priority":null,"deadline":null,"clarificationNeeded":null}

Rules:
- type: "event" (meeting/appointment with time), "task" (todo), "reminder" (alert), "note" (save idea), "query" (question), "unknown"
- title: keep original names exactly, strip action verbs (постав, додай, запиши)
- datetime: full ISO8601 with +03:00 timezone. today=${new Date().toISOString().split('T')[0]}
- duration: INTEGER minutes only. Default 60 for events.
- timezone: Europe/Kyiv (UTC+3)`;

const CHAT_SYSTEM = `Ти — Leeenochka, особистий AI-асистент. Говориш українською. Відповіді короткі та по суті — без зайвих вступів, вибачень і "звичайно!".

Твої можливості: Apple Calendar, Apple Reminders, Notion (задачі та нотатки).

Якщо є КАЛЕНДАР КОРИСТУВАЧА — використовуй ці дані для відповіді про розклад.

Якщо треба створити подію і є всі деталі (назва + час) — підтверди одним реченням і додай в кінці:
||{"type":"event","title":"...","datetime":"2026-06-04T19:00:00+03:00","duration":60}||

Сьогодні: ${today()}`;

async function fetchCalendarContext(msg: string): Promise<string> {
  const lower = msg.toLowerCase();
  if (!/розклад|план|сьогодні|завтра|тижн|календар|на день|що маю|що в мене|події/.test(lower)) return '';
  try {
    const { isCalendarConnected, getUpcomingEvents } = await import('../services/calendar/index.js');
    if (!isCalendarConnected()) return '';
    const events = await getUpcomingEvents(7);
    if (!events.length) return '\n\nКАЛЕНДАР: порожньо.';
    const lines = events.map(e =>
      `- ${new Date(e.start).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' })} — ${e.title}`
    );
    return `\n\nКАЛЕНДАР (7 днів):\n${lines.join('\n')}`;
  } catch { return ''; }
}

export async function parseIntent(text: string): Promise<ParsedIntent | CompoundIntent> {
  const { quickParseCompound } = await import('./parser.js');
  const quick = quickParseCompound(text);
  if (quick) return quick;

  try {
    const res = await freemodel().chat.completions.create({
      model: PARSE_MODEL,
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
    if (parsed.datetime && !/Z|[+-]\d{2}:\d{2}$/.test(parsed.datetime)) {
      parsed.datetime = parsed.datetime + '+03:00';
    }
    return parsed;
  } catch {
    return { type: 'unknown', title: text };
  }
}

export async function chat(userMessage: string): Promise<string> {
  const history = (db.prepare(
    'SELECT role, content FROM messages ORDER BY id DESC LIMIT 20'
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

  const res = await groq().chat.completions.create({ model: CHAT_MODEL, messages, temperature: 0.7, max_tokens: 500 });
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
