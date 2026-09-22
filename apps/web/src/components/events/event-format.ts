/**
 * Date and time rendering for the events board.
 *
 * **The event's own timezone renders it.** Not the reader's local zone, and not
 * `users.timezone`: an anonymous visitor carries neither, and a seminar at
 * 10:00 in São Paulo must read as 10:00 to everyone who opens the page,
 * including the crawler that indexed it from another continent.
 *
 * The locale comes from the dictionary (`dict.events.locale`), the same way
 * `billing.money.locale` and `layout.standingBanner.locale` already resolve it,
 * so the build language decides the month names rather than an ad-hoc literal.
 */

/** The three pieces the dictionary composes into one line. */
export interface EventWhen {
  /** e.g. `sáb., 10 de out. de 2026` */
  date: string;
  /** e.g. `10:00` or `10:00 – 13:00` when the event declares an end. */
  time: string;
  /** Short zone name for the event's own zone, e.g. `GMT-3`. */
  zone: string;
}

/** En dash, the typographic separator for a range. */
const RANGE_SEPARATOR = '–';

function safeFormat(
  locale: string,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
  instant: Date,
): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone }).format(instant);
  } catch {
    // An unknown IANA zone throws a RangeError. A board that 500s because one
    // row carries a typo is worse than one that renders that row in UTC.
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(instant);
  }
}

/**
 * Formats one event's instant(s) in its own zone.
 *
 * `endsAt` is nullable by design — an open-ended event renders a start time
 * only, never a range with a guessed end.
 */
export function formatEventWhen(
  event: { startsAt: string; endsAt: string | null; timezone: string },
  locale: string,
): EventWhen {
  const start = new Date(event.startsAt);
  const end = event.endsAt === null ? null : new Date(event.endsAt);

  const date = safeFormat(
    locale,
    event.timezone,
    { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' },
    start,
  );

  const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  const startTime = safeFormat(locale, event.timezone, timeOptions, start);
  const time =
    end === null
      ? startTime
      : `${startTime} ${RANGE_SEPARATOR} ${safeFormat(locale, event.timezone, timeOptions, end)}`;

  // `timeZoneName` alone still needs a date field to format against; the parts
  // filter is what isolates the zone token from the rest.
  const zone =
    new Intl.DateTimeFormat(locale, {
      timeZone: isKnownZone(event.timezone) ? event.timezone : 'UTC',
      timeZoneName: 'short',
    })
      .formatToParts(start)
      .find((part) => part.type === 'timeZoneName')?.value ?? event.timezone;

  return { date, time, zone };
}

function isKnownZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Merges the anonymous slice a Server Component already rendered with the
 * entitled superset fetched after hydration.
 *
 * It is a union, not a replacement: the public slice is what a crawler and a
 * slow connection see, and it must never blink out of the page because a
 * second request is in flight or came back short. Ordering follows the scope,
 * mirroring the API — soonest first while looking forward, most recent first
 * while looking back.
 */
export function mergeEventLists<T extends { id: string; startsAt: string }>(
  rendered: readonly T[],
  fetched: readonly T[],
  scope: 'upcoming' | 'past',
): T[] {
  const byId = new Map<string, T>();
  for (const event of rendered) byId.set(event.id, event);
  // The entitled copy wins on a collision: it is the fresher read.
  for (const event of fetched) byId.set(event.id, event);

  const direction = scope === 'past' ? -1 : 1;
  return [...byId.values()].sort(
    (a, b) => direction * (Date.parse(a.startsAt) - Date.parse(b.startsAt)),
  );
}
