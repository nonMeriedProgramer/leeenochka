import type OpenAI from 'openai';
import { chatProvider, saveMessage } from './claude.js';
import { TOOLS, dispatch, buildChecklist, type ToolOutcome } from './tools.js';
import db from '../db/index.js';

export type AgentResult =
  | { kind: 'done'; text: string; undo?: () => Promise<string> }
  | { kind: 'confirm'; card: string; execute: () => Promise<string> }
  | { kind: 'ambiguous'; card: string; options: Array<{ label: string; execute: () => Promise<string> }> }
  | { kind: 'checklist'; card: string; items: Array<{ label: string; create: () => Promise<string> }> };

function safeParse(s: string | undefined): Record<string, any> {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

// Зводить термінальні outcomes у єдиний AgentResult
function toResult(outcomes: ToolOutcome[]): AgentResult {
  const confirm = outcomes.find((o): o is Extract<ToolOutcome, { kind: 'confirm' }> => o.kind === 'confirm');
  if (confirm) return { kind: 'confirm', card: confirm.card, execute: confirm.execute };

  const amb = outcomes.find((o): o is Extract<ToolOutcome, { kind: 'ambiguous' }> => o.kind === 'ambiguous');
  if (amb) return { kind: 'ambiguous', card: amb.card, options: amb.options };

  const checklist = outcomes.find((o): o is Extract<ToolOutcome, { kind: 'checklist' }> => o.kind === 'checklist');
  if (checklist) return { kind: 'checklist', card: checklist.card, items: checklist.items };

  const dones = outcomes.filter((o): o is Extract<ToolOutcome, { kind: 'done' }> => o.kind === 'done');
  const text = dones.map(d => d.message).join('\n') || 'Готово.';
  saveMessage('assistant', text);
  const undos = dones.map(d => d.undo).filter((u): u is () => Promise<string> => !!u);
  const undo = undos.length
    ? async () => (await Promise.all(undos.map(u => u()))).join('\n')
    : undefined;
  return { kind: 'done', text, undo };
}

// Головний цикл: модель сама вирішує які інструменти викликати.
export async function runAgent(userMessage: string): Promise<AgentResult> {
  const { client, model, system } = chatProvider();
  const history = (db.prepare('SELECT role, content FROM messages ORDER BY id DESC LIMIT 20')
    .all() as Array<{ role: string; content: string }>).reverse();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    ...history.map(m => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  let finalText = '';
  for (let i = 0; i < 3; i++) {
    const res = await client.chat.completions.create({
      model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2, max_tokens: 600,
    });
    const msg = res.choices[0]?.message;
    if (!msg) break;

    const calls = (msg.tool_calls ?? []).filter(c => c.type === 'function');
    if (!calls.length) { finalText = msg.content ?? ''; break; }

    const outcomes = await Promise.all(calls.map(c => dispatch(c.function.name, safeParse(c.function.arguments))));

    // Якщо є хоч одна дія (не read) — завершуємо й показуємо результат/кнопки
    if (outcomes.some(o => o.kind !== 'observation')) {
      saveMessage('user', userMessage);
      return toResult(outcomes);
    }

    // Усі read — віддаємо дані моделі й продовжуємо, щоб вона підсумувала
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
    calls.forEach((c, idx) => {
      messages.push({
        role: 'tool', tool_call_id: c.id,
        content: (outcomes[idx] as Extract<ToolOutcome, { kind: 'observation' }>).data,
      });
    });
  }

  finalText = finalText || 'Не зовсім зрозуміла. Спробуй сформулювати інакше?';
  saveMessage('user', userMessage);
  saveMessage('assistant', finalText);
  return { kind: 'done', text: finalText };
}

// Генерує ідеї (форсує propose_items) — для ранкового брифа/проактивних пропозицій
export async function generateIdeas(context: string): Promise<Array<{ label: string; create: () => Promise<string> }>> {
  const { client, model, system } = chatProvider();
  try {
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: context }],
      tools: TOOLS.filter(t => t.function.name === 'propose_items'),
      tool_choice: { type: 'function', function: { name: 'propose_items' } },
      temperature: 0.6, max_tokens: 500,
    });
    const call = (res.choices[0]?.message?.tool_calls ?? []).find(c => c.type === 'function');
    if (!call) return [];
    return buildChecklist(JSON.parse(call.function.arguments || '{}').items ?? []);
  } catch {
    return [];
  }
}
