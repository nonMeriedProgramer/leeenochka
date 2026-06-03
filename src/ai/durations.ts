// Таблиця типових тривалостей (хвилини)
export const TASK_DURATIONS: Array<{ keywords: string[]; minutes: number; label?: string }> = [
  { keywords: ['прати', 'прання', 'постирати', 'білі речі', 'одяг'],        minutes: 30 },
  { keywords: ['прогулянка', 'прогулятись', 'погуляти', 'пройтись'],        minutes: 45 },
  { keywords: ['зал', 'тренування', 'тренуватись', 'спортзал', 'фітнес'],   minutes: 90 },
  { keywords: ['біг', 'пробіжка', 'бігти'],                                 minutes: 40 },
  { keywords: ['обід', 'сніданок', 'вечеря', 'поїсти', 'поїхати поїсти'],  minutes: 30 },
  { keywords: ['готувати', 'приготувати', 'готування', 'зварити'],          minutes: 45 },
  { keywords: ['магазин', 'покупки', 'купити продукти', 'супермаркет'],     minutes: 40 },
  { keywords: ['сто', 'автосервіс', 'ремонт авто'],                         minutes: 90 },
  { keywords: ['душ', 'помитись', 'ванна'],                                 minutes: 20 },
  { keywords: ['медитація', 'медитувати'],                                   minutes: 15 },
  { keywords: ['читати', 'почитати', 'книга'],                              minutes: 30 },
  { keywords: ['дзвінок', 'зателефонувати', 'подзвонити'],                 minutes: 20 },
  { keywords: ['зустріч', 'мітинг', 'нарада', 'стендап'],                  minutes: 60 },
  { keywords: ['лікар', 'лікарня', 'клініка', 'прийом'],                   minutes: 60 },
  { keywords: ['прибирання', 'прибрати', 'помити підлогу'],                 minutes: 60 },
  { keywords: ['стрижка', 'перукарня', 'барбер'],                           minutes: 45 },
];

export function estimateDuration(text: string): number {
  const lower = text.toLowerCase();
  for (const entry of TASK_DURATIONS) {
    if (entry.keywords.some(k => lower.includes(k))) return entry.minutes;
  }
  return 30; // дефолт — 30 хвилин
}

// Розбиває "X і Y та Z" на окремі підзадачі
export function splitTasks(text: string): string[] {
  return text
    .split(/\s+(?:і|й|та|також|плюс|,)\s+/i)
    .map(t => t.trim())
    .filter(t => t.length > 2);
}
