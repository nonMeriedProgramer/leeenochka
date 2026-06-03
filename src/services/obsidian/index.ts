// Obsidian Local REST API plugin — https://github.com/coddingtonbear/obsidian-local-rest-api
import https from 'node:https';

function baseUrl(): string {
  return (process.env.OBSIDIAN_URL ?? 'https://127.0.0.1:27124').replace(/\/$/, '');
}

export function isObsidianConnected(): boolean {
  return !!process.env.OBSIDIAN_API_KEY;
}

function request(method: string, path: string, body?: string): Promise<{ ok: boolean; status: number; text: string }> {
  return new Promise((resolve) => {
    const url = new URL(`${baseUrl()}/vault/${path}`);
    const payload = body ? Buffer.from(body, 'utf8') : undefined;

    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method,
      rejectUnauthorized: false, // self-signed cert плагіна
      headers: {
        Authorization: `Bearer ${process.env.OBSIDIAN_API_KEY ?? ''}`,
        'Content-Type': 'text/markdown',
        ...(payload ? { 'Content-Length': payload.length } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ ok: (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0, text });
      });
    });

    req.on('error', () => resolve({ ok: false, status: 0, text: 'connection refused' }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false, status: 0, text: 'timeout' }); });
    if (payload) req.end(payload); else req.end();
  });
}

export async function createNote(path: string, content: string): Promise<boolean> {
  return (await request('PUT', path, content)).ok;
}

export async function appendToNote(path: string, content: string): Promise<boolean> {
  return (await request('PATCH', path, '\n' + content)).ok;
}

export async function readNote(path: string): Promise<string | null> {
  const r = await request('GET', path);
  return r.ok ? r.text : null;
}

export async function createDailyNote(content: string): Promise<boolean> {
  const today = new Date().toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' })
    .split('.').reverse().join('-');
  return appendToNote(`Daily/${today}.md`, content);
}

export async function saveIdea(title: string, content: string): Promise<boolean> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safe = title.replace(/[/\\:*?"<>|]/g, '').slice(0, 60);
  const md = `# ${title}\n\n${content}\n\n*Збережено Leeenochka ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}*\n`;
  return createNote(`Leeenochka/${safe}-${ts}.md`, md);
}
