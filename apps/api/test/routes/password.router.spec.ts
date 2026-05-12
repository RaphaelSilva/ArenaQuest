import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';

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
    token_hash   TEXT    NOT NULL PRIMARY KEY,
    user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at   INTEGER NOT NULL,
    consumed_at  INTEGER,
    created_at   INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash   TEXT    NOT NULL PRIMARY KEY,
    user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at   INTEGER NOT NULL,
    consumed_at  INTEGER,
    created_at   INTEGER NOT NULL
  )`,
];

const TEST_EMAIL = 'reset-user@example.com';
const TEST_USER_ID = 'test-user-pw-router';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function post(path: string, body: unknown, ip = '1.2.3.4'): Promise<Response> {
  const req = new IncomingRequest(`http://example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeAll(async () => {
  await env.DB.batch(MIGRATION_SQL.map((sql) => env.DB.prepare(sql)));
  await env.DB.prepare(
    "INSERT OR IGNORE INTO roles (id, name, description) VALUES ('role-student', 'student', 'Student')",
  ).run();

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, pbkdf2Iterations: 1 });
  const hash = await adapter.hashPassword('Password123');
  await env.DB
    .prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash, status) VALUES (?, ?, ?, ?, ?)')
    .bind(TEST_USER_ID, 'Reset User', TEST_EMAIL, hash, 'active')
    .run();
});

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM password_reset_tokens').run();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /auth/forgot-password', () => {
  it('returns 200 for a registered email', async () => {
    const res = await post('/auth/forgot-password', { email: TEST_EMAIL });
    expect(res.status).toBe(200);
  });

  it('returns 200 for an unknown email (no enumeration)', async () => {
    const res = await post('/auth/forgot-password', { email: 'nobody@example.com' });
    expect(res.status).toBe(200);
  });

  it('returns 400 for an invalid email format', async () => {
    const res = await post('/auth/forgot-password', { email: 'not-an-email' });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('BadRequest');
  });

  it('returns 400 for missing body', async () => {
    const req = new IncomingRequest('http://example.com/auth/forgot-password', { method: 'POST' });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env as AppEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it('creates a token row in the DB for a registered user', async () => {
    await post('/auth/forgot-password', { email: TEST_EMAIL });

    const row = await env.DB
      .prepare('SELECT user_id FROM password_reset_tokens WHERE user_id = ?')
      .bind(TEST_USER_ID)
      .first<{ user_id: string }>();

    expect(row).not.toBeNull();
    expect(row!.user_id).toBe(TEST_USER_ID);
  });

  it('replaces a previous token when a second request is made', async () => {
    await post('/auth/forgot-password', { email: TEST_EMAIL });
    await post('/auth/forgot-password', { email: TEST_EMAIL });

    const rows = await env.DB
      .prepare('SELECT token_hash FROM password_reset_tokens WHERE user_id = ? AND consumed_at IS NULL')
      .bind(TEST_USER_ID)
      .all<{ token_hash: string }>();

    // First token was invalidated (deleted), only one unconsumed row remains.
    expect(rows.results).toHaveLength(1);
  });

  it('returns 429 after exceeding the rate limit', async () => {
    const ip = '9.9.9.9';
    // Hit 3 times (the limit)
    await post('/auth/forgot-password', { email: TEST_EMAIL }, ip);
    await post('/auth/forgot-password', { email: TEST_EMAIL }, ip);
    await post('/auth/forgot-password', { email: TEST_EMAIL }, ip);

    // 4th request should be rate-limited
    const res = await post('/auth/forgot-password', { email: TEST_EMAIL }, ip);
    expect(res.status).toBe(429);
  });
});
