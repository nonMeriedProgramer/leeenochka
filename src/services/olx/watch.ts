// ─── Моніторинг OLX → окрема Telegram-група ───────────────────────────
// Кілька разів на добу тягнемо свіжу видачу по кожному пошуку, лишаємо ті
// оголошення, де в заголовку чи описі є наші слова й ціна в межах, і постимо
// їх великою картинкою. Новизну визначаємо таблицею olx_seen, а не датою:
// OLX сортує «найновіші» за часом підняття, тож старе оголошення щодня знову
// виринає нагорі. Перший прогін нового пошуку лише засіває таблицю — інакше
// в групу одразу впаде півсотні оголошень.

import type { Api } from 'grammy';
import db from '../../db/index.js';
import { fetchOffers, type OlxOffer, type OlxSearch } from './api.js';

// ─── Що шукаємо ───────────────────────────────────────────────────────
// ЗАГЛУШКА: заміни на свої пошуки. query — те, що шукає сам OLX (він шукає
// і по опису); words — слова, наявність яких ми перевіряємо самі; ціна опційна.
export const SEARCHES: OlxSearch[] = [
  { query: 'велосипед', words: ['карбон'], priceFrom: 5000, priceTo: 20000 },
];

/** Оголошення старші за це ігноруємо: OLX постійно піднімає старі. */
const FRESH_DAYS = 14;

/** Курс для оголошень не в гривні — правити тут, коли поїде. */
const RATES: Record<string, number> = { UAH: 1, EUR: 45, USD: 41 };

function normalize(s: string): string {
  return s.toLowerCase().replace(/[’'`]/g, "'").replace(/\s+/g, ' ');
}

/** Які саме слова знайшлись у заголовку або описі — вони йдуть у підпис поста. */
export function matchedWords(offer: OlxOffer, words: string[]): string[] {
  const text = normalize(`${offer.title} ${offer.description}`);
  return words.filter((w) => text.includes(normalize(w)));
}

export function priceOk(offer: OlxOffer, search: OlxSearch): boolean {
  if (search.priceFrom == null && search.priceTo == null) return true;
  if (!offer.price) return false; // «Безкоштовно»/«Обмін» — не те, що шукаємо з рамками ціни
  const uah = offer.price.value * (RATES[offer.price.currency] ?? 1);
  if (search.priceFrom != null && uah < search.priceFrom) return false;
  if (search.priceTo != null && uah > search.priceTo) return false;
  return true;
}

function isFresh(offer: OlxOffer): boolean {
  return offer.createdAt > Date.now() - FRESH_DAYS * 86_400_000;
}

export interface OlxHit { offer: OlxOffer; words: string[]; search: OlxSearch }

/** Відбір без походів у БД і Telegram — щоб те саме міг використати /olx_check. */
export function selectHits(offers: OlxOffer[], search: OlxSearch): OlxHit[] {
  const hits: OlxHit[] = [];
  for (const offer of offers) {
    const words = matchedWords(offer, search.words);
    if (words.length && priceOk(offer, search) && isFresh(offer)) hits.push({ offer, words, search });
  }
  return hits;
}

const kyivTime = new Intl.DateTimeFormat('uk-UA', {
  timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function formatHit({ offer, words }: OlxHit): string {
  const facts = [
    offer.price ? `💰 ${esc(offer.price.label)}` : '💰 ціни немає',
    offer.city ? `📍 ${esc(offer.city)}` : null,
    offer.createdAt ? `🕒 ${kyivTime.format(new Date(offer.createdAt))}` : null,
  ].filter(Boolean).join(' · ');

  return `🔎 ${esc(words.join(', '))}\n<b>${esc(offer.title)}</b>\n${facts}\n${offer.url}`;
}

/** Фото з OLX інколи не віддається — тоді краще текст, ніж загублене оголошення. */
async function postHit(api: Api, chatId: number, hit: OlxHit): Promise<void> {
  const caption = formatHit(hit);
  if (hit.offer.photo) {
    try {
      await api.sendPhoto(chatId, hit.offer.photo, { caption, parse_mode: 'HTML' });
      return;
    } catch (e) {
      console.error('olx sendPhoto failed, falling back to text:', e instanceof Error ? e.message : e);
    }
  }
  await api.sendMessage(chatId, caption, { parse_mode: 'HTML' });
}

export function olxWatchEnabled(): boolean {
  return !!process.env.OLX_CHANNEL_ID;
}

export interface OlxRunResult { checked: number; posted: number; seeded: number; errors: string[] }

export async function runOlxWatch(api: Api): Promise<OlxRunResult> {
  const chatId = Number(process.env.OLX_CHANNEL_ID);
  const result: OlxRunResult = { checked: 0, posted: 0, seeded: 0, errors: [] };
  if (!Number.isFinite(chatId)) { result.errors.push('OLX_CHANNEL_ID не задано'); return result; }

  for (const search of SEARCHES) {
    let offers: OlxOffer[];
    try {
      offers = await fetchOffers(search);
    } catch (e) {
      result.errors.push(`«${search.query}»: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    result.checked += offers.length;

    // Порожня історія пошуку — засіваємо мовчки, щоб не завалити групу старим.
    const known = await db.get<{ n: string }>('SELECT count(*) AS n FROM olx_seen WHERE query = $1', [search.query]);
    const firstRun = Number(known?.n ?? 0) === 0;

    for (const hit of selectHits(offers, search)) {
      const seen = await db.get('SELECT 1 FROM olx_seen WHERE offer_id = $1', [hit.offer.id]);
      if (seen) continue;

      if (!firstRun) {
        try {
          await postHit(api, chatId, hit);
          result.posted++;
        } catch (e) {
          result.errors.push(`пост ${hit.offer.id}: ${e instanceof Error ? e.message : String(e)}`);
          continue; // не позначаємо побаченим — спробуємо наступного прогону
        }
      } else {
        result.seeded++;
      }

      await db.run(
        `INSERT INTO olx_seen (offer_id, query, title, posted) VALUES ($1, $2, $3, $4)
         ON CONFLICT (offer_id) DO NOTHING`,
        [hit.offer.id, search.query, hit.offer.title.slice(0, 200), !firstRun],
      );
    }
  }
  return result;
}
