import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { AdminGroupsController } from '@api/controllers/admin-groups.controller';
import type { AppContainer } from '@api/container';

const UserGroupSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  name: z.string().openapi({ example: 'Year 1 Students' }),
  description: z.string().openapi({ example: 'All year-one students' }),
  memberCount: z.number().int().openapi({ example: 42 }),
  createdAt: z.string().openapi({ example: '2024-01-01T00:00:00Z' }),
});

const listGroupsRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'List Groups',
  description: 'Retrieve all user groups with member counts.',
  tags: ['admin:groups'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved group list',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(UserGroupSchema),
          }),
        },
      },
    },
  },
});

export function buildAdminGroupsRouter(container: AppContainer) {
  const { userGroups } = container.identity;
  const controller = new AdminGroupsController(userGroups);
  const router = new OpenAPIHono();

  router.openapi(listGroupsRoute, async (c) => {
    const result = await controller.listAll();
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 500);
    }
    return c.json({ data: result.data }, 200);
  });

  return router;
}
