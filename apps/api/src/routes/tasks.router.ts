import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { PublicTasksController } from '@api/controllers/public-tasks.controller';
import type { EngagementContext, ContentContext, ProgressContext } from '@api/container';

export function buildTasksRouter(slice: {
  engagement: EngagementContext;
  content: ContentContext;
  progress: ProgressContext;
}): Hono {
  const { taskRepo: tasks, taskStages: stages, taskLinks: links } = slice.engagement;
  const { topics } = slice.content;
  const { enrollmentRepo: enrollment } = slice.progress;

  const router = new Hono();
  const controller = new PublicTasksController(tasks, stages, links, topics, enrollment);

  router.use('*', authGuard);

  // GET /tasks?limit=&offset=
  router.get('/', async (c) => {
    const user = c.get('user');
    const isAdmin = user.roles.includes(ROLES.ADMIN) || user.roles.includes(ROLES.CONTENT_CREATOR);
    const limitStr = c.req.query('limit');
    const offsetStr = c.req.query('offset');
    const result = await controller.list(
      {
        limit: limitStr !== undefined ? Number(limitStr) : undefined,
        offset: offsetStr !== undefined ? Number(offsetStr) : undefined,
      },
      isAdmin ? undefined : user.sub,
    );
    if (!result.ok) return c.json({ error: result.error }, result.status as 400);
    c.header('Cache-Control', 'private, max-age=30');
    return c.json({ data: result.data });
  });

  // GET /tasks/:id
  router.get('/:id', async (c) => {
    const user = c.get('user');
    const isAdmin = user.roles.includes(ROLES.ADMIN) || user.roles.includes(ROLES.CONTENT_CREATOR);
    const result = await controller.getById(c.req.param('id'), isAdmin ? undefined : user.sub);
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    return c.json(result.data);
  });

  return router;
}
