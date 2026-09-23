// ─── Повтор на разовий мережевий збій (таймаут, обрив) ─────────────────
export async function retry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 3000): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
