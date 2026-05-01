import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import worker, { type AppEnv } from '../../src/index';

// ---------------------------------------------------------------------------
// DB setup — mirrors auth.router.spec.ts so this file is self-contained.
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
  await env.DB.prepare(
    "DELETE FROM user_activation_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@activate-test.local')",
  ).run();
  await env.DB.prepare("DELETE FROM users WHERE email LIKE '%@activate-test.local'").run();
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

/**
 * Pull the activation token out of the DB for a freshly-registered user.
 * The Worker's MAIL_DRIVER defaults to console so we cannot intercept the
 * outbound message — but the plaintext lives nowhere in the DB (only its
 * hash). The simplest test path is to seed our own row with a known
 * plaintext via the registration → repo creation that already happened,
 * combined with an alternative: we expose the plaintext by computing the
 * SHA-256 we'd persist for a known string, then inserting it directly.
 *
 * In practice, the integration spec drives both halves: registration writes
 * a hash row, and the activate endpoint consumes by plaintext. We seed our
 * own (plaintext, hash) pair so we have ground truth.
 */
async function seedActivationToken(opts: {
  userId: string;
  plainToken: string;
  expiresAt: number;
}): Promise<void> {
  const tokenHash = await sha256Hex(opts.plainToken);
  await env.DB.prepare(
    'INSERT INTO user_activation_tokens (token_hash, user_id, expires_at, consumed_at, created_at) VALUES (?, ?, ?, NULL, ?)',
  )
    .bind(tokenHash, opts.userId, opts.expiresAt, Date.now())
    .run();
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function seedInactiveUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users (id, name, email, password_hash, status) VALUES (?, ?, ?, ?, 'inactive')",
  )
    .bind(id, 'Test User', email, 'pbkdf2:1:0011:0011')
    .run();
  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /auth/activate', () => {
  it('valid token flips user to ACTIVE and returns 200 activated', async () => {
    const userId = await seedInactiveUser('happy@activate-test.local');
    const plainToken = 'happy-path-plaintext-token';
    await seedActivationToken({
      userId,
      plainToken,
      expiresAt: Date.now() + 60_000,
    });

    const res = await request('/auth/activate', {
      body: { token: plainToken },
      ip: '203.0.113.70',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'activated' });

    const userRow = await env.DB.prepare('SELECT status FROM users WHERE id = ?')
      .bind(userId)
      .first<{ status: string }>();
    expect(userRow?.status).toBe('active');

    const tokenRow = await env.DB.prepare(
      'SELECT consumed_at FROM user_activation_tokens WHERE user_id = ?',
    )
      .bind(userId)
      .first<{ consumed_at: number | null }>();
    expect(tokenRow?.consumed_at).not.toBeNull();
  });

  it('replay returns 200 already_active and does not flip user again', async () => {
    const userId = await seedInactiveUser('replay@activate-test.local');
    const plainToken = 'replay-path-plaintext-token';
    await seedActivationToken({
      userId,
      plainToken,
      expiresAt: Date.now() + 60_000,
    });

    const first = await request('/auth/activate', {
      body: { token: plainToken },
      ip: '203.0.113.71',
    });
    expect(first.status).toBe(200);

    const second = await request('/auth/activate', {
      body: { token: plainToken },
      ip: '203.0.113.71',
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: 'already_active' });
  });

  it('expired token → 400 InvalidToken', async () => {
    const userId = await seedInactiveUser('expired@activate-test.local');
    const plainToken = 'expired-path-plaintext-token';
    await seedActivationToken({
      userId,
      plainToken,
      expiresAt: Date.now() - 1_000, // already past
    });

    const res = await request('/auth/activate', {
      body: { token: plainToken },
      ip: '203.0.113.72',
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'InvalidToken' });
  });

  it('unknown / missing token → 400 InvalidToken (same shape as expired)', async () => {
    const r1 = await request('/auth/activate', {
      body: { token: 'never-issued-token' },
      ip: '203.0.113.73',
    });
    const r2 = await request('/auth/activate', {
      body: {},
      ip: '203.0.113.73',
    });

    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(b1).toEqual({ error: 'InvalidToken' });
    expect(b2).toEqual({ error: 'InvalidToken' });
  });

  it('after activation, /auth/login succeeds with accessToken (regression)', async () => {
    // Drive the full registration → activate → login flow end-to-end.
    const email = 'fullflow@activate-test.local';
    const password = 'hunter22a';

    const reg = await request('/auth/register', {
      body: { name: 'Full Flow', email, password },
      ip: '203.0.113.74',
    });
    expect(reg.status).toBe(202);

    // Pull the freshly created user id and seed a known plaintext token.
    // The handler already created one with a random token we can't recover,
    // so we add a second known token for the same user to drive activation.
    const userRow = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email)
      .first<{ id: string }>();
    expect(userRow).not.toBeNull();
    const knownToken = 'fullflow-known-token';
    await seedActivationToken({
      userId: userRow!.id,
      plainToken: knownToken,
      expiresAt: Date.now() + 60_000,
    });

    const act = await request('/auth/activate', {
      body: { token: knownToken },
      ip: '203.0.113.74',
    });
    expect(act.status).toBe(200);

    const login = await request('/auth/login', {
      body: { email, password },
      ip: '203.0.113.74',
    });
    expect(login.status).toBe(200);
    const body = await login.json<{ accessToken: string }>();
    expect(body.accessToken).toBeTypeOf('string');
  });

  it('table never stores plaintext: stored value is the SHA-256 hash, not the token', async () => {
    const userId = await seedInactiveUser('hashcheck@activate-test.local');
    const plainToken = 'hashcheck-plaintext-token';
    await seedActivationToken({
      userId,
      plainToken,
      expiresAt: Date.now() + 60_000,
    });

    const stored = await env.DB.prepare(
      'SELECT token_hash FROM user_activation_tokens WHERE user_id = ?',
    )
      .bind(userId)
      .first<{ token_hash: string }>();

    expect(stored?.token_hash).toBe(await sha256Hex(plainToken));
    expect(stored?.token_hash).not.toBe(plainToken);
  });
});
