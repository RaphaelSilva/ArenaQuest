'use client';

import Link from 'next/link';
import { useDict } from '@web/context/dict-context';
import { MarkdownViewer } from '@web/components/catalog/MarkdownViewer';
import type { EventDetail } from '@web/lib/events-api';
import { formatEventWhen, isPastEvent } from './event-format';
import { EventAudienceChip } from './EventAudienceChip';
import { EventContactButton } from './EventContactButton';
import { EventFlyer } from './EventFlyer';

/**
 * The event page body.
 *
 * It is a Client Component, but the page that owns it is not: the server
 * renders this markup on the first request, so the flyer, the date, the body
 * and the WhatsApp link are all in the HTML a crawler and a no-JavaScript
 * reader receive. The `'use client'` boundary exists so the same view can also
 * be driven by the post-hydration fetch on `EventDetailFallback`.
 *
 * ---------------------------------------------------------------------------
 * A past event is still a page, not a dead end
 * ---------------------------------------------------------------------------
 *
 * Retaining history is the whole argument for the "Anteriores" tab, and it is
 * worth nothing if the page behind it is stripped. So an event that has already
 * happened keeps its flyer, its date, its location and its body verbatim, and
 * gains exactly one thing: a marker saying so, stated neutrally. It is a record
 * of something the dojo did — not an error, and not an apology.
 *
 * **The contact button stays** (RFC 0014 / Milestone 20 Task 07, product call).
 * The stored message is the admin's own text and a reader on a past seminar is
 * usually asking about the next edition; removing the button would silently
 * delete a contact path for a reason the dojo cannot see. It renders *below*
 * the past note, so nobody writes in believing the date is still ahead.
 */
export function EventDetailView({ event }: { event: EventDetail }) {
  const dict = useDict();
  const when = formatEventWhen(event, dict.events.locale);
  const past = isPastEvent(event);

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <Link
        href="/events"
        className="self-start rounded-[8px] text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ color: 'var(--aq-accent)', outlineColor: 'var(--aq-accent)' }}
      >
        {dict.events.detail.back}
      </Link>

      <EventFlyer
        slug={event.slug}
        title={event.title}
        hasFlyer={event.hasFlyer}
        variant="detail"
      />

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {past && <PastMarker />}
          <EventAudienceChip audience={event.audience} />
        </div>
        <h1
          className="text-2xl font-bold leading-tight sm:text-3xl"
          style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
        >
          {event.title}
        </h1>
        {event.summary && (
          <p className="text-base leading-relaxed" style={{ color: 'var(--aq-text2)' }}>
            {event.summary}
          </p>
        )}
      </header>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt
            className="text-[11px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--aq-text3)', fontFamily: "'Space Grotesk', sans-serif" }}
          >
            {dict.events.detail.whenLabel}
          </dt>
          <dd style={{ color: 'var(--aq-text)' }}>
            <time dateTime={event.startsAt}>
              {dict.events.when(when.date, when.time, when.zone)}
            </time>
          </dd>
        </div>

        {event.location && (
          <div className="flex flex-col gap-1">
            <dt
              className="text-[11px] font-semibold uppercase tracking-widest"
              style={{ color: 'var(--aq-text3)', fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {dict.events.detail.whereLabel}
            </dt>
            <dd style={{ color: 'var(--aq-text)' }}>{event.location}</dd>
          </div>
        )}
      </dl>

      {event.content && (
        <section className="flex flex-col gap-3">
          <h2
            className="text-[11px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--aq-text3)', fontFamily: "'Space Grotesk', sans-serif" }}
          >
            {dict.events.detail.aboutLabel}
          </h2>
          <MarkdownViewer content={event.content} />
        </section>
      )}

      {/* No button at all when the API resolved no contact — see the component.
          On a past event the note above it is what stops a reader from writing
          in about a date that has already gone by. */}
      <div className="flex flex-col items-start gap-3">
        {past && (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--aq-text2)' }}>
            {dict.events.detail.pastNote}
          </p>
        )}
        <EventContactButton contact={event.contact} />
      </div>
    </article>
  );
}

/**
 * "Já aconteceu", as a fact.
 *
 * Deliberately not the error palette: this is a record, and a red banner would
 * read as something having gone wrong with a page that is working exactly as
 * intended.
 */
function PastMarker() {
  const dict = useDict();

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold tracking-tight"
      style={{
        background: 'var(--aq-bg4)',
        color: 'var(--aq-text2)',
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <svg
        data-event-past-marker="true"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {dict.events.detail.pastBadge}
    </span>
  );
}
