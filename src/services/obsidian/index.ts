// Obsidian Local REST API plugin — https://github.com/coddingtonbear/obsidian-local-rest-api
// Встанови плагін в Obsidian, увімкни, скопіюй API key в OBSIDIAN_API_KEY

function baseUrl(): string {
  return (process.env.OBSIDIAN_URL ?? 'https://127.0.0.1:27124').replace(/\/$/, '');
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.OBSIDIAN_API_KEY ?? ''}`,
    'Content-Type': 'text/markdown',
  };
}

export function isObsidianConnected(): boolean {
  return !!process.env.OBSIDIAN_API_KEY;
}

async function request(method: string, path: string, body?: string): Promise<{ ok: boolean; status: number; text: string }> {
  const url = `${baseUrl()}/vault/${path}`;
  const res = await fetch(url, {
    method,
    headers: headers(),
    body,
    // @ts-ignore — Node 18+ підтримує, але типи можуть скаржитись
    dispatcher: undefined,
  }).catch(() => null);
  if (!res) return { ok: false, status: 0, text: 'connection refused' };
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

export async function createNote(path: string, content: string): Promise<boolean> {
  const r = await request('PUT', path, content);
  return r.ok;
}

export async function appendToNote(path: string, content: string): Promise<boolean> {
  const r = await request('PATCH', path, '\n' + content);
  return r.ok;
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
