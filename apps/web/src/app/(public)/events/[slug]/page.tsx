import type { Metadata } from 'next';
import { dict } from '@web/i18n';
import { brand } from '@web/lib/brand';
import { eventFlyerUrl, fetchPublicEvent, PUBLIC_SITE_ORIGIN } from '@web/lib/events-api';
import { EventDetailView } from '@web/components/events/EventDetailView';
import { EventDetailFallback } from '@web/components/events/EventDetailFallback';

/** SSR per request at the edge — see the board page for why this is not static. */
export const runtime = 'edge';

type EventPageProps = { params: Promise<{ slug: string }> };

/**
 * OpenGraph for a link pasted into a chat.
 *
 * Resolved from the **anonymous** read, like the render: a crawler is anonymous
 * by definition, and metadata composed from an entitled read would leak the
 * title and summary of a restricted event into a preview card.
 *
 * `og:image` is the stable `/v1/events/{slug}/flyer` route, never the presigned
 * URL it redirects to. A presigned target has a one-hour TTL and is already
 * dead by the time a chat client renders the preview a day later; the route
 * mints a fresh signature on each hit and re-runs the audience check while it
 * does.
 */
export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await fetchPublicEvent(slug);

  if (!event) {
    return { title: `${dict.events.detail.notFoundTitle} · ${brand.fullName}` };
  }

  const title = `${event.title} · ${brand.fullName}`;
  const url = `${PUBLIC_SITE_ORIGIN}/events/${event.slug}`;
  const images = event.hasFlyer
    ? [{ url: eventFlyerUrl(event.slug), alt: dict.events.board.flyerAlt(event.title) }]
    : undefined;

  return {
    title,
    description: event.summary,
    alternates: { canonical: url },
    openGraph: {
      title,
      description: event.summary,
      url,
      type: 'article',
      images,
    },
  };
}

/**
 * One event.
 *
 * The fetch carries no token, so a `members` or `restricted` event is a `404`
 * here even for a reader holding a session cookie — nothing audience-scoped is
 * ever rendered into HTML that could be cached. A signed-in reader who reached
 * this page from their own board is recovered by `EventDetailFallback`, which
 * retries with their token after hydration.
 */
export default async function EventDetailPage({ params }: EventPageProps) {
  const { slug } = await params;
  const event = await fetchPublicEvent(slug);

  if (!event) return <EventDetailFallback slug={slug} />;

  return <EventDetailView event={event} />;
}
