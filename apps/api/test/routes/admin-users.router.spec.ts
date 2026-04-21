import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { sha256Hex } from '@api/adapters/db/hash';

// ---------------------------------------------------------------------------
// DB bootstrap
// ---------------------------------------------------------------------------

const MIGRATION_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
    id            TEXT NOT NULL PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS roles (
    id          TEXT NOT NULL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
  )`,
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    token      TEXT NOT NULL PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  )`,
  // Seed roles matching the production migration
  `INSERT OR IGNORE INTO roles (id, name, description) VALUES
    ('bace0701-15e3-5144-97c5-47487d543032', 'admin',           'Full platform access'),
    ('3318927d-8b5e-52d9-a145-2e4323919ed6', 'content_creator', 'Can create/edit content'),
    ('32a5cab1-e66f-5d23-a80d-80cfa927d057', 'tutor',           'Can monitor student progress'),
    ('bf3d0f1d-7d77-5151-922e-b87dff0fa7ad', 'student',         'Can consume content and tasks')`,
];

// Admin token signed with the test JWT_SECRET — avoids a real login round-trip.
let adminToken: string;
let studentToken: string;

const ADMIN_USER_ID = 'admin-user-for-crud-tests';
const STUDENT_USER_ID = 'student-user-for-crud-tests';

beforeAll(async () => {
  await env.DB.batch(MIGRATION_SQL.map((sql) => env.DB.prepare(sql)));

  // Sign tokens directly — Worker verifies with the same secret.
  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });

  [adminToken, studentToken] = await Promise.all([
    adapter.signAccessToken({ sub: ADMIN_USER_ID, email: 'admin@example.com', roles: ['admin'] }),
    adapter.signAccessToken({ sub: STUDENT_USER_ID, email: 'student@example.com', roles: ['student'] }),
  ]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function req(
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  const request = new IncomingRequest(`http://example.com${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

// ---------------------------------------------------------------------------
// Auth enforcement — every endpoint must guard 401/403
// ---------------------------------------------------------------------------

describe('Auth enforcement', () => {
  const endpoints: [string, string][] = [
    ['GET',    '/admin/users'],
    ['GET',    '/admin/users/some-id'],
    ['POST',   '/admin/users'],
    ['PATCH',  '/admin/users/some-id'],
    ['DELETE', '/admin/users/some-id'],
  ];

  for (const [method, path] of endpoints) {
    it(`${method} ${path} -> 401 without token`, async () => {
      const res = await req(method, path);
      expect(res.status).toBe(401);
    });

    it(`${method} ${path} -> 403 with student token`, async () => {
      const res = await req(method, path, { token: studentToken, body: method !== 'GET' ? {} : undefined });
      expect(res.status).toBe(403);
    });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/users — create
// ---------------------------------------------------------------------------

describe('POST /admin/users', () => {
  it('creates a user and returns 201 with user entity (no passwordHash)', async () => {
    const res = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'Bob Builder', email: 'bob@example.com', password: 'password123', roles: ['student'] },
    });

    expect(res.status).toBe(201);
    const user = await res.json<Record<string, unknown>>();
    expect(user.email).toBe('bob@example.com');
    expect(user.name).toBe('Bob Builder');
    expect(user.passwordHash).toBeUndefined();
    expect(Array.isArray(user.roles)).toBe(true);
  });

  it('assigns the specified roles on creation', async () => {
    const res = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'Tutor Tom', email: 'tutor@example.com', password: 'password123', roles: ['tutor'] },
    });

    expect(res.status).toBe(201);
    const user = await res.json<{ roles: { name: string }[] }>();
    expect(user.roles.map(r => r.name)).toContain('tutor');
  });

  it('defaults to student role when roles not provided', async () => {
    const res = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'Default Student', email: 'default-student@example.com', password: 'password123' },
    });

    expect(res.status).toBe(201);
    const user = await res.json<{ roles: { name: string }[] }>();
    expect(user.roles.map(r => r.name)).toContain('student');
  });

  it('returns 409 when email already exists', async () => {
    await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'First', email: 'dup@example.com', password: 'password123', roles: ['student'] },
    });

    const res = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'Second', email: 'dup@example.com', password: 'password123', roles: ['student'] },
    });

    expect(res.status).toBe(409);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'No Email' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is shorter than 8 chars', async () => {
    const res = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'Short Pass', email: 'short@example.com', password: '123' },
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/users — list
// ---------------------------------------------------------------------------

describe('GET /admin/users', () => {
  beforeAll(async () => {
    // Ensure at least one user exists regardless of other describe blocks execution order.
    await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'List Seed User', email: 'list-seed@example.com', password: 'password123' },
    });
  });

  it('returns paginated list with data array and total', async () => {
    const res = await req('GET', '/admin/users', { token: adminToken });

    expect(res.status).toBe(200);
    const body = await res.json<{ data: unknown[]; total: number }>();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThanOrEqual(body.data.length);
  });

  it('respects limit and offset query params', async () => {
    const res = await req('GET', '/admin/users?limit=1&offset=0', { token: adminToken });

    expect(res.status).toBe(200);
    const body = await res.json<{ data: unknown[]; total: number }>();
    expect(body.data.length).toBeLessThanOrEqual(1);
    expect(body.total).toBeGreaterThanOrEqual(body.data.length);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/users/:id — single
// ---------------------------------------------------------------------------

describe('GET /admin/users/:id', () => {
  it('returns the user for a valid id', async () => {
    // Create a user to look up
    const createRes = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'Findable User', email: 'findable@example.com', password: 'password123', roles: ['student'] },
    });
    const created = await createRes.json<{ id: string }>();

    const res = await req('GET', `/admin/users/${created.id}`, { token: adminToken });

    expect(res.status).toBe(200);
    const user = await res.json<{ id: string; email: string }>();
    expect(user.id).toBe(created.id);
    expect(user.email).toBe('findable@example.com');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await req('GET', '/admin/users/does-not-exist', { token: adminToken });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id — update
// ---------------------------------------------------------------------------

describe('PATCH /admin/users/:id', () => {
  it('updates name and returns the updated user', async () => {
    const createRes = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'Original Name', email: 'patch-name@example.com', password: 'password123', roles: ['student'] },
    });
    const { id } = await createRes.json<{ id: string }>();

    const res = await req('PATCH', `/admin/users/${id}`, {
      token: adminToken,
      body: { name: 'Updated Name' },
    });

    expect(res.status).toBe(200);
    const user = await res.json<{ name: string }>();
    expect(user.name).toBe('Updated Name');
  });

  it('updates roles correctly', async () => {
    const createRes = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'Role Changer', email: 'role-change@example.com', password: 'password123', roles: ['student'] },
    });
    const { id } = await createRes.json<{ id: string }>();

    const res = await req('PATCH', `/admin/users/${id}`, {
      token: adminToken,
      body: { roles: ['tutor'] },
    });

    expect(res.status).toBe(200);
    const user = await res.json<{ roles: { name: string }[] }>();
    const roleNames = user.roles.map(r => r.name);
    expect(roleNames).toContain('tutor');
    expect(roleNames).not.toContain('student');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await req('PATCH', '/admin/users/does-not-exist', {
      token: adminToken,
      body: { name: 'Ghost' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid body', async () => {
    const createRes = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'Valid User', email: 'valid-patch@example.com', password: 'password123' },
    });
    const { id } = await createRes.json<{ id: string }>();

    const res = await req('PATCH', `/admin/users/${id}`, {
      token: adminToken,
      body: { status: 'unknown_status' },
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /admin/users/:id — soft-delete
// ---------------------------------------------------------------------------

describe('DELETE /admin/users/:id', () => {
  it('soft-deletes by setting status to inactive and returns 204', async () => {
    const createRes = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'To Delete', email: 'to-delete@example.com', password: 'password123', roles: ['student'] },
    });
    const { id } = await createRes.json<{ id: string }>();

    const delRes = await req('DELETE', `/admin/users/${id}`, { token: adminToken });
    expect(delRes.status).toBe(204);

    // Confirm status is now inactive — user still exists
    const getRes = await req('GET', `/admin/users/${id}`, { token: adminToken });
    expect(getRes.status).toBe(200);
    const user = await getRes.json<{ status: string }>();
    expect(user.status).toBe('inactive');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await req('DELETE', '/admin/users/does-not-exist', { token: adminToken });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// S-02: refresh-token revocation on admin mutations
// ---------------------------------------------------------------------------

async function seedRefreshToken(userId: string, tokenValue: string): Promise<void> {
  const tokenHash = await sha256Hex(tokenValue);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await env.DB
    .prepare('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(tokenHash, userId, expiresAt)
    .run();
}

async function countTokensFor(userId: string): Promise<number> {
  const row = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe('Session revocation on admin mutations (S-02)', () => {
  it('PATCH status=inactive revokes every refresh token for the user', async () => {
    const createRes = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'Revoke Target', email: 'revoke-status@example.com', password: 'password123' },
    });
    const { id } = await createRes.json<{ id: string }>();

    await seedRefreshToken(id, 'raw-token-status-a');
    await seedRefreshToken(id, 'raw-token-status-b');
    expect(await countTokensFor(id)).toBe(2);

    const res = await req('PATCH', `/admin/users/${id}`, {
      token: adminToken,
      body: { status: 'inactive' },
    });
    expect(res.status).toBe(200);
    expect(await countTokensFor(id)).toBe(0);
  });

  it('PATCH roles change revokes every refresh token for the user', async () => {
    const createRes = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'Role Change Target', email: 'revoke-roles@example.com', password: 'password123' },
    });
    const { id } = await createRes.json<{ id: string }>();

    await seedRefreshToken(id, 'raw-token-roles');
    expect(await countTokensFor(id)).toBe(1);

    const res = await req('PATCH', `/admin/users/${id}`, {
      token: adminToken,
      body: { roles: ['tutor'] },
    });
    expect(res.status).toBe(200);
    expect(await countTokensFor(id)).toBe(0);
  });

  it('PATCH with only a name change does NOT revoke sessions', async () => {
    const createRes = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'Name Only', email: 'revoke-name-only@example.com', password: 'password123' },
    });
    const { id } = await createRes.json<{ id: string }>();

    await seedRefreshToken(id, 'raw-token-name-only');
    expect(await countTokensFor(id)).toBe(1);

    const res = await req('PATCH', `/admin/users/${id}`, {
      token: adminToken,
      body: { name: 'Name Only Renamed' },
    });
    expect(res.status).toBe(200);
    expect(await countTokensFor(id)).toBe(1);
  });

  it('DELETE revokes every refresh token for the user', async () => {
    const createRes = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'Delete Target', email: 'revoke-delete@example.com', password: 'password123' },
    });
    const { id } = await createRes.json<{ id: string }>();

    await seedRefreshToken(id, 'raw-token-delete-a');
    await seedRefreshToken(id, 'raw-token-delete-b');
    expect(await countTokensFor(id)).toBe(2);

    const res = await req('DELETE', `/admin/users/${id}`, { token: adminToken });
    expect(res.status).toBe(204);
    expect(await countTokensFor(id)).toBe(0);
  });

  it('POST /auth/refresh returns 401 after the user is deactivated', async () => {
    // Create an active user with a known password so we can login through the router.
    const createRes = await req('POST', '/admin/users', {
      token: adminToken,
      body: {
        name: 'Refresh Victim',
        email: 'refresh-victim@example.com',
        password: 'password123',
        roles: ['student'],
      },
    });
    const { id } = await createRes.json<{ id: string }>();

    const loginRes = await req('POST', '/auth/login', {
      body: { email: 'refresh-victim@example.com', password: 'password123' },
    });
    expect(loginRes.status).toBe(200);
    const setCookie = loginRes.headers.get('set-cookie') ?? '';
    const match = setCookie.match(/refresh_token=([^;]+)/);
    expect(match).not.toBeNull();
    const refreshCookie = match![0];

    // Admin deactivates the user.
    const deactivateRes = await req('PATCH', `/admin/users/${id}`, {
      token: adminToken,
      body: { status: 'inactive' },
    });
    expect(deactivateRes.status).toBe(200);

    // Refresh attempt with the pre-deactivation cookie must fail.
    const refreshReq = new (Request as typeof globalThis.Request)(
      'http://example.com/auth/refresh',
      { method: 'POST', headers: { Cookie: refreshCookie } },
    );
    const ctx = createExecutionContext();
    const refreshRes = await worker.fetch(refreshReq, env as AppEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(refreshRes.status).toBe(401);
  });

  it.skip('placeholder', async () => {});
});

// ---------------------------------------------------------------------------
// S-05: admin lockout guards (last-admin + self-lockout)
// ---------------------------------------------------------------------------

describe('Admin lockout guards (S-05)', () => {
  // Seed the actor user row so self-lockout tests can PATCH the actor itself.
  // The JWT's `sub` is ADMIN_USER_ID; we need a DB row with that id and the
  // admin role so the last-admin check can see a peer when expected.
  beforeAll(async () => {
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO users (id, name, email, password_hash, status)
         VALUES (?, 'Acting Admin', 's05-actor@example.com', 'h', 'active')`,
      )
      .bind(ADMIN_USER_ID)
      .run();
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO user_roles (user_id, role_id)
         VALUES (?, 'bace0701-15e3-5144-97c5-47487d543032')`,
      )
      .bind(ADMIN_USER_ID)
      .run();
  });

  async function createAdmin(email: string, name = 'Peer Admin'): Promise<string> {
    const res = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name, email, password: 'password123', roles: ['admin'] },
    });
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();
    return id;
  }

  async function demoteToNonAdmin(userId: string): Promise<void> {
    // Directly mutate DB to avoid the guards that the router would trigger.
    await env.DB
      .prepare(`DELETE FROM user_roles WHERE user_id = ?`)
      .bind(userId)
      .run();
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'bf3d0f1d-7d77-5151-922e-b87dff0fa7ad')`,
      )
      .bind(userId)
      .run();
  }

  it('blocks PATCH that would drop the last active admin (deactivation)', async () => {
    // Isolate: strip every other admin so the peer we create is the only one.
    await env.DB
      .prepare(
        `DELETE FROM user_roles
         WHERE role_id = 'bace0701-15e3-5144-97c5-47487d543032'`,
      )
      .run();
    const peerId = await createAdmin('s05-only-admin@example.com', 'Only Admin');

    const res = await req('PATCH', `/admin/users/${peerId}`, {
      token: adminToken,
      body: { status: 'inactive' },
    });

    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('WOULD_LOCK_OUT_ADMINS');

    // Cleanup: demote so subsequent tests don't see an unexpected admin.
    await demoteToNonAdmin(peerId);
  });

  it('blocks PATCH that would strip the last admin of the admin role', async () => {
    await env.DB
      .prepare(
        `DELETE FROM user_roles
         WHERE role_id = 'bace0701-15e3-5144-97c5-47487d543032'`,
      )
      .run();
    const peerId = await createAdmin('s05-strip-role@example.com', 'Only Admin 2');

    const res = await req('PATCH', `/admin/users/${peerId}`, {
      token: adminToken,
      body: { roles: ['tutor'] },
    });

    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('WOULD_LOCK_OUT_ADMINS');

    await demoteToNonAdmin(peerId);
  });

  it('allows deactivating an admin when a peer admin remains', async () => {
    await env.DB
      .prepare(
        `DELETE FROM user_roles
         WHERE role_id = 'bace0701-15e3-5144-97c5-47487d543032'`,
      )
      .run();
    const keeperId = await createAdmin('s05-keeper@example.com', 'Keeper Admin');
    const victimId = await createAdmin('s05-victim@example.com', 'Victim Admin');

    const res = await req('PATCH', `/admin/users/${victimId}`, {
      token: adminToken,
      body: { status: 'inactive' },
    });

    expect(res.status).toBe(200);

    await demoteToNonAdmin(keeperId);
    await demoteToNonAdmin(victimId);
  });

  it('allows demoting a peer admin when another admin remains', async () => {
    await env.DB
      .prepare(
        `DELETE FROM user_roles
         WHERE role_id = 'bace0701-15e3-5144-97c5-47487d543032'`,
      )
      .run();
    const keeperId = await createAdmin('s05-demote-keeper@example.com', 'Keeper');
    const demoteeId = await createAdmin('s05-demotee@example.com', 'Demotee');

    const res = await req('PATCH', `/admin/users/${demoteeId}`, {
      token: adminToken,
      body: { roles: ['tutor'] },
    });

    expect(res.status).toBe(200);

    await demoteToNonAdmin(keeperId);
  });

  it('rejects self-deactivation with SELF_LOCKOUT', async () => {
    const res = await req('PATCH', `/admin/users/${ADMIN_USER_ID}`, {
      token: adminToken,
      body: { status: 'inactive' },
    });
    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('SELF_LOCKOUT');
  });

  it('rejects self-demotion (removing own admin role) with SELF_LOCKOUT', async () => {
    const res = await req('PATCH', `/admin/users/${ADMIN_USER_ID}`, {
      token: adminToken,
      body: { roles: ['tutor'] },
    });
    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('SELF_LOCKOUT');
  });

  it('rejects DELETE on self with SELF_LOCKOUT', async () => {
    const res = await req('DELETE', `/admin/users/${ADMIN_USER_ID}`, {
      token: adminToken,
    });
    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('SELF_LOCKOUT');
  });

  it('blocks DELETE that would drop the last active admin', async () => {
    await env.DB
      .prepare(
        `DELETE FROM user_roles
         WHERE role_id = 'bace0701-15e3-5144-97c5-47487d543032'`,
      )
      .run();
    const peerId = await createAdmin('s05-delete-last@example.com', 'Last Admin');

    const res = await req('DELETE', `/admin/users/${peerId}`, { token: adminToken });

    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('WOULD_LOCK_OUT_ADMINS');

    await demoteToNonAdmin(peerId);
  });

  it('allows name-only self-PATCH (not a lockout)', async () => {
    const res = await req('PATCH', `/admin/users/${ADMIN_USER_ID}`, {
      token: adminToken,
      body: { name: 'Still Me, Renamed' },
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Audit log (kept after S-05 so earlier lockout tests do not interfere)
// ---------------------------------------------------------------------------

describe('Admin audit log', () => {
  it('emits an audit log line with { event, userId, actor, at } on revocation', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const createRes = await req('POST', '/admin/users', {
      token: adminToken,
      body: { name: 'Audit Target', email: 'audit-revoke@example.com', password: 'password123' },
    });
    const { id } = await createRes.json<{ id: string }>();

    const res = await req('PATCH', `/admin/users/${id}`, {
      token: adminToken,
      body: { status: 'inactive' },
    });
    expect(res.status).toBe(200);

    const emitted = infoSpy.mock.calls
      .map((args) => args[0])
      .filter((arg): arg is string => typeof arg === 'string')
      .map((line) => {
        try { return JSON.parse(line) as Record<string, unknown>; }
        catch { return null; }
      })
      .filter((obj): obj is Record<string, unknown> => obj !== null && obj.userId === id);

    expect(emitted.length).toBeGreaterThan(0);
    const entry = emitted[0];
    expect(entry.event).toBe('user.sessions.revoked.deactivated');
    expect(entry.userId).toBe(id);
    expect(entry.actor).toBe(ADMIN_USER_ID);
    expect(typeof entry.at).toBe('string');
    expect(new Date(entry.at as string).toString()).not.toBe('Invalid Date');

    infoSpy.mockRestore();
  });
});
