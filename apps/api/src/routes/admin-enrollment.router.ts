import { Hono } from 'hono';
import { z } from 'zod';
import { authGuard } from '@api/middleware/auth-guard';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { EnrollmentService } from '@api/core/enrollment/enrollment-service';
import type {
  IEnrollmentRepository,
  IUserRepository,
  ITopicNodeRepository,
} from '@arenaquest/shared/ports';

const GrantSchema = z.object({
  topicNodeId: z.string().uuid(),
});

const CascadeSchema = z.object({
  cascade: z.boolean().optional(),
});

export function buildAdminEnrollmentRouter(
  enrollment: IEnrollmentRepository,
  users: IUserRepository,
  topics: ITopicNodeRepository,
): Hono {
  const router = new Hono();
  const service = new EnrollmentService(enrollment, users, topics);

  router.use('*', authGuard, requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR));

  // ---------------------------------------------------------------------------
  // User enrollment endpoints
  // ---------------------------------------------------------------------------

  router.get('/users/:userId/enrollments', async (c) => {
    const result = await service.listUserGrants(c.req.param('userId'));
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    return c.json({ data: result.data });
  });

  router.post('/users/:userId/enrollments', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = GrantSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: 'BadRequest', details: parsed.error.flatten() },
        400,
      );
    }

    const actorId = c.get('user').sub;
    const result = await service.grantUser(
      c.req.param('userId'),
      parsed.data.topicNodeId,
      actorId,
    );
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 404);
    const status = result.data.created ? 201 : 200;
    return c.json(result.data.grant, status as 200 | 201);
  });

  router.delete('/users/:userId/enrollments/:topicId', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = CascadeSchema.safeParse(body);
    const cascade = parsed.success ? (parsed.data.cascade ?? false) : false;

    const actorId = c.get('user').sub;
    const result = await service.revokeUser(
      c.req.param('userId'),
      c.req.param('topicId'),
      actorId,
      { cascade },
    );
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------------------
  // Group enrollment endpoints
  // ---------------------------------------------------------------------------

  router.get('/groups/:groupId/enrollments', async (c) => {
    const result = await service.listGroupGrants(c.req.param('groupId'));
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    return c.json({ data: result.data });
  });

  router.post('/groups/:groupId/enrollments', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = GrantSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: 'BadRequest', details: parsed.error.flatten() },
        400,
      );
    }

    const actorId = c.get('user').sub;
    const result = await service.grantGroup(
      c.req.param('groupId'),
      parsed.data.topicNodeId,
      actorId,
    );
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 404);
    const status = result.data.created ? 201 : 200;
    return c.json(result.data.grant, status as 200 | 201);
  });

  router.delete('/groups/:groupId/enrollments/:topicId', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = CascadeSchema.safeParse(body);
    const cascade = parsed.success ? (parsed.data.cascade ?? false) : false;

    const actorId = c.get('user').sub;
    const result = await service.revokeGroup(
      c.req.param('groupId'),
      c.req.param('topicId'),
      actorId,
      { cascade },
    );
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    return c.body(null, 204);
  });

  return router;
}
