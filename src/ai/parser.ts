import type { ParsedIntent } from '../types/index.js';
import { estimateDuration, splitTasks } from './durations.js';

// Прибирає вступні слова і нормалізує "15-30" → "15:30"
function normalize(text: string): string {
  return text
    .replace(/^(так,?\s*|ок,?\s*|добре,?\s*|давай,?\s*|додай,?\s*)/i, '')
    .replace(/(\d{1,2})-(\d{2})(?!\d)/g, '$1:$2')
    .trim();
}

function extractDateTime(text: string): { datetime: string | null; duration: number | null } {
  const lower = text.toLowerCase();
  const now = new Date();
  let baseDate = new Date(now);

  if (lower.includes('завтра'))           baseDate.setDate(now.getDate() + 1);
  else if (lower.includes('післязавтра')) baseDate.setDate(now.getDate() + 2);

  // Час доби
  if (lower.includes('вранці') || lower.includes('на ранок') || lower.includes('зранку'))
    baseDate.setHours(9, 0, 0, 0);
  else if (lower.includes('в обід') || lower.includes('на обід') || lower.includes('опівдні'))
    baseDate.setHours(13, 0, 0, 0);
  else if (lower.includes('ввечері') || lower.includes('на вечір') || lower.includes('увечері') || lower.includes('вечором'))
    baseDate.setHours(19, 0, 0, 0);
  else if (lower.includes('вночі') || lower.includes('на ніч'))
    baseDate.setHours(22, 0, 0, 0);

  const timeMatch =
    lower.match(/(?:о|в|на)\s*(\d{1,2}):(\d{2})/) ??
    lower.match(/(\d{1,2}):(\d{2})/) ??
    lower.match(/(?:о|в)\s*(\d{1,2})(?!\d|:)/);

  let datetime: string | null = null;
  if (timeMatch) {
    const h = parseInt(timeMatch[1]);
    const m = parseInt(timeMatch[2] ?? '0');
    baseDate.setHours(h, m, 0, 0);
    // Сервер в UTC, користувач думає в Kyiv (UTC+3) — зсуваємо на -3год
    baseDate = new Date(baseDate.getTime() - 3 * 3600000);
  }
  const hasTimeOfDay = /вранці|на ранок|зранку|в обід|на обід|опівдні|ввечері|на вечір|увечері|вечором|вночі|на ніч/.test(lower);
  if (timeMatch || hasTimeOfDay) {
    datetime = baseDate.toISOString();
  }

  let duration: number | null = null;
  const lower2 = lower;
  if (lower2.includes('на годину') || lower2.match(/на 1 год/))         duration = 60;
  else if (lower2.match(/на дві?\s*год|на 2\s*год/))                    duration = 120;
  else if (lower2.match(/на\s+(\d+)\s*год/))  duration = parseInt(lower2.match(/на\s+(\d+)\s*год/)![1]) * 60;
  else if (lower2.match(/на\s+(\d+)\s*хв/))   duration = parseInt(lower2.match(/на\s+(\d+)\s*хв/)![1]);
  else if (lower2.includes('на півгодини'))    duration = 30;

  return { datetime, duration };
}

function extractTitle(text: string): string {
  return text
    .replace(/завтра|сьогодні|після\s*завтра/gi, '')
    .replace(/(?:о|в|на)\s*\d{1,2}:\d{2}/gi, '')
    .replace(/(?:о|в)\s*\d{1,2}(?!\d)/gi, '')
    .replace(/на\s+(?:\d+\s*(?:год|хв|хвилин)|годину|дві?\s*год|півгодини)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CompoundIntent {
  type: 'compound';
  events: ParsedIntent[];
}

export function quickParseCompound(text: string): CompoundIntent | ParsedIntent | null {
  const cleaned = normalize(text);
  const lower = cleaned.toLowerCase();
  const hasTimeOfDay = /вранці|на ранок|зранку|в обід|на обід|опівдні|ввечері|на вечір|увечері|вечором|вночі|на ніч/.test(lower);
  const hasTime = /\d{1,2}:\d{2}/.test(cleaned);
  const hasPlanuй = /(заплануй|заплануйте|внеси|постав|додай)/.test(lower);

  if (!(hasTime || hasTimeOfDay) || !hasPlanuй) return quickParse(text);

  // Витягуємо базовий час
  const { datetime } = extractDateTime(cleaned);
  if (!datetime) return quickParse(text);

  // Прибираємо часові маркери та дієслово-тригер, беремо суть
  const core = cleaned
    .replace(/^(на вечір|ввечері|вранці|на ранок|сьогодні|завтра)\s*/i, '')
    .replace(/\s*(заплануй|заплануйте|постав|внеси|додай)\s*$/i, '')
    .trim();

  const parts = splitTasks(core);
  if (parts.length <= 1) return quickParse(text);

  // Плануємо послідовно
  let cursor = new Date(datetime);
  const events: ParsedIntent[] = parts.map(part => {
    const duration = estimateDuration(part);
    const start = new Date(cursor);
    cursor = new Date(cursor.getTime() + duration * 60000);
    return {
      type: 'event' as const,
      title: part,
      datetime: start.toISOString(),
      duration,
    };
  });

  return { type: 'compound', events };
}

export function quickParse(text: string): ParsedIntent | null {
  const cleaned = normalize(text);
  const lower = cleaned.toLowerCase();

  // CALENDAR QUERIES — відповідаємо без AI
  if (/що.{0,15}(сьогодні|сьогод)/.test(lower) || /розклад.{0,10}(сьогодні|на день)/.test(lower) || lower === 'сьогодні' || lower === 'розклад')
    return { type: 'query', title: '__today__' };
  if (/що.{0,15}завтра/.test(lower) || /розклад.{0,10}завтра/.test(lower))
    return { type: 'query', title: '__tomorrow__' };
  if (/що.{0,15}(тижн|тиждень|week)/.test(lower))
    return { type: 'query', title: '__week__' };

  // НАГАДУВАННЯ
  if (/^нагадай|^нагад /.test(lower)) {
    const { datetime } = extractDateTime(cleaned);
    const title = cleaned.replace(/^нагадай\s*/i, '').replace(/(?:о|в)\s*\d{1,2}(?::\d{2})?/i, '').trim();
    if (!datetime) return null;
    return { type: 'reminder', title, datetime };
  }

  // ВІДМІНА
  if (/^(відміни|скасуй|відмінити|undo)/.test(lower)) {
    return { type: 'query', title: '__undo__' };
  }

  // ПЕРЕНЕСТИ ПОДІЮ — поки не підтримується
  if (/перенес|перенос|змін.{0,5}час|посунь/.test(lower)) {
    return { type: 'query', title: '__reschedule__' };
  }

  // НОТАТКА → Notion
  if (/^(запиши|запис|нотатка|нотатку|збережи|зафіксуй|занотуй)[:\s]/.test(lower) || /^(запиши|збережи)\s+(ідею|нотатку|думку|запис)/.test(lower)) {
    const title = cleaned
      .replace(/^(запиши|запис|нотатка|нотатку|збережи|зафіксуй|занотуй)[:\s]*/i, '')
      .replace(/^(ідею|нотатку|думку|запис)[:\s]*/i, '')
      .trim();
    return { type: 'note', title };
  }

  // ЗАДАЧА
  if (/^задача[:\s]|^треба\s|^потрібно\s|^зроби\s|^додай\s+задач/.test(lower)) {
    const title = cleaned.replace(/^задача[:\s]*/i, '').replace(/^треба\s+/i, '').trim();
    return { type: 'task', title };
  }

  // ПОДІЯ: є час + ключове слово або дата
  const hasTime = /\d{1,2}:\d{2}/.test(cleaned);
  const hasEventWord = /(зустріч|дзвінок|мітинг|нарада|зідзвон|стендап|call|meet|подія|сто|запис|прийом)/.test(lower);
  const hasDateWord = /(завтра|сьогодні|після\s*завтра)/.test(lower);
  const hasDodai = /^додай\s/.test(lower);
  const hasPlanuй = /(заплануй|заплануйте|внеси|постав|додай)/.test(lower);
  const hasTimeOfDay2 = /вранці|на ранок|зранку|в обід|на обід|опівдні|ввечері|на вечір|увечері|вечором|вночі|на ніч/.test(lower);

  if ((hasTime || hasTimeOfDay2) && (hasEventWord || hasDateWord || hasDodai || hasPlanuй)) {
    const { datetime, duration } = extractDateTime(cleaned);
    if (!datetime) return null;
    const title = extractTitle(cleaned);
    return { type: 'event', title, datetime, duration: duration ?? 60 };
  }

  return null;
}
