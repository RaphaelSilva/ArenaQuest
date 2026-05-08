import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { TopicsController } from '@api/controllers/topics.controller';
import type {
  ITopicNodeRepository,
  IMediaRepository,
  IStorageAdapter,
  IEnrollmentRepository,
} from '@arenaquest/shared/ports';

const CACHE_CONTROL = 'private, max-age=30';

export function buildTopicsRouter(
  topics: ITopicNodeRepository,
  media: IMediaRepository,
  storage: IStorageAdapter,
  enrollment: IEnrollmentRepository,
): Hono {
  const router = new Hono();
  const controller = new TopicsController(topics, media, storage, enrollment);

  router.use('*', authGuard);

  // GET /topics — published catalogue tree
  router.get('/', async (c) => {
    const user = c.get('user');
    const isAdmin = user.roles.includes(ROLES.ADMIN) || user.roles.includes(ROLES.CONTENT_CREATOR);
    const result = await controller.listPublished(isAdmin ? undefined : user.sub);
    if (!result.ok) return c.json({ error: result.error }, result.status as never);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json({ data: result.data });
  });

  // GET /topics/:id — single published topic with published children and ready media
  router.get('/:id', async (c) => {
    const user = c.get('user');
    const isAdmin = user.roles.includes(ROLES.ADMIN) || user.roles.includes(ROLES.CONTENT_CREATOR);
    const result = await controller.getPublishedById(
      c.req.param('id'),
      isAdmin ? undefined : user.sub,
    );
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json(result.data);
  });

  return router;
}
