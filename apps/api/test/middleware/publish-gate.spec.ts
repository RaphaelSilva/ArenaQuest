import { Hono } from 'hono';
import { describe, it, expect } from 'vitest';
import { publishGate, PUBLISH_STATUS, type PublishGateOptions } from '@api/middleware/publish-gate';
import type { VerifiedToken } from '@arenaquest/shared/ports';
import '@api/types/hono-env';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userWith(roles: VerifiedToken['roles']): VerifiedToken {
  return {
    sub: 'user-1',
    email: 'staff@example.com',
    roles,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
  };
}

const ADMIN = userWith(['admin']);
const CREATOR = userWith(['content_creator']);

/**
 * A minimal app: `user` is injected as `authGuard` would, the gate is mounted
 * on `/` and `/:id`, and every handler echoes the body it still sees — which
 * also proves the gate did not consume the stream.
 */
function buildTestApp(user: VerifiedToken, options?: PublishGateOptions) {
  const app = new Hono();
  app.use('*', (c, next) => {
    c.set('user', user);
    return next();
  });
  app.use('/', publishGate(options));
  app.use('/:id', publishGate(options));

  const echo = async (c: { req: { json: () => Promise<unknown>; method: string } }) => {
    let body: unknown = null;
    try {
      body = await c.req.json();
    } catch {
      body = 'not-json';
    }
    return Response.json({ handled: true, method: c.req.method, body });
  };
  app.post('/', echo);
  app.patch('/:id', echo);
  app.put('/:id', echo);
  return app;
}

function send(app: Hono, method: string, path: string, body?: unknown, contentType = 'application/json') {
  return app.request(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': contentType },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('publishGate', () => {
  it('exposes the one status it reacts to', () => {
    expect(PUBLISH_STATUS).toBe('published');
  });

  it('is PATCH-only by default: a content creator may POST { status: published }', async () => {
    const app = buildTestApp(CREATOR);

    const res = await send(app, 'POST', '/', { status: 'published' });

    expect(res.status).toBe(200);
    expect(await res.json<{ handled: boolean }>()).toMatchObject({ handled: true });
  });

  it('refuses a content creator PATCH { status: published } with the requireRole body', async () => {
    const app = buildTestApp(CREATOR);

    const res = await send(app, 'PATCH', '/abc', { status: 'published' });

    expect(res.status).toBe(403);
    expect(await res.json<{ error: string }>()).toEqual({ error: 'Forbidden' });
  });

  it('lets an admin through and the handler still sees the body', async () => {
    const app = buildTestApp(ADMIN);

    const res = await send(app, 'PATCH', '/abc', { status: 'published', title: 'T' });

    expect(res.status).toBe(200);
    expect(await res.json<{ body: unknown }>()).toMatchObject({
      body: { status: 'published', title: 'T' },
    });
  });

  it('passes a status other than published through for a content creator', async () => {
    const app = buildTestApp(CREATOR);

    for (const status of ['draft', 'archived']) {
      const res = await send(app, 'PATCH', '/abc', { status });
      expect(res.status).toBe(200);
    }
    expect((await send(app, 'PATCH', '/abc', { title: 'no status at all' })).status).toBe(200);
  });

  it('passes a non-JSON body through to the handler, which owns the 400', async () => {
    const app = buildTestApp(CREATOR);

    const res = await send(app, 'PATCH', '/abc', '{not json', 'text/plain');

    expect(res.status).toBe(200);
    expect(await res.json<{ body: unknown }>()).toMatchObject({ body: 'not-json' });
  });

  it('passes a JSON body that is not an object through', async () => {
    const app = buildTestApp(CREATOR);

    expect((await send(app, 'PATCH', '/abc', null)).status).toBe(200);
    expect((await send(app, 'PATCH', '/abc', 'published')).status).toBe(200);
  });

  it("gates POST when configured with methods: ['POST'] and leaves PATCH alone", async () => {
    const app = buildTestApp(CREATOR, { methods: ['POST'] });

    expect((await send(app, 'POST', '/', { status: 'published' })).status).toBe(403);
    expect((await send(app, 'PATCH', '/abc', { status: 'published' })).status).toBe(200);
  });

  it('gates every listed method', async () => {
    const app = buildTestApp(CREATOR, { methods: ['POST', 'PATCH', 'PUT'] });

    expect((await send(app, 'POST', '/', { status: 'published' })).status).toBe(403);
    expect((await send(app, 'PATCH', '/abc', { status: 'published' })).status).toBe(403);
    expect((await send(app, 'PUT', '/abc', { status: 'published' })).status).toBe(403);
    expect((await send(app, 'POST', '/', { status: 'draft' })).status).toBe(200);
  });
});
