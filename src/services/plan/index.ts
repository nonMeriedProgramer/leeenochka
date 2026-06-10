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
  for (const [re, d] of DAY_TEXT) if (re.test(s.trim())) return d;
  return null;
}

// ─── Київський тиждень ──────────────────────────────────────────
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

// ─── CRUD ───────────────────────────────────────────────────────
export function addPlanItem(p: { week_start?: string; category: string; title: string; day?: Day | null; recurring?: number }): number {
  const ws = p.week_start ?? kyivWeekStart();
  const sort = (db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS n FROM plan_items WHERE week_start=? AND category=?').get(ws, p.category) as { n: number }).n;
  const info = db.prepare('INSERT INTO plan_items (week_start, category, title, day, recurring, sort) VALUES (?,?,?,?,?,?)')
    .run(ws, p.category, p.title, p.day ?? null, p.recurring ?? 0, sort);
  return Number(info.lastInsertRowid);
}

export function togglePlanItem(id: number): boolean {
  const row = db.prepare('SELECT done FROM plan_items WHERE id=?').get(id) as { done: number } | undefined;
  if (!row) return false;
  const nd = row.done ? 0 : 1;
  db.prepare('UPDATE plan_items SET done=?, done_at=? WHERE id=?').run(nd, nd ? new Date().toISOString() : null, id);
  return !!nd;
}

export function getWeekItems(ws = kyivWeekStart()): PlanItem[] {
  return db.prepare('SELECT * FROM plan_items WHERE week_start=? ORDER BY category, sort, id').all(ws) as PlanItem[];
}

export function categoriesOf(ws = kyivWeekStart()): string[] {
  return (db.prepare('SELECT category, MIN(id) m FROM plan_items WHERE week_start=? GROUP BY category ORDER BY m').all(ws) as Array<{ category: string }>).map(r => r.category);
}

export function findItemByTitle(query: string, ws = kyivWeekStart()): PlanItem | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return getWeekItems(ws).find(i => i.title.toLowerCase().includes(q));
}

// ─── Повтори (стандартні щотижневі справи) ──────────────────────
export function addRecurring(p: { category: string; title: string; day?: Day | null }): void {
  const sort = (db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS n FROM plan_recurring WHERE category=?').get(p.category) as { n: number }).n;
  db.prepare('INSERT INTO plan_recurring (category, title, day, sort) VALUES (?,?,?,?)').run(p.category, p.title, p.day ?? null, sort);
}
export function recurringTemplates(): Array<{ category: string; title: string; day: Day | null }> {
  return db.prepare('SELECT category, title, day FROM plan_recurring ORDER BY sort, id').all() as Array<{ category: string; title: string; day: Day | null }>;
}
export function makeRecurring(id: number): boolean {
  const r = db.prepare('SELECT category, title, day FROM plan_items WHERE id=?').get(id) as { category: string; title: string; day: Day | null } | undefined;
  if (!r) return false;
  addRecurring({ category: r.category, title: r.title, day: r.day });
  db.prepare('UPDATE plan_items SET recurring=1 WHERE id=?').run(id);
  return true;
}
// Ідемпотентно: засіває шаблони повторів у тиждень ws, якщо їх там ще нема
export function ensureWeekSeeded(ws = kyivWeekStart()): number {
  const has = (db.prepare('SELECT COUNT(*) n FROM plan_items WHERE week_start=? AND recurring=1').get(ws) as { n: number }).n;
  if (has) return 0;
  const tpls = recurringTemplates();
  const ins = db.prepare('INSERT INTO plan_items (week_start, category, title, day, recurring, sort) VALUES (?,?,?,?,1,?)');
  tpls.forEach((t, i) => ins.run(ws, t.category, t.title, t.day ?? null, i));
  return tpls.length;
}

// ─── Перенос невиконаного ───────────────────────────────────────
export function carryables(ws = kyivWeekStart()): PlanItem[] {
  return db.prepare('SELECT * FROM plan_items WHERE week_start=? AND done=0 AND recurring=0 ORDER BY category, sort, id').all(ws) as PlanItem[];
}
export function carryItems(ids: number[], toWs: string): number {
  let n = 0;
  for (const id of ids) {
    const r = db.prepare('SELECT category, title, day FROM plan_items WHERE id=?').get(id) as { category: string; title: string; day: Day | null } | undefined;
    if (!r) continue;
    addPlanItem({ week_start: toWs, category: r.category, title: r.title, day: r.day, recurring: 0 });
    n++;
  }
  return n;
}

// ─── Шкала успішності ───────────────────────────────────────────
export interface Score { total: number; done: number; pct: number; perCategory: Record<string, { done: number; total: number; pct: number }>; }
export function weekScore(ws = kyivWeekStart()): Score {
  const items = getWeekItems(ws);
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
export function closeWeekIfNeeded(ws: string): void {
  if (db.prepare('SELECT 1 FROM plan_weeks WHERE week_start=?').get(ws)) return;
  const s = weekScore(ws);
  if (!s.total) return;
  db.prepare('INSERT INTO plan_weeks (week_start, total, done, pct) VALUES (?,?,?,?)').run(ws, s.total, s.done, s.pct);
}
// Закрити всі минулі тижні, що мають пункти, але ще без знімка (стійко до рестартів)
export function closePastWeeks(currentWs = kyivWeekStart()): void {
  const weeks = db.prepare('SELECT DISTINCT week_start FROM plan_items WHERE week_start<?').all(currentWs) as Array<{ week_start: string }>;
  for (const w of weeks) closeWeekIfNeeded(w.week_start);
}
export function trendAndStreak(ws = kyivWeekStart(), goal = PLAN_GOAL_PCT): { thisPct: number; lastPct: number | null; arrow: string; streak: number } {
  const thisPct = weekScore(ws).pct;
  const prev = db.prepare('SELECT pct FROM plan_weeks WHERE week_start<? ORDER BY week_start DESC LIMIT 1').get(ws) as { pct: number } | undefined;
  const lastPct = prev ? prev.pct : null;
  const arrow = lastPct == null ? '—' : thisPct > lastPct ? '↑' : thisPct < lastPct ? '↓' : '→';
  const rows = db.prepare('SELECT pct FROM plan_weeks ORDER BY week_start DESC').all() as Array<{ pct: number }>;
  let streak = 0;
  for (const r of rows) { if (r.pct >= goal) streak++; else break; }
  return { thisPct, lastPct, arrow, streak };
}

// ─── Прогрес-смужка ─────────────────────────────────────────────
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
