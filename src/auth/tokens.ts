import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tokensPath = path.join(__dirname, '../../data/tokens.json');

interface AppleCredentials {
  email: string;
  password: string;
}

interface TokenStore {
  apple?: AppleCredentials;
}

function load(): TokenStore {
  if (!fs.existsSync(tokensPath)) return {};
  return JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
}

function save(data: TokenStore) {
  const dir = path.dirname(tokensPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tokensPath, JSON.stringify(data, null, 2));
}

export function getAppleCredentials(): AppleCredentials | null {
  // Спершу з .env, потім з файлу
  if (process.env.APPLE_ID_EMAIL && process.env.APPLE_APP_PASSWORD) {
    return { email: process.env.APPLE_ID_EMAIL, password: process.env.APPLE_APP_PASSWORD };
  }
  return load().apple ?? null;
}

export function saveAppleCredentials(email: string, password: string) {
  save({ ...load(), apple: { email, password } });
}

export function clearAppleCredentials() {
  const data = load();
  delete data.apple;
  save(data);
}
