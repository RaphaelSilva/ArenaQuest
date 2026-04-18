import { Hono } from 'hono';
import { z } from 'zod';
import { authGuard } from '@api/middleware/auth-guard';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import type { IUserRepository } from '@arenaquest/shared/ports';
import type { IAuthAdapter } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const ROLE_VALUES = ['admin', 'content_creator', 'tutor', 'student'] as const;
const STATUS_VALUES = ['active', 'inactive', 'pending', 'banned'] as const;

const CreateUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  roles: z.array(z.enum(ROLE_VALUES)).default(['student']),
});

const UpdateUserSchema = z.object({
  name: z.string().min(2).optional(),
  status: z.enum(STATUS_VALUES).optional(),
  roles: z.array(z.enum(ROLE_VALUES)).optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function buildAdminUsersRouter(users: IUserRepository, auth: IAuthAdapter): Hono {
  const router = new Hono();

  // Every admin endpoint requires a valid token with the admin role.
  router.use('*', authGuard, requireRole(ROLES.ADMIN));

  // GET /admin/users — paginated list
  router.get('/', async (c) => {
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
    const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10), 0);

    const [data, total] = await Promise.all([
      users.list({ limit, offset }),
      users.count(),
    ]);

    return c.json({ data, total });
  });

  // GET /admin/users/:id
  router.get('/:id', async (c) => {
    const user = await users.findById(c.req.param('id'));
    if (!user) return c.json({ error: 'NotFound' }, 404);
    return c.json(user);
  });

  // POST /admin/users
  router.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = CreateUserSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'BadRequest', details: parsed.error.flatten() }, 400);
    }

    const { name, email, password, roles } = parsed.data;
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

  // PATCH /admin/users/:id
  router.patch('/:id', async (c) => {
    const body = await c.req.json();
    const parsed = UpdateUserSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'BadRequest', details: parsed.error.flatten() }, 400);
    }

    const id = c.req.param('id');
    const existing = await users.findById(id);
    if (!existing) return c.json({ error: 'NotFound' }, 404);

    const { name, status, roles } = parsed.data;
    const user = await users.update(id, {
      name,
      status: status as Entities.Config.UserStatus | undefined,
      roleNames: roles,
    });

    return c.json(user);
  });

  // DELETE /admin/users/:id — soft-delete: mark inactive
  router.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const existing = await users.findById(id);
    if (!existing) return c.json({ error: 'NotFound' }, 404);

    await users.update(id, { status: Entities.Config.UserStatus.INACTIVE });
    return c.body(null, 204);
  });

  return router;
}
