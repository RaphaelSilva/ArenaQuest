import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { buildApp, type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { JwtAuthAdapter } from '@api/adapters/auth';

/**
 * `/v1/admin/events` end to end through `worker.fetch`.
 *
 * Three things are asserted here and nowhere else, because each is a *wiring*
 * property that a controller spec cannot see:
 *
 * 1. **The publish gate is on the publish path only.** The positive half —
 *    a `content_creator` creating and patching a draft — matters more than the
 *    `403`: a gate mounted router-wide, which is the easy mistake, would still
 *    produce the `403` and would still look green.
 * 2. **No hard delete exists**, asserted against the route table rather than by
 *    a request returning `404`. A `404` proves only that this path is unbound
 *    today; the table is what a future `router.delete('/:id')` would show up in.
 * 3. **The flyer ceiling holds against real bytes in the bucket.** Miniflare's
 *    R2 binding is the same `head`/`delete` the adapter calls in production.
 *
 * `test/middleware/auth-guard.spec.ts` owns the generic 401/403 matrix. The
 * per-route role matrix at the bottom is a deliberate exception asked for by
 * the task: this router is the first to carry two different role rules at once,
 * so "every route refuses a student and a tutor" is stated route by route.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const ADMIN_ID = 'evt-admin';
const CREATOR_ID = 'evt-creator';
const STUDENT_ID = 'evt-student';
const TUTOR_ID = 'evt-tutor';
const GROUP_ID = 'evt-admin-group';
const MEMBER_ID = 'evt-member';

const CEILING = 5 * 1024 * 1024;

let adminToken: string;
let creatorToken: string;
let studentToken: string;
let tutorToken: string;

/** Every public read gets its own IP so one test cannot spend another's budget. */
let ipCounter = 0;

async function req(
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'CF-Connecting-IP': `203.0.113.${++ipCounter % 250}-${ipCounter}`,
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  const request = new IncomingRequest(`http://example.com${v1(path)}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

type EventDto = {
  id: string;
  slug: string;
  title: string;
  status: string;
  audience: string;
  whatsappNumber: string;
  createdBy: string;
  flyer: { status: string; key: string | null; sizeBytes: number | null };
  audienceGrants?: { groupIds: string[]; userIds: string[] };
};

/** Creates a draft as an admin and returns it. */
async function createDraft(body: Record<string, unknown> = {}): Promise<EventDto> {
  const res = await req('POST', '/admin/events', {
    token: adminToken,
    body: {
      title: 'Summer seminar',
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      ...body,
    },
  });
  expect(res.status).toBe(201);
  return res.json<EventDto>();
}

/** presign → PUT (straight into the bucket) → finalize. */
async function uploadFlyer(
  eventId: string,
  storedBytes: number,
  declaredBytes = 4096,
): Promise<{ key: string; finalize: Response }> {
  const presignRes = await req('POST', `/admin/events/${eventId}/flyer/presign`, {
    token: adminToken,
    body: { fileName: 'flyer.jpg', contentType: 'image/jpeg', sizeBytes: declaredBytes },
  });
  expect(presignRes.status).toBe(201);
  const { flyer } = await presignRes.json<{ flyer: { key: string } }>();

  await env.R2.put(flyer.key, new ArrayBuffer(storedBytes));

  const finalize = await req('POST', `/admin/events/${eventId}/flyer/finalize`, {
    token: adminToken,
  });
  return { key: flyer.key, finalize };
}

async function slugsOf(path: string): Promise<string[]> {
  const res = await req('GET', path);
  expect(res.status).toBe(200);
  const body = await res.json<{ data: { slug: string }[] }>();
  return body.data.map(e => e.slug);
}

beforeAll(async () => {
  await applyMigrations(env.DB);

  await env.DB.batch([
    ...[ADMIN_ID, CREATOR_ID, STUDENT_ID, TUTOR_ID, MEMBER_ID].map(id =>
      env.DB
        .prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .bind(id, 'Test', `${id}@events.test`, 'hash'),
    ),
    env.DB
      .prepare('INSERT OR IGNORE INTO user_groups (id, name) VALUES (?, ?)')
      .bind(GROUP_ID, 'Events admin group'),
  ]);

  const adapter = new JwtAuthAdapter({
    secret: env.JWT_SECRET,
    accessTokenExpiresInSeconds: 900,
  });

  [adminToken, creatorToken, studentToken, tutorToken] = await Promise.all([
    adapter.signAccessToken({ sub: ADMIN_ID, email: 'a@events.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: CREATOR_ID, email: 'c@events.test', roles: ['content_creator'] }),
    adapter.signAccessToken({ sub: STUDENT_ID, email: 's@events.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: TUTOR_ID, email: 't@events.test', roles: ['tutor'] }),
  ]);
});

// ---------------------------------------------------------------------------
// The publish gate
// ---------------------------------------------------------------------------

describe('the publish gate', () => {
  it('lets an admin publish', async () => {
    const event = await createDraft({ title: 'Admin publishes this' });

    const res = await req('PATCH', `/admin/events/${event.id}`, {
      token: adminToken,
      body: { status: 'published' },
    });

    expect(res.status).toBe(200);
    expect((await res.json<EventDto>()).status).toBe('published');
  });

  it('refuses a content_creator the publish transition', async () => {
    const event = await createDraft({ title: 'Creator may not publish this' });

    const res = await req('PATCH', `/admin/events/${event.id}`, {
      token: creatorToken,
      body: { status: 'published' },
    });

    expect(res.status).toBe(403);
    // …and nothing moved.
    const row = await env.DB
      .prepare('SELECT status FROM events WHERE id = ?')
      .bind(event.id)
      .first<{ status: string }>();
    expect(row?.status).toBe('draft');
  });

  it('lets a content_creator CREATE a draft — the gate is not router-wide', async () => {
    const res = await req('POST', '/admin/events', {
      token: creatorToken,
      body: { title: 'Creator draft', startsAt: new Date().toISOString() },
    });

    expect(res.status).toBe(201);
    const created = await res.json<EventDto>();
    expect(created.status).toBe('draft');
    expect(created.createdBy).toBe(CREATOR_ID);
  });

  it('lets a content_creator PATCH a draft, archive included', async () => {
    const event = await createDraft({ title: 'Creator edits this' });

    const renamed = await req('PATCH', `/admin/events/${event.id}`, {
      token: creatorToken,
      body: { title: 'Creator renamed this', summary: 'A blurb' },
    });
    expect(renamed.status).toBe(200);
    expect((await renamed.json<EventDto>()).title).toBe('Creator renamed this');

    // `archived` is not `published`: removal stays open to both roles.
    const archived = await req('PATCH', `/admin/events/${event.id}`, {
      token: creatorToken,
      body: { status: 'archived' },
    });
    expect(archived.status).toBe(200);
  });

  it('lets a content_creator read the board and manage a flyer', async () => {
    const event = await createDraft({ title: 'Creator flyer' });

    expect((await req('GET', '/admin/events', { token: creatorToken })).status).toBe(200);
    const presign = await req('POST', `/admin/events/${event.id}/flyer/presign`, {
      token: creatorToken,
      body: { fileName: 'f.jpg', contentType: 'image/jpeg', sizeBytes: 1024 },
    });
    expect(presign.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// No hard delete
// ---------------------------------------------------------------------------

describe('removal is archiving, not deletion', () => {
  it('declares no DELETE route for an event itself', () => {
    const routes = buildApp(env as AppEnv).routes.filter(r =>
      r.path.startsWith('/v1/admin/events'),
    );

    const deletes = routes.filter(r => r.method === 'DELETE').map(r => r.path);

    // The only DELETE this router may carry is the flyer's.
    expect(deletes.length).toBeGreaterThan(0);
    expect(deletes.every(path => path.endsWith('/flyer'))).toBe(true);
    expect(deletes).not.toContain('/v1/admin/events/:id');
  });

  it('answers 404 to a DELETE on an event, as an unbound path', async () => {
    const event = await createDraft({ title: 'Never deletable' });
    const res = await req('DELETE', `/admin/events/${event.id}`, { token: adminToken });
    expect(res.status).toBe(404);

    const row = await env.DB
      .prepare('SELECT id FROM events WHERE id = ?')
      .bind(event.id)
      .first<{ id: string }>();
    expect(row?.id).toBe(event.id);
  });
});

// ---------------------------------------------------------------------------
// Archive / un-archive against the public board
// ---------------------------------------------------------------------------

describe('archiving', () => {
  it('removes the event from both public scopes while its flyer object survives', async () => {
    const event = await createDraft({
      title: 'Archivable open mat',
      slug: 'archivable-open-mat',
      audience: 'public',
    });
    const { key, finalize } = await uploadFlyer(event.id, 2048);
    expect(finalize.status).toBe(200);

    await req('PATCH', `/admin/events/${event.id}`, {
      token: adminToken,
      body: { status: 'published' },
    });
    expect(await slugsOf('/events?scope=upcoming')).toContain('archivable-open-mat');

    const archived = await req('PATCH', `/admin/events/${event.id}`, {
      token: adminToken,
      body: { status: 'archived' },
    });
    expect(archived.status).toBe(200);

    expect(await slugsOf('/events?scope=upcoming')).not.toContain('archivable-open-mat');
    expect(await slugsOf('/events?scope=past')).not.toContain('archivable-open-mat');
    // The row and the object stay together: an archive is reversible.
    expect(await env.R2.head(key)).not.toBeNull();

    const restored = await req('PATCH', `/admin/events/${event.id}`, {
      token: adminToken,
      body: { status: 'published' },
    });
    expect(restored.status).toBe(200);
    expect(await slugsOf('/events?scope=upcoming')).toContain('archivable-open-mat');
  });
});

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

describe('the slug', () => {
  it('survives a rename, and the URL already shared keeps resolving', async () => {
    const event = await createDraft({
      title: 'Winter grading',
      slug: 'winter-grading',
      audience: 'public',
    });
    await req('PATCH', `/admin/events/${event.id}`, {
      token: adminToken,
      body: { status: 'published' },
    });

    const renamed = await req('PATCH', `/admin/events/${event.id}`, {
      token: adminToken,
      body: { title: 'Winter grading — new date' },
    });

    expect(renamed.status).toBe(200);
    expect((await renamed.json<EventDto>()).slug).toBe('winter-grading');
    // The link pasted into a chat before the rename still works.
    expect((await req('GET', '/events/winter-grading')).status).toBe(200);
  });

  it('honours an explicit slug and refuses a collision with 409', async () => {
    const explicit = await createDraft({ title: 'Explicitly slugged', slug: 'explicit-slug' });
    expect(explicit.slug).toBe('explicit-slug');

    const res = await req('POST', '/admin/events', {
      token: adminToken,
      body: {
        title: 'Another one',
        slug: 'explicit-slug',
        startsAt: new Date().toISOString(),
      },
    });

    expect(res.status).toBe(409);
    expect((await res.json<{ error: string }>()).error).toBe('SlugConflict');
  });
});

// ---------------------------------------------------------------------------
// Audience grants
// ---------------------------------------------------------------------------

describe('PUT /{id}/audience', () => {
  it('replaces the whole grant set', async () => {
    const event = await createDraft({ title: 'Restricted seminar', audience: 'restricted' });

    const first = await req('PUT', `/admin/events/${event.id}/audience`, {
      token: adminToken,
      body: { groupIds: [GROUP_ID], userIds: [MEMBER_ID] },
    });
    expect(first.status).toBe(200);

    const second = await req('PUT', `/admin/events/${event.id}/audience`, {
      token: adminToken,
      body: { groupIds: [], userIds: [MEMBER_ID] },
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ groupIds: [], userIds: [MEMBER_ID] });

    const groups = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM event_audience_group WHERE event_id = ?')
      .bind(event.id)
      .first<{ n: number }>();
    expect(groups?.n).toBe(0);
  });

  it('refuses an unknown group or user with 422', async () => {
    const event = await createDraft({ title: 'Bad grants', audience: 'restricted' });

    const res = await req('PUT', `/admin/events/${event.id}/audience`, {
      token: adminToken,
      body: { groupIds: ['no-such-group'], userIds: ['no-such-user'] },
    });

    expect(res.status).toBe(422);
    expect((await res.json<{ error: string }>()).error).toBe('UnknownAudienceTarget');
  });
});

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

describe('the WhatsApp number', () => {
  it('rejects a number that fails the shared digit rule', async () => {
    const res = await req('POST', '/admin/events', {
      token: adminToken,
      body: {
        title: 'Bad number',
        startsAt: new Date().toISOString(),
        whatsappNumber: '99-99',
      },
    });

    expect(res.status).toBe(400);
    expect((await res.json<{ field: string }>()).field).toBe('whatsappNumber');
  });

  it('accepts an empty number — it means "no button", and there is no tenant fallback', async () => {
    const event = await createDraft({ title: 'No number', whatsappNumber: '' });
    expect(event.whatsappNumber).toBe('');

    const cleared = await req('PATCH', `/admin/events/${event.id}`, {
      token: adminToken,
      body: { whatsappNumber: '' },
    });
    expect(cleared.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// The flyer ceiling
// ---------------------------------------------------------------------------

describe('the flyer ceiling', () => {
  it('rejects a 6 MB JPEG at presign', async () => {
    const event = await createDraft({ title: 'Too big at presign' });

    const res = await req('POST', `/admin/events/${event.id}/flyer/presign`, {
      token: adminToken,
      body: { fileName: 'huge.jpg', contentType: 'image/jpeg', sizeBytes: 6 * 1024 * 1024 },
    });

    expect(res.status).toBe(422);
    const body = await res.json<{ error: string; maxBytes: number }>();
    expect(body.error).toBe('FileTooLarge');
    expect(body.maxBytes).toBe(CEILING);
  });

  it('rejects a non-image type at presign', async () => {
    const event = await createDraft({ title: 'Not an image' });

    const res = await req('POST', `/admin/events/${event.id}/flyer/presign`, {
      token: adminToken,
      body: { fileName: 'programme.pdf', contentType: 'application/pdf', sizeBytes: 1024 },
    });

    expect(res.status).toBe(422);
    expect((await res.json<{ error: string }>()).error).toBe('UnsupportedMediaType');
  });

  it('rejects an oversize STORED object at finalize, deletes it, and stays pending', async () => {
    const event = await createDraft({ title: 'Lies about its size' });

    // Declares 1 KB, stores more than the ceiling. The size the API believes is
    // the one it reads back out of the bucket. (6 MB rather than the 50 MB of
    // the controller spec: these are real bytes through Miniflare, and one byte
    // over the ceiling proves the same rule.)
    const { key, finalize } = await uploadFlyer(event.id, CEILING + 1024, 1024);

    expect(finalize.status).toBe(422);
    const body = await finalize.json<{ error: string; storedBytes: number }>();
    expect(body.error).toBe('FileTooLarge');
    expect(body.storedBytes).toBe(CEILING + 1024);

    // The bytes are gone from the bucket…
    expect(await env.R2.head(key)).toBeNull();
    // …and the row never advanced past `pending`.
    const row = await env.DB
      .prepare('SELECT flyer_status FROM events WHERE id = ?')
      .bind(event.id)
      .first<{ flyer_status: string }>();
    expect(row?.flyer_status).toBe('pending');
  });

  it('answers NotUploaded when the object never landed', async () => {
    const event = await createDraft({ title: 'Never uploaded' });
    await req('POST', `/admin/events/${event.id}/flyer/presign`, {
      token: adminToken,
      body: { fileName: 'f.jpg', contentType: 'image/jpeg', sizeBytes: 1024 },
    });

    const res = await req('POST', `/admin/events/${event.id}/flyer/finalize`, {
      token: adminToken,
    });

    expect(res.status).toBe(422);
    expect((await res.json<{ error: string }>()).error).toBe('NotUploaded');
  });

  it('refuses a finalize with nothing pending', async () => {
    const event = await createDraft({ title: 'Nothing pending' });

    const res = await req('POST', `/admin/events/${event.id}/flyer/finalize`, {
      token: adminToken,
    });

    expect(res.status).toBe(422);
    expect((await res.json<{ error: string }>()).error).toBe('NoPendingFlyer');
  });

  it('deletes the displaced object on a second successful finalize', async () => {
    const event = await createDraft({ title: 'Replaced flyer' });

    const first = await uploadFlyer(event.id, 2048);
    expect(first.finalize.status).toBe(200);

    const second = await uploadFlyer(event.id, 4096);
    expect(second.finalize.status).toBe(200);
    expect(second.key).not.toBe(first.key);

    expect(await env.R2.head(first.key)).toBeNull();
    expect(await env.R2.head(second.key)).not.toBeNull();
    const flyer = (await second.finalize.json<EventDto>()).flyer;
    expect(flyer.status).toBe('ready');
    expect(flyer.sizeBytes).toBe(4096);
  });

  it('removes the flyer and its object on DELETE /{id}/flyer', async () => {
    const event = await createDraft({ title: 'Flyer to remove' });
    const { key, finalize } = await uploadFlyer(event.id, 2048);
    expect(finalize.status).toBe(200);

    const res = await req('DELETE', `/admin/events/${event.id}/flyer`, { token: adminToken });

    expect(res.status).toBe(204);
    expect(await env.R2.head(key)).toBeNull();
    const row = await env.DB
      .prepare('SELECT flyer_status, flyer_key FROM events WHERE id = ?')
      .bind(event.id)
      .first<{ flyer_status: string; flyer_key: string | null }>();
    expect(row?.flyer_status).toBe('none');
    expect(row?.flyer_key).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The role matrix, per route
// ---------------------------------------------------------------------------

describe('a student and a tutor are refused every route', () => {
  const routes: { method: string; path: (id: string) => string; body?: unknown }[] = [
    { method: 'GET', path: () => '/admin/events' },
    {
      method: 'POST',
      path: () => '/admin/events',
      body: { title: 'Nope', startsAt: '2026-10-10T13:00:00.000Z' },
    },
    { method: 'PATCH', path: id => `/admin/events/${id}`, body: { title: 'Nope' } },
    {
      method: 'PUT',
      path: id => `/admin/events/${id}/audience`,
      body: { groupIds: [], userIds: [] },
    },
    {
      method: 'POST',
      path: id => `/admin/events/${id}/flyer/presign`,
      body: { fileName: 'f.jpg', contentType: 'image/jpeg', sizeBytes: 1024 },
    },
    { method: 'POST', path: id => `/admin/events/${id}/flyer/finalize` },
    { method: 'DELETE', path: id => `/admin/events/${id}/flyer` },
  ];

  let targetId: string;

  beforeAll(async () => {
    targetId = (await createDraft({ title: 'Role matrix target' })).id;
  });

  for (const role of ['student', 'tutor'] as const) {
    for (const route of routes) {
      it(`${role}: ${route.method} ${route.path('{id}')} -> 403`, async () => {
        const token = role === 'student' ? studentToken : tutorToken;
        const res = await req(route.method, route.path(targetId), { token, body: route.body });
        expect(res.status).toBe(403);
      });
    }
  }

  it('refuses an anonymous caller with 401', async () => {
    expect((await req('GET', '/admin/events')).status).toBe(401);
  });
});
