import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { AdminEventsController } from '@api/controllers/admin-events.controller';
import { respondWith, respondCreated, respondNoContent } from '@api/routes/_shared/envelope';
import { ALLOWED_MEDIA_TYPES, IMAGE_MEDIA_TYPES } from '@arenaquest/shared/domain/media/limits';
import type { AppContainer } from '@api/container';

/**
 * `/v1/admin/events` — the authoring surface of the events board (RFC 0014,
 * Milestone 20 Task 04).
 *
 * HTTP only: parse, guard, shape. Every rule lives in `AdminEventsController`
 * and arrives here as a `ControllerResult`.
 *
 * **There is no `DELETE /{id}`.** Removal is `PATCH { status: 'archived' }`,
 * which is reversible and keeps an event's row and its flyer object together.
 * The single `DELETE` on this router removes a flyer. Adding a hard delete is
 * not a feature request; it is a regression.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const EventStatusSchema = z.enum(['draft', 'published', 'archived']);
const EventAudienceSchema = z.enum(['public', 'members', 'restricted']);
const FlyerStatusSchema = z.enum(['none', 'pending', 'ready']);

const IsoInstant = z.string().datetime({ offset: true }).openapi({
  example: '2026-10-10T13:00:00.000Z',
});

const EventIdParamSchema = z.object({
  id: z.string().min(1).openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
});

const AudienceGrantsSchema = z
  .object({
    groupIds: z.array(z.string()).default([]),
    userIds: z.array(z.string()).default([]),
  })
  .openapi('EventAudienceGrants');

const AdminEventSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    summary: z.string(),
    content: z.string(),
    location: z.string(),
    startsAt: z.string(),
    endsAt: z.string().nullable(),
    timezone: z.string(),
    status: EventStatusSchema,
    audience: EventAudienceSchema,
    flyer: z.object({
      status: FlyerStatusSchema,
      key: z.string().nullable(),
      type: z.string().nullable(),
      sizeBytes: z.number().int().nullable(),
      name: z.string().nullable(),
    }),
    whatsappNumber: z.string(),
    whatsappMessage: z.string().nullable(),
    contactLabel: z.string(),
    createdBy: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    audienceGrants: AudienceGrantsSchema.optional(),
  })
  .openapi('AdminEvent');

/**
 * The creation payload carries **no `status`**.
 *
 * Every event is born a draft. Accepting a status here would let a
 * `content_creator` publish through the create route and walk around the
 * admin-only gate on the patch route, which is the one authorisation rule this
 * router adds to the umbrella.
 */
const CreateEventSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(120).optional(),
  summary: z.string().max(500).optional(),
  content: z.string().optional(),
  location: z.string().max(200).optional(),
  startsAt: IsoInstant,
  endsAt: IsoInstant.nullable().optional(),
  timezone: z.string().min(1).max(64).optional(),
  audience: EventAudienceSchema.optional(),
  whatsappNumber: z.string().max(32).optional(),
  whatsappMessage: z.string().max(1000).nullable().optional(),
  contactLabel: z.string().max(80).optional(),
});

const UpdateEventSchema = CreateEventSchema.partial().extend({
  status: EventStatusSchema.optional(),
});

/**
 * `contentType` admits the whole upload lifecycle's table, and the controller
 * narrows it to images with a `422`.
 *
 * Declaring the image subset here instead would answer a PDF flyer with a
 * schema-shaped `400`, which says "malformed request" about a well-formed one.
 * "A flyer is an image" is a rule of the events domain, so it is stated where
 * the domain rules live and is testable there.
 */
const FlyerPresignSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_MEDIA_TYPES).openapi({
    description: `An event flyer must be one of: ${IMAGE_MEDIA_TYPES.join(', ')}.`,
    example: 'image/jpeg',
  }),
  sizeBytes: z.number().int().positive(),
});

const FlyerPresignResultSchema = z
  .object({
    uploadUrl: z.string(),
    expiresInSeconds: z.number().int(),
    maxBytes: z.number().int(),
    flyer: AdminEventSchema.shape.flyer,
  })
  .openapi('EventFlyerPresign');

const AdminEventListSchema = z.object({
  data: z.array(AdminEventSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

const ListQuerySchema = z.object({
  status: EventStatusSchema.optional(),
  limit: z.string().regex(/^\d+$/).optional().openapi({ example: '50' }),
  offset: z.string().regex(/^\d+$/).optional().openapi({ example: '0' }),
});

// ---------------------------------------------------------------------------
// Route declarations
// ---------------------------------------------------------------------------

export const listAdminEventsRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'List every event',
  description:
    'Drafts, published and archived alike, newest start first. This is the authoring ' +
    'board; the audience rule that scopes `GET /v1/events` deliberately does not apply.',
  tags: ['admin:events'],
  security: [{ bearerAuth: [] }],
  request: { query: ListQuerySchema },
  responses: {
    200: {
      description: 'The events page',
      content: { 'application/json': { schema: AdminEventListSchema } },
    },
  },
});

export const createAdminEventRoute = createRoute({
  method: 'post',
  path: '/',
  summary: 'Create an event draft',
  description:
    'Always creates a `draft`: publishing is a separate, admin-only transition on ' +
    '`PATCH /{id}`. An explicit `slug` is honoured and a collision answers `409`; an ' +
    'omitted one is derived from the title, once.',
  tags: ['admin:events'],
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateEventSchema } } },
  },
  responses: {
    201: {
      description: 'The created draft',
      content: { 'application/json': { schema: AdminEventSchema } },
    },
    400: { description: 'Malformed payload' },
    409: { description: 'The explicit slug is already taken' },
  },
});

export const updateAdminEventRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  summary: 'Patch an event, including its status transitions',
  description:
    'Renaming never re-derives the slug — a link already circulating keeps working. ' +
    'Supplying `slug` moves it explicitly and a collision answers `409`. ' +
    '`status: "published"` additionally requires the `admin` role; `archived` does not.',
  tags: ['admin:events'],
  security: [{ bearerAuth: [] }],
  request: {
    params: EventIdParamSchema,
    body: { content: { 'application/json': { schema: UpdateEventSchema } } },
  },
  responses: {
    200: {
      description: 'The patched event',
      content: { 'application/json': { schema: AdminEventSchema } },
    },
    400: { description: 'Malformed payload' },
    403: { description: 'Publishing requires the admin role' },
    404: { description: 'No such event' },
    409: { description: 'The explicit slug is already taken' },
  },
});

export const replaceAudienceRoute = createRoute({
  method: 'put',
  path: '/{id}/audience',
  summary: 'Replace the whole audience grant set',
  description:
    'Whole-set, never additive: a group or user absent from the payload loses its ' +
    'grant. An unknown id answers `422` rather than a foreign-key failure.',
  tags: ['admin:events'],
  security: [{ bearerAuth: [] }],
  request: {
    params: EventIdParamSchema,
    body: { content: { 'application/json': { schema: AudienceGrantsSchema } } },
  },
  responses: {
    200: {
      description: 'The grant set now in force',
      content: { 'application/json': { schema: AudienceGrantsSchema } },
    },
    404: { description: 'No such event' },
    422: { description: 'An unknown group or user id' },
  },
});

export const presignFlyerRoute = createRoute({
  method: 'post',
  path: '/{id}/flyer/presign',
  summary: 'Authorise a flyer upload',
  description:
    'Returns a short-lived presigned `PUT`. A non-image type and a declared size over ' +
    'the shared image ceiling are both refused `422`. The ceiling is re-checked ' +
    'against the stored bytes at finalize.',
  tags: ['admin:events'],
  security: [{ bearerAuth: [] }],
  request: {
    params: EventIdParamSchema,
    body: { content: { 'application/json': { schema: FlyerPresignSchema } } },
  },
  responses: {
    201: {
      description: 'The upload URL and the pending flyer',
      content: { 'application/json': { schema: FlyerPresignResultSchema } },
    },
    404: { description: 'No such event' },
    422: { description: 'Not an image, or larger than the ceiling' },
  },
});

export const finalizeFlyerRoute = createRoute({
  method: 'post',
  path: '/{id}/flyer/finalize',
  summary: 'Confirm an uploaded flyer',
  description:
    "Reads the stored object's real size and compares it against the ceiling. Over it, " +
    'the object is deleted and the flyer stays `pending` (`422 FileTooLarge`); an object ' +
    'that never landed answers `422 NotUploaded`. On success the flyer a previous ' +
    'upload displaced is deleted from storage.',
  tags: ['admin:events'],
  security: [{ bearerAuth: [] }],
  request: { params: EventIdParamSchema },
  responses: {
    200: {
      description: 'The event with its flyer now `ready`',
      content: { 'application/json': { schema: AdminEventSchema } },
    },
    404: { description: 'No such event' },
    422: { description: 'Not uploaded, over the ceiling, or nothing pending' },
  },
});

export const deleteFlyerRoute = createRoute({
  method: 'delete',
  path: '/{id}/flyer',
  summary: 'Remove the flyer',
  description:
    'Clears the flyer columns and deletes the object. This is the only `DELETE` on ' +
    'this router: an event itself is removed by archiving it.',
  tags: ['admin:events'],
  security: [{ bearerAuth: [] }],
  request: { params: EventIdParamSchema },
  responses: {
    204: { description: 'Flyer removed' },
    404: { description: 'No such event' },
  },
});

// ---------------------------------------------------------------------------
// The publish gate
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Admin-only, **on the publish transition alone**.
 *
 * `routes/admin/billing.ts` sets the precedent for a sub-router that is
 * stricter than the `/v1/admin/*` umbrella, but it applies `requireRole` to the
 * whole router. Doing that here would lock a `content_creator` out of the
 * drafts they are employed to write. The gate is therefore conditional on the
 * payload: publishing puts a page and a person's phone number on the open
 * internet, and that act is an admin's; every other edit, `archived` included,
 * stays open to both roles.
 *
 * Reading the body here is safe — `HonoRequest.json()` caches its parse, so the
 * Zod validator downstream sees the same object rather than a consumed stream.
 * A body that is not JSON is passed through untouched, so the validator (and
 * not this middleware) owns the `400`.
 */
export const publishGate: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'PATCH') return next();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return next();
  }

  const status = (body as { status?: unknown } | null)?.status;
  if (status !== 'published') return next();

  return requireRole(ROLES.ADMIN)(c, next);
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function parseBoundedInt(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  return Math.min(Math.max(Number.parseInt(raw, 10), 0), max);
}

export function buildAdminEventsRouter(container: AppContainer) {
  const { eventRepo, storage, users, userGroups } = container.events;
  const controller = new AdminEventsController(eventRepo, storage, users, userGroups);

  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'ValidationError' as const, issues: result.error.issues }, 400);
      }
    },
  });

  // Registered before the routes so it runs ahead of them, and scoped to
  // `/:id` so it can never touch the list, the create or the flyer paths.
  router.use('/:id', publishGate);

  router.openapi(listAdminEventsRoute, async (c) => {
    const query = c.req.valid('query');
    const result = await controller.list({
      status: query.status,
      limit: Math.max(parseBoundedInt(query.limit, DEFAULT_LIMIT, MAX_LIMIT), 1),
      offset: parseBoundedInt(query.offset, 0, Number.MAX_SAFE_INTEGER),
    });
    return respondWith(c, result) as never;
  });

  router.openapi(createAdminEventRoute, async (c) => {
    const result = await controller.create(c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result) as never;
  });

  router.openapi(updateAdminEventRoute, async (c) => {
    const result = await controller.update(c.req.valid('param').id, c.req.valid('json'));
    return respondWith(c, result) as never;
  });

  router.openapi(replaceAudienceRoute, async (c) => {
    const result = await controller.replaceAudience(c.req.valid('param').id, c.req.valid('json'));
    return respondWith(c, result) as never;
  });

  router.openapi(presignFlyerRoute, async (c) => {
    const result = await controller.presignFlyer(c.req.valid('param').id, c.req.valid('json'));
    return respondCreated(c, result) as never;
  });

  router.openapi(finalizeFlyerRoute, async (c) => {
    const result = await controller.finalizeFlyer(c.req.valid('param').id);
    return respondWith(c, result) as never;
  });

  router.openapi(deleteFlyerRoute, async (c) => {
    const result = await controller.deleteFlyer(c.req.valid('param').id);
    return respondNoContent(c, result) as never;
  });

  return router;
}
