/**
 * Converts a UTC Date to a local date string (YYYY-MM-DD) for the given IANA timezone.
 * Uses Intl.DateTimeFormat — no external deps, works in V8/Workers and Vitest.
 */
export function toLocalDateString(utcDate: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(utcDate);

  const year = parts.find(p => p.type === 'year')?.value ?? '';
  const month = parts.find(p => p.type === 'month')?.value ?? '';
  const day = parts.find(p => p.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}
