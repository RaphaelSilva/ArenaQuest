'use client';

import Link from 'next/link';
import { useDict } from '@web/context/dict-context';
import { MarkdownViewer } from '@web/components/catalog/MarkdownViewer';
import { eventFlyerUrl, type EventDetail } from '@web/lib/events-api';
import { formatEventWhen } from './event-format';
import { EventAudienceChip } from './EventAudienceChip';
import { EventContactButton } from './EventContactButton';

/**
 * The event page body.
 *
 * It is a Client Component, but the page that owns it is not: the server
 * renders this markup on the first request, so the flyer, the date, the body
 * and the WhatsApp link are all in the HTML a crawler and a no-JavaScript
 * reader receive. The `'use client'` boundary exists so the same view can also
 * be driven by the post-hydration fetch on `EventDetailFallback`.
 */
export function EventDetailView({ event }: { event: EventDetail }) {
  const dict = useDict();
  const when = formatEventWhen(event, dict.events.locale);

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <Link
        href="/events"
        className="text-sm font-medium transition-colors"
        style={{ color: 'var(--aq-accent)' }}
      >
        {dict.events.detail.back}
      </Link>

      {event.hasFlyer && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={eventFlyerUrl(event.slug)}
          alt={dict.events.board.flyerAlt(event.title)}
          className="w-full rounded-[14px] object-cover"
          style={{ border: '1px solid var(--aq-border)' }}
        />
      )}

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <EventAudienceChip audience={event.audience} />
        </div>
        <h1
          className="text-3xl font-bold leading-tight"
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

      {/* No button at all when the API resolved no contact — see the component. */}
      <EventContactButton contact={event.contact} />
    </article>
  );
}
