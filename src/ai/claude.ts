import OpenAI from 'openai';
import type { ParsedIntent } from '../types/index.js';
import db from '../db/index.js';

// Groq — Llama 3.3 70B для чату/інструментів (швидкий, безкоштовний)
let _groq: OpenAI | null = null;
function groq() {
  return _groq ??= new OpenAI({ apiKey: process.env.GROQ_API_KEY!, baseURL: 'https://api.groq.com/openai/v1' });
}

// FreeModel — запасний провайдер
let _freemodel: OpenAI | null = null;
function freemodel() {
  return _freemodel ??= new OpenAI({ apiKey: process.env.FREEMODEL_API_KEY!, baseURL: 'https://api.freemodel.dev/v1' });
}

const CHAT_MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'gpt-5.5';

const fmtDate = (d: Date) => d.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'long' });

function systemPrompt(): string {
  const today = fmtDate(new Date());
  const tomorrow = fmtDate(new Date(Date.now() + 86400000));
  return `Ти — Leeenochka, особистий AI-асистент. Відповідаєш українською, коротко й по суті — без вступів, вибачень і "звичайно!".

У тебе є інструменти для Apple Calendar, Apple Reminders і Notion — користуйся ними, не вигадуй дані.

ПРАВИЛА НАЗВИ ПОДІЇ:
- "вранці", "ввечері", "вечір", "на вечір", "обід", "на ранок", "вночі" — це ЧАС ДОБИ (→ datetime), НЕ назва.
- "завтра", "сьогодні", "на 22", "на понеділок" — це ДАТА (→ datetime), НЕ назва.
- title = що саме відбувається (зустріч, дзвінок, тренування, назва справи тощо).
- Якщо назва не зрозуміла — коротко перепитай, не вигадуй.

ПРАВИЛА ДІЙ:
- Якщо у повідомленні кілька дій через "і", "та", "плюс" — виклич інструмент для кожної ОКРЕМО.
- title_query для reschedule/cancel — береш ТІЛЬКИ з поточного повідомлення, не з контексту попередніх подій.
- Якщо чогось бракує для створення (немає назви або часу де він потрібен) — коротко перепитай.

Усі datetime — у форматі 2026-06-04T19:00:00+03:00 (Київ, UTC+3).
Сьогодні: ${today}. Завтра: ${tomorrow}.`;
}

// Повертає провайдера для агента: Groq якщо є ключ, інакше FreeModel
export function chatProvider(): { client: OpenAI; model: string; system: string } {
  return process.env.GROQ_API_KEY
    ? { client: groq(), model: CHAT_MODEL, system: systemPrompt() }
    : { client: freemodel(), model: FALLBACK_MODEL, system: systemPrompt() };
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
