import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { AdminGroupsController } from '@api/controllers/admin-groups.controller';
import { respondWith, respondCreated, respondNoContent } from '@api/routes/_shared/envelope';
import type { AppContainer } from '@api/container';

const UserGroupSchema = z.object({
  id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  name: z.string().openapi({ example: 'Year 1 Students' }),
  description: z.string().openapi({ example: 'All year-one students' }),
  memberCount: z.number().int().openapi({ example: 42 }),
  createdAt: z.string().openapi({ example: '2024-01-01T00:00:00Z' }),
});

const GroupMemberSchema = z.object({
  userId: z.string().openapi({ example: 'student-id' }),
  name: z.string().openapi({ example: 'Jane Doe' }),
  email: z.string().openapi({ example: 'jane@example.com' }),
});

const listGroupsRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'List Groups',
  description: 'Retrieve all user groups with member counts.',
  tags: ['admin:groups'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved group list',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(UserGroupSchema) }),
        },
      },
    },
  },
});

const createGroupRoute = createRoute({
  method: 'post',
  path: '/',
  summary: 'Create Group',
  description: 'Create a new user group.',
  tags: ['admin:groups'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(100).openapi({ example: 'Year 1 Students' }),
            description: z.string().max(500).optional().openapi({ example: 'All year-one students' }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Group created',
      content: { 'application/json': { schema: UserGroupSchema } },
    },
    400: { description: 'Bad Request / Validation Failed' },
    409: { description: 'A group with this name already exists' },
  },
});

const listMembersRoute = createRoute({
  method: 'get',
  path: '/{groupId}/members',
  summary: 'List Group Members',
  description: 'Retrieve the members of a group.',
  tags: ['admin:groups'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ groupId: z.string().openapi({ example: 'group-id' }) }),
  },
  responses: {
    200: {
      description: 'Successfully retrieved members',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(GroupMemberSchema) }),
        },
      },
    },
    404: { description: 'Group not found' },
  },
});

const addMemberRoute = createRoute({
  method: 'post',
  path: '/{groupId}/members',
  summary: 'Add Group Member',
  description: 'Add a user to a group (idempotent).',
  tags: ['admin:groups'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ groupId: z.string().openapi({ example: 'group-id' }) }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ userId: z.string().openapi({ example: 'student-id' }) }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Member added',
      content: { 'application/json': { schema: GroupMemberSchema } },
    },
    400: { description: 'Bad Request / Validation Failed' },
    404: { description: 'Group or User not found' },
  },
});

const removeMemberRoute = createRoute({
  method: 'delete',
  path: '/{groupId}/members/{userId}',
  summary: 'Remove Group Member',
  description: 'Remove a user from a group.',
  tags: ['admin:groups'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      groupId: z.string().openapi({ example: 'group-id' }),
      userId: z.string().openapi({ example: 'student-id' }),
    }),
  },
  responses: {
    204: { description: 'Member removed' },
    404: { description: 'Group not found' },
  },
});

export function buildAdminGroupsRouter(container: AppContainer) {
  const { userGroups, users } = container.identity;
  const controller = new AdminGroupsController(userGroups, users);
  const router = new OpenAPIHono();

  router.openapi(listGroupsRoute, async (c) => {
    const result = await controller.listAll();
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(createGroupRoute, async (c) => {
    const body = c.req.valid('json');
    const result = await controller.createGroup({
      name: body.name,
      description: body.description ?? '',
    });
    return respondCreated(c, result);
  });

  router.openapi(listMembersRoute, async (c) => {
    const { groupId } = c.req.valid('param');
    const result = await controller.listMembers(groupId);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(addMemberRoute, async (c) => {
    const { groupId } = c.req.valid('param');
    const { userId } = c.req.valid('json');
    const result = await controller.addMember(groupId, userId);
    return respondCreated(c, result);
  });

  router.openapi(removeMemberRoute, async (c) => {
    const { groupId, userId } = c.req.valid('param');
    const result = await controller.removeMember(groupId, userId);
    return respondNoContent(c, result);
  });

  return router;
}
