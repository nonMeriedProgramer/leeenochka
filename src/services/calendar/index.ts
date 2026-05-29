import { google, calendar_v3 } from 'googleapis';
import type { UserState } from '../../types/index.js';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);

export function getAuthUrl(telegramId: number): string {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    state: String(telegramId),
  });
}

export async function exchangeCode(code: string) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

function getCalendar(tokens: UserState['googleTokens']) {
  oauth2Client.setCredentials(tokens!);
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

export async function createEvent(
  tokens: UserState['googleTokens'],
  event: { title: string; start: string; durationMinutes: number; description?: string },
): Promise<calendar_v3.Schema$Event> {
  const cal = getCalendar(tokens);
  const startDate = new Date(event.start);
  const endDate = new Date(startDate.getTime() + event.durationMinutes * 60000);

  const { data } = await cal.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: event.title,
      description: event.description,
      start: { dateTime: startDate.toISOString(), timeZone: 'Europe/Kyiv' },
      end: { dateTime: endDate.toISOString(), timeZone: 'Europe/Kyiv' },
    },
  });
  return data;
}

export async function findFreeSlot(
  tokens: UserState['googleTokens'],
  durationMinutes: number,
  afterDate: Date = new Date(),
): Promise<Date | null> {
  const cal = getCalendar(tokens);
  const timeMin = afterDate.toISOString();
  const timeMax = new Date(afterDate.getTime() + 7 * 24 * 3600000).toISOString();

  const { data } = await cal.freebusy.query({
    requestBody: { timeMin, timeMax, items: [{ id: 'primary' }] },
  });

  const busy = data.calendars?.primary?.busy ?? [];
  let candidate = new Date(afterDate);

  // round up to next 30-min slot
  const mins = candidate.getMinutes();
  if (mins > 0) {
    candidate.setMinutes(mins <= 30 ? 30 : 60, 0, 0);
  }

  for (let i = 0; i < 48 * 7; i++) {
    const hour = candidate.getHours();
    if (hour >= 9 && hour < 18) {
      const slotEnd = new Date(candidate.getTime() + durationMinutes * 60000);
      const conflict = busy.some(b => {
        const bs = new Date(b.start!).getTime();
        const be = new Date(b.end!).getTime();
        return candidate.getTime() < be && slotEnd.getTime() > bs;
      });
      if (!conflict) return candidate;
    }
    candidate = new Date(candidate.getTime() + 30 * 60000);
  }
  return null;
}
