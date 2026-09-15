// ─── Ранковий бриф: альбом із 3 панелей + підпис ─────────────────────
// Сон · Готовність · Сьогодні. Кожна панель рендериться окремо: якщо одна
// впала, решта все одно йде. Жодної панелі — лише текст. Дані — gatherBriefData
// (Garmin, intervals.icu, погода, план), кожне джерело теж незалежне.

import { InputFile, InputMediaBuilder, type Api } from 'grammy';
import { gatherBriefData, type BriefData } from './data.js';
import { renderSleepPanel } from './panelSleep.js';
import { renderReadinessPanel } from './panelReadiness.js';
import { renderDayPanel } from './panelDay.js';
import { pickGreeting, pickQuote } from './phrases.js';
import { GarminAuthError, garminConfigured } from '../garmin/client.js';

export async function briefCaption(d: BriefData): Promise<string> {
  const g = d.garmin;
  const lines = [await pickGreeting(), '', await pickQuote(), '', '📅 План на сьогодні:'];

  if (d.plan.length) {
    for (const p of d.plan) lines.push(p.kind === 'gym' ? `🏋️ ${p.title}` : `• ${p.time ? `${p.time} ` : ''}${p.title}`);
  } else {
    lines.push('нічого не заплановано.');
  }

  // Мертвий токен — дія потрібна саме від тебе; блок/збій мине сам, не шумимо.
  if (g.fatal instanceof GarminAuthError && garminConfigured()) {
    lines.push('', '⚠️ Garmin відключився — сон і готовність сьогодні з intervals.icu. Потрібен новий логін (login_garmin.py → GARMIN_TOKEN_B64).');
  }

  const text = lines.join('\n');
  return text.length > 1024 ? `${text.slice(0, 1021)}…` : text;
}

export interface RenderedBrief { panels: Array<{ name: string; png: Buffer }>; errors: string[] }

export async function renderBrief(d: BriefData): Promise<RenderedBrief> {
  const errors: string[] = [];
  const jobs: Array<[string, (x: BriefData) => Promise<Buffer>]> = [
    ['сон', renderSleepPanel], ['готовність', renderReadinessPanel], ['сьогодні', renderDayPanel],
  ];
  const panels: RenderedBrief['panels'] = [];
  for (const [name, fn] of jobs) {
    try {
      panels.push({ name, png: await fn(d) });
    } catch (e) {
      console.error(`brief panel ${name} failed:`, e);
      errors.push(`панель «${name}»: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { panels, errors };
}

export async function sendBriefAlbum(api: Api, chatId: number, panels: RenderedBrief['panels'], caption: string): Promise<void> {
  if (panels.length >= 2) {
    const media = panels.map((p, i) => InputMediaBuilder.photo(new InputFile(p.png, `brief-${i + 1}.png`), i === 0 ? { caption } : {}));
    await api.sendMediaGroup(chatId, media);
  } else if (panels.length === 1) {
    await api.sendPhoto(chatId, new InputFile(panels[0].png, 'brief.png'), { caption });
  } else {
    await api.sendMessage(chatId, caption);
  }
}

/** Текст ранкового брифу (без картинок). */
export async function buildMorningBrief(): Promise<string> {
  return briefCaption(await gatherBriefData());
}

export async function sendMorningBrief(api: Api, chatId: number): Promise<void> {
  const data = await gatherBriefData();
  const caption = await briefCaption(data);
  const { panels } = await renderBrief(data);
  try {
    await sendBriefAlbum(api, chatId, panels, caption);
  } catch (e) {
    console.error('sendMorningBrief album failed, falling back to text:', e instanceof Error ? e.message : e);
    await api.sendMessage(chatId, caption);
  }
}
