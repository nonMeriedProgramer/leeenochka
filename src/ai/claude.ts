import Anthropic from '@anthropic-ai/sdk';
import type { ParsedIntent } from '../types/index.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a personal assistant that parses voice/text messages and extracts structured intent.

Always respond with valid JSON matching this schema:
{
  "type": "event" | "task" | "note" | "query" | "unknown",
  "title": string,
  "description": string | null,
  "datetime": ISO8601 string | null,
  "duration": number (minutes) | null,
  "project": string | null,
  "priority": "high" | "medium" | "low" | null,
  "deadline": ISO8601 date string | null,
  "clarificationNeeded": string | null
}

Rules:
- "event" = calendar event with a specific time
- "task" = to-do item, may have a deadline but no specific time
- "note" = information to save, no action needed
- "query" = user is asking a question
- If datetime is ambiguous, set clarificationNeeded
- Relative times like "tomorrow", "in 2 hours" should be resolved based on current time
- Current datetime: ${new Date().toISOString()}
- Timezone: Europe/Kyiv (UTC+3)`;

export async function parseIntent(text: string): Promise<ParsedIntent> {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');

  const jsonMatch = content.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');

  return JSON.parse(jsonMatch[0]) as ParsedIntent;
}

export async function formatConfirmation(intent: ParsedIntent): Promise<string> {
  const parts: string[] = [];

  const typeLabel = { event: '📅 Подія', task: '✅ Задача', note: '📝 Нотатка', query: '❓ Запит', unknown: '🤔 Незрозуміло' };
  parts.push(typeLabel[intent.type] || '🤔');
  parts.push(`*${intent.title}*`);

  if (intent.datetime) {
    const d = new Date(intent.datetime);
    parts.push(`🕐 ${d.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}`);
  }
  if (intent.duration) parts.push(`⏱ ${intent.duration} хв`);
  if (intent.deadline) parts.push(`📌 Дедлайн: ${intent.deadline}`);
  if (intent.project) parts.push(`📁 Проект: ${intent.project}`);
  if (intent.description) parts.push(`💬 ${intent.description}`);

  return parts.join('\n');
}
