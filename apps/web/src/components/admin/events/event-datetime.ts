/**
 * Conversion between the form's `datetime-local` value and the UTC instant the
 * API stores.
 *
 * An event carries a wall-clock time **and** the zone it is announced in: a
 * seminar at 10:00 in São Paulo reads as 10:00 to everyone, including a crawler
 * on another continent (`components/events/event-format.ts` renders it the same
 * way). So the pair the admin types is not a local time in *their* browser's
 * zone — it is a local time in the *event's* zone, and the conversion has to go
 * through that zone rather than through `new Date(value)`, which would silently
 * apply whatever zone the authoring machine happens to sit in.
 */

/** The zone a new event starts in, per the milestone. Editable per event. */
export const DEFAULT_EVENT_TIMEZONE = 'America/Sao_Paulo';

/**
 * How far `timeZone` is from UTC at `instant`, in milliseconds.
 *
 * Computed by formatting the instant in that zone and reading the wall clock
 * back, which is the only offset source that honours DST without a table.
 * An unknown zone yields `0`, so a typo degrades to UTC instead of throwing on
 * every keystroke.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant);

    const read = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? '0');

    // `hour12: false` renders midnight as `24` in some ICU versions.
    const hour = read('hour') % 24;
    const asUtc = Date.UTC(
      read('year'),
      read('month') - 1,
      read('day'),
      hour,
      read('minute'),
      read('second'),
    );
    return asUtc - instant.getTime();
  } catch {
    return 0;
  }
}

/**
 * `YYYY-MM-DDTHH:mm` read in `timeZone` → an ISO-8601 UTC instant.
 *
 * Returns `null` for an empty or malformed value, which is what the form shows
 * as "a start is required" rather than sending `Invalid Date` to the API.
 *
 * The offset is applied twice on purpose: the first pass uses the offset at the
 * *wrong* instant (the wall time read as UTC), which is off by an hour across a
 * DST transition; the second pass re-reads it at the corrected instant.
 */
export function wallTimeToInstant(wallTime: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wallTime);
  if (!match) return null;

  const naive = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  if (Number.isNaN(naive)) return null;

  let instant = naive - zoneOffsetMs(new Date(naive), timeZone);
  instant = naive - zoneOffsetMs(new Date(instant), timeZone);

  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * An ISO-8601 instant → the `YYYY-MM-DDTHH:mm` a `datetime-local` input shows,
 * expressed in `timeZone`.
 *
 * The inverse of {@link wallTimeToInstant}, so an edit that touches nothing
 * round-trips to the same instant.
 */
export function instantToWallTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const shifted = new Date(date.getTime() + zoneOffsetMs(date, timeZone));
  return shifted.toISOString().slice(0, 16);
}
