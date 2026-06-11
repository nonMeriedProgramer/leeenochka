import { Pool } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (Supabase Postgres connection string)');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase вимагає SSL
  max: 5,
});

pool.on('error', (e) => console.error('PG pool error:', e.message));

// ─── Тонкий async-інтерфейс (заміна синхронному better-sqlite3) ──
async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}
async function get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  const res = await pool.query(sql, params);
  return res.rows[0] as T | undefined;
}
async function run(sql: string, params: any[] = []): Promise<void> {
  await pool.query(sql, params);
}

// Створення схеми — викликати раз на старті (initDb у index.ts)
export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memories (
      id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      kind       TEXT NOT NULL CHECK (kind IN ('fact','preference','routine','person','place','correction')),
      content    TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'inferred',
      hit_count  INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      fire_at    TEXT NOT NULL,
      text       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','canceled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS plan_items (
      id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      week_start TEXT NOT NULL,
      category   TEXT NOT NULL,
      title      TEXT NOT NULL,
      day        TEXT,
      done       INTEGER NOT NULL DEFAULT 0,
      done_at    TEXT,
      recurring  INTEGER NOT NULL DEFAULT 0,
      sort       INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS plan_recurring (
      id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      category   TEXT NOT NULL,
      title      TEXT NOT NULL,
      day        TEXT,
      sort       INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS plan_weeks (
      week_start TEXT PRIMARY KEY,
      total      INTEGER NOT NULL,
      done       INTEGER NOT NULL,
      pct        INTEGER NOT NULL,
      closed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('✅ DB ready (Postgres)');
}

const db = { query, get, run };
export default db;
