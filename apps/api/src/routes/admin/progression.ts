import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { AdminProgressionController } from '@api/controllers/admin-progression.controller';
import { respondWith, respondNoContent } from '@api/routes/_shared/envelope';
import type { AppContainer } from '@api/container';

const userIdParam = z.object({
  userId: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
});

const userBadgeParams = z.object({
  userId: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  badgeId: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
});

const PlayerProgressionSchema = z.object({
  userId: z.string(),
  xp: z.object({
    totalXp: z.number().int(),
    level: z.number().int(),
    rankTitle: z.string(),
  }),
  badges: z.array(
    z.object({
      badgeId: z.string(),
      slug: z.string(),
      name: z.string(),
      earnedAt: z.string(),
    }),
  ),
  recentXpEvents: z.array(
    z.object({
      id: z.string(),
      sourceKind: z.string(),
      points: z.number().int(),
      earnedAt: z.string(),
    }),
  ),
}).openapi('PlayerProgression');

const XpAdjustmentBodySchema = z.object({
  points: z.number().int().openapi({ example: 50 }),
  reason: z.string().trim().min(1).openapi({ example: 'Manual correction' }),
}).openapi('XpAdjustmentBody');

const XpTotalsSchema = z.object({
  previousTotal: z.number().int(),
  newTotal: z.number().int(),
});

export const getProgressionRoute = createRoute({
  method: 'get',
  path: '/{userId}/progression',
  summary: 'Get Player Progression',
  description: 'Retrieve a player’s total XP, resolved level/rank, earned badges, and recent XP events.',
  tags: ['admin:players'],
  security: [{ bearerAuth: [] }],
  request: { params: userIdParam },
  responses: {
    200: {
      description: 'Player progression',
      content: { 'application/json': { schema: PlayerProgressionSchema } },
    },
  },
});

export const awardBadgeRoute = createRoute({
  method: 'post',
  path: '/{userId}/badges/{badgeId}',
  summary: 'Award Badge to Player',
  description: 'Manually award a badge to a player.',
  tags: ['admin:players'],
  security: [{ bearerAuth: [] }],
  request: { params: userBadgeParams },
  responses: {
    200: {
      description: 'Badge awarded',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string(),
            userId: z.string(),
            badgeId: z.string(),
            earnedAt: z.string(),
          }),
        },
      },
    },
  },
});

export const revokeBadgeRoute = createRoute({
  method: 'delete',
  path: '/{userId}/badges/{badgeId}',
  summary: 'Revoke Badge from Player',
  description: 'Remove a badge a player holds. Returns 404 when the player does not hold it. Does not touch XP.',
  tags: ['admin:players'],
  security: [{ bearerAuth: [] }],
  request: { params: userBadgeParams },
  responses: {
    204: { description: 'Badge revoked' },
    404: { description: 'Player does not hold this badge' },
  },
});

export const adjustXpRoute = createRoute({
  method: 'post',
  path: '/{userId}/xp-adjustments',
  summary: 'Adjust Player XP',
  description:
    'Append an admin_adjustment XP event (positive or negative). user_xp.total_xp is clamped at 0; the ledger keeps the true delta.',
  tags: ['admin:players'],
  security: [{ bearerAuth: [] }],
  request: {
    params: userIdParam,
    body: { content: { 'application/json': { schema: XpAdjustmentBodySchema } } },
  },
  responses: {
    200: {
      description: 'Adjustment applied',
      content: { 'application/json': { schema: XpTotalsSchema } },
    },
    400: { description: 'Bad Request / Validation Failed' },
  },
});

export const recomputeXpRoute = createRoute({
  method: 'post',
  path: '/{userId}/xp-recompute',
  summary: 'Recompute Player XP',
  description: 'Rewrite user_xp.total_xp to MAX(0, SUM(xp_events.points)). Appends no event.',
  tags: ['admin:players'],
  security: [{ bearerAuth: [] }],
  request: { params: userIdParam },
  responses: {
    200: {
      description: 'XP recomputed',
      content: { 'application/json': { schema: XpTotalsSchema } },
    },
  },
});

export function buildAdminProgressionRouter(container: AppContainer) {
  const { gamificationRepo, badgeRepo } = container.gamification;
  const controller = new AdminProgressionController(gamificationRepo, badgeRepo);

  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'ValidationError' as const, issues: result.error.issues }, 400);
      }
    },
  });

  // Per-user progression administration is ADMIN-only, stricter than the admin
  // umbrella (ADMIN, CONTENT_CREATOR).
  router.use('*', requireRole(ROLES.ADMIN));

  router.openapi(getProgressionRoute, async (c) => {
    const { userId } = c.req.valid('param');
    const result = await controller.getProgression(userId);
    return respondWith(c, result);
  });

  router.openapi(awardBadgeRoute, async (c) => {
    const { userId, badgeId } = c.req.valid('param');
    const record = await badgeRepo.awardBadge(userId, badgeId);
    return c.json(record, 200);
  });

  router.openapi(revokeBadgeRoute, async (c) => {
    const { userId, badgeId } = c.req.valid('param');
    const result = await controller.revokeBadge(userId, badgeId);
    return respondNoContent(c, result);
  });

  router.openapi(adjustXpRoute, async (c) => {
    const { userId } = c.req.valid('param');
    const body = c.req.valid('json');
    const adminId = c.get('user').sub;
    const result = await controller.adjustXp(userId, adminId, body);
    return respondWith(c, result);
  });

  router.openapi(recomputeXpRoute, async (c) => {
    const { userId } = c.req.valid('param');
    const result = await controller.recomputeXp(userId);
    return respondWith(c, result);
  });

  return router;
}
