import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import worker, { type AppEnv } from '../../src/index';

// ---------------------------------------------------------------------------
// DB setup
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
  `CREATE TABLE IF NOT EXISTS user_activation_tokens (
    token_hash    TEXT    NOT NULL PRIMARY KEY,
    user_id       TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at    INTEGER NOT NULL,
    consumed_at   INTEGER NULL,
    created_at    INTEGER NOT NULL
  )`,
];

beforeAll(async () => {
  await env.DB.batch(MIGRATION_SQL.map((sql) => env.DB.prepare(sql)));
  await env.DB.prepare(
    "INSERT OR IGNORE INTO roles (id, name, description) VALUES ('role-student', 'student', 'Student')",
  ).run();
});

beforeEach(async () => {
  // Each spec works against a clean users table so duplicate-email tests can
  // pre-seed deterministically without bleed-over from siblings.
  await env.DB.prepare("DELETE FROM users WHERE email LIKE '%@register-test.local'").run();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function request(
  path: string,
  options: { method?: string; body?: unknown; ip?: string } = {},
): Promise<Response> {
  const { method = 'POST', body, ip } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (ip) headers['CF-Connecting-IP'] = ip;

  const req = new IncomingRequest(`http://example.com${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /auth/register', () => {
  it('creates an INACTIVE user with status=pending_activation on a fresh email', async () => {
    const email = 'fresh@register-test.local';
    const res = await request('/auth/register', {
      body: { name: 'Joana Silva', email, password: 'hunter22a' },
      ip: '203.0.113.40',
    });

    expect(res.status).toBe(202);
    const body = await res.json<{ status: string }>();
    expect(body.status).toBe('pending_activation');

    const row = await env.DB.prepare('SELECT status FROM users WHERE email = ?')
      .bind(email)
      .first<{ status: string }>();
    expect(row?.status).toBe('inactive');

    // No refresh-token cookie issued — registration must not log the user in.
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect((body as Record<string, unknown>).accessToken).toBeUndefined();
  });

  it('login with the new INACTIVE user returns 401 InvalidCredentials (regression)', async () => {
    const email = 'inactive-login@register-test.local';
    await request('/auth/register', {
      body: { name: 'Joana', email, password: 'hunter22a' },
      ip: '203.0.113.41',
    });

    const loginRes = await request('/auth/login', {
      body: { email, password: 'hunter22a' },
      ip: '203.0.113.41',
    });
    expect(loginRes.status).toBe(401);
    const body = await loginRes.json<{ error: string }>();
    expect(body.error).toBe('InvalidCredentials');
  });

  it('duplicate email returns 202 with same payload and does not insert', async () => {
    const email = 'dup@register-test.local';

    const first = await request('/auth/register', {
      body: { name: 'Joana', email, password: 'hunter22a' },
      ip: '203.0.113.42',
    });
    expect(first.status).toBe(202);

    const second = await request('/auth/register', {
      body: { name: 'Other Person', email, password: 'different7' },
      ip: '203.0.113.43',
    });
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({ status: 'pending_activation' });

    const { results } = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email)
      .all<{ id: string }>();
    expect(results).toHaveLength(1);
  });

  it('schema rejection returns 400 ValidationFailed with per-field errors', async () => {
    const res = await request('/auth/register', {
      body: { name: '', email: 'not-an-email', password: 'short' },
      ip: '203.0.113.44',
    });

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; fields: Array<{ field: string; code: string }> }>();
    expect(body.error).toBe('ValidationFailed');
    expect(body.fields.length).toBeGreaterThanOrEqual(3);
    const byField = Object.fromEntries(body.fields.map((f) => [f.field, f.code]));
    expect(byField.name).toBeDefined();
    expect(byField.email).toBe('Invalid');
    expect(byField.password).toBeDefined();
  });

  it('rate limit: 6th request from the same IP within window returns 429', async () => {
    const ip = '203.0.113.50';

    // 5 valid requests (each with a unique email) — all succeed.
    for (let i = 0; i < 5; i++) {
      const res = await request('/auth/register', {
        body: {
          name: 'User',
          email: `burst${i}@register-test.local`,
          password: 'hunter22a',
        },
        ip,
      });
      expect(res.status).toBe(202);
    }

    const locked = await request('/auth/register', {
      body: {
        name: 'User',
        email: 'burst6@register-test.local',
        password: 'hunter22a',
      },
      ip,
    });
    expect(locked.status).toBe(429);
    const body = await locked.json<{ error: string }>();
    expect(body.error).toBe('TooManyRequests');
    expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('email is normalized: case + trim collapse to one row', async () => {
    const res1 = await request('/auth/register', {
      body: { name: 'Joana', email: '  Casing@Register-Test.Local  ', password: 'hunter22a' },
      ip: '203.0.113.60',
    });
    expect(res1.status).toBe(202);

    const res2 = await request('/auth/register', {
      body: { name: 'Joana', email: 'casing@register-test.local', password: 'hunter22a' },
      ip: '203.0.113.61',
    });
    expect(res2.status).toBe(202);

    const { results } = await env.DB.prepare(
      "SELECT id FROM users WHERE email = 'casing@register-test.local'",
    ).all<{ id: string }>();
    expect(results).toHaveLength(1);
  });
});
