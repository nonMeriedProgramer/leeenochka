// Актуальний київський UTC-offset для конкретної дати (літній час +03:00, зимовий +02:00).
// Без хардкоду — рахується через ICU, тож не ламається при переході годинників.
export function kyivOffset(at: Date = new Date()): string {
  const name = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', timeZoneName: 'longOffset' })
    .formatToParts(at).find(p => p.type === 'timeZoneName')?.value || '';
  const m = name.match(/([+-])(\d{2}):?(\d{2})/); // "GMT+03:00" → +03:00
  return m ? `${m[1]}${m[2]}:${m[3]}` : '+02:00';
}

// Поточний час у Києві
export function kyivNow(): { hour: number; minute: number; date: string; weekday: string } {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv', hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '';
  return { hour: Number(g('hour')), minute: Number(g('minute')), date: `${g('year')}-${g('month')}-${g('day')}`, weekday: g('weekday') };
}

export function timeKyiv(iso: string): string {
  return new Date(iso).toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' });
}
