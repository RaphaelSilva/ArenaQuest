import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

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
  await applyMigrations(env.DB);

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
});
