import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { AdminQuestsController } from '@api/controllers/admin-quests.controller';
import { respondWith } from '@api/routes/_shared/envelope';
import { ROLES } from '@arenaquest/shared/constants/roles';
import type { AppContainer } from '@api/container';

const QuestSchema = z.object({
  id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  kind: z.enum(['daily', 'weekly']).openapi({ example: 'daily' }),
  title: z.string().openapi({ example: 'Daily Login' }),
  description: z.string().openapi({ example: 'Log in today.' }),
  predicateKind: z.string().openapi({ example: 'login_count' }),
  predicateParams: z.string().openapi({ example: '{"count":1}' }),
  xpReward: z.number().int().openapi({ example: 50 }),
  active: z.boolean().openapi({ example: true }),
  createdAt: z.string().openapi({ example: '2023-01-01T12:00:00Z' }),
  updatedAt: z.string().openapi({ example: '2023-01-01T13:00:00Z' }),
});

const createBodySchema = z.object({
  kind: z.enum(['daily', 'weekly']).openapi({ example: 'daily' }),
  title: z.string().min(1).openapi({ example: 'Daily Login' }),
  description: z.string().min(1).openapi({ example: 'Log in today.' }),
  predicateKind: z.string().min(1).openapi({ example: 'login_count' }),
  predicateParams: z.string().min(1).openapi({ example: '{"count":1}' }),
  xpReward: z.number().int().min(0).openapi({ example: 50 }),
  active: z.boolean().optional().openapi({ example: true }),
});

const updateBodySchema = z.object({
  kind: z.enum(['daily', 'weekly']).optional().openapi({ example: 'weekly' }),
  title: z.string().min(1).optional().openapi({ example: 'Updated Quest' }),
  description: z.string().min(1).optional().openapi({ example: 'New description.' }),
  predicateKind: z.string().min(1).optional().openapi({ example: 'login_count' }),
  predicateParams: z.string().min(1).optional().openapi({ example: '{"count":2}' }),
  xpReward: z.number().int().min(0).optional().openapi({ example: 75 }),
  active: z.boolean().optional().openapi({ example: true }),
});

export const listQuestsRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'List All Quests',
  description: 'Retrieve a list of all gamification quest definitions.',
  tags: ['admin:quests'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved quests',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(QuestSchema),
          }),
        },
      },
    },
  },
});

export const createQuestRoute = createRoute({
  method: 'post',
  path: '/',
  summary: 'Create Quest',
  description: 'Create a new gamification quest definition.',
  tags: ['admin:quests'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: createBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully created quest',
      content: {
        'application/json': {
          schema: z.object({
            data: QuestSchema,
          }),
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    403: {
      description: 'Forbidden — economy field edit requires admin',
    },
  },
});

export const updateQuestRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  summary: 'Update Quest',
  description: 'Update an existing gamification quest definition.',
  tags: ['admin:quests'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully updated quest',
      content: {
        'application/json': {
          schema: z.object({
            data: QuestSchema,
          }),
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    403: {
      description: 'Forbidden — economy field edit requires admin',
    },
    404: {
      description: 'Quest not found',
    },
  },
});

export const deleteQuestRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  summary: 'Delete Quest',
  description: 'Hard delete a gamification quest definition.',
  tags: ['admin:quests'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
    }),
  },
  responses: {
    200: {
      description: 'Successfully deleted quest',
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
      description: 'Quest not found',
    },
  },
});

export function buildAdminQuestsRouter(container: AppContainer) {
  const { questRepo } = container.gamification;
  const controller = new AdminQuestsController(questRepo);
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'ValidationError' as const, issues: result.error.issues }, 400);
      }
    },
  });

  router.openapi(listQuestsRoute, async (c) => {
    const result = await controller.list();
    if (!result.ok) return respondWith(c, result) as any;
    return c.json({ data: result.data }, 200);
  });

  router.openapi(createQuestRoute, async (c) => {
    const body = c.req.valid('json');
    const canEditEconomy = c.get('user').roles.includes(ROLES.ADMIN);
    const result = await controller.create(body, canEditEconomy);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 201);
  });

  router.openapi(updateQuestRoute, async (c) => {
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const canEditEconomy = c.get('user').roles.includes(ROLES.ADMIN);
    const result = await controller.update(id, body, canEditEconomy);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(deleteQuestRoute, async (c) => {
    const id = c.req.valid('param').id;
    const result = await controller.delete(id);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  return router;
}
