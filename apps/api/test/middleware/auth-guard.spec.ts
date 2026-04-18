import { Hono } from 'hono';
import { describe, it, expect } from 'vitest';
import { authGuard } from '@api/middleware/auth-guard';
import { requireRole } from '@api/middleware/require-role';
import type { IAuthAdapter, VerifiedToken } from '@arenaquest/shared/ports';
import '@api/types/hono-env';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_PAYLOAD: VerifiedToken = {
  sub: 'user-1',
  email: 'alice@example.com',
  roles: ['student'],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 900,
};

function makeMockAuth(verifyResult: VerifiedToken | null): IAuthAdapter {
  return {
    hashPassword: async () => 'hash',
    verifyPassword: async () => true,
    signAccessToken: async () => 'token',
    verifyAccessToken: async () => verifyResult,
    generateRefreshToken: async () => 'rt',
  };
}

/** Build a minimal Hono app that injects `adapter` into context and mounts the given middleware chain on GET /test. */
function buildTestApp(adapter: IAuthAdapter, ...handlers: Parameters<typeof Hono.prototype.get>[1][]) {
  const app = new Hono();
  app.use('*', (c, next) => { c.set('auth', adapter); return next(); });
  // @ts-expect-error — spread of rest middleware args; types are correct at runtime
  app.get('/test', ...handlers);
  return app;
}

function get(app: Hono, path: string, authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader) headers['Authorization'] = authHeader;
  return app.request(path, { headers });
}

// ---------------------------------------------------------------------------
// authGuard
// ---------------------------------------------------------------------------

describe('authGuard', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const app = buildTestApp(makeMockAuth(VALID_PAYLOAD), authGuard, (c) => c.json({ ok: true }));

    const res = await get(app, '/test');

    expect(res.status).toBe(401);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 when token verification fails (expired / tampered)', async () => {
    const app = buildTestApp(makeMockAuth(null), authGuard, (c) => c.json({ ok: true }));

    const res = await get(app, '/test', 'Bearer invalid.token.here');

    expect(res.status).toBe(401);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('Unauthorized');
  });

  it('calls next and injects user into context when token is valid', async () => {
    const app = buildTestApp(
      makeMockAuth(VALID_PAYLOAD),
      authGuard,
      (c) => c.json({ email: c.get('user').email }),
    );

    const res = await get(app, '/test', 'Bearer valid.token');

    expect(res.status).toBe(200);
    const body = await res.json<{ email: string }>();
    expect(body.email).toBe('alice@example.com');
  });

  it('strips the "Bearer " prefix before verifying', async () => {
    let capturedToken = '';
    const adapter: IAuthAdapter = {
      ...makeMockAuth(VALID_PAYLOAD),
      verifyAccessToken: async (token) => { capturedToken = token; return VALID_PAYLOAD; },
    };
    const app = buildTestApp(adapter, authGuard, (c) => c.json({ ok: true }));

    await get(app, '/test', 'Bearer my-raw-token');

    expect(capturedToken).toBe('my-raw-token');
  });
});

// ---------------------------------------------------------------------------
// requireRole
// ---------------------------------------------------------------------------

describe('requireRole', () => {
  function buildRoleApp(...requiredRoles: Parameters<typeof requireRole>) {
    const app = buildTestApp(
      makeMockAuth(VALID_PAYLOAD),
      authGuard,
      requireRole(...requiredRoles),
      (c) => c.json({ ok: true }),
    );
    return app;
  }

  it('returns 403 when user does not have the required role', async () => {
    const app = buildRoleApp('admin');

    const res = await get(app, '/test', 'Bearer valid.token');

    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('Forbidden');
  });

  it('proceeds when user has the required role', async () => {
    const app = buildRoleApp('student');

    const res = await get(app, '/test', 'Bearer valid.token');

    expect(res.status).toBe(200);
  });

  it('proceeds when user has any one of multiple required roles', async () => {
    const app = buildRoleApp('admin', 'student');

    const res = await get(app, '/test', 'Bearer valid.token');

    expect(res.status).toBe(200);
  });

  it('returns 403 when user has none of the required roles', async () => {
    const app = buildRoleApp('admin', 'content_creator');

    const res = await get(app, '/test', 'Bearer valid.token');

    expect(res.status).toBe(403);
  });
});
