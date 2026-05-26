import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import { ProgressService } from '@api/core/progress/progress-service';
import type { ProgressContext, EngagementContext, ContentContext, GamificationContext } from '@api/container';

const CACHE_CONTROL = 'private, max-age=15';

function buildService(
  slice: { progress: ProgressContext; engagement: EngagementContext; content: ContentContext },
): ProgressService {
  const { progressRepo: progress, enrollmentRepo: enrollment } = slice.progress;
  const { taskRepo: tasks, taskStages: stages, taskLinks: links } = slice.engagement;
  const { topics } = slice.content;
  return new ProgressService(progress, enrollment, tasks, stages, links, topics);
}

// ---------------------------------------------------------------------------
// POST /tasks/:id/stages/:stageId/check-in
// ---------------------------------------------------------------------------

export function buildProgressTaskRouter(slice: {
  progress: ProgressContext;
  engagement: EngagementContext;
  content: ContentContext;
  gamification: GamificationContext;
}): Hono {
  const { xpEngine, streakEngine, questEvaluator, badgeEngine } = slice.gamification;

  const router = new Hono();
  const service = buildService(slice);

  router.use('*', authGuard);

  router.post('/:id/stages/:stageId/check-in', async (c) => {
    const userId = c.get('user').sub;
    const stageId = c.req.param('stageId');
    const result = await service.stageCheckIn(
      userId,
      c.req.param('id'),
      stageId,
    );
    if (!result.ok) {
      return c.json({ error: result.error, ...result.meta }, result.status as 403 | 404 | 409);
    }
    if (result.data.changed && xpEngine) {
      try {
        await xpEngine.award({ userId, action: 'stage_checkin', sourceKind: 'stage', sourceId: stageId });
      } catch (err) {
        console.error('[XP] stage_checkin award failed:', err);
      }
    }
    if (result.data.changed && streakEngine) {
      try {
        await streakEngine.recordActivity(userId, new Date());
      } catch (err) {
        console.error('[streak] stage_checkin recordActivity failed:', err);
      }
    }
    if (result.data.changed && questEvaluator) {
      try {
        await questEvaluator.evaluate(userId, 'stage', new Date());
      } catch (err) {
        console.error('[quest] stage_checkin evaluate failed:', err);
      }
    }
    if (result.data.changed && badgeEngine) {
      try {
        await badgeEngine.evaluate(userId, new Date());
      } catch (err) {
        console.error('[badge] stage_checkin evaluate failed:', err);
      }
    }
    const status = result.data.changed ? 201 : 200;
    return c.json(result.data, status as 200 | 201);
  });

  return router;
}

// ---------------------------------------------------------------------------
// POST /topics/:id/visit and POST /topics/:id/complete
// ---------------------------------------------------------------------------

export function buildProgressTopicRouter(slice: {
  progress: ProgressContext;
  engagement: EngagementContext;
  content: ContentContext;
  gamification: GamificationContext;
}): Hono {
  const { xpEngine, streakEngine, questEvaluator, badgeEngine } = slice.gamification;

  const router = new Hono();
  const service = buildService(slice);

  router.use('*', authGuard);

  router.post('/:id/visit', async (c) => {
    const userId = c.get('user').sub;
    const result = await service.visitTopic(userId, c.req.param('id'));
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 403 | 404);
    }
    return c.json(result.data);
  });

  router.post('/:id/complete', async (c) => {
    const userId = c.get('user').sub;
    const topicId = c.req.param('id');
    const result = await service.completeTopic(userId, topicId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 403 | 404);
    }
    if (result.data.changed && xpEngine) {
      try {
        await xpEngine.award({ userId, action: 'topic_complete', sourceKind: 'topic', sourceId: topicId });
      } catch (err) {
        console.error('[XP] topic_complete award failed:', err);
      }
    }
    if (result.data.changed && streakEngine) {
      try {
        await streakEngine.recordActivity(userId, new Date());
      } catch (err) {
        console.error('[streak] topic_complete recordActivity failed:', err);
      }
    }
    if (result.data.changed && questEvaluator) {
      try {
        await questEvaluator.evaluate(userId, 'topic', new Date());
      } catch (err) {
        console.error('[quest] topic_complete evaluate failed:', err);
      }
    }
    if (result.data.changed && badgeEngine) {
      try {
        await badgeEngine.evaluate(userId, new Date());
      } catch (err) {
        console.error('[badge] topic_complete evaluate failed:', err);
      }
    }
    return c.json(result.data);
  });

  return router;
}

// ---------------------------------------------------------------------------
// GET /me/progress/summary, /me/progress/topics, /me/progress/tasks
// ---------------------------------------------------------------------------

export function buildMeProgressRouter(slice: {
  progress: ProgressContext;
  engagement: EngagementContext;
  content: ContentContext;
}): Hono {
  const router = new Hono();
  const service = buildService(slice);

  router.use('*', authGuard);

  router.get('/progress/summary', async (c) => {
    const userId = c.get('user').sub;
    const result = await service.getProgressSummary(userId);
    if (!result.ok) return c.json({ error: result.error }, result.status as never);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json(result.data);
  });

  router.get('/progress/topics', async (c) => {
    const userId = c.get('user').sub;
    const result = await service.listAccessibleTopicProgress(userId);
    if (!result.ok) return c.json({ error: result.error }, result.status as never);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json({ data: result.data });
  });

  router.get('/progress/tasks', async (c) => {
    const userId = c.get('user').sub;
    const result = await service.listAccessibleTaskProgress(userId);
    if (!result.ok) return c.json({ error: result.error }, result.status as never);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json({ data: result.data });
  });

  return router;
}
