import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { AdminMediaController } from '@api/controllers/admin-media.controller';
import type { ContentContext } from '@api/container';

/**
 * Mounted at /admin/topics in AppRouter.
 * Handles /admin/topics/:topicId/media/* paths.
 */
export function buildAdminMediaRouter(slice: { content: ContentContext }): Hono {
  const { topics, media, storage } = slice.content;

  const router = new Hono();
  const controller = new AdminMediaController(topics, media, storage);

  router.use('*', authGuard, requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR));

  router.get('/:topicId/media', async (c) => {
    const result = await controller.listMedia(c.req.param('topicId'));
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 404);
    return c.json({ data: result.data });
  });

  router.post('/:topicId/media/presign', async (c) => {
    const body = await c.req.json();
    const result = await controller.presignUpload(c.req.param('topicId'), body, c.get('user').sub);
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404 | 422);
    return c.json(result.data, 201);
  });

  router.post('/:topicId/media/:mediaId/finalize', async (c) => {
    const result = await controller.finalizeUpload(c.req.param('topicId'), c.req.param('mediaId'));
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 404 | 422);
    return c.json(result.data);
  });

  router.delete('/:topicId/media/:mediaId', async (c) => {
    const result = await controller.deleteMedia(c.req.param('topicId'), c.req.param('mediaId'));
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    return c.body(null, 204);
  });

  return router;
}
