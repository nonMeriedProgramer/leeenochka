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

    -- ── Тренування (силова програма) ─────────────────────────────
    CREATE TABLE IF NOT EXISTS training_maxes (
      exercise   TEXT PRIMARY KEY,
      rv6        NUMERIC NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS training_state (
      id         INTEGER PRIMARY KEY DEFAULT 1,
      started_on DATE,
      CONSTRAINT training_state_singleton CHECK (id = 1)
    );

    CREATE TABLE IF NOT EXISTS training_logs (
      id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      log_date           DATE NOT NULL,
      week               INTEGER,
      day_key            TEXT,
      exercise           TEXT NOT NULL,
      weight             NUMERIC,
      reps_json          JSONB NOT NULL DEFAULT '[]'::jsonb,
      rir                TEXT,
      note               TEXT,
      source             TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','garmin')),
      garmin_activity_id TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_training_logs_date ON training_logs (log_date DESC);

    -- Кеш підтягнутих із Garmin активностей; processed=false → бот ще не запитав підтвердження
    CREATE TABLE IF NOT EXISTS garmin_activities (
      garmin_id     TEXT PRIMARY KEY,
      activity_date DATE,
      type          TEXT,
      name          TEXT,
      raw           JSONB,
      parsed        JSONB,
      processed     BOOLEAN NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Обрані дні залу на тиждень (для дошки/нагадувань і «як минулого тижня»)
    CREATE TABLE IF NOT EXISTS gym_schedule (
      week_start TEXT PRIMARY KEY,
      days       JSONB NOT NULL DEFAULT '[]'::jsonb
    );

    -- Щоденні дані відновлення з Garmin (сон, HRV, body battery, ...) — пише tools/garmin_sync.py
    CREATE TABLE IF NOT EXISTS garmin_wellness (
      date                DATE PRIMARY KEY,
      resting_hr          INTEGER,
      hrv_ms              INTEGER,
      sleep_hours         NUMERIC,
      sleep_score         INTEGER,
      body_battery_high   INTEGER,
      body_battery_low    INTEGER,
      body_battery_current INTEGER,
      stress_avg          INTEGER,
      steps               INTEGER,
      training_readiness  INTEGER,
      raw                 JSONB,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE garmin_wellness ADD COLUMN IF NOT EXISTS body_battery_current INTEGER;

    -- Закриваємо таблиці від публічного REST API Supabase (anon-ключ).
    -- Бот — власник таблиць (роль postgres) — RLS обходить, тож працює як і раніше.
    ALTER TABLE memories          ENABLE ROW LEVEL SECURITY;
    ALTER TABLE messages          ENABLE ROW LEVEL SECURITY;
    ALTER TABLE reminders         ENABLE ROW LEVEL SECURITY;
    ALTER TABLE plan_items        ENABLE ROW LEVEL SECURITY;
    ALTER TABLE plan_recurring    ENABLE ROW LEVEL SECURITY;
    ALTER TABLE plan_weeks        ENABLE ROW LEVEL SECURITY;
    ALTER TABLE training_maxes    ENABLE ROW LEVEL SECURITY;
    ALTER TABLE training_state    ENABLE ROW LEVEL SECURITY;
    ALTER TABLE training_logs     ENABLE ROW LEVEL SECURITY;
    ALTER TABLE garmin_activities ENABLE ROW LEVEL SECURITY;
    ALTER TABLE gym_schedule      ENABLE ROW LEVEL SECURITY;
    ALTER TABLE garmin_wellness   ENABLE ROW LEVEL SECURITY;
  `);
  console.log('✅ DB ready (Postgres)');
}

const db = { query, get, run };
export default db;
