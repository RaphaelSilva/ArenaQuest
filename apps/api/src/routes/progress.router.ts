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
): Hono {
  const router = new Hono();
  const service = buildService(progress, enrollment, tasks, stages, links, topics);

  router.use('*', authGuard);

  router.post('/:id/stages/:stageId/check-in', async (c) => {
    const userId = c.get('user').sub;
    const result = await service.stageCheckIn(
      userId,
      c.req.param('id'),
      c.req.param('stageId'),
    );
    if (!result.ok) {
      return c.json({ error: result.error, ...result.meta }, result.status as 403 | 404 | 409);
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
    const result = await service.completeTopic(userId, c.req.param('id'));
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 403 | 404);
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
