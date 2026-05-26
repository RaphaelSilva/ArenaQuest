import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { AdminBadgesController } from '@api/controllers/admin-badges.controller';
import { respondWith } from '@api/routes/_shared/envelope';
import type { AppContainer } from '@api/container';

const BadgeRecordSchema = z.object({
  id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  slug: z.string().openapi({ example: 'perfect-streak' }),
  name: z.string().openapi({ example: 'Perfect Streak' }),
  iconEmoji: z.string().openapi({ example: '🔥' }),
  description: z.string().nullable().optional().openapi({ example: 'Complete a streak.' }),
  xpReward: z.number().int().nullable().optional().openapi({ example: 100 }),
  ruleKind: z.string().openapi({ example: 'streak_days' }),
  ruleParams: z.string().nullable().optional().openapi({ example: '7' }),
  active: z.boolean().openapi({ example: true }),
  createdAt: z.string().openapi({ example: '2023-01-01T12:00:00Z' }),
  updatedAt: z.string().openapi({ example: '2023-01-01T13:00:00Z' }),
});

const UserBadgeRecordSchema = z.object({
  id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  userId: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  badgeId: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  awardedAt: z.string().openapi({ example: '2023-01-01T12:00:00Z' }),
});

export const listBadgesRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'List All Badges',
  description: 'Retrieve a list of all gamification badges.',
  tags: ['admin:badges'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved badges',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(BadgeRecordSchema),
          }),
        },
      },
    },
  },
});

export const createBadgeRoute = createRoute({
  method: 'post',
  path: '/',
  summary: 'Create Badge',
  description: 'Create a new gamification badge.',
  tags: ['admin:badges'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            slug: z.string().min(1).openapi({ example: 'perfect-streak' }),
            name: z.string().min(1).openapi({ example: 'Perfect Streak' }),
            iconEmoji: z.string().min(1).openapi({ example: '🔥' }),
            description: z.string().optional().openapi({ example: 'Complete a streak.' }),
            xpReward: z.number().int().min(0).optional().openapi({ example: 100 }),
            ruleKind: z.enum([
              'streak_days',
              'topic_completed',
              'videos_watched_in_period',
              'total_xp',
              'mission_completed',
            ]).openapi({ example: 'streak_days' }),
            ruleParams: z.string().optional().openapi({ example: '7' }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully created badge',
      content: {
        'application/json': {
          schema: z.object({
            data: BadgeRecordSchema,
          }),
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
  },
});

export const updateBadgeRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  summary: 'Update Badge',
  description: 'Update metadata of an existing badge.',
  tags: ['admin:badges'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).optional().openapi({ example: 'New Badge Name' }),
            iconEmoji: z.string().min(1).optional().openapi({ example: '🏆' }),
            description: z.string().optional().openapi({ example: 'New description' }),
            xpReward: z.number().int().min(0).optional().openapi({ example: 200 }),
            ruleKind: z.enum([
              'streak_days',
              'topic_completed',
              'videos_watched_in_period',
              'total_xp',
              'mission_completed',
            ]).optional().openapi({ example: 'total_xp' }),
            ruleParams: z.string().optional().openapi({ example: '1000' }),
            active: z.boolean().optional().openapi({ example: true }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully updated badge',
      content: {
        'application/json': {
          schema: z.object({
            data: BadgeRecordSchema,
          }),
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    404: {
      description: 'Badge not found',
    },
  },
});

export const awardBadgeRoute = createRoute({
  method: 'post',
  path: '/{badgeId}/award/{userId}',
  summary: 'Award Badge to User',
  description: 'Manually award a gamification badge to a user.',
  tags: ['admin:badges'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      badgeId: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
      userId: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
    }),
  },
  responses: {
    200: {
      description: 'Successfully awarded badge',
      content: {
        'application/json': {
          schema: z.object({
            data: UserBadgeRecordSchema,
          }),
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
  },
});

export function buildAdminBadgesRouter(container: AppContainer) {
  const { badgeRepo } = container.gamification;
  const controller = new AdminBadgesController(badgeRepo);
  const router = new OpenAPIHono();

  router.openapi(listBadgesRoute, async (c) => {
    const result = await controller.list();
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(createBadgeRoute, async (c) => {
    const body = c.req.valid('json');
    const result = await controller.create(body);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 201);
  });

  router.openapi(updateBadgeRoute, async (c) => {
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const result = await controller.update(id, body);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(awardBadgeRoute, async (c) => {
    const { badgeId, userId } = c.req.valid('param');
    const result = await controller.awardBadge(userId, badgeId);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  return router;
}
