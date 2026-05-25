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
  `CREATE TABLE IF NOT EXISTS user_streak (
    user_id             TEXT    NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_streak      INTEGER NOT NULL DEFAULT 0,
    longest_streak      INTEGER NOT NULL DEFAULT 0,
    last_activity_date  TEXT,
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
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
  options: { method?: string; body?: unknown; cookie?: string; ip?: string } = {},
): Promise<Response> {
  const { method = 'POST', body, cookie, ip } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;
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


});

describe('POST /auth/login rate limiting (S-04)', () => {
  it('returns 429 with Retry-After header after 5 failed attempts', async () => {
    const victimEmail = 's04-lockout-6th@example.com';
    const ip = '203.0.113.10';

    for (let i = 0; i < 5; i++) {
      const res = await request('/auth/login', {
        body: { email: victimEmail, password: 'wrong' },
        ip,
      });
      expect(res.status).toBe(401);
    }

    const locked = await request('/auth/login', {
      body: { email: victimEmail, password: 'wrong' },
      ip,
    });

    expect(locked.status).toBe(429);
    const body = await locked.json<{ error: string }>();
    expect(body.error).toBe('TooManyRequests');

    const retryAfter = Number(locked.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
  });

  it('resets the counter after a successful login within the window', async () => {
    const ip = '203.0.113.20';

    // Four failures — one short of lockout.
    for (let i = 0; i < 4; i++) {
      const res = await request('/auth/login', {
        body: { email: TEST_EMAIL, password: 'wrong' },
        ip,
      });
      expect(res.status).toBe(401);
    }

    // Correct credentials must succeed and clear the bucket.
    const success = await request('/auth/login', {
      body: { email: TEST_EMAIL, password: TEST_PASSWORD },
      ip,
    });
    expect(success.status).toBe(200);

    // After reset, a fresh run of 5 failures should still be allowed before
    // lockout kicks in on the 6th attempt.
    for (let i = 0; i < 5; i++) {
      const res = await request('/auth/login', {
        body: { email: TEST_EMAIL, password: 'wrong' },
        ip,
      });
      expect(res.status).toBe(401);
    }

    const locked = await request('/auth/login', {
      body: { email: TEST_EMAIL, password: 'wrong' },
      ip,
    });
    expect(locked.status).toBe(429);
  });

  it('isolates buckets by (email, ip) — one tuple lockout does not affect another', async () => {
    const email = 's04-isolation@example.com';
    const attackerIp = '203.0.113.30';
    const victimIp = '203.0.113.31';

    for (let i = 0; i < 5; i++) {
      await request('/auth/login', {
        body: { email, password: 'wrong' },
        ip: attackerIp,
      });
    }

    // Attacker IP is locked out.
    const attackerLocked = await request('/auth/login', {
      body: { email, password: 'wrong' },
      ip: attackerIp,
    });
    expect(attackerLocked.status).toBe(429);

    // Same email from a different IP is still allowed.
    const victim = await request('/auth/login', {
      body: { email, password: 'wrong' },
      ip: victimIp,
    });
    expect(victim.status).toBe(401);

    // Different email from the attacker IP is still allowed.
    const otherEmail = await request('/auth/login', {
      body: { email: 's04-isolation-other@example.com', password: 'wrong' },
      ip: attackerIp,
    });
    expect(otherEmail.status).toBe(401);
  });
});

