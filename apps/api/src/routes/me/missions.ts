import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { MeMissionsController, type MissionCaller } from '@api/controllers/me-missions.controller';
import { DashboardMissionEntrySchema, MissionCheckResultSchema } from '@api/openapi/components/entities';
import { ErrorBody } from '@api/openapi/components/errors';
import { respondWith, respondNoContent } from '@api/routes/_shared/envelope';
import type {
  ContentContext,
  EngagementContext,
  EventsContext,
  GamificationContext,
  IdentityContext,
  ProgressContext,
} from '@api/container';

/**
 * Student missions (RFC 0022 §5, §6, §8). Mounted under `/v1/me`, whose sub-app
 * already applies `authGuard`. `GET /missions` itself lives in the gamification
 * router; every route here answers `404` on any miss — an `assigned` mission the
 * caller is not in, a mission the caller cannot see, a requirement that is not a
 * `manual_check` step of the mission.
 */

const TAGS = ['me:missions'];
const SECURITY = [{ bearerAuth: [] }];
const NO_STORE = 'private, no-store';

// Ids are matched, never parsed: a malformed id is a miss like any other (404).
const idParams = z.object({
  id: z.string().min(1).max(64).openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
});
const requirementParams = idParams.extend({
  reqId: z.string().min(1).max(64).openapi({ example: 'b1b2c3d4-e5f6-7890-1234-567890abcdef' }),
});

const json = <T extends z.ZodTypeAny>(schema: T) => ({ content: { 'application/json': { schema } } });
const error = (description: string) => ({ description, ...json(ErrorBody) });

const notFound = error('`NotFound` — no such mission or step, or the caller cannot see it');

export const getMyMissionRoute = createRoute({
  method: 'get',
  path: '/missions/{id}',
  summary: 'Get one of my missions',
  description:
    'One active mission with its steps (the mission page), as `GET /me/missions` lists it. A locked teaser, a gated-out `auto` mission and a mission outside its window answer `404`. Never writes.',
  tags: TAGS,
  security: SECURITY,
  request: { params: idParams },
  responses: {
    200: { description: 'The mission entry', ...json(DashboardMissionEntrySchema) },
    404: notFound,
  },
});

export const joinMissionRoute = createRoute({
  method: 'post',
  path: '/missions/{id}/join',
  summary: 'Join an open mission',
  description:
    'Enrolls the caller (`source = self`) in an `open` mission inside its window; evidence counts from the join. A rejoin after Leave keeps the first `countsFrom`.',
  tags: TAGS,
  security: SECURITY,
  request: { params: idParams },
  responses: {
    200: { description: 'Already joined: the current entry', ...json(DashboardMissionEntrySchema) },
    201: { description: 'Joined: the new entry', ...json(DashboardMissionEntrySchema) },
    404: notFound,
    409: error('`MISSION_NOT_JOINABLE` (not an `open` mission) or `MISSION_CLOSED` (outside its window)'),
  },
});

export const leaveMissionRoute = createRoute({
  method: 'post',
  path: '/missions/{id}/leave',
  summary: 'Leave a mission',
  description:
    'Leaves a `self` enrollment: completed steps and rewards stay, and a later Join keeps the original `countsFrom`.',
  tags: TAGS,
  security: SECURITY,
  request: { params: idParams },
  responses: {
    204: { description: 'Left' },
    404: notFound,
    409: error('`MISSION_NOT_LEAVABLE` — the enrollment is not `self` (implicit or by audience)'),
  },
});

export const checkMissionStepRoute = createRoute({
  method: 'post',
  path: '/missions/{id}/requirements/{reqId}/check',
  summary: 'Tick a manual-check step',
  description:
    'Marks a `manual_check` step as done and evaluates the mission in the same request, so the step completes, earns its XP and records streak activity. A second tick changes nothing and answers the current step.',
  tags: TAGS,
  security: SECURITY,
  request: { params: requirementParams },
  responses: {
    200: { description: 'The step and its mission entry', ...json(MissionCheckResultSchema) },
    404: notFound,
    409: error('`MISSION_STEP_LOCKED` (a sequential predecessor is incomplete) or `MISSION_CLOSED` (outside the window)'),
    500: error('`MISSION_EVALUATOR_UNAVAILABLE`'),
  },
});

export interface MeMissionsSlice {
  gamification: GamificationContext;
  progress: ProgressContext;
  content: ContentContext;
  identity: IdentityContext;
  events: EventsContext;
  engagement: EngagementContext;
}

/** The student missions controller over the per-request container slice. */
export function buildMeMissionsController(slice: MeMissionsSlice): MeMissionsController {
  const { gamification, engagement } = slice;
  return new MeMissionsController({
    missions: gamification.missionRepo,
    participation: gamification.missionParticipationRepo,
    evidence: gamification.missionEvidenceRepo,
    evaluator: gamification.missionEvaluator,
    badgeEngine: gamification.badgeEngine,
    topics: slice.content.topics,
    enrollment: slice.progress.enrollmentRepo,
    events: slice.events.eventRepo,
    userGroups: slice.identity.userGroups,
    // Same rule as the evaluator: a malformed SUBMISSIONS_* var counts no `shared_only` step.
    sharingEnabled: engagement.submissionConfig.ok ? engagement.submissionConfig.config.sharingEnabled : false,
  });
}

export function missionCaller(c: Context): MissionCaller {
  const user = c.get('user');
  return { userId: user.sub, roles: user.roles };
}

export function buildMeMissionsRouter(slice: MeMissionsSlice): OpenAPIHono {
  const controller = buildMeMissionsController(slice);
  const router = new OpenAPIHono();

  router.openapi(getMyMissionRoute, async (c) => {
    const { id } = c.req.valid('param');
    c.header('Cache-Control', NO_STORE);
    return respondWith(c, await controller.getMission(missionCaller(c), id, new Date())) as any;
  });

  router.openapi(joinMissionRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.join(missionCaller(c), id, new Date());
    c.header('Cache-Control', NO_STORE);
    if (!result.ok) return respondWith(c, result) as any;
    return c.json(result.data.entry, result.data.created ? 201 : 200) as any;
  });

  router.openapi(leaveMissionRoute, async (c) => {
    const { id } = c.req.valid('param');
    return respondNoContent(c, await controller.leave(missionCaller(c), id, new Date())) as any;
  });

  router.openapi(checkMissionStepRoute, async (c) => {
    const { id, reqId } = c.req.valid('param');
    c.header('Cache-Control', NO_STORE);
    return respondWith(c, await controller.check(missionCaller(c), id, reqId, new Date())) as any;
  });

  return router;
}
