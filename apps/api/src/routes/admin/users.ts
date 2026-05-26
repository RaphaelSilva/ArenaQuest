import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { Entities } from '@arenaquest/shared/types/entities';
import { AdminUsersController } from '../../controllers/admin-users.controller';
import { respondWith } from '../_shared/envelope';
import type { AppContainer } from '../../container';

const ROLE_VALUES = ['admin', 'content_creator', 'tutor', 'student'] as const;
const STATUS_VALUES = ['active', 'inactive', 'pending', 'banned'] as const;

const CreateUserRequestSchema = z.object({
  name: z.string().min(2).openapi({ example: 'New User' }),
  email: z.string().email().openapi({ example: 'newuser@arenaquest.app' }),
  password: z.string().min(8).openapi({ example: 'password123' }),
  roles: z.array(z.enum(ROLE_VALUES)).default(['student']).openapi({ example: ['student'] }),
});

const UpdateUserRequestSchema = z.object({
  name: z.string().min(2).optional().openapi({ example: 'Updated Name' }),
  status: z.enum(STATUS_VALUES).optional().openapi({ example: 'inactive' }),
  roles: z.array(z.enum(ROLE_VALUES)).optional().openapi({ example: ['student'] }),
});

const UserRoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

const UserEntitySchema = z.object({
  id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  name: z.string().openapi({ example: 'John Doe' }),
  email: z.string().email().openapi({ example: 'john@example.com' }),
  status: z.string().openapi({ example: 'active' }),
  roles: z.array(UserRoleSchema),
  createdAt: z.string().openapi({ example: '2023-01-01T12:00:00Z' }),
  updatedAt: z.string().openapi({ example: '2023-01-01T13:00:00Z' }),
});

function auditSessionRevocation(event: string, userId: string, actor: string) {
  console.info(
    JSON.stringify({ event, userId, actor, at: new Date().toISOString() }),
  );
}

function wouldLoseLastAdmin(
  existing: Entities.Identity.User,
  nextStatus: string | undefined,
  nextRoles: string[] | undefined,
  activeAdminsNow: number,
): boolean {
  const existingIsActive = existing.status === Entities.Config.UserStatus.ACTIVE;
  const existingIsAdmin = existing.roles.some(r => r.name === ROLES.ADMIN);
  if (!existingIsActive || !existingIsAdmin) return false;

  const nextlyInactive =
    nextStatus !== undefined && nextStatus !== Entities.Config.UserStatus.ACTIVE;
  const losingAdminRole =
    nextRoles !== undefined && !nextRoles.includes(ROLES.ADMIN);

  if (!nextlyInactive && !losingAdminRole) return false;

  return activeAdminsNow <= 1;
}

function isSelfLockout(
  actorId: string,
  targetId: string,
  nextStatus: string | undefined,
  nextRoles: string[] | undefined,
): boolean {
  if (actorId !== targetId) return false;

  const selfDeactivating =
    nextStatus !== undefined && nextStatus !== Entities.Config.UserStatus.ACTIVE;
  const selfDemoting =
    nextRoles !== undefined && !nextRoles.includes(ROLES.ADMIN);

  return selfDeactivating || selfDemoting;
}

export const listUsersRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'List Users',
  description: 'Retrieve a paginated list of all users.',
  tags: ['admin:users'],
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      limit: z.string().optional().openapi({ example: '50' }),
      offset: z.string().optional().openapi({ example: '0' }),
    }),
  },
  responses: {
    200: {
      description: 'Successfully retrieved user list',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(UserEntitySchema),
            total: z.number().int(),
          }),
        },
      },
    },
  },
});

export const getUserRoute = createRoute({
  method: 'get',
  path: '/{id}',
  summary: 'Get User',
  description: 'Retrieve a single user by ID.',
  tags: ['admin:users'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
    }),
  },
  responses: {
    200: {
      description: 'User details',
      content: {
        'application/json': {
          schema: UserEntitySchema,
        },
      },
    },
    404: {
      description: 'User not found',
    },
  },
});

export const createUserRoute = createRoute({
  method: 'post',
  path: '/',
  summary: 'Create User',
  description: 'Create a new user with specified roles.',
  tags: ['admin:users'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateUserRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully created user',
      content: {
        'application/json': {
          schema: UserEntitySchema,
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    409: {
      description: 'Conflict / Email already exists',
    },
  },
});

export const updateUserRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  summary: 'Update User',
  description: 'Update metadata, status, or roles of a user. Prevents self-lockout or removing last active admin.',
  tags: ['admin:users'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateUserRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully updated user',
      content: {
        'application/json': {
          schema: UserEntitySchema,
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    404: {
      description: 'User not found',
    },
    409: {
      description: 'Conflict / Self lockout or last admin protection triggered',
    },
  },
});

export const deleteUserRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  summary: 'Delete User',
  description: 'Soft-delete a user by marking them inactive. Revokes all active refresh tokens.',
  tags: ['admin:users'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
    }),
  },
  responses: {
    204: {
      description: 'Successfully deleted user',
    },
    404: {
      description: 'User not found',
    },
    409: {
      description: 'Conflict / Self lockout or last admin protection triggered',
    },
  },
});

export const resetPasswordRoute = createRoute({
  method: 'post',
  path: '/{id}/reset-password',
  summary: 'Reset Password',
  description: 'Admin-initiated password reset for a user.',
  tags: ['admin:users'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({}),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully reset password',
      content: {
        'application/json': {
          schema: z.object({
            temporaryPassword: z.string().openapi({ example: 'tempPass123' }),
          }),
        },
      },
    },
    401: {
      description: 'Unauthorized',
    },
  },
});

export function buildAdminUsersRouter(container: AppContainer) {
  const { users, tokens } = container.identity;
  const { auth, mailer } = container.infra;

  const adminUsersController = new AdminUsersController(auth, users, tokens, mailer);
  const router = new OpenAPIHono();

  // Enforce ADMIN role strictly on all user endpoints
  router.use('*', requireRole(ROLES.ADMIN));

  router.openapi(listUsersRoute, async (c) => {
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
    const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10), 0);

    const [data, total] = await Promise.all([
      users.list({ limit, offset }),
      users.count(),
    ]);

    return c.json({ data, total }, 200);
  });

  router.openapi(getUserRoute, async (c) => {
    const user = await users.findById(c.req.valid('param').id);
    if (!user) return c.json({ error: 'NotFound' }, 404);
    return c.json(user, 200);
  });

  router.openapi(createUserRoute, async (c) => {
    const body = c.req.valid('json');
    const { name, email, password, roles } = body;
    const passwordHash = await auth.hashPassword(password);

    try {
      const user = await users.create({ name, email, passwordHash, roleNames: roles });
      return c.json(user, 201);
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        return c.json({ error: 'Conflict', detail: 'Email already exists' }, 409);
      }
      throw err;
    }
  });

  router.openapi(updateUserRoute, async (c) => {
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');

    const existing = await users.findById(id);
    if (!existing) return c.json({ error: 'NotFound' }, 404);

    const { name, status, roles } = body;
    const actor = c.get('user').sub;

    if (isSelfLockout(actor, id, status, roles)) {
      return c.json({ error: 'SELF_LOCKOUT' }, 409);
    }
    const existingIsActiveAdmin =
      existing.status === Entities.Config.UserStatus.ACTIVE &&
      existing.roles.some(r => r.name === ROLES.ADMIN);
    if (existingIsActiveAdmin) {
      const activeAdminsNow = await users.countActiveAdmins();
      if (wouldLoseLastAdmin(existing, status, roles, activeAdminsNow)) {
        return c.json({ error: 'WOULD_LOCK_OUT_ADMINS' }, 409);
      }
    }

    const user = await users.update(id, {
      name,
      status: status as Entities.Config.UserStatus | undefined,
      roleNames: roles,
    });

    const deactivated =
      status !== undefined && status !== Entities.Config.UserStatus.ACTIVE;
    const rolesChanged = roles !== undefined;
    if (deactivated || rolesChanged) {
      await tokens.deleteAllForUser(id);
      auditSessionRevocation(
        deactivated ? 'user.sessions.revoked.deactivated' : 'user.sessions.revoked.roles_changed',
        id,
        actor,
      );
    }

    return c.json(user, 200);
  });

  router.openapi(deleteUserRoute, async (c) => {
    const id = c.req.valid('param').id;
    const existing = await users.findById(id);
    if (!existing) return c.json({ error: 'NotFound' }, 404);

    const actor = c.get('user').sub;
    const nextStatus = Entities.Config.UserStatus.INACTIVE;
    if (isSelfLockout(actor, id, nextStatus, undefined)) {
      return c.json({ error: 'SELF_LOCKOUT' }, 409);
    }
    const existingIsActiveAdmin =
      existing.status === Entities.Config.UserStatus.ACTIVE &&
      existing.roles.some(r => r.name === ROLES.ADMIN);
    if (existingIsActiveAdmin) {
      const activeAdminsNow = await users.countActiveAdmins();
      if (wouldLoseLastAdmin(existing, nextStatus, undefined, activeAdminsNow)) {
        return c.json({ error: 'WOULD_LOCK_OUT_ADMINS' }, 409);
      }
    }

    await users.update(id, { status: Entities.Config.UserStatus.INACTIVE });
    await tokens.deleteAllForUser(id);
    auditSessionRevocation('user.sessions.revoked.deleted', id, actor);

    return c.body(null, 204);
  });

  router.openapi(resetPasswordRoute, async (c) => {
    const userId = c.req.valid('param').id;
    const adminId = c.get('user').sub;
    const body = await c.req.json().catch(() => ({}));

    const result = await adminUsersController.resetPassword(adminId, userId, body);

    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 401 | 404);
    }

    return c.json(result.data, 200);
  });

  return router;
}
