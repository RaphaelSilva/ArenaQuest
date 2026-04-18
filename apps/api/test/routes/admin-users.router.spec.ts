import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';

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
