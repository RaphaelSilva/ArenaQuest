import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { AdminMissionsController } from '@api/controllers/admin-missions.controller';
import type { IMissionRepository } from '@arenaquest/shared/ports';

export function buildAdminMissionsRouter(missionRepo: IMissionRepository): Hono {
  const router = new Hono();
  const controller = new AdminMissionsController(missionRepo);

  router.use('*', authGuard, requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR));

  // GET /admin/missions — list all missions
  router.get('/', async (c) => {
    const result = await controller.list();
    if (!result.ok) return c.json({ error: result.error }, result.status as 400);
    return c.json({ data: result.data });
  });

  // POST /admin/missions — create mission
  router.post('/', async (c) => {
    const body = await c.req.json();
    const result = await controller.create(body);
    if (!result.ok) {
      return c.json({ error: result.error, meta: result.meta }, result.status as 400);
    }
    return c.json({ data: result.data }, 201);
  });

  // PATCH /admin/missions/:id — update mission
  router.patch('/:id', async (c) => {
    const body = await c.req.json();
    const result = await controller.update(c.req.param('id'), body);
    if (!result.ok) {
      return c.json({ error: result.error, meta: result.meta }, result.status as 400 | 404);
    }
    return c.json({ data: result.data });
  });

  // DELETE /admin/missions/:id — soft delete mission
  router.delete('/:id', async (c) => {
    const result = await controller.delete(c.req.param('id'));
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    return c.json({ data: result.data });
  });

  return router;
}
