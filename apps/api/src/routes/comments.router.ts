import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import type { ICommentRepository, IEnrollmentRepository } from '@arenaquest/shared/ports';
import type { XpEngine } from '@arenaquest/shared/domain/gamification/xp-engine';
import { CommentsController } from '@api/controllers/comments.controller';

export function buildCommentsRouter(
  commentRepo: ICommentRepository,
  enrollmentRepo: IEnrollmentRepository,
  xpEngine?: XpEngine,
): Hono {
  const router = new Hono();
  const controller = new CommentsController(commentRepo);

  router.get('/topics/:id/comments', authGuard, async (c) => {
    const userId = c.get('user').sub;
    const topicId = c.req.param('id');
    const enrolledIds = await enrollmentRepo.getEffectiveAccessTopicIds(userId);
    const result = await controller.listComments(topicId, userId, enrolledIds);
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 403);
    return c.json({ data: result.data });
  });

  router.post('/topics/:id/comments', authGuard, async (c) => {
    const userId = c.get('user').sub;
    const topicId = c.req.param('id');
    const body = await c.req.json();
    const enrolledIds = await enrollmentRepo.getEffectiveAccessTopicIds(userId);
    const result = await controller.createComment(topicId, userId, body, enrolledIds);
    if (!result.ok) {
      return c.json({ error: result.error, ...result.meta }, result.status as 400 | 403 | 422);
    }
    if (xpEngine) {
      const todayKey = new Date().toISOString().slice(0, 10);
      try {
        await xpEngine.award({ userId, action: 'comment_posted', sourceKind: 'comment', sourceId: null, version: todayKey });
      } catch (err) {
        console.error('[XP] comment_posted award failed:', err);
      }
    }
    return c.json(result.data, 201);
  });

  router.post('/comments/:id/like', authGuard, async (c) => {
    const userId = c.get('user').sub;
    const commentId = c.req.param('id');
    const result = await controller.likeComment(commentId, userId);
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    return c.json(result.data);
  });

  router.delete('/comments/:id', authGuard, async (c) => {
    const userId = c.get('user').sub;
    const commentId = c.req.param('id');
    const userRoles = c.get('user').roles;
    const result = await controller.deleteComment(commentId, userId, userRoles);
    if (!result.ok) return c.json({ error: result.error }, result.status as 403 | 404);
    return c.body(null, 204);
  });

  return router;
}
