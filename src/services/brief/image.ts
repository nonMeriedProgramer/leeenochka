import type { WellnessRow } from '../training/garmin.js';

// Картинка ранкового брифу через OpenRouter Image API (POST /api/v1/images).
// Малює темний дашборд у стилі AlterMe з РЕАЛЬНИХ даних Garmin. Недетерміновано
// (числа може іноді спотворити), тому це доповнення до тексту брифу, а не заміна:
// текст завжди йде як підпис (caption). Модель — налаштовувана через env,
// дефолт google/gemini-2.5-flash-image (Nano Banana — сильний у тексті/цифрах).

const IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image';

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

interface OpenRouterImageResponse {
  data?: Array<{ b64_json?: string; media_type?: string }>;
}

/** Генерує PNG ранкового дашборду; null якщо немає ключа або генерація не вдалась. */
export async function generateBriefImage(w: WellnessRow, dateLabel: string): Promise<Buffer | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Leeenochka',
      },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt: buildPrompt(w, dateLabel) }),
    });
    if (!res.ok) {
      console.error('generateBriefImage HTTP', res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const json = await res.json() as OpenRouterImageResponse;
    const b64 = json.data?.[0]?.b64_json;
    return b64 ? Buffer.from(b64, 'base64') : null;
  } catch (e) {
    console.error('generateBriefImage failed:', e instanceof Error ? e.message : e);
    return null;
  }
}
