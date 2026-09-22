/**
 * Transport for the public events board (`GET /v1/events`, `/{slug}`,
 * `/{slug}/flyer` — Milestone 20, Task 03).
 *
 * This is a separate client from `api-client.ts` on purpose. That module is
 * `'use client'` and routes every call through `fetchWithAuth`, which assumes a
 * session exists and knows how to refresh it. These three reads must work with
 * **no token at all**, from a Server Component, so they cannot go through it.
 *
 * ---------------------------------------------------------------------------
 * The invariant this file exists to enforce
 * ---------------------------------------------------------------------------
 *
 * The board is *audience-scoped*: the same URL returns a different body per
 * caller. A server render that carried the visitor's token and then got cached
 * or prerendered would hand a `restricted` event to whoever asked next — the
 * cache becomes exactly the leak the API's literal anonymous query and its
 * 404-not-403 rule exist to prevent.
 *
 * So the split below is structural, not a convention:
 *
 * - `fetchPublicEventList` / `fetchPublicEvent` are the **server** reads. They
 *   take no token parameter, and there is no overload, option bag or default
 *   argument by which one could be handed one. They see the `public` slice,
 *   which is what makes the rendered HTML safe to cache and correct to index.
 * - `fetchViewerEventList` / `fetchViewerEvent` are the **client** reads. They
 *   require a non-empty access token as their first positional argument and are
 *   only ever called after hydration, from a Client Component, uncached.
 *
 * The two paths do not share an auth-capable core; `readAnonymous` literally
 * has nowhere to put an `Authorization` header.
 */

import type { Entities } from '@arenaquest/shared/types/entities';

const API_VERSION = '/v1';

// ---------------------------------------------------------------------------
// Wire types — mirror `apps/api/src/routes/events.router.ts`
// ---------------------------------------------------------------------------

/** Which side of "now" the board is listing. */
export type EventScope = 'upcoming' | 'past';

/**
 * The audience literals, derived from the shared enum rather than re-declared,
 * so a new level in `Entities.Config.EventAudience` fails the build here.
 */
export type EventAudience = `${Entities.Config.EventAudience}`;

/**
 * The resolved WhatsApp call-to-action, or `null` when the event stores no
 * number.
 *
 * `message` is required and may be `''`: it is `events.whatsapp_message` as the
 * admin stored it. The API composes no default and **neither does this layer**
 * — an empty message means the chat opens with nothing pre-filled.
 */
export interface EventContact {
  number: string;
  message: string;
  label: string;
}

/** One card on the board. */
export interface EventListItem {
  id: string;
  slug: string;
  title: string;
  summary: string;
  location: string;
  /** ISO-8601 UTC instant. */
  startsAt: string;
  /** ISO-8601 UTC instant, or `null` for an open-ended event. */
  endsAt: string | null;
  /** IANA zone the event is rendered in — see `event-format.ts`. */
  timezone: string;
  audience: EventAudience;
  /** Whether `/v1/events/{slug}/flyer` will redirect to an image. */
  hasFlyer: boolean;
}

export interface EventDetail extends EventListItem {
  /** Markdown, already sanitised by the API on the way out. */
  content: string;
  contact: EventContact | null;
}

export interface EventList {
  data: EventListItem[];
  total: number;
  limit: number;
  offset: number;
  scope: EventScope;
}

export interface ListEventsParams {
  scope: EventScope;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

function apiOrigin(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? '';
}

function listPath(params: ListEventsParams): string {
  const query = new URLSearchParams({ scope: params.scope });
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  return `/events?${query.toString()}`;
}

function detailPath(slug: string): string {
  return `/events/${encodeURIComponent(slug)}`;
}

/**
 * The **stable** flyer URL: the API route, never the presigned target it
 * redirects to.
 *
 * This is what goes into `og:image`. A presigned URL has a one-hour TTL and is
 * already dead by the time a crawler or a chat client fetches the preview,
 * whereas this route mints a fresh signature on every hit and re-checks the
 * audience while it does.
 */
export function eventFlyerUrl(slug: string): string {
  return `${apiOrigin()}${API_VERSION}${detailPath(slug)}/flyer`;
}

/**
 * Origin the public pages are served from, used for canonical links, the
 * sitemap and `robots.txt`.
 *
 * Read from `NEXT_PUBLIC_SITE_URL` at build time, like every other public var.
 * The loopback default is a development convenience; a deployed build must set
 * it, or the sitemap will advertise localhost.
 */
export const PUBLIC_SITE_ORIGIN = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
).replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Response handling
// ---------------------------------------------------------------------------

/**
 * Turns a response into data or `null`.
 *
 * `null` covers every failure the same way — a `404` (no such event, or not
 * visible to this caller: the API makes those byte-identical on purpose), a
 * `429`, a `5xx` and a transport error alike. The board degrades to its empty
 * state rather than to an exception on a page a stranger is reading.
 */
async function readJson<T>(response: Response): Promise<T | null> {
  if (!response.ok) return null;
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * The anonymous read. **There is no token parameter, by design** — see the
 * module header. `no-store` keeps the edge render per-request: a board that was
 * frozen at build time would not show an event published this morning.
 */
async function readAnonymous<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${apiOrigin()}${API_VERSION}${path}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    return await readJson<T>(response);
  } catch {
    return null;
  }
}

/**
 * The entitled read, for a Client Component after hydration.
 *
 * `accessToken` is a required `string`, not `string | null`: a caller with no
 * session has nothing to add to the anonymous slice it already rendered, so it
 * must not call this at all. The result is never cached.
 */
async function readAsViewer<T>(path: string, accessToken: string): Promise<T | null> {
  try {
    const response = await fetch(`${apiOrigin()}${API_VERSION}${path}`, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return await readJson<T>(response);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Server reads — anonymous, always
// ---------------------------------------------------------------------------

/** The `public` slice of the board. Safe to render into cacheable HTML. */
export function fetchPublicEventList(params: ListEventsParams): Promise<EventList | null> {
  return readAnonymous<EventList>(listPath(params));
}

/**
 * One `public` event by slug, or `null`.
 *
 * `null` for an event that exists but is not public is the correct server
 * answer even when the reader is signed in: their entitled view is resolved on
 * the client, where it cannot be cached and handed to the next stranger.
 */
export function fetchPublicEvent(slug: string): Promise<EventDetail | null> {
  return readAnonymous<EventDetail>(detailPath(slug));
}

// ---------------------------------------------------------------------------
// Client reads — the entitled superset
// ---------------------------------------------------------------------------

/**
 * The board as this viewer may see it: the same endpoint, with a token.
 *
 * The client never declares what it may see — there is no filter parameter and
 * no second route. The signed-in board is simply the difference between two
 * responses to the same URL.
 */
export function fetchViewerEventList(
  accessToken: string,
  params: ListEventsParams,
): Promise<EventList | null> {
  return readAsViewer<EventList>(listPath(params), accessToken);
}

/** One event as this viewer may see it, or `null` when they may not. */
export function fetchViewerEvent(
  accessToken: string,
  slug: string,
): Promise<EventDetail | null> {
  return readAsViewer<EventDetail>(detailPath(slug), accessToken);
}
