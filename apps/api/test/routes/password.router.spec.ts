import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

const TEST_EMAIL = 'reset-user@example.com';
const TEST_USER_ID = 'test-user-pw-router';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function post(path: string, body: unknown, ip = '1.2.3.4'): Promise<Response> {
  const req = new IncomingRequest(`http://example.com${v1(path)}`, {
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
  await applyMigrations(env.DB);

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

// ---------------------------------------------------------------------------
// POST /auth/reset-password
// ---------------------------------------------------------------------------

describe('POST /auth/reset-password', () => {
  it('returns standardized 400 with issues for invalid body', async () => {
    const res = await post('/auth/reset-password', { newPassword: 'weak' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('ValidationError');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('returns 400 for a missing token', async () => {
    const res = await post('/auth/reset-password', { newPassword: 'ValidPass1' });
    expect(res.status).toBe(400);
  });

  it('full flow: forgot → reset → login with new password, old password rejected', async () => {
    // 1. Seed a fresh reset token by calling forgot-password
    await post('/auth/forgot-password', { email: TEST_EMAIL });

    // 2. Read the token hash row from the DB (not the plaintext — we need to fish
    //    the token from the ConsoleMailAdapter output). Instead, we directly call
    //    the repository via the D1 adapter in-process to extract and re-use the token.
    //    For the integration test, we seed the token ourselves so we control the plaintext.
    const plainToken = 'integration-test-reset-token-123abc';
    const { sha256Hex } = await import('@api/adapters/db/hash');
    const tokenHash = await sha256Hex(plainToken);
    const expiresAt = Date.now() + 3_600_000;
    await env.DB
      .prepare('INSERT OR REPLACE INTO password_reset_tokens (token_hash, user_id, expires_at, consumed_at, created_at) VALUES (?, ?, ?, NULL, ?)')
      .bind(tokenHash, TEST_USER_ID, expiresAt, Date.now())
      .run();

    // 3. Reset password
    const resetRes = await post('/auth/reset-password', { token: plainToken, newPassword: 'NewValidPass9' });
    expect(resetRes.status).toBe(200);

    // 4. Login with new password should succeed
    const loginNew = await post('/auth/login', { email: TEST_EMAIL, password: 'NewValidPass9' });
    expect(loginNew.status).toBe(200);

    // 5. Login with old password should fail
    const loginOld = await post('/auth/login', { email: TEST_EMAIL, password: 'Password123' });
    expect(loginOld.status).toBe(401);

    // Restore original password for other tests
    const { JwtAuthAdapter: Adapter } = await import('@api/adapters/auth');
    const adapter = new Adapter({ secret: env.JWT_SECRET, pbkdf2Iterations: 1 });
    const originalHash = await adapter.hashPassword('Password123');
    await env.DB
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(originalHash, TEST_USER_ID)
      .run();
  });
});
