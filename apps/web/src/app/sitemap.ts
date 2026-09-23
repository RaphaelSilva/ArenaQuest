import type { MetadataRoute } from 'next';
import {
  fetchPublicEventList,
  PUBLIC_SITE_ORIGIN,
  type EventListItem,
  type EventScope,
} from '@web/lib/events-api';

/**
 * Built per request at the edge, for the same reason the board is: a sitemap
 * frozen at deploy time would not list the event that was published this
 * morning.
 */
export const runtime = 'edge';

/** The API's own ceiling (`MAX_LIMIT` in `events.router.ts`). */
const PAGE_SIZE = 100;

/**
 * A bound on the walk below, so a mis-reported `total` cannot turn one sitemap
 * request into an unbounded series of subrequests.
 */
const MAX_PAGES = 20;

/**
 * Every event in here comes from the **anonymous** read, which is exactly the
 * published `public` set — the same slice the crawler will be served when it
 * follows the link. A `members` or `restricted` event is invisible to this
 * fetch for the same reason it is invisible to the crawler, so the sitemap
 * cannot advertise a URL that answers `404`.
 */
async function listPublic(scope: EventScope): Promise<EventListItem[]> {
  const events: EventListItem[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPublicEventList({
      scope,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });
    if (!result || result.data.length === 0) break;

    events.push(...result.data);
    if (events.length >= result.total) break;
  }

  return events;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [upcoming, past] = await Promise.all([listPublic('upcoming'), listPublic('past')]);

  const entries: MetadataRoute.Sitemap = [
    { url: `${PUBLIC_SITE_ORIGIN}/`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${PUBLIC_SITE_ORIGIN}/events`, changeFrequency: 'daily', priority: 1 },
  ];

  // An upcoming event is worth re-crawling; a past one is vitrine that no
  // longer changes. Both are listed: the history is evidence to a first-time
  // visitor that the dojo is active.
  for (const event of upcoming) {
    entries.push({
      url: `${PUBLIC_SITE_ORIGIN}/events/${event.slug}`,
      changeFrequency: 'daily',
      priority: 0.8,
    });
  }
  for (const event of past) {
    entries.push({
      url: `${PUBLIC_SITE_ORIGIN}/events/${event.slug}`,
      changeFrequency: 'yearly',
      priority: 0.3,
    });
  }

  return entries;
}
