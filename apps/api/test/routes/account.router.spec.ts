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
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    timezone      TEXT NOT NULL DEFAULT 'UTC'
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
  `CREATE TABLE IF NOT EXISTS user_streak (
    user_id             TEXT    NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_streak      INTEGER NOT NULL DEFAULT 0,
    longest_streak      INTEGER NOT NULL DEFAULT 0,
    last_activity_date  TEXT,
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
];

const TEST_EMAIL = 'change-pw-user@example.com';
const TEST_USER_ID = 'test-user-change-pw';
const CURRENT_PASSWORD = 'OldPassword1';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

let adapter: JwtAuthAdapter;
let accessToken: string;

async function post(
  path: string,
  body: unknown,
  options: { token?: string; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.cookie) headers['Cookie'] = options.cookie;

  const req = new IncomingRequest(`http://example.com${path}`, {
    method: 'POST',
    headers,
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

  adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, pbkdf2Iterations: 1 });
  const hash = await adapter.hashPassword(CURRENT_PASSWORD);
  await env.DB
    .prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash, status) VALUES (?, ?, ?, ?, ?)')
    .bind(TEST_USER_ID, 'Change PW User', TEST_EMAIL, hash, 'active')
    .run();

  accessToken = await adapter.signAccessToken({
    sub: TEST_USER_ID,
    email: TEST_EMAIL,
    roles: ['student'],
  });
});

beforeEach(async () => {
  // Restore original password hash before each test
  const hash = await adapter.hashPassword(CURRENT_PASSWORD);
  await env.DB
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(hash, TEST_USER_ID)
    .run();
  await env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(TEST_USER_ID).run();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /account/change-password', () => {
  it('returns 401 without a JWT', async () => {
    const res = await post('/account/change-password', {
      currentPassword: CURRENT_PASSWORD,
      newPassword: 'NewPass123',
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing newPassword', async () => {
    const res = await post(
      '/account/change-password',
      { currentPassword: CURRENT_PASSWORD },
      { token: accessToken },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for newPassword shorter than 8 chars', async () => {
    const res = await post(
      '/account/change-password',
      { currentPassword: CURRENT_PASSWORD, newPassword: 'sh0rt' },
      { token: accessToken },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for newPassword with no digit', async () => {
    const res = await post(
      '/account/change-password',
      { currentPassword: CURRENT_PASSWORD, newPassword: 'NoDigitHere' },
      { token: accessToken },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 InvalidCurrentPassword for wrong current password', async () => {
    const res = await post(
      '/account/change-password',
      { currentPassword: 'WrongPassword9', newPassword: 'NewPass123' },
      { token: accessToken },
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('InvalidCurrentPassword');
  });

  it('returns 200 and updates password for valid request', async () => {
    const res = await post(
      '/account/change-password',
      { currentPassword: CURRENT_PASSWORD, newPassword: 'NewPass123' },
      { token: accessToken },
    );
    expect(res.status).toBe(200);

    // Verify new password works
    const loginNew = await post('/auth/login', { email: TEST_EMAIL, password: 'NewPass123' });
    expect(loginNew.status).toBe(200);

    // Old password rejected
    const loginOld = await post('/auth/login', { email: TEST_EMAIL, password: CURRENT_PASSWORD });
    expect(loginOld.status).toBe(401);
  });

  it('invalidates other refresh tokens but preserves the calling session', async () => {
    const { sha256Hex } = await import('@api/adapters/db/hash');

    // Seed two refresh tokens: one "current session", one "other session"
    const currentToken = 'current-session-token-abc';
    const otherToken = 'other-session-token-xyz';
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await env.DB
      .prepare('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256Hex(currentToken), TEST_USER_ID, expiresAt)
      .run();
    await env.DB
      .prepare('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256Hex(otherToken), TEST_USER_ID, expiresAt)
      .run();

    await post(
      '/account/change-password',
      { currentPassword: CURRENT_PASSWORD, newPassword: 'NewPass123' },
      { token: accessToken, cookie: `refresh_token=${currentToken}` },
    );

    // Current session token still exists in DB
    const kept = await env.DB
      .prepare('SELECT token FROM refresh_tokens WHERE user_id = ? AND token = ?')
      .bind(TEST_USER_ID, await sha256Hex(currentToken))
      .first();
    expect(kept).not.toBeNull();

    // Other session token is gone
    const removed = await env.DB
      .prepare('SELECT token FROM refresh_tokens WHERE user_id = ? AND token = ?')
      .bind(TEST_USER_ID, await sha256Hex(otherToken))
      .first();
    expect(removed).toBeNull();
  });
});
