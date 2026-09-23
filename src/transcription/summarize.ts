// ─── Стисла вижимка розшифровки голосового ─────────────────────────────
import { completionProvider } from '../ai/claude.js';

/** ~25% від оригіналу за словами, українською, без вступних фраз. */
export async function summarizeText(text: string): Promise<string> {
  const words = text.split(/\s+/).filter(Boolean).length;
  const target = Math.max(15, Math.round(words * 0.25));
  const { client, model } = completionProvider();

  const res = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `Стисни текст до вижимки українською мовою, приблизно ${target} слів (це ~25% від оригіналу). `
          + 'Збережи головну суть і ключові факти. Без вступних фраз на кшталт "ось стислий переказ:" — відразу текст.',
      },
      { role: 'user', content: text },
    ],
  });

  return res.choices[0]?.message?.content?.trim() || text;
}
