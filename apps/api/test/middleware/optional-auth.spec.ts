import { Hono } from 'hono';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { optionalAuth, resolveViewerUserId } from '@api/middleware/optional-auth';
import type { IAuthAdapter, VerifiedToken } from '@arenaquest/shared/ports';
import '@api/types/hono-env';

/**
 * `optionalAuth` has exactly one hard guarantee: **it never returns a status**.
 * Every case below therefore asserts `200` first and the resolved identity
 * second — a spec that only checked the identity would still pass if the
 * middleware started answering `401` for a malformed token, which is the
 * regression this surface cannot afford.
 */

const VALID_PAYLOAD: VerifiedToken = {
  sub: 'user-1',
  email: 'alice@example.com',
  roles: ['student'],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 900,
};

function makeAuth(
  verifyAccessToken: IAuthAdapter['verifyAccessToken'],
): IAuthAdapter {
  return {
    hashPassword: async () => 'hash',
    verifyPassword: async () => true,
    signAccessToken: async () => 'token',
    verifyAccessToken,
    generateRefreshToken: async () => 'rt',
  };
}

/** Mounts `optionalAuth` over a handler that reports what it resolved. */
function buildApp(adapter: IAuthAdapter) {
  const app = new Hono();
  app.use('*', (c, next) => {
    c.set('auth', adapter);
    return next();
  });
  app.use('*', optionalAuth);
  app.get('/test', (c) => c.json({ viewerUserId: resolveViewerUserId(c) }));
  return app;
}

function get(app: Hono, authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers['Authorization'] = authHeader;
  return app.request('/test', { headers });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('optionalAuth', () => {
  it('proceeds anonymously when no Authorization header is present', async () => {
    const verify = vi.fn(async () => VALID_PAYLOAD);
    const res = await get(buildApp(makeAuth(verify)));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ viewerUserId: null });
    // Nothing to verify, so the adapter is never asked.
    expect(verify).not.toHaveBeenCalled();
  });

  it('sets the user when the token verifies', async () => {
    const res = await get(buildApp(makeAuth(async () => VALID_PAYLOAD)), 'Bearer good.token');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ viewerUserId: 'user-1' });
  });

  it('strips the "Bearer " prefix before verifying', async () => {
    let captured = '';
    const app = buildApp(
      makeAuth(async (token) => {
        captured = token;
        return VALID_PAYLOAD;
      }),
    );

    await get(app, 'Bearer my-raw-token');

    expect(captured).toBe('my-raw-token');
  });

  it('proceeds anonymously — not 401 — for an expired or tampered token', async () => {
    // `null` is what JwtAuthAdapter returns for an expired signature, a bad
    // signature and a foreign-signed token alike.
    const res = await get(buildApp(makeAuth(async () => null)), 'Bearer expired.token.here');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ viewerUserId: null });
  });

  it('proceeds anonymously for a header that is not a Bearer token', async () => {
    const verify = vi.fn(async () => VALID_PAYLOAD);
    const res = await get(buildApp(makeAuth(verify)), 'Basic dXNlcjpwYXNz');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ viewerUserId: null });
    expect(verify).not.toHaveBeenCalled();
  });

  it('proceeds anonymously for an empty Bearer value', async () => {
    const verify = vi.fn(async () => VALID_PAYLOAD);
    const res = await get(buildApp(makeAuth(verify)), 'Bearer    ');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ viewerUserId: null });
    expect(verify).not.toHaveBeenCalled();
  });

  it('accepts the scheme case-insensitively', async () => {
    const res = await get(buildApp(makeAuth(async () => VALID_PAYLOAD)), 'bearer good.token');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ viewerUserId: 'user-1' });
  });

  /**
   * The risk this closes (plan §7): a *thrown* verification is not the same
   * event as a declined one, and degrading to anonymous by accident would turn
   * a broken signing key into a silent, permanent downgrade of every signed-in
   * reader. The behaviour is still "proceed anonymously" — this surface has a
   * correct anonymous answer — but it is chosen, and it is logged.
   */
  it('logs and proceeds anonymously when verification throws', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('Web Crypto refused the key');

    const res = await get(
      buildApp(
        makeAuth(async () => {
          throw boom;
        }),
      ),
      'Bearer whatever',
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ viewerUserId: null });
    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0]).toContain(boom);
  });

  it('never short-circuits: the downstream handler always runs', async () => {
    const handler = vi.fn((c: Parameters<Parameters<Hono['get']>[1]>[0]) => c.text('reached'));
    const app = new Hono();
    app.use('*', (c, next) => {
      c.set('auth', makeAuth(async () => null));
      return next();
    });
    app.use('*', optionalAuth);
    // @ts-expect-error — the mocked handler is structurally a Hono handler
    app.get('/test', handler);

    for (const header of [undefined, 'Bearer nope', 'garbage', 'Bearer ']) {
      const res = await get(app, header);
      expect(res.status).toBe(200);
    }
    expect(handler).toHaveBeenCalledTimes(4);
  });
});

describe('resolveViewerUserId', () => {
  it('returns null when the token verified but carries an empty subject', async () => {
    const res = await get(
      buildApp(makeAuth(async () => ({ ...VALID_PAYLOAD, sub: '' }))),
      'Bearer good.token',
    );

    // An empty subject resolves to anonymous rather than to a user id that
    // matches no grant: the narrow side is the safe side.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ viewerUserId: null });
  });
});
