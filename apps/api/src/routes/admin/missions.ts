import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { ZodIssue } from 'zod';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { AdminMissionsController } from '@api/controllers/admin-missions.controller';
import { respondWith } from '@api/routes/_shared/envelope';
import { encodeCursor, invalidCursorResponse, parseCursorParam } from '@api/routes/_shared/cursor';
import {
  MissionAudienceSchema,
  MissionCreateBodySchema,
  MissionDetailSchema,
  MissionListItemSchema,
  MissionParticipantPageSchema,
  MissionPatchBodySchema,
  MissionRequirementErrorSchema,
  MissionRequirementSchema,
  MissionRequirementTitleBodySchema,
  MissionSchema,
  MissionStartedErrorSchema,
  ReplaceMissionRequirementsBodySchema,
} from '@api/openapi/components/entities';
import type { AppContainer } from '@api/container';

/**
 * Admin missions (RFC 0022 §6). The `/admin/*` umbrella admits `admin` and
 * `content_creator`, which keeps the three reads open to instructors; every
 * write carries `requireRole(ROLES.ADMIN)` as its own route middleware, which
 * runs before body validation, so a content creator gets `403` whatever the body.
 */
const adminOnly = [requireRole(ROLES.ADMIN)];

const TAGS = ['admin:missions'];
const SECURITY = [{ bearerAuth: [] }];

const idParams = z.object({
  id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
});

const requirementParams = idParams.extend({
  reqId: z.string().uuid().openapi({ example: 'b1b2c3d4-e5f6-7890-1234-567890abcdef' }),
});

const json = <T extends z.ZodTypeAny>(schema: T) => ({ content: { 'application/json': { schema } } });

const requirementError = {
  description:
    'Validation failed. A requirement-scoped error names its `index`; target refusals answer `INVALID_REQUIREMENT_TARGET` (or `EVENT_NOT_CHARGEABLE` / `REQUIREMENT_SHARING_DISABLED`) with a `reason`',
  ...json(MissionRequirementErrorSchema),
};

const missionStarted = {
  description: 'MISSION_STARTED — the mission started; `fields` names the locked fields',
  ...json(MissionStartedErrorSchema),
};

// ---------------------------------------------------------------------------
// Reads (admin + content creator)
// ---------------------------------------------------------------------------

export const listMissionsRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'List missions',
  description: 'Every mission, legacy rows included, with requirement, enrolled and completed counts.',
  tags: TAGS,
  security: SECURITY,
  responses: {
    200: { description: 'Missions', ...json(z.object({ data: z.array(MissionListItemSchema) })) },
    403: { description: 'Not staff' },
  },
});

export const getMissionRoute = createRoute({
  method: 'get',
  path: '/{id}',
  summary: 'Get mission',
  description: 'The mission with its requirements in position order and its audience.',
  tags: TAGS,
  security: SECURITY,
  request: { params: idParams },
  responses: {
    200: { description: 'Mission detail', ...json(z.object({ data: MissionDetailSchema })) },
    404: { description: 'Mission not found' },
  },
});

export const listParticipantsRoute = createRoute({
  method: 'get',
  path: '/{id}/participants',
  summary: 'List mission participants',
  description:
    'Enrollments (active and left) ordered by join time, with aggregate and per-step progress. Keyset-paginated; a malformed cursor answers `400 InvalidCursor`.',
  tags: TAGS,
  security: SECURITY,
  request: {
    params: idParams,
    query: z.object({
      cursor: z.string().optional().openapi({ description: 'Opaque `nextCursor` of the previous page' }),
    }),
  },
  responses: {
    200: { description: 'One page of participants', ...json(MissionParticipantPageSchema) },
    400: { description: 'InvalidCursor' },
    404: { description: 'Mission not found' },
  },
});

// ---------------------------------------------------------------------------
// Writes (admin only)
// ---------------------------------------------------------------------------

export const createMissionRoute = createRoute({
  method: 'post',
  path: '/',
  middleware: adminOnly,
  summary: 'Create mission',
  description:
    "Creates a mission and its 1..20 ordered requirements in one batch, stored with `predicateKind = 'requirements'`. An audience is accepted only with `enrollmentMode = 'assigned'`; its users (direct and group members) are enrolled.",
  tags: TAGS,
  security: SECURITY,
  request: { body: json(MissionCreateBodySchema) },
  responses: {
    201: { description: 'Mission created', ...json(z.object({ data: MissionDetailSchema })) },
    400: requirementError,
    403: { description: 'Not an admin' },
  },
});

export const updateMissionRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  middleware: adminOnly,
  summary: 'Update mission',
  description:
    'After `startAt`, only `title`, `description`, `active` and extending `endAt` are accepted; changing `startAt`, `mode`, `enrollmentMode`, `xpReward` or `badgeId` answers `409 MISSION_STARTED`. An `endAt` never shortens the mission below now.',
  tags: TAGS,
  security: SECURITY,
  request: { params: idParams, body: json(MissionPatchBodySchema) },
  responses: {
    200: { description: 'Mission updated', ...json(z.object({ data: MissionSchema })) },
    400: { description: 'Validation failed' },
    403: { description: 'Not an admin' },
    404: { description: 'Mission not found' },
    409: missionStarted,
  },
});

export const replaceRequirementsRoute = createRoute({
  method: 'put',
  path: '/{id}/requirements',
  middleware: adminOnly,
  summary: 'Replace mission requirements',
  description: 'Replaces the ordered list; positions are the array order. Refused once the mission started.',
  tags: TAGS,
  security: SECURITY,
  request: { params: idParams, body: json(ReplaceMissionRequirementsBodySchema) },
  responses: {
    200: { description: 'Requirements replaced', ...json(z.object({ data: z.array(MissionRequirementSchema) })) },
    400: requirementError,
    403: { description: 'Not an admin' },
    404: { description: 'Mission not found' },
    409: { description: 'MISSION_STARTED, or MISSION_LEGACY for a legacy predicate mission' },
  },
});

export const updateRequirementTitleRoute = createRoute({
  method: 'patch',
  path: '/{id}/requirements/{reqId}',
  middleware: adminOnly,
  summary: 'Rename a mission requirement',
  description: 'The title is the one requirement field editable after start; the requirement keeps its id and progress.',
  tags: TAGS,
  security: SECURITY,
  request: { params: requirementParams, body: json(MissionRequirementTitleBodySchema) },
  responses: {
    200: { description: 'Requirement renamed', ...json(z.object({ data: MissionRequirementSchema })) },
    400: { description: 'Validation failed' },
    403: { description: 'Not an admin' },
    404: { description: 'Requirement not found on this mission' },
  },
});

export const replaceAudienceRoute = createRoute({
  method: 'put',
  path: '/{id}/audience',
  middleware: adminOnly,
  summary: 'Replace mission audience',
  description:
    'Replace-all of the groups and users of an `assigned` mission. Newly covered users are enrolled; users no longer covered get `leftAt`, keeping their progress and rewards.',
  tags: TAGS,
  security: SECURITY,
  request: { params: idParams, body: json(MissionAudienceSchema) },
  responses: {
    200: { description: 'Audience replaced', ...json(z.object({ data: MissionAudienceSchema })) },
    400: { description: 'Validation failed, or UNKNOWN_AUDIENCE_TARGET' },
    403: { description: 'Not an admin' },
    404: { description: 'Mission not found' },
    409: { description: 'MISSION_NOT_ASSIGNED' },
  },
});

export const deleteMissionRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  middleware: adminOnly,
  summary: 'Delete mission',
  description: 'Soft delete (`active = false`).',
  tags: TAGS,
  security: SECURITY,
  request: { params: idParams },
  responses: {
    200: { description: 'Mission deleted', ...json(z.object({ data: z.object({ success: z.boolean() }) })) },
    403: { description: 'Not an admin' },
    404: { description: 'Mission not found' },
  },
});

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

/** Stable reason of a schema issue inside one requirement. */
function issueReason(issue: ZodIssue): string {
  if (issue.code === 'invalid_union_discriminator') return 'UNKNOWN_KIND';
  return issue.code.toUpperCase();
}

/**
 * `400 ValidationError` with the zod issues; when an issue lies inside
 * `requirements[i]`, the body also names that `index`, the `field` inside the
 * item and a `reason`, so the editor can put the error on the right card.
 */
function validationBody(issues: ZodIssue[]): Record<string, unknown> {
  const body: Record<string, unknown> = { error: 'ValidationError', issues };
  const requirementIssue = issues.find((i) => i.path[0] === 'requirements' && typeof i.path[1] === 'number');
  if (requirementIssue) {
    body.index = requirementIssue.path[1];
    body.field = requirementIssue.path.slice(2).join('.');
    body.reason = issueReason(requirementIssue);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function buildAdminMissionsRouter(container: AppContainer) {
  const { missionRepo, missionParticipationRepo, badgeRepo } = container.gamification;
  const submissionConfig = container.engagement.submissionConfig;
  const controller = new AdminMissionsController({
    missions: missionRepo,
    participation: missionParticipationRepo,
    topics: container.content.topics,
    media: container.content.media,
    events: container.events.eventRepo,
    eventCharges: container.billing.eventChargeRepo,
    userGroups: container.identity.userGroups,
    users: container.identity.users,
    badges: badgeRepo,
    sharingEnabled: submissionConfig.ok ? submissionConfig.config.sharingEnabled : null,
  });

  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) return c.json(validationBody(result.error.issues), 400);
    },
  });

  router.openapi(listMissionsRoute, async (c) => {
    const result = await controller.list();
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(getMissionRoute, async (c) => {
    const result = await controller.get(c.req.valid('param').id);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(listParticipantsRoute, async (c) => {
    const cursor = parseCursorParam(c.req.valid('query').cursor);
    if (cursor === undefined) return invalidCursorResponse(c);
    const result = await controller.listParticipants(c.req.valid('param').id, cursor);
    if (!result.ok) return respondWith(c, result);
    const { data, nextCursor } = result.data;
    return c.json({ data, nextCursor: nextCursor ? encodeCursor(nextCursor) : null }, 200);
  });

  router.openapi(createMissionRoute, async (c) => {
    const result = await controller.create(c.req.valid('json'));
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 201);
  });

  router.openapi(updateMissionRoute, async (c) => {
    const result = await controller.update(c.req.valid('param').id, c.req.valid('json'));
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(replaceRequirementsRoute, async (c) => {
    const result = await controller.replaceRequirements(c.req.valid('param').id, c.req.valid('json').requirements);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(updateRequirementTitleRoute, async (c) => {
    const { id, reqId } = c.req.valid('param');
    const result = await controller.updateRequirementTitle(id, reqId, c.req.valid('json').title);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(replaceAudienceRoute, async (c) => {
    const result = await controller.replaceAudience(c.req.valid('param').id, c.req.valid('json'));
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(deleteMissionRoute, async (c) => {
    const result = await controller.delete(c.req.valid('param').id);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  return router;
}
