import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { AdminTopicsController } from '@api/controllers/admin-topics.controller';
import type { ContentContext } from '@api/container';

export function buildAdminTopicsRouter(slice: { content: ContentContext }): Hono {
  const { topics, tags } = slice.content;

  const router = new Hono();
  const controller = new AdminTopicsController(topics, tags);

  router.use('*', authGuard, requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR));

  // GET /admin/topics — flat list of all nodes (all statuses, all archive states)
  router.get('/', async (c) => {
    const result = await controller.listAll();
    if (!result.ok) return c.json({ error: result.error }, result.status as never);
    return c.json({ data: result.data });
  });

  // POST /admin/topics — create a node
  router.post('/', async (c) => {
    const body = await c.req.json();
    const result = await controller.create(body);
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404 | 422);
    return c.json(result.data, 201);
  });

  // GET /admin/topics/:id — single node with its direct children
  router.get('/:id', async (c) => {
    const result = await controller.getById(c.req.param('id'));
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    return c.json(result.data);
  });

  // PATCH /admin/topics/:id — update metadata
  router.patch('/:id', async (c) => {
    const body = await c.req.json();
    const result = await controller.update(c.req.param('id'), body);
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404 | 422);
    return c.json(result.data);
  });

  // POST /admin/topics/:id/move — re-parent and/or reorder
  router.post('/:id/move', async (c) => {
    const body = await c.req.json();
    const result = await controller.move(c.req.param('id'), body);
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404 | 409);
    return c.json(result.data);
  });

  // DELETE /admin/topics/:id — soft-archive (cascades to all descendants)
  router.delete('/:id', async (c) => {
    const result = await controller.archive(c.req.param('id'));
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    return c.body(null, 204);
  });

  return router;
}
