import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import { EventsController } from '@api/controllers/events.controller';
import { optionalAuth, resolveViewerUserId } from '@api/middleware/optional-auth';
import { respondWith } from '@api/routes/_shared/envelope';
import type { EventsContext, InfraContext } from '@api/container';
import type { EventScope, IRateLimiter } from '@arenaquest/shared/ports';

/**
 * The events board's anonymous read surface, mounted at `/v1/events`.
 *
 * Mounted from `routes/index.ts` and **not** from `routes/public/`, whose name
 * means "non-admin but authenticated" and whose every route carries `authGuard`.
 * Putting a genuinely anonymous router in that directory would leave the next
 * reader with two incompatible meanings for one word, on the one surface where
 * the distinction is a security boundary rather than a naming preference.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const EVENT_SCOPES = ['upcoming', 'past'] as const;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * `scope` selects a list; it does **not** select an audience.
 *
 * Nothing in this schema, and nothing anywhere else on these routes, lets a
 * caller influence which audience slice comes back. The only input to that is
 * the token `optionalAuth` verified.
 */
const ListEventsQuerySchema = z.object({
  scope: z.enum(EVENT_SCOPES).optional().openapi({
    description: 'Which side of now to list. Defaults to `upcoming`.',
    example: 'upcoming',
  }),
  // Kept as digit strings rather than coerced numbers so that `?limit=abc` is a
  // 400 from the schema instead of a silent NaN clamped to the default.
  limit: z.string().regex(/^\d+$/).optional().openapi({ example: '50' }),
  offset: z.string().regex(/^\d+$/).optional().openapi({ example: '0' }),
});

/**
 * Deliberately unconstrained beyond a length bound: a slug that cannot exist
 * must still reach the handler and come back as the same `404` as a slug that
 * merely is not visible. A stricter pattern here would answer `400` for some
 * inputs and `404` for others, which is the enumeration oracle this surface
 * exists to avoid, one layer up.
 */
const EventSlugParamSchema = z.object({
  slug: z.string().min(1).max(200).openapi({ example: 'seminario-de-verao' }),
});

/**
 * `message` is required and may be `''`: it is `events.whatsapp_message` as the
 * admin stored it, and the API composes no default (RFC 0014 §5, amended
 * 2026-09-22). It is not `.optional()`, so the client has one shape to render
 * rather than two. The example is deliberately illustrative rather than a
 * product string — no user-facing copy in any language is defined here.
 */
const EventContactSchema = z.object({
  number: z.string().openapi({ example: '5519999991155' }),
  message: z.string().openapi({ example: '' }),
  label: z.string().openapi({ example: '' }),
});

const EventListItemSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  slug: z.string().openapi({ example: 'seminario-de-verao' }),
  title: z.string().openapi({ example: 'Seminário de verão' }),
  summary: z.string().openapi({ example: 'Open mat with a visiting instructor.' }),
  location: z.string().openapi({ example: 'Dojo central' }),
  startsAt: z.string().openapi({ example: '2026-10-10T13:00:00.000Z' }),
  endsAt: z.string().nullable().openapi({ example: null }),
  timezone: z.string().openapi({ example: 'America/Sao_Paulo' }),
  audience: z.enum(['public', 'members', 'restricted']).openapi({ example: 'public' }),
  hasFlyer: z.boolean().openapi({ example: true }),
});

const EventDetailSchema = EventListItemSchema.extend({
  content: z.string().openapi({ example: '## Programme\n\n...' }),
  contact: EventContactSchema.nullable(),
});

const EventListResponseSchema = z.object({
  data: z.array(EventListItemSchema),
  total: z.number().int().openapi({ example: 3 }),
  limit: z.number().int().openapi({ example: 50 }),
  offset: z.number().int().openapi({ example: 0 }),
  scope: z.enum(EVENT_SCOPES).openapi({ example: 'upcoming' }),
});

// ---------------------------------------------------------------------------
// Route declarations
// ---------------------------------------------------------------------------

export const listEventsRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'List events the caller may see',
  description:
    'Audience-scoped board. Without a token this is the published, `public` set; ' +
    'with one it additionally contains `members` events and the `restricted` events ' +
    'granted to that user or to one of their groups. One endpoint serves both — the ' +
    'client never declares what it may see.',
  tags: ['events'],
  request: { query: ListEventsQuerySchema },
  responses: {
    200: {
      description: 'The slice of the board this caller may see',
      content: { 'application/json': { schema: EventListResponseSchema } },
    },
    400: { description: 'Malformed query parameter' },
    429: { description: 'Too Many Requests' },
  },
});

export const getEventRoute = createRoute({
  method: 'get',
  path: '/{slug}',
  summary: 'Read one event by slug',
  description:
    'Returns the event with its sanitised Markdown body and its resolved contact ' +
    'block. An event the caller may not see answers `404`, byte-identical to a slug ' +
    'that does not exist.',
  tags: ['events'],
  request: { params: EventSlugParamSchema },
  responses: {
    200: {
      description: 'The event',
      content: { 'application/json': { schema: EventDetailSchema } },
    },
    404: { description: 'No such event, or not visible to this caller' },
    429: { description: 'Too Many Requests' },
  },
});

export const getEventFlyerRoute = createRoute({
  method: 'get',
  path: '/{slug}/flyer',
  summary: 'Redirect to the event flyer',
  description:
    'Redirects to a freshly minted presigned GET (TTL 1h). The route itself is the ' +
    'stable URL — safe to paste into a chat or an `og:image` tag — while the bucket ' +
    'stays private and the audience check runs on every hit.',
  tags: ['events'],
  request: { params: EventSlugParamSchema },
  responses: {
    302: { description: 'Redirect to the presigned flyer URL' },
    404: { description: 'No such event, not visible to this caller, or no flyer' },
    429: { description: 'Too Many Requests' },
  },
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * The bucket key.
 *
 * `CF-Connecting-IP` is written by Cloudflare at the edge and is not
 * client-controllable: whatever a caller sends under that name is overwritten
 * before the Worker sees it. `X-Forwarded-For` is an ordinary request header
 * and **is** spoofable, so it is deliberately not used as a fallback — falling
 * back to it would let one caller mint an unlimited number of buckets by
 * rotating a header value, which is the same as having no limiter at all. An
 * absent header (local `wrangler dev`, a test) shares one `unknown` bucket,
 * which is the conservative side of that trade.
 */
function clientIpKey(c: Context): string {
  const ip = c.req.header('cf-connecting-ip');
  return ip && ip.length > 0 ? ip : 'unknown';
}

/**
 * These endpoints cost a caller nothing and cost us a D1 read and sometimes an
 * HMAC signature, so they are metered per IP. It fails **open**: a KV outage
 * must not take the public board down with it.
 */
function buildRateLimit(limiter: IRateLimiter): MiddlewareHandler {
  return async (c, next) => {
    const key = clientIpKey(c);
    try {
      const state = await limiter.peek(key);
      if (!state.allowed) {
        c.header('Retry-After', String(state.retryAfterSeconds ?? 1));
        return c.json({ error: 'TooManyRequests' }, 429);
      }
      await limiter.hit(key);
    } catch (error) {
      console.error('[rate-limit] events limiter failed, failing open', error);
    }
    return next();
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function parseBoundedInt(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  return Math.min(Math.max(value, 0), max);
}

export function buildEventsRouter(slice: {
  events: EventsContext;
  infra: InfraContext;
}): OpenAPIHono {
  const { eventRepo, storage } = slice.events;
  const limiter = slice.infra.rateLimiters.events;

  const controller = new EventsController(eventRepo, storage);
  const router = new OpenAPIHono();

  // Order matters: meter first, then resolve identity. A caller already over
  // budget must not cost us a signature verification.
  router.use('*', buildRateLimit(limiter));
  router.use('*', optionalAuth);

  router.openapi(listEventsRoute, async (c) => {
    const query = c.req.valid('query');
    const scope: EventScope = query.scope ?? 'upcoming';

    const result = await controller.list({
      viewerUserId: resolveViewerUserId(c),
      scope,
      limit: Math.max(parseBoundedInt(query.limit, DEFAULT_LIMIT, MAX_LIMIT), 1),
      offset: parseBoundedInt(query.offset, 0, Number.MAX_SAFE_INTEGER),
      now: new Date(),
    });

    // `private` even for an anonymous caller: the body is a function of the
    // Authorization header, and a shared cache keyed only on the URL would
    // serve a member's slice to the next stranger.
    c.header('Cache-Control', 'private, max-age=30');
    return respondWith(c, result) as never;
  });

  router.openapi(getEventRoute, async (c) => {
    const result = await controller.getBySlug(c.req.valid('param').slug, {
      viewerUserId: resolveViewerUserId(c),
    });

    c.header('Cache-Control', 'private, max-age=30');
    return respondWith(c, result) as never;
  });

  router.openapi(getEventFlyerRoute, async (c) => {
    const result = await controller.getFlyerTarget(c.req.valid('param').slug, {
      viewerUserId: resolveViewerUserId(c),
    });

    if (!result.ok) return respondWith(c, result) as never;

    // Only a `public` event may be cached, and only for a minute: the redirect
    // is audience-scoped, so a cached 302 outlives its audience if the event is
    // later restricted. One minute bounds that window; do not raise it. For
    // every other audience the answer is per-caller and must not be stored at
    // all.
    c.header(
      'Cache-Control',
      result.data.audience === 'public' ? 'public, max-age=60' : 'no-store',
    );
    return c.redirect(result.data.url, 302) as never;
  });

  return router;
}
