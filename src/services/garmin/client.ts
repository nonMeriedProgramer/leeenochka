// ─── Garmin Connect (неофіційний API) — лише читання ──────────────────
// Логін у Garmin (MFA, обхід Cloudflare) робить ОДИН раз локально python-скрипт
// на python-garminconnect 0.3.x — він видає DI OAuth-токени
// {di_token, di_refresh_token, di_client_id}. Сюди вони приходять через env
// GARMIN_TOKEN_B64 (base64 від того JSON), далі живуть у Postgres (garmin_auth)
// і ротуються тут: access-токен (JWT, ~добу) оновлюється refresh-токеном.
//
// Запити за даними — звичайний HTTPS з Bearer і заголовками мобільного
// застосунку, рівно як у бібліотеці (python теж ходить у connectapi plain
// requests, без TLS-імперсонації; імперсонація потрібна лише самому логіну).
//
// GARMIN_TOKEN_FILE (локальна розробка) — зберігати токени у файлі замість БД,
// сумісно з ~/.garminconnect/garmin_tokens.json python-бібліотеки.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import db from '../../db/index.js';

const CONNECT_API = 'https://connectapi.garmin.com';
const DI_TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';

const NATIVE_HEADERS: Record<string, string> = {
  'User-Agent': 'GCM-Android-5.23',
  'X-Garmin-User-Agent': 'com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0',
  'X-Garmin-Paired-App-Version': '10861',
  'X-Garmin-Client-Platform': 'Android',
  'X-App-Ver': '10861',
  'X-Lang': 'en',
  'X-GCExperience': 'GC5',
  'Accept-Language': 'en-US,en;q=0.9',
};

interface Tokens { di_token: string; di_refresh_token: string; di_client_id: string }

/** Токени мертві — потрібен новий логін (python login_garmin.py) і новий GARMIN_TOKEN_B64. */
export class GarminAuthError extends Error {}
/** Garmin/Cloudflare відбиває запити (429/403) — мине само, логін не допоможе. */
export class GarminBlockedError extends Error {}

export function garminConfigured(): boolean {
  return !!(process.env.GARMIN_TOKEN_B64 || process.env.GARMIN_TOKEN_FILE);
}

// ─── Сховище токенів ──────────────────────────────────────────────────
let cache: Tokens | null = null;
let refreshing: Promise<Tokens> | null = null;
let displayName: string | null = null;

function valid(t: Partial<Tokens> | null | undefined): t is Tokens {
  return !!(t?.di_token && t.di_refresh_token && t.di_client_id);
}

async function saveTokens(t: Tokens, seedHash?: string): Promise<void> {
  const file = process.env.GARMIN_TOKEN_FILE;
  if (file) {
    writeFileSync(file, JSON.stringify(t));
    return;
  }
  await db.run(
    `INSERT INTO garmin_auth (id, tokens, seed_hash, updated_at) VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET tokens = EXCLUDED.tokens,
       seed_hash = COALESCE(EXCLUDED.seed_hash, garmin_auth.seed_hash), updated_at = now()`,
    [JSON.stringify(t), seedHash ?? null],
  );
}

async function loadTokens(): Promise<Tokens> {
  if (cache) return cache;

  const file = process.env.GARMIN_TOKEN_FILE;
  if (file) {
    const t = JSON.parse(readFileSync(file, 'utf8')) as Partial<Tokens>;
    if (!valid(t)) throw new GarminAuthError(`${file}: немає di_token/di_refresh_token/di_client_id`);
    return (cache = t);
  }

  const b64 = process.env.GARMIN_TOKEN_B64?.trim();
  const row = await db.get<{ tokens: string; seed_hash: string | null }>(
    'SELECT tokens, seed_hash FROM garmin_auth WHERE id = 1',
  );

  // Свіжий GARMIN_TOKEN_B64 (новий логін) перемагає старий ротований ланцюжок у БД.
  // Порівнюємо хеш env зі збереженим — інакше після кожного рестарту ми б
  // затирали ротовані токени тим самим уже мертвим bootstrap-значенням з env.
  if (b64) {
    const seedHash = createHash('sha256').update(b64).digest('hex');
    if (!row || row.seed_hash !== seedHash) {
      let seed: Partial<Tokens>;
      try {
        seed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } catch {
        throw new GarminAuthError('GARMIN_TOKEN_B64 не розпарсився (очікую base64 від JSON)');
      }
      if (!valid(seed)) throw new GarminAuthError('GARMIN_TOKEN_B64: немає di_token/di_refresh_token/di_client_id');
      await saveTokens(seed, seedHash);
      return (cache = seed);
    }
  }
  if (row) {
    const t = JSON.parse(row.tokens) as Partial<Tokens>;
    if (valid(t)) return (cache = t);
  }
  throw new GarminAuthError('Немає токенів Garmin: задай GARMIN_TOKEN_B64');
}

function jwtPayload(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function expiresSoon(token: string): boolean {
  const exp = jwtPayload(token)?.exp;
  return typeof exp === 'number' && Date.now() / 1000 > exp - 900;
}

async function doRefresh(t: Tokens): Promise<Tokens> {
  const res = await fetch(DI_TOKEN_URL, {
    method: 'POST',
    headers: {
      ...NATIVE_HEADERS,
      Authorization: `Basic ${Buffer.from(`${t.di_client_id}:`).toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: t.di_client_id,
      refresh_token: t.di_refresh_token,
    }),
  });
  if (res.status === 429 || res.status === 403) throw new GarminBlockedError(`Garmin: оновлення токена відбито (${res.status})`);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== 'string') {
    // Лише код помилки: error_description у Garmin містить сам refresh-токен.
    throw new GarminAuthError(`Garmin: токен більше не оновлюється (${res.status} ${String(data.error ?? '')}) — потрібен новий логін`);
  }
  const clientId = jwtPayload(data.access_token)?.client_id;
  const next: Tokens = {
    di_token: data.access_token,
    di_refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : t.di_refresh_token,
    di_client_id: typeof clientId === 'string' ? clientId : t.di_client_id,
  };
  await saveTokens(next);
  cache = next;
  return next;
}

/**
 * Одне оновлення на всіх: refresh-токен ротується, тож два паралельні оновлення
 * тим самим токеном — друге отримало б invalid_grant і вбило б весь ланцюжок.
 */
function refresh(t: Tokens): Promise<Tokens> {
  refreshing ??= doRefresh(t).finally(() => { refreshing = null; });
  return refreshing;
}

// ─── Запити ────────────────────────────────────────────────────────────
export async function garminGet<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  let t = await loadTokens();
  if (refreshing) t = await refreshing;
  else if (expiresSoon(t.di_token)) t = await refresh(t);

  const url = new URL(CONNECT_API + path);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));
  const call = (tok: Tokens) => fetch(url, {
    headers: { ...NATIVE_HEADERS, Authorization: `Bearer ${tok.di_token}`, Accept: 'application/json' },
  });

  let res = await call(t);
  if (res.status === 401) res = await call(await refresh(t));
  if (res.status === 429 || res.status === 403) throw new GarminBlockedError(`Garmin: запит відбито (${res.status}) ${path}`);
  if (res.status === 204) return {} as T;
  if (!res.ok) throw new Error(`Garmin ${res.status} ${path}`);
  return (await res.json()) as T;
}

/** UUID профілю — частина шляху для сну й денної статистики. */
export async function garminDisplayName(): Promise<string> {
  if (displayName) return displayName;
  const prof = await garminGet<{ displayName?: string }>('/userprofile-service/socialProfile');
  if (!prof.displayName) throw new GarminAuthError('Garmin: профіль без displayName');
  return (displayName = prof.displayName);
}
