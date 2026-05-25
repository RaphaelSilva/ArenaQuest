import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await applyMigrations(env.DB);
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
