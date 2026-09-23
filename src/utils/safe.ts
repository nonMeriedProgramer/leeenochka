// ─── Одне джерело даних падає — решта звіту все одно йде ───────────────
export async function safe<T>(label: string, sources: string[], fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    sources.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    return fallback;
  }
}
