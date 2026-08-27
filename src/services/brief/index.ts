import { isCalendarConnected, getUpcomingEvents } from '../calendar/index.js';
import { todaySession } from '../training/index.js';
import { wellnessFor, renderWellness } from '../training/garmin.js';
import { kyivNow, timeKyiv } from '../../utils/kyiv.js';

/** Текст ранкового брифу: календар на сьогодні + тренування + Garmin wellness (якщо є). */
export async function buildMorningBrief(): Promise<string> {
  const { date } = kyivNow();
  const todayStr = new Date().toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' });

  const planItems: string[] = [];
  if (isCalendarConnected()) {
    const events = (await getUpcomingEvents(1))
      .filter(e => e.start && new Date(e.start).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' }) === todayStr);
    planItems.push(...events.map(e => `• ${timeKyiv(e.start)} ${e.title}`));
  }
  try {
    const session = await todaySession();
    if (session) planItems.push(`🏋️ ${session.day.title} · ${session.day.subtitle}`);
  } catch { /* без тренування — не критично */ }
  const planLines = planItems.length ? planItems.join('\n') : 'на сьогодні нічого не заплановано.';

  let wellnessLine = '';
  try {
    const w = await wellnessFor(date);
    const rendered = w ? renderWellness(w) : null;
    if (rendered) wellnessLine = `\n\n${rendered}`;
  } catch { /* без даних Garmin — не критично */ }

  return `☀️ Доброго ранку!${wellnessLine}\n\n📅 План на сьогодні:\n${planLines}`;
}
