import https from 'node:https';
import { setDefaultResultOrder } from 'node:dns';
import { v4 as uuid } from 'uuid';
import { getAppleCredentials } from '../../auth/tokens.js';

// Форсуємо IPv4 (Windows IPv6 може ламати TLS до iCloud shard-серверів)
setDefaultResultOrder('ipv4first');

export function isCalendarConnected(): boolean {
  return getAppleCredentials() !== null;
}

function basicAuth(): string {
  const creds = getAppleCredentials();
  if (!creds) throw new Error('Apple Calendar не підключено — напиши /setup');
  return 'Basic ' + Buffer.from(`${creds.email}:${creds.password}`).toString('base64');
}

// PROPFIND через node:https з retry + backoff (уникаємо undici SSL-проблем)
function propfind(url: string, depth: 0 | 1, body: string, attempt = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = Buffer.from(body, 'utf8');
    const auth = basicAuth();

    const retry = (err: Error) => {
      if (attempt < 3) {
        setTimeout(() => propfind(url, depth, body, attempt + 1).then(resolve, reject), 500 * 2 ** attempt);
      } else {
        reject(err);
      }
    };

    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'PROPFIND',
      servername: u.hostname,
      headers: {
        Authorization: auth,
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: String(depth),
        'Content-Length': payload.length,
        Connection: 'close',
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const sc = res.statusCode ?? 0;
        if ([301, 302, 307, 308].includes(sc) && res.headers.location) {
          return propfind(new URL(res.headers.location, url).toString(), depth, body, 0).then(resolve, reject);
        }
        if (sc === 207 || sc === 200) return resolve(text);
        if (sc >= 500 || sc === 400 || sc === 429) return retry(new Error(`HTTP ${sc}`));
        reject(new Error(`PROPFIND ${u.hostname} -> HTTP ${sc}: ${text.slice(0, 200)}`));
      });
    });

    req.setTimeout(15000, () => req.destroy(new Error(`Timeout: ${url}`)));
    req.on('error', retry);
    req.end(payload);
  });
}

function hrefUnder(xml: string, tag: string): string | null {
  const block = xml.match(new RegExp(`<[^>]*\\b${tag}\\b[^>]*>([\\s\\S]*?)</[^>]*\\b${tag}\\b>`, 'i'));
  const scope = block ? block[1] : xml;
  return scope.match(/<(?:[a-z0-9]+:)?href[^>]*>\s*([^<]+?)\s*<\/(?:[a-z0-9]+:)?href>/i)?.[1]?.trim() ?? null;
}

let _calendarUrl: string | null = null;

async function getCalendarUrl(): Promise<string> {
  if (_calendarUrl) return _calendarUrl;

  const s1 = await propfind('https://caldav.icloud.com/', 0,
    `<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`);
  const principal = hrefUnder(s1, 'current-user-principal');
  if (!principal) throw new Error('iCloud: не знайдено principal');

  const principalUrl = new URL(principal, 'https://caldav.icloud.com/').toString();
  const s2 = await propfind(principalUrl, 0,
    `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`);
  const homeHref = hrefUnder(s2, 'calendar-home-set');
  if (!homeHref) throw new Error('iCloud: не знайдено calendar-home-set');

  const homeUrl = new URL(homeHref, principalUrl).toString();
  const s3 = await propfind(homeUrl, 1,
    `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>`);

  // Логуємо всі знайдені календарі
  const homeNorm = homeUrl.endsWith('/') ? homeUrl : homeUrl + '/';
  for (const block of s3.split(/<(?:[a-z0-9]+:)?response[ >]/i).slice(1)) {
    if (!/VEVENT/i.test(block)) continue;
    const href = block.match(/<(?:[a-z0-9]+:)?href[^>]*>\s*([^<]+?)\s*<\/(?:[a-z0-9]+:)?href>/i)?.[1]?.trim();
    if (!href) continue;
    const calUrl = new URL(href, homeUrl).toString();
    const calNorm = calUrl.endsWith('/') ? calUrl : calUrl + '/';
    // Пропускаємо якщо це сам контейнер (home set), беремо тільки дочірні
    if (calNorm === homeNorm) continue;
    console.log('Found calendar:', calUrl);
    _calendarUrl = calUrl.endsWith('/') ? calUrl : calUrl + '/';
    return _calendarUrl;
  }
  // Fallback: показуємо що знайшли
  console.log('homeUrl:', homeUrl);
  console.log('s3 snippet:', s3.slice(0, 500));
  throw new Error('iCloud: не знайдено жодного VEVENT-календаря');
}

function put(url: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = Buffer.from(body, 'utf8');
    console.log('PUT', url);
    const req = https.request({
      hostname: u.hostname, port: u.port || 443,
      path: u.pathname, method: 'PUT',
      servername: u.hostname,
      headers: {
        Authorization: basicAuth(),
        'Content-Type': 'text/calendar',
        'Content-Length': payload.length,
        'If-None-Match': '*',
        Connection: 'close',
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        console.log('PUT response', res.statusCode, text.slice(0, 300));
        if (res.statusCode && res.statusCode < 300) resolve();
        else reject(new Error(`PUT -> HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

// За скільки хвилин до події дзвонить нативна оповістка iPhone (Apple Calendar) — за годину
const ALARM_LEAD_MIN = Number(process.env.EVENT_ALARM_MINUTES) || 60;

function toICS(uid: string, title: string, start: Date, end: Date, description?: string): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
  const now = fmt(new Date());
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Leeenochka//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `CREATED:${now}`,
    `LAST-MODIFIED:${now}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(title)}`,
    'SEQUENCE:0',
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    description ? `DESCRIPTION:${esc(description)}` : '',
    // Нативна оповістка на iPhone за ALARM_LEAD_MIN хв до початку
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(title)}`,
    `TRIGGER:-PT${ALARM_LEAD_MIN}M`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].filter((l, i, a) => l !== '' || i === a.length - 1).join('\r\n');
}

export async function createEvent(event: {
  title: string; start: string; durationMinutes: number; description?: string;
}): Promise<{ uid: string; title: string; href: string }> {
  const calUrl = await getCalendarUrl();
  const uid = uuid();
  const start = new Date(event.start);
  const end = new Date(start.getTime() + event.durationMinutes * 60000);
  const href = `${calUrl}${uid}.ics`;
  await put(href, toICS(uid, event.title, start, end, event.description));
  return { uid, title: event.title, href };
}

// Видаляє подію за повним URL ресурсу (.ics)
export function deleteEvent(href: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(href);
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname,
      method: 'DELETE', servername: u.hostname,
      headers: { Authorization: basicAuth(), Connection: 'close' },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode && res.statusCode < 300) || res.statusCode === 404) resolve();
        else reject(new Error(`DELETE -> HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Знаходить події, чия назва містить query (для переносу/відміни)
export async function findEventByTitle(
  query: string, days = 7,
): Promise<Array<{ title: string; start: string; end: string; href: string }>> {
  const q = query.trim().toLowerCase();
  const events = await getUpcomingEventsWithRefs(days);
  const exact = events.filter(e => e.title.toLowerCase().includes(q));
  if (exact.length || !q) return exact;
  // запасний варіант — співпадіння по окремих словах
  const words = q.split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return [];
  return events.filter(e => words.some(w => e.title.toLowerCase().includes(w)));
}

// "20260603T153000Z" → "2026-06-03T15:30:00Z"
function parseICalDate(raw: string): string {
  const s = raw.trim().replace(/[^\dTZ]/g, '');
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  const date = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  const time = `${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}`;
  return s.endsWith('Z') ? `${date}T${time}Z` : `${date}T${time}`;
}

// Події у вікні `days` разом із href кожного ресурсу (потрібен для видалення/переносу)
export async function getUpcomingEventsWithRefs(
  days = 1,
): Promise<Array<{ title: string; start: string; end: string; href: string }>> {
  if (!isCalendarConnected()) return [];
  try {
    const calUrl = await getCalendarUrl();
    // Опівніч у Kyiv (UTC+3)
    const now = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' }) + 'T00:00:00+03:00');
    const end = new Date(now.getTime() + days * 24 * 3600000);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const res = await new Promise<string>((resolve, reject) => {
      const u = new URL(calUrl);
      const body = `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop><d:getetag/><c:calendar-data/></d:prop>
        <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
          <c:time-range start="${fmt(now)}" end="${fmt(end)}"/>
        </c:comp-filter></c:comp-filter></c:filter>
      </c:calendar-query>`;
      const payload = Buffer.from(body, 'utf8');
      const req = https.request({
        hostname: u.hostname, port: u.port || 443, path: u.pathname,
        method: 'REPORT', servername: u.hostname,
        headers: { Authorization: basicAuth(), 'Content-Type': 'application/xml', Depth: '1', 'Content-Length': payload.length, Connection: 'close' },
      }, (r) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); });
      req.on('error', reject);
      req.end(payload);
    });

    // Парсимо по <response> блоках, щоб привʼязати href до події
    const out: Array<{ title: string; start: string; end: string; href: string }> = [];
    for (const block of res.split(/<(?:[a-z0-9]+:)?response[ >]/i).slice(1)) {
      const ics = block.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/)?.[0];
      if (!ics) continue;
      const hrefPath = block.match(/<(?:[a-z0-9]+:)?href[^>]*>\s*([^<]+?)\s*<\/(?:[a-z0-9]+:)?href>/i)?.[1]?.trim();
      if (!hrefPath) continue;
      out.push({
        title: ics.match(/SUMMARY:(.+)/)?.[1]?.trim() ?? '(без назви)',
        start: parseICalDate(ics.match(/DTSTART[^:]*:(.+)/)?.[1]?.trim() ?? ''),
        end:   parseICalDate(ics.match(/DTEND[^:]*:(.+)/)?.[1]?.trim()   ?? ''),
        href:  new URL(hrefPath, calUrl).toString(),
      });
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
  } catch { return []; }
}

export async function getUpcomingEvents(days = 1): Promise<Array<{ title: string; start: string; end: string }>> {
  return (await getUpcomingEventsWithRefs(days)).map(({ title, start, end }) => ({ title, start, end }));
}

export async function findFreeSlot(durationMinutes: number, afterDate = new Date()): Promise<Date | null> {
  const events = await getUpcomingEvents(7);
  let c = new Date(afterDate);
  const m = c.getMinutes();
  if (m > 0) c.setMinutes(m <= 30 ? 30 : 60, 0, 0);
  for (let i = 0; i < 48 * 7; i++) {
    const h = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', hour: 'numeric', hour12: false }).format(c));
    if (h >= 9 && h < 18) {
      const e = new Date(c.getTime() + durationMinutes * 60000);
      if (!events.some(ev => { const s = new Date(ev.start).getTime(), en = new Date(ev.end).getTime(); return !isNaN(s) && c.getTime() < en && e.getTime() > s; })) return c;
    }
    c = new Date(c.getTime() + 30 * 60000);
  }
  return null;
}
