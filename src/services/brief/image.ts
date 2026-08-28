import { GoogleGenAI } from '@google/genai';
import type { WellnessRow } from '../training/garmin.js';

// Nano Banana — Gemini 2.5 Flash Image. Малює гарний ранковий дашборд-скрін у стилі
// AlterMe з РЕАЛЬНИМИ даними Garmin. Недетерміновано (числа може іноді спотворити),
// тому це доповнення до тексту брифу, а не заміна: текст завжди йде як підпис (caption).

let _ai: GoogleGenAI | null = null;
function ai(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return _ai ??= new GoogleGenAI({ apiKey });
}

// Рядки-картки для промту — лише ті метрики, що реально є в даних.
function metricLines(w: WellnessRow): string[] {
  const cards: string[] = [];
  if (w.sleep_score != null || w.sleep_hours != null) {
    const sub = w.sleep_hours != null ? `${w.sleep_hours} год` : 'сон';
    cards.push(`• card "Сон" — big number "${w.sleep_score ?? '—'}" — subtitle "${sub}" (green accent)`);
  }
  if (w.body_battery_current != null) {
    cards.push(`• card "Заряд тіла" — big number "${w.body_battery_current}" — subtitle "заряд" (violet accent)`);
  }
  if (w.training_readiness != null) {
    cards.push(`• LARGE card with a circular progress ring about ${w.training_readiness}% filled (green) — label "Готовність" — big number "${w.training_readiness}" — subtitle "готовність до тренування"`);
  }
  if (w.hrv_ms != null) {
    cards.push(`• card "Варіабельність пульсу" — number "${w.hrv_ms} мс" — small green mini line-graph — subtitle "HRV"`);
  }
  if (w.resting_hr != null) {
    cards.push(`• card "Пульс спокою" with a heart icon — number "${w.resting_hr} уд/хв" — subtitle "оптимально"`);
  }
  if (w.stress_avg != null) {
    cards.push(`• card "Стрес" — big number "${w.stress_avg}" — subtitle "середній" (violet accent)`);
  }
  if (w.steps != null) {
    cards.push(`• card "Кроки" with a run icon — number "${w.steps}" — small green bar chart`);
  }
  return cards;
}

function buildPrompt(w: WellnessRow, dateLabel: string): string {
  return `A clean, flat, straight-on mobile app dashboard screen — NO hand, NO phone body, NO bezel, NO room background. Output ONLY the app screen itself, tall portrait orientation (9:19), edge to edge, as a flat modern UI mockup (not a photo, no 3D, no reflections).

Style: near-black background (#0b0f14), rounded dark charcoal cards (#151b23) with thin subtle borders, modern geometric sans-serif, generous spacing, lots of negative space, premium and calm. Accent colors used sparingly ONLY in ring outlines, mini-charts and icons: soft green (#8fe3a0) and muted violet (#9b8cf2).

Header: a small sun icon and the title "Доброго ранку" with the date "${dateLabel}" in smaller muted text.

Render these cards with EXACTLY these Ukrainian labels and numbers — reproduce every digit precisely, do NOT invent or change any numbers:
${metricLines(w).join('\n')}

No bottom navigation bar, no company logo, no branding, no watermark, no photographic elements, no people, no extra text beyond the labels and numbers listed. High quality, sharp, legible.`;
}

/** Генерує PNG ранкового дашборду; null якщо немає ключа або генерація не вдалась. */
export async function generateBriefImage(w: WellnessRow, dateLabel: string): Promise<Buffer | null> {
  const client = ai();
  if (!client) return null;
  try {
    const res = await client.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: buildPrompt(w, dateLabel),
    });
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const data = part.inlineData?.data;
      if (data) return Buffer.from(data, 'base64');
    }
    return null;
  } catch (e) {
    console.error('generateBriefImage failed:', e instanceof Error ? e.message : e);
    return null;
  }
}
