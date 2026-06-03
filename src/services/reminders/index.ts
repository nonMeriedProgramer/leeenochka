import https from 'node:https';
import { setDefaultResultOrder } from 'node:dns';
import { v4 as uuid } from 'uuid';
import { getAppleCredentials } from '../../auth/tokens.js';

setDefaultResultOrder('ipv4first');

export function isRemindersConnected(): boolean {
  return getAppleCredentials() !== null;
}

function basicAuth(): string {
  const creds = getAppleCredentials();
  if (!creds) throw new Error('Apple не підключено — напиши /setup');
  return 'Basic ' + Buffer.from(`${creds.email}:${creds.password}`).toString('base64');
}

function propfind(url: string, depth: 0 | 1, body: string, attempt = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = Buffer.from(body, 'utf8');

    const retry = (err: Error) => {
      if (attempt < 3) setTimeout(() => propfind(url, depth, body, attempt + 1).then(resolve, reject), 500 * 2 ** attempt);
      else reject(err);
    };

    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: 'PROPFIND', servername: u.hostname,
      headers: { Authorization: basicAuth(), 'Content-Type': 'application/xml; charset=utf-8', Depth: String(depth), 'Content-Length': payload.length, Connection: 'close' },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const sc = res.statusCode ?? 0;
        if ([301, 302, 307, 308].includes(sc) && res.headers.location)
          return propfind(new URL(res.headers.location, url).toString(), depth, body, 0).then(resolve, reject);
        if (sc === 207 || sc === 200) return resolve(text);
        if (sc >= 500 || sc === 429) return retry(new Error(`HTTP ${sc}`));
        reject(new Error(`PROPFIND -> HTTP ${sc}: ${text.slice(0, 200)}`));
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

let _remindersUrl: string | null = null;

async function getRemindersUrl(): Promise<string> {
  if (_remindersUrl) return _remindersUrl;

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

  const homeNorm = homeUrl.endsWith('/') ? homeUrl : homeUrl + '/';
  for (const block of s3.split(/<(?:[a-z0-9]+:)?response[ >]/i).slice(1)) {
    if (!/VTODO/i.test(block)) continue;
    if (/VEVENT/i.test(block)) continue; // skip combined calendars, want Reminders-only
    const href = block.match(/<(?:[a-z0-9]+:)?href[^>]*>\s*([^<]+?)\s*<\/(?:[a-z0-9]+:)?href>/i)?.[1]?.trim();
    if (!href) continue;
    const calUrl = new URL(href, homeUrl).toString();
    const calNorm = calUrl.endsWith('/') ? calUrl : calUrl + '/';
    if (calNorm === homeNorm) continue;
    console.log('Found reminders list:', calUrl);
    _remindersUrl = calUrl.endsWith('/') ? calUrl : calUrl + '/';
    return _remindersUrl;
  }

  // Fallback: будь-який VTODO
  for (const block of s3.split(/<(?:[a-z0-9]+:)?response[ >]/i).slice(1)) {
    if (!/VTODO/i.test(block)) continue;
    const href = block.match(/<(?:[a-z0-9]+:)?href[^>]*>\s*([^<]+?)\s*<\/(?:[a-z0-9]+:)?href>/i)?.[1]?.trim();
    if (!href) continue;
    const calUrl = new URL(href, homeUrl).toString();
    const calNorm = calUrl.endsWith('/') ? calUrl : calUrl + '/';
    if (calNorm === homeNorm) continue;
    _remindersUrl = calUrl.endsWith('/') ? calUrl : calUrl + '/';
    return _remindersUrl;
  }

  throw new Error('iCloud: не знайдено списку Reminders (VTODO)');
}

function put(url: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = Buffer.from(body, 'utf8');
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname,
      method: 'PUT', servername: u.hostname,
      headers: { Authorization: basicAuth(), 'Content-Type': 'text/calendar', 'Content-Length': payload.length, 'If-None-Match': '*', Connection: 'close' },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode < 300) resolve();
        else reject(new Error(`PUT -> HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function toVTODO(uid: string, title: string, due?: Date, notes?: string): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
  const now = fmt(new Date());
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Leeenochka//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `CREATED:${now}`,
    `LAST-MODIFIED:${now}`,
    `SUMMARY:${esc(title)}`,
    'STATUS:NEEDS-ACTION',
    due ? `DUE:${fmt(due)}` : '',
    notes ? `DESCRIPTION:${esc(notes)}` : '',
    'END:VTODO',
    'END:VCALENDAR',
    '',
  ].filter((l, i, a) => l !== '' || i === a.length - 1).join('\r\n');
}

export async function createReminder(reminder: {
  title: string;
  due?: string;
  notes?: string;
}): Promise<{ uid: string; title: string }> {
  const url = await getRemindersUrl();
  const uid = uuid();
  const due = reminder.due ? new Date(reminder.due) : undefined;
  await put(`${url}${uid}.ics`, toVTODO(uid, reminder.title, due, reminder.notes));
  return { uid, title: reminder.title };
}

export async function getReminders(): Promise<Array<{ title: string; due: string; status: string }>> {
  if (!isRemindersConnected()) return [];
  try {
    const url = await getRemindersUrl();
    const res = await new Promise<string>((resolve, reject) => {
      const u = new URL(url);
      const body = `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop><d:getetag/><c:calendar-data/></d:prop>
        <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO">
          <c:prop-filter name="STATUS"><c:text-match>NEEDS-ACTION</c:text-match></c:prop-filter>
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

    return (res.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/g) ?? []).map(ics => ({
      title: ics.match(/SUMMARY:(.+)/)?.[1]?.trim() ?? '(без назви)',
      due: ics.match(/DUE[^:]*:(.+)/)?.[1]?.trim() ?? '',
      status: ics.match(/STATUS:(.+)/)?.[1]?.trim() ?? '',
    }));
  } catch { return []; }
}
