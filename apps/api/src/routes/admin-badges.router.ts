import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { AdminBadgesController } from '@api/controllers/admin-badges.controller';
import type { IBadgeRepository } from '@arenaquest/shared/ports';

export function buildAdminBadgesRouter(badgeRepo: IBadgeRepository): Hono {
  const router = new Hono();
  const controller = new AdminBadgesController(badgeRepo);

  router.use('*', authGuard, requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR));

  // GET /admin/badges — list all badges
  router.get('/', async (c) => {
    const result = await controller.list();
    if (!result.ok) return c.json({ error: result.error }, result.status as 400);
    return c.json({ data: result.data });
  });

  // POST /admin/badges — create badge
  router.post('/', async (c) => {
    const body = await c.req.json();
    const result = await controller.create(body);
    if (!result.ok) return c.json({ error: result.error, ...(result.meta ?? {}) }, result.status as 400);
    return c.json({ data: result.data }, 201);
  });

  // PATCH /admin/badges/:id — update badge
  router.patch('/:id', async (c) => {
    const body = await c.req.json();
    const result = await controller.update(c.req.param('id'), body);
    if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 404);
    return c.json({ data: result.data });
  });

  // POST /admin/badges/:badgeId/award/:userId — award badge to user
  router.post('/:badgeId/award/:userId', async (c) => {
    const result = await controller.awardBadge(c.req.param('userId'), c.req.param('badgeId'));
    if (!result.ok) return c.json({ error: result.error }, result.status as 400);
    return c.json({ data: result.data });
  });

  return router;
}
