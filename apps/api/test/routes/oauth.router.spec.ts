import { env, createExecutionContext, waitOnExecutionContext, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
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
  `CREATE TABLE IF NOT EXISTS oauth_accounts (
    provider         TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email            TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (provider, provider_user_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_accounts_provider_user
     ON oauth_accounts (provider, user_id)`,
];

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function get(path: string): Promise<Response> {
  const req = new IncomingRequest(`http://example.com${path}`, { method: 'GET' });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function makeIdToken(payload: object): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.fake-sig`;
}

beforeAll(async () => {
  await env.DB.batch(MIGRATION_SQL.map(sql => env.DB.prepare(sql)));
  await env.DB.prepare(
    "INSERT OR IGNORE INTO roles (id, name, description) VALUES ('role-student', 'student', 'Student')"
  ).run();

  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  // Reset interceptors between tests without deactivating
  fetchMock.activate();
});

// ---------------------------------------------------------------------------
// GET /auth/google
// ---------------------------------------------------------------------------

describe('GET /auth/google', () => {
  it('redirects to Google authorization endpoint', async () => {
    const res = await get('/auth/google');
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('accounts.google.com/o/oauth2/v2/auth');
  });

  it('includes code_challenge and state in the redirect URL', async () => {
    const res = await get('/auth/google');
    const location = res.headers.get('location') ?? '';
    const url = new URL(location);
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });
});

// ---------------------------------------------------------------------------
// GET /auth/google/callback
// ---------------------------------------------------------------------------

describe('GET /auth/google/callback', () => {
  it('returns 400 for a missing state', async () => {
    const res = await get('/auth/google/callback?code=some-code');
    expect(res.status).toBe(400);
  });

  it('returns 400 for a missing code', async () => {
    const res = await get('/auth/google/callback?state=some-state');
    expect(res.status).toBe(400);
  });

  it('returns 400 InvalidOAuthState for an unknown state', async () => {
    const res = await get('/auth/google/callback?state=nonexistent&code=some-code');
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('InvalidOAuthState');
  });

  it('full flow: new user created, refresh cookie set, redirect to web app', async () => {
    const testState = 'integration-test-state-abc';
    const testVerifier = 'integration-test-code-verifier-xyz-long-enough-43';
    await env.RATE_LIMIT_KV.put(
      `oauth:state:${testState}`,
      JSON.stringify({ codeVerifier: testVerifier }),
      { expirationTtl: 300 },
    );

    const googleSub = 'google-integration-sub-999';
    const googleEmail = 'oauth-integration-new@test.com';
    const idToken = makeIdToken({ sub: googleSub, email: googleEmail, name: 'Integration User' });

    fetchMock
      .get('https://oauth2.googleapis.com')
      .intercept({ path: '/token', method: 'POST' })
      .reply(200, JSON.stringify({ id_token: idToken }), {
        headers: { 'Content-Type': 'application/json' },
      });

    const res = await get(`/auth/google/callback?state=${testState}&code=auth-code-xyz`);

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/auth/callback');
    expect(location).toContain('accessToken=');

    const cookieHeader = res.headers.get('set-cookie') ?? '';
    expect(cookieHeader).toContain('refresh_token=');
    expect(cookieHeader).toContain('HttpOnly');

    const user = await env.DB
      .prepare('SELECT email FROM users WHERE email = ?')
      .bind(googleEmail)
      .first<{ email: string }>();
    expect(user).not.toBeNull();

    const link = await env.DB
      .prepare('SELECT provider_user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?')
      .bind('google', googleSub)
      .first();
    expect(link).not.toBeNull();
  });

  it('state nonce is consumed: replaying returns 400 InvalidOAuthState', async () => {
    const testState = 'replay-test-state-def';
    await env.RATE_LIMIT_KV.put(
      `oauth:state:${testState}`,
      JSON.stringify({ codeVerifier: 'verifier-def' }),
      { expirationTtl: 300 },
    );

    const idToken = makeIdToken({ sub: 'replay-sub', email: 'replay-user@test.com', name: 'Replay' });
    fetchMock
      .get('https://oauth2.googleapis.com')
      .intercept({ path: '/token', method: 'POST' })
      .reply(200, JSON.stringify({ id_token: idToken }), {
        headers: { 'Content-Type': 'application/json' },
      });

    await get(`/auth/google/callback?state=${testState}&code=first-code`);

    const replay = await get(`/auth/google/callback?state=${testState}&code=second-code`);
    expect(replay.status).toBe(400);
    const body = await replay.json<{ error: string }>();
    expect(body.error).toBe('InvalidOAuthState');
  });
});
