import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import { PublicTasksController } from '@api/controllers/public-tasks.controller';
import type {
  ITaskRepository,
  ITaskStageRepository,
  ITaskLinkingRepository,
  ITopicNodeRepository,
} from '@arenaquest/shared/ports';

export function buildTasksRouter(
  tasks: ITaskRepository,
  stages: ITaskStageRepository,
  links: ITaskLinkingRepository,
  topics: ITopicNodeRepository,
): Hono {
  const router = new Hono();
  const controller = new PublicTasksController(tasks, stages, links, topics);

  router.use('*', authGuard);

  // GET /tasks?limit=&offset=
  router.get('/', async (c) => {
    const limitStr = c.req.query('limit');
    const offsetStr = c.req.query('offset');
    const result = await controller.list({
      limit: limitStr !== undefined ? Number(limitStr) : undefined,
      offset: offsetStr !== undefined ? Number(offsetStr) : undefined,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status as 400);
    c.header('Cache-Control', 'private, max-age=30');
    return c.json({ data: result.data });
  });

  // GET /tasks/:id
  router.get('/:id', async (c) => {
    const result = await controller.getById(c.req.param('id'));
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    return c.json(result.data);
  });

  return router;
}
