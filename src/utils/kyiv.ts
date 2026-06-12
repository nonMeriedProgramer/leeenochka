// Актуальний київський UTC-offset для конкретної дати (літній час +03:00, зимовий +02:00).
// Без хардкоду — рахується через ICU, тож не ламається при переході годинників.
export function kyivOffset(at: Date = new Date()): string {
  const name = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', timeZoneName: 'longOffset' })
    .formatToParts(at).find(p => p.type === 'timeZoneName')?.value || '';
  const m = name.match(/([+-])(\d{2}):?(\d{2})/); // "GMT+03:00" → +03:00
  return m ? `${m[1]}${m[2]}:${m[3]}` : '+02:00';
}
