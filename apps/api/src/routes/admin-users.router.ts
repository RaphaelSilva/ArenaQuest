import { Hono } from 'hono';
import { z } from 'zod';
import { authGuard } from '@api/middleware/auth-guard';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import type {
  IAuthAdapter,
  IRefreshTokenRepository,
  IUserRepository,
} from '@arenaquest/shared/ports';
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
// Audit helper
// ---------------------------------------------------------------------------

function auditSessionRevocation(event: string, userId: string, actor: string) {
  console.info(
    JSON.stringify({ event, userId, actor, at: new Date().toISOString() }),
  );
}

// ---------------------------------------------------------------------------
// S-05 guards — lockout prevention
// ---------------------------------------------------------------------------

/**
 * Would the pending mutation on `existing` drop the admin population's active
 * count below 1? Only relevant when `existing` is currently a counted admin.
 */
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

  // If the mutation doesn't change admin-active status at all, no risk.
  if (!nextlyInactive && !losingAdminRole) return false;

  return activeAdminsNow <= 1;
}

/**
 * Is the actor attempting to lock themselves out — self-deactivation or
 * self-demotion from admin?
 */
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

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function buildAdminUsersRouter(
  users: IUserRepository,
  auth: IAuthAdapter,
  tokens: IRefreshTokenRepository,
): Hono {
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
    const actor = c.get('user').sub;

    // S-05: refuse to let an admin lock themselves out or strip the platform
    // of its last active admin. Check the cheap actor-ID comparison first,
    // then hit the DB only if we still might need to.
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

    // S-02: revoke live refresh tokens whenever a change could shrink or
    // redirect the user's privileges. Name-only edits are not risk-bearing.
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

    return c.json(user);
  });

  // DELETE /admin/users/:id — soft-delete: mark inactive
  router.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const existing = await users.findById(id);
    if (!existing) return c.json({ error: 'NotFound' }, 404);

    const actor = c.get('user').sub;
    // Soft-delete flips status to inactive, so run both guards with that as
    // the pending status.
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

  return router;
}
