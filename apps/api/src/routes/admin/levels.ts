import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { AdminLevelsController } from '@api/controllers/admin-levels.controller';
import { respondWith } from '@api/routes/_shared/envelope';
import type { AppContainer } from '@api/container';

const LevelDefinitionSchema = z.object({
  level: z.number().int().openapi({ example: 1 }),
  rankTitle: z.string().min(1).openapi({ example: 'Aspirante' }),
  minXp: z.number().int().openapi({ example: 0 }),
  maxXp: z.number().int().nullable().openapi({ example: 100 }),
});

const ReplaceLevelsBodySchema = z.array(LevelDefinitionSchema).openapi('ReplaceLevelsBody');

export const listLevelsRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'List Level Definitions',
  description: 'Retrieve the level curve ordered by level.',
  tags: ['admin:levels'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved level definitions',
      content: {
        'application/json': {
          schema: z.array(LevelDefinitionSchema),
        },
      },
    },
  },
});

export const replaceLevelsRoute = createRoute({
  method: 'put',
  path: '/',
  summary: 'Replace Level Definitions',
  description:
    'Replace the entire level curve in one transaction. The curve must be contiguous, with strictly increasing minXp and exactly one final open-ended (maxXp = null) level.',
  tags: ['admin:levels'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: ReplaceLevelsBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully replaced the level curve',
      content: {
        'application/json': {
          schema: z.array(LevelDefinitionSchema),
        },
      },
    },
    400: {
      description: 'Bad Request / Curve validation failed',
    },
  },
});

export function buildAdminLevelsRouter(container: AppContainer) {
  const { gamificationRepo } = container.gamification;
  const controller = new AdminLevelsController(gamificationRepo);

  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'ValidationError' as const, issues: result.error.issues }, 400);
      }
    },
  });

  // The level curve is economy-affecting: the whole surface is ADMIN-only,
  // stricter than the admin umbrella (ADMIN, CONTENT_CREATOR).
  router.use('*', requireRole(ROLES.ADMIN));

  router.openapi(listLevelsRoute, async (c) => {
    const result = await controller.list();
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(replaceLevelsRoute, async (c) => {
    const body = c.req.valid('json');
    const result = await controller.replaceAll(body);
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  return router;
}
