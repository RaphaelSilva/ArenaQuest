import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { AdminMissionsController } from '@api/controllers/admin-missions.controller';
import { respondWith } from '@api/routes/_shared/envelope';
import type { AppContainer } from '@api/container';

const MissionSchema = z.object({
  id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  title: z.string().openapi({ example: 'Weekly Sprint' }),
  description: z.string().openapi({ example: 'Complete 3 topics.' }),
  startAt: z.string().openapi({ example: '2023-01-01T12:00:00Z' }),
  endAt: z.string().openapi({ example: '2023-01-08T12:00:00Z' }),
  predicateKind: z.string().openapi({ example: 'topics_completed' }),
  predicateParams: z.string().openapi({ example: '3' }),
  xpReward: z.number().int().openapi({ example: 500 }),
  badgeId: z.string().uuid().nullable().openapi({ example: null }),
  active: z.boolean().openapi({ example: true }),
  createdAt: z.string().openapi({ example: '2023-01-01T12:00:00Z' }),
  updatedAt: z.string().openapi({ example: '2023-01-01T13:00:00Z' }),
});

export const listMissionsRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'List All Missions',
  description: 'Retrieve a list of all gamification missions.',
  tags: ['admin:missions'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved missions',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(MissionSchema),
          }),
        },
      },
    },
  },
});

export const createMissionRoute = createRoute({
  method: 'post',
  path: '/',
  summary: 'Create Mission',
  description: 'Create a new gamification mission.',
  tags: ['admin:missions'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            title: z.string().min(1).openapi({ example: 'Weekly Sprint' }),
            description: z.string().min(1).openapi({ example: 'Complete 3 topics.' }),
            startAt: z.string().datetime().openapi({ example: '2023-01-01T12:00:00Z' }),
            endAt: z.string().datetime().openapi({ example: '2023-01-08T12:00:00Z' }),
            predicateKind: z.string().min(1).openapi({ example: 'topics_completed' }),
            predicateParams: z.string().min(1).openapi({ example: '3' }),
            xpReward: z.number().int().min(0).openapi({ example: 500 }),
            badgeId: z.string().uuid().nullable().optional().openapi({ example: null }),
            active: z.boolean().optional().openapi({ example: true }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully created mission',
      content: {
        'application/json': {
          schema: z.object({
            data: MissionSchema,
          }),
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
  },
});

export const updateMissionRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  summary: 'Update Mission',
  description: 'Update an existing gamification mission.',
  tags: ['admin:missions'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            title: z.string().min(1).optional().openapi({ example: 'Updated Sprint' }),
            description: z.string().min(1).optional().openapi({ example: 'New description' }),
            startAt: z.string().datetime().optional().openapi({ example: '2023-01-01T12:00:00Z' }),
            endAt: z.string().datetime().optional().openapi({ example: '2023-01-08T12:00:00Z' }),
            predicateKind: z.string().min(1).optional().openapi({ example: 'topics_completed' }),
            predicateParams: z.string().min(1).optional().openapi({ example: '4' }),
            xpReward: z.number().int().min(0).optional().openapi({ example: 600 }),
            badgeId: z.string().uuid().nullable().optional().openapi({ example: null }),
            active: z.boolean().optional().openapi({ example: true }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully updated mission',
      content: {
        'application/json': {
          schema: z.object({
            data: MissionSchema,
          }),
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    404: {
      description: 'Mission not found',
    },
  },
});

export const deleteMissionRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  summary: 'Delete Mission',
  description: 'Soft delete a gamification mission.',
  tags: ['admin:missions'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
    }),
  },
  responses: {
    200: {
      description: 'Successfully deleted mission',
      content: {
        'application/json': {
          schema: z.object({
            data: z.object({
              success: z.boolean().openapi({ example: true }),
            }),
          }),
        },
      },
    },
    404: {
      description: 'Mission not found',
    },
  },
});

export function buildAdminMissionsRouter(container: AppContainer) {
  const { missionRepo } = container.gamification;
  const controller = new AdminMissionsController(missionRepo);
  const router = new OpenAPIHono();

  router.openapi(listMissionsRoute, async (c) => {
    const result = await controller.list();
    if (!result.ok) return respondWith(c, result) as any;
    return c.json({ data: result.data }, 200);
  });

  router.openapi(createMissionRoute, async (c) => {
    const body = c.req.valid('json');
    const result = await controller.create(body);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 201);
  });

  router.openapi(updateMissionRoute, async (c) => {
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const result = await controller.update(id, body);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(deleteMissionRoute, async (c) => {
    const id = c.req.valid('param').id;
    const result = await controller.delete(id);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  return router;
}
