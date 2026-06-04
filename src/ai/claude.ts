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

// Пригадує збережені вподобання/факти, щоб модель їх враховувала
function recallMemories(): string {
  try {
    const rows = db.prepare('SELECT content FROM memories ORDER BY id DESC LIMIT 15')
      .all() as Array<{ content: string }>;
    if (!rows.length) return '';
    return `\n\nЩО ПАМʼЯТАЮ ПРО КОРИСТУВАЧА (враховуй у відповідях, створенні та пропозиціях):\n${rows.map(r => `- ${r.content}`).join('\n')}`;
  } catch { return ''; }
}

function systemPrompt(): string {
  const today = fmtDate(new Date());
  const tomorrow = fmtDate(new Date(Date.now() + 86400000));
  return `Ти — Leeenochka, особистий AI-асистент. Відповідаєш українською, коротко й по суті — без вступів, вибачень і "звичайно!".

У тебе є інструменти для Apple Calendar, Apple Reminders і Notion — користуйся ними, НІКОЛИ не вигадуй події чи дані.

ЯКИЙ ІНСТРУМЕНТ ОБРАТИ (найважливіше):
1. ПИТАННЯ про розклад → query_schedule. Сюди: "що сьогодні?", "що заплановано?", "який план на день?", "що вже є?", "що в мене завтра?", "що по тижню?", "ітого що сьогодні". Це ПИТАННЯ — нічого не створюй і не пропонуй, просто покажи розклад.
2. ЯВНА нова справа з наміром додати ("додай...", "завтра о 15 зустріч", "нагадай...", "запиши...") → відповідний create_* / create_reminder.
3. Прохання ПОРАДИТИ/ПРИДУМАТИ ("запропонуй", "придумай", "що б зайнятись", "дай ідеї") → propose_items.
4. Світська балачка → просто текст, без інструментів.

ЖОРСТКІ ПРАВИЛА:
- Якщо повідомлення — це питання (є "?", або слова що/який/коли/скільки/чи про розклад) → це НЕ створення. Не створюй подій у відповідь на питання.
- Реагуй ЛИШЕ на поточне повідомлення. Не повторюй і не відтворюй дії з історії чи попередніх подій.
- Ти не знаєш розкладу, поки не викликав query_schedule. Не вигадуй назви подій ("Книга", "Відпочинок" тощо).
- propose_items — лише коли просять ідеї/поради. НЕ для показу наявного розкладу.

НАЗВА vs ЧАС:
- "вранці/ввечері/вечір/обід/вночі" = ЧАС ДОБИ (→ datetime). "завтра/сьогодні/на 22/на понеділок" = ДАТА (→ datetime). Це НЕ title.
- title = що саме відбувається. Якщо назва незрозуміла — коротко перепитай.

ІНШЕ:
- Кілька дій через "і/та/плюс" — окремий виклик на кожну.
- title_query для reschedule/cancel — ТІЛЬКИ з поточного повідомлення.
- Бракує даних для створення — коротко перепитай.

Усі datetime — у форматі 2026-06-04T19:00:00+03:00 (Київ, UTC+3).
Сьогодні: ${today}. Завтра: ${tomorrow}.${recallMemories()}`;
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
