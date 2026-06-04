import type { ParsedIntent } from '../types/index.js';
import { estimateDuration, splitTasks } from './durations.js';

function normalize(text: string): string {
  return text
    .replace(/^(так,?\s*|ок,?\s*|добре,?\s*|давай,?\s*|додай,?\s*)/i, '')
    .replace(/(\d{1,2})-(\d{2})(?!\d)(?!\s*числа)/g, '$1:$2') // не конвертуємо "12-15 числа"
    .trim();
}

// Поточна дата у Kyiv-таймзоні
function kyivToday(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const p: Record<string, number> = {};
  for (const pt of parts) if (pt.type !== 'literal') p[pt.type] = parseInt(pt.value);
  return { year: p.year, month: p.month - 1, day: p.day };
}

// Будує ISO-рядок у Kyiv-часі (UTC+3, Україна з 2022 постійно)
function kyivDatetime(year: number, month: number, day: number, hour: number, minute: number): string {
  const d = new Date(Date.UTC(year, month, day)); // нормалізує overflow дат
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(minute)}:00+03:00`;
}

function extractDateTime(text: string): { datetime: string | null; duration: number | null } {
  const lower = text.toLowerCase();
  const { year, month, day: baseDay } = kyivToday();

  let day = baseDay;
  if (lower.includes('після') && lower.includes('завтра')) day += 2;
  else if (lower.includes('завтра')) day += 1;

  let hour = 12, minute = 0, hasTimeOfDaySet = false;

  if (/вранці|на ранок|зранку/.test(lower))                               { hour = 9;  hasTimeOfDaySet = true; }
  else if (/в обід|на обід|опівдні/.test(lower))                          { hour = 13; hasTimeOfDaySet = true; }
  else if (/ввечері|на вечір|увечері|вечором/.test(lower))                 { hour = 19; hasTimeOfDaySet = true; }
  else if (/вночі|на ніч/.test(lower))                                     { hour = 22; hasTimeOfDaySet = true; }

  // Bare-hour: підтримуємо "о/в/на 18" (не перед год/хв)
  const timeMatch =
    lower.match(/(?:о|в|на)\s*(\d{1,2}):(\d{2})/) ??
    lower.match(/(\d{1,2}):(\d{2})/) ??
    lower.match(/(?:о|в|на)\s*(\d{1,2})(?!\d|:)(?!\s*(?:год|хв|хвилин))/);

  let datetime: string | null = null;
  if (timeMatch) {
    hour = parseInt(timeMatch[1]);
    minute = parseInt(timeMatch[2] ?? '0');
    datetime = kyivDatetime(year, month, day, hour, minute);
  } else if (hasTimeOfDaySet) {
    datetime = kyivDatetime(year, month, day, hour, minute);
  }

  let duration: number | null = null;
  if (lower.includes('на годину') || lower.match(/на 1 год/))        duration = 60;
  else if (lower.match(/на дві?\s*год|на 2\s*год/))                   duration = 120;
  else if (lower.match(/на\s+(\d+)\s*год/)) duration = parseInt(lower.match(/на\s+(\d+)\s*год/)![1]) * 60;
  else if (lower.match(/на\s+(\d+)\s*хв/))  duration = parseInt(lower.match(/на\s+(\d+)\s*хв/)![1]);
  else if (lower.includes('на півгодини'))   duration = 30;

  return { datetime, duration };
}

function extractTitle(text: string): string {
  return text
    .replace(/завтра|сьогодні|після\s*завтра/gi, '')
    .replace(/(?:о|в|на)\s*\d{1,2}:\d{2}/gi, '')
    .replace(/(?:о|в|на)\s*\d{1,2}(?!\d)/gi, '')
    .replace(/на\s+(?:\d+\s*(?:год|хв|хвилин)|годину|дві?\s*год|півгодини)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CompoundIntent {
  type: 'compound';
  events: ParsedIntent[];
}

// Чи є часова мітка (HH:MM або bare "о/в/на 18")
function hasTimeMarker(lower: string): boolean {
  return /\d{1,2}:\d{2}/.test(lower) || /(?:о|в|на)\s*\d{1,2}(?!\d|:)(?!\s*(?:год|хв|хвилин))/.test(lower);
}

// Чи схоже на query-фразу, а не задачу
function isQueryClause(part: string): boolean {
  return /^(покажи|що вийшло|показати|перевір|список|розклад)/.test(part.toLowerCase());
}

export function quickParseCompound(text: string): CompoundIntent | ParsedIntent | null {
  const cleaned = normalize(text);
  const lower = cleaned.toLowerCase();
  const hasTimeOfDay = /вранці|на ранок|зранку|в обід|на обід|опівдні|ввечері|на вечір|увечері|вечором|вночі|на ніч/.test(lower);
  const hasPlanuй = /(заплануй|заплануйте|внеси|постав|додай)/.test(lower);

  if (!(hasTimeMarker(lower) || hasTimeOfDay) || !hasPlanuй) return quickParse(text);

  const { datetime } = extractDateTime(cleaned);
  if (!datetime) return quickParse(text);

  const core = cleaned
    .replace(/^(на вечір|ввечері|вранці|на ранок|сьогодні|завтра)\s*/i, '')
    .replace(/\s*(заплануй|заплануйте|постав|внеси|додай)\s*$/i, '')
    .trim();

  const parts = splitTasks(core).filter(p => !isQueryClause(p));
  if (parts.length <= 1) return quickParse(text);

  let cursor = new Date(datetime);
  const events: ParsedIntent[] = parts.map(part => {
    const duration = estimateDuration(part);
    const start = new Date(cursor);
    cursor = new Date(cursor.getTime() + duration * 60000);
    return { type: 'event' as const, title: part, datetime: start.toISOString(), duration };
  });

  return { type: 'compound', events };
}

export function quickParse(text: string): ParsedIntent | null {
  const cleaned = normalize(text);
  const lower = cleaned.toLowerCase();

  // CALENDAR QUERIES
  if (
    /що.{0,20}(сьогодні|сьогод|на день|в мене)/.test(lower) ||
    /розклад.{0,15}(сьогодні|на день|на сьогодні)/.test(lower) ||
    /план.{0,10}(на день|на сьогодні|сьогодні)/.test(lower) ||
    /що.{0,5}(план|маю|заплановано)/.test(lower) ||
    /^(сьогодні|на сьогодні|мій день|мій розклад|розклад|план на день)\??$/.test(lower)
  ) return { type: 'query', title: '__today__' };

  if (/що.{0,15}завтра/.test(lower) || /розклад.{0,10}завтра/.test(lower) || /^завтра\??$/.test(lower))
    return { type: 'query', title: '__tomorrow__' };
  if (/що.{0,15}(тижн|тиждень|week)/.test(lower) || /розклад.{0,10}тижн/.test(lower))
    return { type: 'query', title: '__week__' };

  // ВІДМІНА / ПЕРЕНОС
  if (/^(відміни|скасуй|відмінити|undo)/.test(lower))
    return { type: 'query', title: '__undo__' };
  if (/перенес|перенос|змін.{0,5}час|посунь/.test(lower))
    return { type: 'query', title: '__reschedule__' };

  // НОТАТКА
  if (/^(запиши|запис|нотатка|нотатку|збережи|зафіксуй|занотуй)[:\s]/.test(lower) || /^(запиши|збережи)\s+(ідею|нотатку|думку|запис)/.test(lower)) {
    const title = cleaned
      .replace(/^(запиши|запис|нотатка|нотатку|збережи|зафіксуй|занотуй)[:\s]*/i, '')
      .replace(/^(ідею|нотатку|думку|запис)[:\s]*/i, '')
      .trim();
    return { type: 'note', title };
  }

  // НАГАДУВАННЯ
  if (/^нагадай|^нагад /.test(lower)) {
    const { datetime } = extractDateTime(cleaned);
    const title = cleaned.replace(/^нагадай\s*/i, '').replace(/(?:о|в|на)\s*\d{1,2}(?::\d{2})?/i, '').trim();
    if (!datetime) return null;
    return { type: 'reminder', title, datetime };
  }

  // ЗАДАЧА
  if (/^задача[:\s]|^треба\s|^потрібно\s|^зроби\s|^додай\s+задач/.test(lower)) {
    const title = cleaned.replace(/^задача[:\s]*/i, '').replace(/^треба\s+/i, '').trim();
    return { type: 'task', title };
  }

  // ПОДІЯ: часова мітка + контекстне слово
  const hasEventWord = /(зустріч|дзвінок|мітинг|нарада|зідзвон|стендап|call|meet|подія|запис|прийом|пробіжка|пробіж|тренування|зал)/.test(lower);
  const hasDateWord = /(завтра|сьогодні|після\s*завтра)/.test(lower);
  const hasAction = /(заплануй|заплануйте|внеси|постав|додай)/.test(lower);
  const hasTimeOfDay = /вранці|на ранок|зранку|в обід|на обід|опівдні|ввечері|на вечір|увечері|вечором|вночі|на ніч/.test(lower);

  if ((hasTimeMarker(lower) || hasTimeOfDay) && (hasEventWord || hasDateWord || hasAction)) {
    const { datetime, duration } = extractDateTime(cleaned);
    if (!datetime) return null;
    const title = extractTitle(cleaned);
    return { type: 'event', title, datetime, duration: duration ?? 60 };
  }

  return null;
}
