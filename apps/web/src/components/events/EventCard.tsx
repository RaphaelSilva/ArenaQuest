'use client';

import Link from 'next/link';
import { useDict } from '@web/context/dict-context';
import type { EventListItem } from '@web/lib/events-api';
import { formatEventWhen } from './event-format';
import { EventAudienceChip } from './EventAudienceChip';
import { EventFlyer } from './EventFlyer';

/**
 * One card on the board: flyer thumbnail, date, title, summary and — beyond
 * `public` — the audience chip.
 *
 * The whole card is one link, so the keyboard reaches every event with a single
 * Tab per card rather than three. The flyer is always rendered through
 * `EventFlyer`, including when the event has none: a placeholder that keeps the
 * ratio is what stops a mixed board from turning into a ragged grid.
 */
export function EventCard({ event }: { event: EventListItem }) {
  const dict = useDict();
  const when = formatEventWhen(event, dict.events.locale);

  return (
    <li className="flex">
      <Link
        href={`/events/${event.slug}`}
        aria-label={dict.events.board.openEvent(event.title)}
        className="group flex h-full w-full flex-col overflow-hidden rounded-[14px] border transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{
          background: 'var(--aq-bg2)',
          borderColor: 'var(--aq-border)',
          outlineColor: 'var(--aq-accent)',
        }}
      >
        <EventFlyer
          slug={event.slug}
          title={event.title}
          hasFlyer={event.hasFlyer}
          variant="card"
        />

        <div className="flex flex-1 flex-col gap-2 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <time
              dateTime={event.startsAt}
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--aq-accent)', fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {dict.events.when(when.date, when.time, when.zone)}
            </time>
            <EventAudienceChip audience={event.audience} />
          </div>

          <h2
            className="text-lg font-bold leading-tight"
            style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
          >
            {event.title}
          </h2>

          {event.summary && (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--aq-text2)' }}>
              {event.summary}
            </p>
          )}

          {event.location && (
            <p className="mt-auto pt-2 text-xs" style={{ color: 'var(--aq-text3)' }}>
              {event.location}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}
