import db from '../../db/index.js';

// ─── Дні ────────────────────────────────────────────────────────
export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const DAY_ORDER: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_UK: Record<Day, string> = { mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Нд' };
export function dayUk(d: Day): string { return DAY_UK[d]; }

export const PLAN_GOAL_PCT = Number(process.env.PLAN_GOAL_PCT) || 70;

export interface PlanItem {
  id: number; week_start: string; category: string; title: string;
  day: Day | null; done: number; done_at: string | null; recurring: number; sort: number;
}

// текст ("вівторок", "вівторок-середа", "чт") → ключ дня (перший збіг)
const DAY_TEXT: Array<[RegExp, Day]> = [
  [/понеділ|^пн$|monday|\bmon\b/i, 'mon'],
  [/вівтор|^вт$|tuesday|\btue\b/i, 'tue'],
  [/серед|^ср$|wednesday|\bwed\b/i, 'wed'],
  [/четвер|^чт$|thursday|\bthu\b/i, 'thu'],
  [/пʼятниц|пятниц|^пт$|friday|\bfri\b/i, 'fri'],
  [/субот|^сб$|saturday|\bsat\b/i, 'sat'],
  [/неділ|^нд$|sunday|\bsun\b/i, 'sun'],
];
export function dayKeyFromText(s?: string | null): Day | null {
  if (!s) return null;
  for (const [re, d] of DAY_TEXT) if (re.test(String(s).trim())) return d;
  return null;
}

// ─── Київський тиждень (чисті) ──────────────────────────────────
function kyivYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function kyivWeekdayMon0(d: Date): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', weekday: 'short' }).format(d);
  return ({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 } as Record<string, number>)[wd] ?? 0;
}
export function kyivWeekStart(d = new Date()): string {
  const monday = new Date(d.getTime() - kyivWeekdayMon0(d) * 86400000);
  return kyivYmd(monday);
}
export function nextWeekStart(ws = kyivWeekStart()): string {
  const monday = new Date(ws + 'T12:00:00+03:00');
  return kyivYmd(new Date(monday.getTime() + 7 * 86400000));
}
export function todayDayKey(d = new Date()): Day {
  return DAY_ORDER[kyivWeekdayMon0(d)];
}

// ─── CRUD (async / Postgres) ────────────────────────────────────
export async function addPlanItem(p: { week_start?: string; category: string; title: string; day?: Day | null; recurring?: number }): Promise<number> {
  const ws = p.week_start ?? kyivWeekStart();
  const r = await db.get<{ n: number }>('SELECT COALESCE(MAX(sort),0)+1 AS n FROM plan_items WHERE week_start=$1 AND category=$2', [ws, p.category]);
  const ins = await db.query<{ id: number }>(
    'INSERT INTO plan_items (week_start, category, title, day, recurring, sort) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [ws, p.category, p.title, p.day ?? null, p.recurring ?? 0, r?.n ?? 1],
  );
  return ins[0].id;
}

export async function togglePlanItem(id: number): Promise<boolean> {
  const row = await db.get<{ done: number }>('SELECT done FROM plan_items WHERE id=$1', [id]);
  if (!row) return false;
  const nd = row.done ? 0 : 1;
  await db.run('UPDATE plan_items SET done=$1, done_at=$2 WHERE id=$3', [nd, nd ? new Date().toISOString() : null, id]);
  return !!nd;
}

export async function getWeekItems(ws = kyivWeekStart()): Promise<PlanItem[]> {
  return db.query<PlanItem>('SELECT * FROM plan_items WHERE week_start=$1 ORDER BY category, sort, id', [ws]);
}

export async function findItemByTitle(query: string, ws = kyivWeekStart()): Promise<PlanItem | undefined> {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return (await getWeekItems(ws)).find(i => i.title.toLowerCase().includes(q));
}

// чиста: категорії з уже завантажених items (порядок появи)
export function categoriesOf(items: PlanItem[]): string[] {
  const seen = new Set<string>();
  for (const it of items) seen.add(it.category);
  return [...seen];
}

// ─── Повтори (стандартні щотижневі справи) ──────────────────────
export async function addRecurring(p: { category: string; title: string; day?: Day | null }): Promise<void> {
  const r = await db.get<{ n: number }>('SELECT COALESCE(MAX(sort),0)+1 AS n FROM plan_recurring WHERE category=$1', [p.category]);
  await db.run('INSERT INTO plan_recurring (category, title, day, sort) VALUES ($1,$2,$3,$4)', [p.category, p.title, p.day ?? null, r?.n ?? 1]);
}
export async function recurringTemplates(): Promise<Array<{ category: string; title: string; day: Day | null }>> {
  return db.query('SELECT category, title, day FROM plan_recurring ORDER BY sort, id');
}
export async function makeRecurring(id: number): Promise<boolean> {
  const r = await db.get<{ category: string; title: string; day: Day | null }>('SELECT category, title, day FROM plan_items WHERE id=$1', [id]);
  if (!r) return false;
  await addRecurring({ category: r.category, title: r.title, day: r.day });
  await db.run('UPDATE plan_items SET recurring=1 WHERE id=$1', [id]);
  return true;
}
// Ідемпотентно: засіває шаблони повторів у тиждень ws, якщо їх там ще нема
export async function ensureWeekSeeded(ws = kyivWeekStart()): Promise<number> {
  const has = await db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM plan_items WHERE week_start=$1 AND recurring=1', [ws]);
  if (has && has.n > 0) return 0;
  const tpls = await recurringTemplates();
  for (let i = 0; i < tpls.length; i++) {
    const t = tpls[i];
    await db.run('INSERT INTO plan_items (week_start, category, title, day, recurring, sort) VALUES ($1,$2,$3,$4,1,$5)', [ws, t.category, t.title, t.day ?? null, i]);
  }
  return tpls.length;
}

// ─── Перенос невиконаного ───────────────────────────────────────
export async function carryables(ws = kyivWeekStart()): Promise<PlanItem[]> {
  return db.query<PlanItem>('SELECT * FROM plan_items WHERE week_start=$1 AND done=0 AND recurring=0 ORDER BY category, sort, id', [ws]);
}
export async function carryItems(ids: number[], toWs: string): Promise<number> {
  let n = 0;
  for (const id of ids) {
    const r = await db.get<{ category: string; title: string; day: Day | null }>('SELECT category, title, day FROM plan_items WHERE id=$1', [id]);
    if (!r) continue;
    await addPlanItem({ week_start: toWs, category: r.category, title: r.title, day: r.day, recurring: 0 });
    n++;
  }
  return n;
}

// ─── Шкала успішності ───────────────────────────────────────────
export interface Score { total: number; done: number; pct: number; perCategory: Record<string, { done: number; total: number; pct: number }>; }
// чиста: рахує зі вже завантажених items
export function weekScore(items: PlanItem[]): Score {
  const per: Record<string, { done: number; total: number; pct: number }> = {};
  let done = 0;
  for (const it of items) {
    const c = (per[it.category] ??= { done: 0, total: 0, pct: 0 });
    c.total++;
    if (it.done) { c.done++; done++; }
  }
  for (const c of Object.values(per)) c.pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
  const total = items.length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0, perCategory: per };
}
// Ідемпотентний знімок тижня (для тренду/стріку)
export async function closeWeekIfNeeded(ws: string): Promise<void> {
  if (await db.get('SELECT 1 FROM plan_weeks WHERE week_start=$1', [ws])) return;
  const s = weekScore(await getWeekItems(ws));
  if (!s.total) return;
  await db.run('INSERT INTO plan_weeks (week_start, total, done, pct) VALUES ($1,$2,$3,$4)', [ws, s.total, s.done, s.pct]);
}
// Закрити всі минулі тижні, що мають пункти, але ще без знімка (стійко до рестартів)
export async function closePastWeeks(currentWs = kyivWeekStart()): Promise<void> {
  const weeks = await db.query<{ week_start: string }>('SELECT DISTINCT week_start FROM plan_items WHERE week_start<$1', [currentWs]);
  for (const w of weeks) await closeWeekIfNeeded(w.week_start);
}
export async function trendAndStreak(ws = kyivWeekStart(), goal = PLAN_GOAL_PCT): Promise<{ thisPct: number; lastPct: number | null; arrow: string; streak: number }> {
  const thisPct = weekScore(await getWeekItems(ws)).pct;
  const prev = await db.get<{ pct: number }>('SELECT pct FROM plan_weeks WHERE week_start<$1 ORDER BY week_start DESC LIMIT 1', [ws]);
  const lastPct = prev ? prev.pct : null;
  const arrow = lastPct == null ? '—' : thisPct > lastPct ? '↑' : thisPct < lastPct ? '↓' : '→';
  const rows = await db.query<{ pct: number }>('SELECT pct FROM plan_weeks ORDER BY week_start DESC');
  let streak = 0;
  for (const r of rows) { if (r.pct >= goal) streak++; else break; }
  return { thisPct, lastPct, arrow, streak };
}

// ─── Дрібні утиліти ─────────────────────────────────────────────
export function bar(pct: number, width = 5): string {
  const f = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return '▓'.repeat(f) + '░'.repeat(width - f);
}
// Українське відмінювання за числом: 1→one, 2-4→few, 5+→many (з урахуванням 11-14)
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
