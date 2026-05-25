import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------
// PBKDF2 note: POST /auth/register hashes passwords through the Worker (buildApp),
// which uses the production default of 100 000 iterations. There is no test-only
// override without a src/ change. This is a known limitation; the spec is kept
// as an integration smoke test rather than a performance-critical suite.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await applyMigrations(env.DB);
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
});
