import type {
  IEventRepository,
  IStorageAdapter,
  EventScope,
} from '@arenaquest/shared/ports';
import type { Entities } from '@arenaquest/shared/types/entities';
import { normalizeWhatsapp } from '@arenaquest/shared/domain/contact/whatsapp';
import { sanitizeMarkdown } from '@arenaquest/shared/utils/sanitize-markdown';
import type { ControllerResult } from '@api/core/result';

/**
 * The anonymous read surface of the events board (RFC 0014 §6, Milestone 20
 * Task 03).
 *
 * What this controller does **not** do is the important part: it contains no
 * audience filtering. `IEventRepository` owns that rule and Task 02 tested it
 * against the full matrix; every method here passes `viewerUserId` straight
 * through and trusts the answer. A second expression of the rule at this layer
 * is how the two drift, and the drift would be silent — a `public` event is
 * visible under either implementation, so only the restricted cases would
 * diverge, and those are exactly the ones nobody notices until they leak.
 *
 * The controller also never learns who the caller is from the request. It is
 * handed a `viewerUserId` that `optionalAuth` resolved from a verified token,
 * and there is no parameter by which a client could ask for a wider slice.
 */

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/** The resolved WhatsApp call-to-action, or `null` when the event stores none. */
export interface EventContactDto {
  number: string;
  message: string;
  label: string;
}

/**
 * One card on the board.
 *
 * `content` is absent on purpose: the list is rendered by an anonymous browser
 * and the body of every event is a payload nobody scrolled to yet.
 */
export interface EventListItemDto {
  id: string;
  slug: string;
  title: string;
  summary: string;
  location: string;
  /** ISO-8601 UTC instant. */
  startsAt: string;
  /** ISO-8601 UTC instant, or `null` for an open-ended event. */
  endsAt: string | null;
  timezone: string;
  audience: Entities.Config.EventAudience;
  /**
   * Whether `GET /v1/events/{slug}/flyer` will redirect. The URL itself is not
   * emitted here: it is a route, the client already holds the slug, and a
   * presigned target must never be baked into a cacheable list body.
   */
  hasFlyer: boolean;
}

export interface EventDetailDto extends EventListItemDto {
  /** Markdown, passed through `sanitizeMarkdown` on the way out. */
  content: string;
  contact: EventContactDto | null;
}

export interface EventListDto {
  data: EventListItemDto[];
  total: number;
  limit: number;
  offset: number;
  scope: EventScope;
}

/** What the router needs to answer a flyer request; it owns the 302 itself. */
export interface EventFlyerTargetDto {
  /** Freshly minted presigned GET. */
  url: string;
  /** Drives the router's `Cache-Control`; only a `public` event may be cached. */
  audience: Entities.Config.EventAudience;
}

export interface EventReaderOptions {
  /** Resolved by `optionalAuth`; `null` is anonymous. */
  viewerUserId: string | null;
}

export interface ListEventsOptions extends EventReaderOptions {
  scope: EventScope;
  limit: number;
  offset: number;
  /** The instant the scope predicate is evaluated against. */
  now: Date;
}

// ---------------------------------------------------------------------------
// The single not-found result
// ---------------------------------------------------------------------------

/**
 * **One** not-found value, returned by every miss on this surface.
 *
 * "Out of audience" and "no such slug" must be indistinguishable, or the board
 * becomes an enumeration oracle for anyone on the internet: a `403` on a real
 * slug and a `404` on a fake one confirms which private events exist. A shared
 * constant — rather than two literals that happen to match today — is what
 * keeps them identical after somebody adds a helpful `detail` to one branch.
 */
const NOT_FOUND = Object.freeze({
  ok: false as const,
  status: 404,
  error: 'NotFound',
});

function notFound<T>(): ControllerResult<T> {
  return NOT_FOUND;
}

// ---------------------------------------------------------------------------
// Flyer presign TTL
// ---------------------------------------------------------------------------

/** RFC 0014 §4: the redirect target is short-lived; the stable URL is the route. */
const FLYER_URL_TTL_SECONDS = 3600;

// ---------------------------------------------------------------------------

export class EventsController {
  constructor(
    private readonly events: IEventRepository,
    private readonly storage: IStorageAdapter,
  ) {}

  /**
   * The board. One endpoint for both audiences by design (RFC 0014 §6): the
   * client sends whatever token it has and receives the union it may see, so
   * "the logged-in list" is the difference between two responses rather than a
   * second route a client could call wrongly.
   */
  async list(opts: ListEventsOptions): Promise<ControllerResult<EventListDto>> {
    const { viewerUserId, scope, limit, offset, now } = opts;

    const [events, total] = await Promise.all([
      this.events.listVisible({ viewerUserId, scope, now, limit, offset }),
      this.events.countVisible({ viewerUserId, scope, now }),
    ]);

    return {
      ok: true,
      data: { data: events.map(toListItem), total, limit, offset, scope },
    };
  }

  /** One event by slug, or the shared not-found — never a `403`. */
  async getBySlug(
    slug: string,
    opts: EventReaderOptions,
  ): Promise<ControllerResult<EventDetailDto>> {
    const event = await this.events.findVisibleBySlug(slug, {
      viewerUserId: opts.viewerUserId,
    });
    if (!event) return notFound();

    return {
      ok: true,
      data: {
        ...toListItem(event),
        // Sanitised on the way out as well as on the way in: this body is read
        // by anonymous browsers and crawlers, and a row written before the
        // write-side sanitiser existed must not be the exception.
        content: sanitizeMarkdown(event.content),
        contact: resolveContact(event),
      },
    };
  }

  /**
   * The redirect target for the flyer.
   *
   * The audience check runs on every hit because the presigned URL is minted
   * per request; the bucket itself is never made world-readable and the bytes
   * are never proxied through the Worker.
   */
  async getFlyerTarget(
    slug: string,
    opts: EventReaderOptions,
  ): Promise<ControllerResult<EventFlyerTargetDto>> {
    const event = await this.events.findVisibleBySlug(slug, {
      viewerUserId: opts.viewerUserId,
    });
    if (!event) return notFound();

    // A `pending` flyer is an upload that was presigned and never confirmed;
    // only `ready` is served, and "no flyer" answers exactly as "no event".
    if (event.flyer.status !== 'ready' || !event.flyer.key) return notFound();

    const url = await this.storage.getPresignedDownloadUrl(event.flyer.key, {
      expiresInSeconds: FLYER_URL_TTL_SECONDS,
    });

    return { ok: true, data: { url, audience: event.audience } };
  }
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toListItem(event: Entities.Events.Event): EventListItemDto {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    summary: event.summary,
    location: event.location,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt === null ? null : event.endsAt.toISOString(),
    timezone: event.timezone,
    audience: event.audience,
    hasFlyer: event.flyer.status === 'ready' && event.flyer.key !== null,
  };
}

// ---------------------------------------------------------------------------
// Contact resolution (RFC 0014 §5, as amended 2026-09-22)
// ---------------------------------------------------------------------------

/**
 * Resolves the contact block, or `null`.
 *
 * **There is no runtime tenant fallback.** The number a reader sees is the one
 * stored on the event row and nothing else: the tenant's number is a build-time
 * variable of the web bundle that the Worker cannot read, and persisting the
 * number per event keeps a published contact auditable years later. An empty
 * column therefore suppresses the whole block, and the page renders no button —
 * the same degradation the landing page already implements.
 */
export function resolveContact(
  event: Pick<
    Entities.Events.Event,
    'whatsappNumber' | 'whatsappMessage' | 'contactLabel' | 'title' | 'startsAt' | 'timezone'
  >,
): EventContactDto | null {
  // Re-normalised on read as well as on write, so a row inserted by a seed, a
  // migration or a direct SQL edit degrades to "no button" rather than to a
  // `wa.me` link that opens an empty chat.
  const number = normalizeWhatsapp(event.whatsappNumber);
  if (!number) return null;

  const stored = event.whatsappMessage?.trim() ?? '';

  return {
    number,
    // A stored `null` composes from the event as it is *now*, which is the
    // whole reason the default is not materialised into the column: renaming an
    // event would otherwise strand every reader on the old title.
    message: stored !== '' ? stored : composeContactMessage(event),
    // Passed through as stored, `''` included. The default is a translated
    // string and belongs to the web dictionary, which knows the build language;
    // resolving it here would ship one language to both builds.
    label: event.contactLabel,
  };
}

/**
 * The default first message.
 *
 * The literal is product copy fixed by RFC 0014 §5 rather than developer-facing
 * text: it is the sentence a reader sends to the dojo, and the board ships in
 * Portuguese. It is composed here, on the server, so the rule lives in one
 * place for the web page, the OpenGraph preview and any later consumer.
 */
export function composeContactMessage(
  event: Pick<Entities.Events.Event, 'title' | 'startsAt' | 'timezone'>,
): string {
  return `Olá! Tenho interesse no evento "${event.title}" (${formatEventDate(event.startsAt, event.timezone)}).`;
}

/**
 * The event's start date in the event's own zone.
 *
 * The zone is stored on the row precisely because an anonymous reader carries
 * no `users.timezone`. A zone the runtime rejects falls back to the ISO date
 * rather than throwing: a malformed IANA string must not take down a public
 * page over a cosmetic detail.
 */
function formatEventDate(startsAt: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(startsAt);
  } catch {
    return startsAt.toISOString().slice(0, 10);
  }
}
