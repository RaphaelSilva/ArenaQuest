import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { EnrollmentService } from '@api/core/enrollment/enrollment-service';
import { respondWith, respondNoContent } from '@api/routes/_shared/envelope';
import type { AppContainer } from '@api/container';

const EnrollmentGrantSchema = z.object({
  id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  userId: z.string().openapi({ example: 'student-id' }),
  topicNodeId: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  grantedBy: z.string().openapi({ example: 'admin-id' }),
  grantedAt: z.string().openapi({ example: '2023-01-01T12:00:00Z' }),
});

const GroupEnrollmentGrantSchema = z.object({
  id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  groupId: z.string().openapi({ example: 'group-id' }),
  topicNodeId: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  grantedBy: z.string().openapi({ example: 'admin-id' }),
  grantedAt: z.string().openapi({ example: '2023-01-01T12:00:00Z' }),
});

export const listUserEnrollmentsRoute = createRoute({
  method: 'get',
  path: '/users/{userId}/enrollments',
  summary: 'List User Enrollments',
  description: 'Retrieve a list of topic node enrollments granted to a specific user.',
  tags: ['admin:enrollments'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      userId: z.string().openapi({ example: 'student-id' }),
    }),
  },
  responses: {
    200: {
      description: 'Successfully retrieved user enrollments',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(EnrollmentGrantSchema),
          }),
        },
      },
    },
    404: {
      description: 'User not found',
    },
  },
});

export const grantUserEnrollmentRoute = createRoute({
  method: 'post',
  path: '/users/{userId}/enrollments',
  summary: 'Grant User Enrollment',
  description: 'Enroll a user in a specific topic node.',
  tags: ['admin:enrollments'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      userId: z.string().openapi({ example: 'student-id' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            topicNodeId: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully enrolled user (created)',
      content: {
        'application/json': {
          schema: EnrollmentGrantSchema,
        },
      },
    },
    200: {
      description: 'User is already enrolled (idempotent)',
      content: {
        'application/json': {
          schema: EnrollmentGrantSchema,
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    404: {
      description: 'User or Topic not found',
    },
  },
});

export const revokeUserEnrollmentRoute = createRoute({
  method: 'delete',
  path: '/users/{userId}/enrollments/{topicId}',
  summary: 'Revoke User Enrollment',
  description: 'Revoke enrollment from a user for a specific topic node, optionally cascading to descendants.',
  tags: ['admin:enrollments'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      userId: z.string().openapi({ example: 'student-id' }),
      topicId: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
    }),
  },
  responses: {
    204: {
      description: 'Successfully revoked user enrollment',
    },
    404: {
      description: 'Enrollment not found',
    },
  },
});

export const listGroupEnrollmentsRoute = createRoute({
  method: 'get',
  path: '/groups/{groupId}/enrollments',
  summary: 'List Group Enrollments',
  description: 'Retrieve a list of topic node enrollments granted to a specific group.',
  tags: ['admin:enrollments'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      groupId: z.string().openapi({ example: 'group-id' }),
    }),
  },
  responses: {
    200: {
      description: 'Successfully retrieved group enrollments',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(GroupEnrollmentGrantSchema),
          }),
        },
      },
    },
    404: {
      description: 'Group not found',
    },
  },
});

export const grantGroupEnrollmentRoute = createRoute({
  method: 'post',
  path: '/groups/{groupId}/enrollments',
  summary: 'Grant Group Enrollment',
  description: 'Enroll a group in a specific topic node.',
  tags: ['admin:enrollments'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      groupId: z.string().openapi({ example: 'group-id' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            topicNodeId: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully enrolled group (created)',
      content: {
        'application/json': {
          schema: GroupEnrollmentGrantSchema,
        },
      },
    },
    200: {
      description: 'Group is already enrolled (idempotent)',
      content: {
        'application/json': {
          schema: GroupEnrollmentGrantSchema,
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    404: {
      description: 'Group or Topic not found',
    },
  },
});

export const revokeGroupEnrollmentRoute = createRoute({
  method: 'delete',
  path: '/groups/{groupId}/enrollments/{topicId}',
  summary: 'Revoke Group Enrollment',
  description: 'Revoke enrollment from a group for a specific topic node, optionally cascading to descendants.',
  tags: ['admin:enrollments'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      groupId: z.string().openapi({ example: 'group-id' }),
      topicId: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
    }),
  },
  responses: {
    204: {
      description: 'Successfully revoked group enrollment',
    },
    404: {
      description: 'Enrollment not found',
    },
  },
});

export function buildAdminEnrollmentsRouter(container: AppContainer) {
  const { enrollmentRepo: enrollment } = container.progress;
  const { users } = container.identity;
  const { topics } = container.content;
  const service = new EnrollmentService(enrollment, users, topics);
  const router = new OpenAPIHono();

  router.openapi(listUserEnrollmentsRoute, async (c) => {
    const userId = c.req.valid('param').userId;
    const result = await service.listUserGrants(userId);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(grantUserEnrollmentRoute, async (c) => {
    const userId = c.req.valid('param').userId;
    const body = c.req.valid('json');
    const actorId = c.get('user').sub;
    const result = await service.grantUser(userId, body.topicNodeId, actorId);
    if (!result.ok) return respondWith(c, result);
    const status = result.data.created ? 201 : 200;
    return c.json(result.data.grant, status as 200 | 201);
  });

  router.openapi(revokeUserEnrollmentRoute, async (c) => {
    const { userId, topicId } = c.req.valid('param');
    const body = await c.req.json().catch(() => ({}));
    const cascade = typeof body === 'object' && body !== null ? (body.cascade ?? false) : false;
    const actorId = c.get('user').sub;
    const result = await service.revokeUser(userId, topicId, actorId, { cascade });
    return respondNoContent(c, result);
  });

  router.openapi(listGroupEnrollmentsRoute, async (c) => {
    const groupId = c.req.valid('param').groupId;
    const result = await service.listGroupGrants(groupId);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(grantGroupEnrollmentRoute, async (c) => {
    const groupId = c.req.valid('param').groupId;
    const body = c.req.valid('json');
    const actorId = c.get('user').sub;
    const result = await service.grantGroup(groupId, body.topicNodeId, actorId);
    if (!result.ok) return respondWith(c, result);
    const status = result.data.created ? 201 : 200;
    return c.json(result.data.grant, status as 200 | 201);
  });

  router.openapi(revokeGroupEnrollmentRoute, async (c) => {
    const { groupId, topicId } = c.req.valid('param');
    const body = await c.req.json().catch(() => ({}));
    const cascade = typeof body === 'object' && body !== null ? (body.cascade ?? false) : false;
    const actorId = c.get('user').sub;
    const result = await service.revokeGroup(groupId, topicId, actorId, { cascade });
    return respondNoContent(c, result);
  });

  return router;
}
