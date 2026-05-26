import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import { CommentsController } from '@api/controllers/comments.controller';
import type { EngagementContext, ProgressContext, GamificationContext } from '@api/container';

export function buildCommentsRouter(slice: {
  engagement: EngagementContext;
  progress: ProgressContext;
  gamification: GamificationContext;
}): Hono {
  const { commentRepo } = slice.engagement;
  const { enrollmentRepo } = slice.progress;
  const { xpEngine } = slice.gamification;

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

  return router;
}
