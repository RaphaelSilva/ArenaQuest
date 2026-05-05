import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { AdminTasksController } from '@api/controllers/admin-tasks.controller';
import { AdminTaskStagesController } from '@api/controllers/admin-task-stages.controller';
import { AdminTaskLinkingController } from '@api/controllers/admin-task-linking.controller';
import type {
  ITaskRepository,
  ITaskStageRepository,
  ITaskLinkingRepository,
  ITopicNodeRepository,
} from '@arenaquest/shared/ports';

export function buildAdminTasksRouter(
  tasks: ITaskRepository,
  stages: ITaskStageRepository,
  links: ITaskLinkingRepository,
  topics: ITopicNodeRepository,
): Hono {
  const router = new Hono();
  const controller = new AdminTasksController(tasks, stages, links, topics);
  const stagesController = new AdminTaskStagesController(tasks, stages);
  const linkingController = new AdminTaskLinkingController(tasks, stages, links, topics);

  router.use('*', authGuard, requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR));

  // GET /admin/tasks?status=&limit=&offset=
  router.get('/', async (c) => {
    const status = c.req.query('status');
    const limitStr = c.req.query('limit');
    const offsetStr = c.req.query('offset');
    const result = await controller.list({
      status,
      limit: limitStr !== undefined ? Number(limitStr) : undefined,
      offset: offsetStr !== undefined ? Number(offsetStr) : undefined,
    });
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400);
    return c.json({ data: result.data });
  });

  // POST /admin/tasks
  router.post('/', async (c) => {
    const body = await c.req.json();
    const user = c.get('user');
    const result = await controller.create(body, user.sub);
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400);
    return c.json(result.data, 201);
  });

  // GET /admin/tasks/:id
  router.get('/:id', async (c) => {
    const result = await controller.getById(c.req.param('id'));
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    return c.json(result.data);
  });

  // PATCH /admin/tasks/:id
  router.patch('/:id', async (c) => {
    const body = await c.req.json();
    const result = await controller.update(c.req.param('id'), body);
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404 | 409);
    return c.json(result.data);
  });

  // POST /admin/tasks/:id/topics — replace task-level link set
  router.post('/:id/topics', async (c) => {
    const body = await c.req.json();
    const result = await linkingController.replaceTaskTopics(c.req.param('id'), body);
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404 | 409);
    return c.json(result.data);
  });

  // POST /admin/tasks/:id/stages/:stageId/topics — replace stage-level link set
  router.post('/:id/stages/:stageId/topics', async (c) => {
    const body = await c.req.json();
    const result = await linkingController.replaceStageTopics(
      c.req.param('id'),
      c.req.param('stageId'),
      body,
    );
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404 | 409);
    return c.json(result.data);
  });

  // POST /admin/tasks/:id/stages
  router.post('/:id/stages', async (c) => {
    const body = await c.req.json();
    const result = await stagesController.create(c.req.param('id'), body);
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404);
    return c.json(result.data, 201);
  });

  // POST /admin/tasks/:id/stages/reorder — must precede /:stageId routes.
  router.post('/:id/stages/reorder', async (c) => {
    const body = await c.req.json();
    const result = await stagesController.reorder(c.req.param('id'), body);
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404 | 409);
    return c.json({ data: result.data });
  });

  // PATCH /admin/tasks/:id/stages/:stageId
  router.patch('/:id/stages/:stageId', async (c) => {
    const body = await c.req.json();
    const result = await stagesController.update(c.req.param('id'), c.req.param('stageId'), body);
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404);
    return c.json(result.data);
  });

  // DELETE /admin/tasks/:id/stages/:stageId
  router.delete('/:id/stages/:stageId', async (c) => {
    const result = await stagesController.delete(c.req.param('id'), c.req.param('stageId'));
    if (!result.ok) return c.json({ error: result.error }, result.status as 404 | 409);
    return c.body(null, 204);
  });

  // DELETE /admin/tasks/:id — soft archive
  router.delete('/:id', async (c) => {
    const result = await controller.archive(c.req.param('id'));
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    return c.body(null, 204);
  });

  return router;
}
