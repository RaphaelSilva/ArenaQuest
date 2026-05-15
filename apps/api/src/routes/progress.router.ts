import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import { ProgressService } from '@api/core/progress/progress-service';
import type {
  IProgressRepository,
  IEnrollmentRepository,
  ITaskRepository,
  ITaskStageRepository,
  ITaskLinkingRepository,
  ITopicNodeRepository,
} from '@arenaquest/shared/ports';
import type { XpEngine } from '@arenaquest/shared/domain/gamification/xp-engine';
import type { StreakEngine } from '@arenaquest/shared/domain/gamification/streak-engine';

const CACHE_CONTROL = 'private, max-age=15';

function buildService(
  progress: IProgressRepository,
  enrollment: IEnrollmentRepository,
  tasks: ITaskRepository,
  stages: ITaskStageRepository,
  links: ITaskLinkingRepository,
  topics: ITopicNodeRepository,
): ProgressService {
  return new ProgressService(progress, enrollment, tasks, stages, links, topics);
}

// ---------------------------------------------------------------------------
// POST /tasks/:id/stages/:stageId/check-in
// ---------------------------------------------------------------------------

export function buildProgressTaskRouter(
  progress: IProgressRepository,
  enrollment: IEnrollmentRepository,
  tasks: ITaskRepository,
  stages: ITaskStageRepository,
  links: ITaskLinkingRepository,
  topics: ITopicNodeRepository,
  xpEngine?: XpEngine,
  streakEngine?: StreakEngine,
): Hono {
  const router = new Hono();
  const service = buildService(progress, enrollment, tasks, stages, links, topics);

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
    const status = result.data.changed ? 201 : 200;
    return c.json(result.data, status as 200 | 201);
  });

  return router;
}

// ---------------------------------------------------------------------------
// POST /topics/:id/visit and POST /topics/:id/complete
// ---------------------------------------------------------------------------

export function buildProgressTopicRouter(
  progress: IProgressRepository,
  enrollment: IEnrollmentRepository,
  tasks: ITaskRepository,
  stages: ITaskStageRepository,
  links: ITaskLinkingRepository,
  topics: ITopicNodeRepository,
  xpEngine?: XpEngine,
  streakEngine?: StreakEngine,
): Hono {
  const router = new Hono();
  const service = buildService(progress, enrollment, tasks, stages, links, topics);

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
    return c.json(result.data);
  });

  return router;
}

// ---------------------------------------------------------------------------
// GET /me/progress/summary, /me/progress/topics, /me/progress/tasks
// ---------------------------------------------------------------------------

export function buildMeProgressRouter(
  progress: IProgressRepository,
  enrollment: IEnrollmentRepository,
  tasks: ITaskRepository,
  stages: ITaskStageRepository,
  links: ITaskLinkingRepository,
  topics: ITopicNodeRepository,
): Hono {
  const router = new Hono();
  const service = buildService(progress, enrollment, tasks, stages, links, topics);

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
