import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/** Запускає tools/garmin_sync.py прямо в контейнері бота; повертає stdout+stderr для діагностики. */
export async function runGarminSync(): Promise<string> {
  const script = path.resolve(process.cwd(), 'tools', 'garmin_sync.py');
  const { stdout, stderr } = await execFileAsync('python3', [script, '--days', '3'], {
    timeout: 120_000,
    env: process.env,
  });
  return (stdout || stderr || '').trim();
}
