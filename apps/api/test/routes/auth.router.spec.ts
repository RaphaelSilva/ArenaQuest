import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';

// ---------------------------------------------------------------------------
// DB setup — runs once before all tests
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
];

const TEST_EMAIL = 'alice@example.com';
const TEST_PASSWORD = 'correct-password-123';
const TEST_USER_ID = 'test-user-auth-router';

beforeAll(async () => {
  await env.DB.batch(MIGRATION_SQL.map((sql) => env.DB.prepare(sql)));

  const adapter = new JwtAuthAdapter({
    secret: env.JWT_SECRET,
    accessTokenExpiresInSeconds: 900,
    pbkdf2Iterations: 1, // minimal iterations so test setup is fast
  });
  const passwordHash = await adapter.hashPassword(TEST_PASSWORD);

  await env.DB.prepare(
    'INSERT OR IGNORE INTO users (id, name, email, password_hash, status) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(TEST_USER_ID, 'Alice', TEST_EMAIL, passwordHash, 'active')
    .run();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function request(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<Response> {
  const { method = 'POST', body, cookie } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;

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

function extractRefreshCookie(res: Response): string | null {
  const setCookie = res.headers.get('Set-Cookie');
  if (!setCookie) return null;
  const match = setCookie.match(/refresh_token=([^;]+)/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /auth/login', () => {
  it('returns 200 with accessToken and sets HttpOnly cookie on valid credentials', async () => {
    const res = await request('/auth/login', {
      body: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });

    expect(res.status).toBe(200);

    const body = await res.json<{ accessToken: string; user: { email: string } }>();
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.user.email).toBe(TEST_EMAIL);

    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('refresh_token=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
  });

  it('returns 401 with InvalidCredentials on wrong password', async () => {
    const res = await request('/auth/login', {
      body: { email: TEST_EMAIL, password: 'wrong-password' },
    });

    expect(res.status).toBe(401);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('InvalidCredentials');
  });

  it('returns 401 for unknown email', async () => {
    const res = await request('/auth/login', {
      body: { email: 'nobody@example.com', password: TEST_PASSWORD },
    });

    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('returns 204 and clears cookie on valid refresh token', async () => {
    const loginRes = await request('/auth/login', {
      body: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    const token = extractRefreshCookie(loginRes);
    expect(token).not.toBeNull();

    const logoutRes = await request('/auth/logout', {
      cookie: `refresh_token=${token}`,
    });

    expect(logoutRes.status).toBe(204);

    // Cookie should be cleared (empty value or expired)
    const setCookie = logoutRes.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('refresh_token=');
  });

  it('returns 401 when refresh_token cookie is absent', async () => {
    const res = await request('/auth/logout');
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  it('returns 200 with new accessToken and rotates cookie', async () => {
    const loginRes = await request('/auth/login', {
      body: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    const oldToken = extractRefreshCookie(loginRes);
    expect(oldToken).not.toBeNull();

    const refreshRes = await request('/auth/refresh', {
      cookie: `refresh_token=${oldToken}`,
    });

    expect(refreshRes.status).toBe(200);

    const body = await refreshRes.json<{ accessToken: string }>();
    expect(body.accessToken).toBeTypeOf('string');

    const newToken = extractRefreshCookie(refreshRes);
    expect(newToken).not.toBeNull();
    expect(newToken).not.toBe(oldToken);
  });

  it('returns 401 for an already-used (rotated) refresh token', async () => {
    const loginRes = await request('/auth/login', {
      body: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    const token = extractRefreshCookie(loginRes);

    // Use the token once
    await request('/auth/refresh', { cookie: `refresh_token=${token}` });

    // Second use should fail
    const secondRes = await request('/auth/refresh', {
      cookie: `refresh_token=${token}`,
    });

    expect(secondRes.status).toBe(401);
  });

  it('returns 401 when refresh_token cookie is absent', async () => {
    const res = await request('/auth/refresh');
    expect(res.status).toBe(401);
  });
});

describe('GET /health (regression)', () => {
  it('still returns 200 with status ok', async () => {
    const res = await request('/health', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string }>();
    expect(body.status).toBe('ok');
  });
});
