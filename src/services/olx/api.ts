// ─── OLX: публічний JSON-API оголошень ────────────────────────────────
// Ходимо через node:http2, а не fetch, і це не примха: CloudFront перед OLX
// ріже HTTP/1.1 і віддає 403 «Request blocked» навіть з домашнього IP.
// Вбудований http2 віддає ті самі дані, що й браузер, тож зайвих залежностей
// (cheerio, puppeteer, імперсонація TLS) не потрібно.

import http2 from 'node:http2';

const HOST = 'https://www.olx.ua';
const TIMEOUT_MS = 30_000;

const BROWSER_HEADERS: Record<string, string> = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'uk-UA,uk;q=0.9,en;q=0.8',
};

/** OLX/CloudFront відбиває запит (403/429) — мине само, це не наша помилка в коді. */
export class OlxBlockedError extends Error {}

export interface OlxPrice { value: number; currency: string; label: string }

export interface OlxOffer {
  id: number;
  title: string;
  description: string;   // без HTML-тегів
  url: string;
  createdAt: number;     // epoch ms
  city: string | null;
  price: OlxPrice | null;
  photo: string | null;  // велике фото (1000×700) для sendPhoto
  isShop: boolean;
}

export interface OlxSearch {
  query: string;
  words: string[];
  priceFrom?: number;
  priceTo?: number;
}

async function olxGet<T>(path: string): Promise<T> {
  const session = http2.connect(HOST);
  try {
    return await new Promise<T>((resolve, reject) => {
      const done = (fn: () => void) => { clearTimeout(timer); fn(); };
      const timer = setTimeout(() => { req.close(); reject(new Error(`OLX: таймаут ${path}`)); }, TIMEOUT_MS);

      session.on('error', (e) => done(() => reject(e)));
      const req = session.request({ ':method': 'GET', ':path': path, ...BROWSER_HEADERS });

      let status = 0;
      req.on('response', (h) => { status = Number(h[':status']); });
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('error', (e) => done(() => reject(e)));
      req.on('end', () => done(() => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (status === 403 || status === 429) {
          reject(new OlxBlockedError(`OLX: запит відбито (${status}) — CloudFront не пустив`));
        } else if (status !== 200) {
          reject(new Error(`OLX ${status} ${path}`));
        } else {
          try { resolve(JSON.parse(body) as T); } catch { reject(new Error('OLX: відповідь не JSON')); }
        }
      }));
      req.end();
    });
  } finally {
    session.close();
  }
}

type J = Record<string, any>;

const stripHtml = (s: unknown): string =>
  typeof s === 'string' ? s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';

function parsePrice(params: J[]): OlxPrice | null {
  const p = params.find((x) => x?.key === 'price')?.value;
  if (!p || typeof p.value !== 'number') return null;
  return { value: p.value, currency: String(p.currency ?? 'UAH'), label: String(p.label ?? p.value) };
}

/** OLX віддає шаблон .../image;s={width}x{height} — без підстановки посилання неробоче. */
function parsePhoto(photos: J[]): string | null {
  const link = photos?.[0]?.link;
  return typeof link === 'string' ? link.replace('{width}', '1000').replace('{height}', '700') : null;
}

function parseOffer(o: J): OlxOffer | null {
  if (typeof o?.id !== 'number' || typeof o.url !== 'string') return null;
  const created = Date.parse(o.created_time ?? '');
  return {
    id: o.id,
    title: stripHtml(o.title),
    description: stripHtml(o.description),
    url: o.url,
    createdAt: Number.isFinite(created) ? created : 0,
    city: o.location?.city?.name ?? null,
    price: parsePrice(Array.isArray(o.params) ? o.params : []),
    photo: parsePhoto(Array.isArray(o.photos) ? o.photos : []),
    isShop: o.business === true,
  };
}

export async function fetchOffers(search: OlxSearch, limit = 50): Promise<OlxOffer[]> {
  const q = new URLSearchParams({
    offset: '0',
    limit: String(limit),
    query: search.query,
    sort_by: 'created_at:desc',
  });
  // Саме таке написання ключів OLX і розуміє; варіант search[filter_float_price:from] він мовчки ігнорує.
  if (search.priceFrom != null) q.set('filter_float_price:from', String(search.priceFrom));
  if (search.priceTo != null) q.set('filter_float_price:to', String(search.priceTo));

  const data = await olxGet<{ data?: J[] }>(`/api/v1/offers/?${q}`);
  return (data.data ?? []).map(parseOffer).filter((o): o is OlxOffer => o !== null);
}
