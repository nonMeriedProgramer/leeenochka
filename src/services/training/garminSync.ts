import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const tail = (s: string, n = 15) => s.trim().split('\n').slice(-n).join('\n');

/** Запускає tools/garmin_sync.py прямо в контейнері бота; повертає stdout+stderr для діагностики. */
export async function runGarminSync(): Promise<string> {
  const script = path.resolve(process.cwd(), 'tools', 'garmin_sync.py');
  try {
    const { stdout, stderr } = await execFileAsync('python3', [script, '--days', '3'], {
      timeout: 120_000,
      env: process.env,
    });
    return (stdout || stderr || '').trim();
  } catch (e) {
    // Справжня причина Python-помилки — в КІНЦІ трейсбеку, тож віддаємо хвіст stderr.
    const err = e as { stderr?: string; stdout?: string; message?: string };
    throw new Error(tail(err.stderr || err.stdout || err.message || String(e)));
  }
}
