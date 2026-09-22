import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { D1EventRepository } from '@api/adapters/db/d1-event-repository';
import { Entities } from '@arenaquest/shared/types/entities';

/**
 * The anonymous events read surface, end to end through `worker.fetch`.
 *
 * This file carries the audience matrix at the HTTP layer even though
 * `test/db/d1-event-repository.spec.ts` already owns the rule, because the
 * regression being guarded against is a *wiring* one: a router that forgets to
 * pass `viewerUserId`, or an `optionalAuth` that stops setting the user, would
 * leave every repository test green while serving the wrong slice to the
 * internet. Four viewer classes × seven event states is the cheapest assertion
 * that the two halves are still connected.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const DAY = 24 * 60 * 60 * 1000;

const MEMBER_NO_GRANT = 'evt-viewer-no-grant';
const MEMBER_DIRECT = 'evt-viewer-direct';
const MEMBER_GROUP = 'evt-viewer-group';
const ADMIN_ID = 'evt-author';
const GROUP_ID = 'evt-group';

const WHATSAPP = '5519999991155';

let tokenNoGrant: string;
let tokenDirect: string;
let tokenGroup: string;
let expiredToken: string;

/** Every request gets its own IP so one test cannot spend another's budget. */
let ipCounter = 0;

async function req(
  path: string,
  options: { token?: string; ip?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'CF-Connecting-IP': options.ip ?? `198.51.100.${++ipCounter % 250}-${ipCounter}`,
  };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  const request = new IncomingRequest(`http://example.com${v1(path)}`, { method: 'GET', headers });
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function slugsOf(res: Response): Promise<string[]> {
  const body = await res.json<{ data: { slug: string }[] }>();
  return body.data.map(e => e.slug).sort();
}

beforeAll(async () => {
  await applyMigrations(env.DB);
  await env.DB.exec('PRAGMA foreign_keys = ON');

  await env.DB.batch([
    ...[ADMIN_ID, MEMBER_NO_GRANT, MEMBER_DIRECT, MEMBER_GROUP].map(id =>
      env.DB
        .prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .bind(id, 'Test', `${id}@events.test`, 'hash'),
    ),
    env.DB.prepare('INSERT OR IGNORE INTO user_groups (id, name) VALUES (?, ?)').bind(GROUP_ID, 'Events group'),
    env.DB
      .prepare('INSERT OR IGNORE INTO user_group_members (group_id, user_id) VALUES (?, ?)')
      .bind(GROUP_ID, MEMBER_GROUP),
  ]);

  const repo = new D1EventRepository(env.DB);
  const now = Date.now();
  const soon = new Date(now + 7 * DAY);
  const longGone = new Date(now - 10 * DAY);

  const base = {
    createdBy: ADMIN_ID,
    startsAt: soon,
    status: Entities.Config.EventStatus.PUBLISHED,
  };

  await repo.create({
    ...base,
    slug: 'public-upcoming',
    title: 'Open mat',
    content: 'Welcome <script>alert(1)</script> everyone',
    audience: Entities.Config.EventAudience.PUBLIC,
    whatsappNumber: WHATSAPP,
  });
  await repo.create({
    ...base,
    slug: 'public-no-contact',
    title: 'Open mat without a number',
    audience: Entities.Config.EventAudience.PUBLIC,
    whatsappNumber: '',
  });
  await repo.create({
    ...base,
    slug: 'public-no-flyer',
    title: 'Open mat without a flyer',
    audience: Entities.Config.EventAudience.PUBLIC,
  });
  await repo.create({
    ...base,
    slug: 'members-upcoming',
    title: 'Members only grading',
    audience: Entities.Config.EventAudience.MEMBERS,
  });

  const direct = await repo.create({
    ...base,
    slug: 'restricted-granted-user',
    title: 'Invitational, by name',
    audience: Entities.Config.EventAudience.RESTRICTED,
  });
  await repo.replaceAudienceGrants(direct.id, { groupIds: [], userIds: [MEMBER_DIRECT] });

  const group = await repo.create({
    ...base,
    slug: 'restricted-granted-group',
    title: 'Invitational, by group',
    audience: Entities.Config.EventAudience.RESTRICTED,
  });
  await repo.replaceAudienceGrants(group.id, { groupIds: [GROUP_ID], userIds: [] });

  await repo.create({
    ...base,
    slug: 'restricted-not-granted',
    title: 'Invitational, nobody here',
    audience: Entities.Config.EventAudience.RESTRICTED,
  });

  // A draft in the future and an archived event in the past, so each is
  // genuinely inside the scope that would otherwise return it.
  await repo.create({
    ...base,
    slug: 'draft-public',
    title: 'Not published yet',
    audience: Entities.Config.EventAudience.PUBLIC,
    status: Entities.Config.EventStatus.DRAFT,
  });
  await repo.create({
    ...base,
    slug: 'archived-public',
    title: 'Taken down',
    startsAt: longGone,
    audience: Entities.Config.EventAudience.PUBLIC,
    status: Entities.Config.EventStatus.ARCHIVED,
  });

  // Open-ended and long past: expires one day after it started.
  await repo.create({
    ...base,
    slug: 'past-public',
    title: 'Last summer seminar',
    startsAt: longGone,
    audience: Entities.Config.EventAudience.PUBLIC,
  });

  // Flyers: one on a `public` event and one on a `members` event, so the two
  // Cache-Control branches are both reachable.
  for (const slug of ['public-upcoming', 'members-upcoming']) {
    const event = await repo.findBySlug(slug);
    await repo.setFlyerPending(event!.id, {
      key: `events/${event!.id}/flyer.png`,
      type: 'image/png',
      sizeBytes: 1024,
      name: 'flyer.png',
    });
    await repo.setFlyerReady(event!.id);
  }

  const auth = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [tokenNoGrant, tokenDirect, tokenGroup] = await Promise.all([
    auth.signAccessToken({ sub: MEMBER_NO_GRANT, email: 'a@events.test', roles: ['student'] }),
    auth.signAccessToken({ sub: MEMBER_DIRECT, email: 'b@events.test', roles: ['student'] }),
    auth.signAccessToken({ sub: MEMBER_GROUP, email: 'c@events.test', roles: ['student'] }),
  ]);

  // Correctly signed, already past its `exp`.
  expiredToken = await new JwtAuthAdapter({
    secret: env.JWT_SECRET,
    accessTokenExpiresInSeconds: -60,
  }).signAccessToken({ sub: MEMBER_DIRECT, email: 'b@events.test', roles: ['student'] });
});

// ===========================================================================
// The audience matrix — four viewers against every event state
// ===========================================================================

const ANONYMOUS_UPCOMING = ['public-no-contact', 'public-no-flyer', 'public-upcoming'].sort();

describe('GET /v1/events — audience matrix', () => {
  it('anonymous sees exactly the published, public, upcoming set', async () => {
    const res = await req('/events');

    expect(res.status).toBe(200);
    expect(await slugsOf(res)).toEqual(ANONYMOUS_UPCOMING);
  });

  it('a member with no grant sees the public set plus members, and nothing restricted', async () => {
    const res = await req('/events', { token: tokenNoGrant });

    expect(res.status).toBe(200);
    expect(await slugsOf(res)).toEqual([...ANONYMOUS_UPCOMING, 'members-upcoming'].sort());
  });

  it('a directly granted member additionally sees that one restricted event', async () => {
    const res = await req('/events', { token: tokenDirect });

    expect(await slugsOf(res)).toEqual(
      [...ANONYMOUS_UPCOMING, 'members-upcoming', 'restricted-granted-user'].sort(),
    );
  });

  it('a group-granted member additionally sees the group restricted event', async () => {
    const res = await req('/events', { token: tokenGroup });

    expect(await slugsOf(res)).toEqual(
      [...ANONYMOUS_UPCOMING, 'members-upcoming', 'restricted-granted-group'].sort(),
    );
  });

  it('no viewer ever sees a restricted event nobody was granted', async () => {
    for (const token of [undefined, tokenNoGrant, tokenDirect, tokenGroup]) {
      const res = await req('/events', { token });
      expect(await slugsOf(res)).not.toContain('restricted-not-granted');
    }
  });

  it('the authenticated slice is the anonymous slice plus more, never minus', async () => {
    // The product asked for "another list for logged-in users". It is the
    // difference between two responses, not a second endpoint.
    const anon = await slugsOf(await req('/events'));
    const member = await slugsOf(await req('/events', { token: tokenDirect }));

    for (const slug of anon) expect(member).toContain(slug);
    expect(member.length).toBeGreaterThan(anon.length);
  });

  it('hides drafts and archived events from every viewer at both scopes', async () => {
    for (const scope of ['upcoming', 'past']) {
      for (const token of [undefined, tokenNoGrant, tokenDirect, tokenGroup]) {
        const slugs = await slugsOf(await req(`/events?scope=${scope}`, { token }));
        expect(slugs).not.toContain('draft-public');
        expect(slugs).not.toContain('archived-public');
      }
    }
  });
});

describe('GET /v1/events/{slug} — audience matrix', () => {
  const MATRIX: Array<{ slug: string; visibleTo: Array<'anon' | 'none' | 'direct' | 'group'> }> = [
    { slug: 'public-upcoming', visibleTo: ['anon', 'none', 'direct', 'group'] },
    { slug: 'members-upcoming', visibleTo: ['none', 'direct', 'group'] },
    { slug: 'restricted-granted-user', visibleTo: ['direct'] },
    { slug: 'restricted-granted-group', visibleTo: ['group'] },
    { slug: 'restricted-not-granted', visibleTo: [] },
    { slug: 'draft-public', visibleTo: [] },
    { slug: 'archived-public', visibleTo: [] },
  ];

  const TOKENS = {
    anon: () => undefined,
    none: () => tokenNoGrant,
    direct: () => tokenDirect,
    group: () => tokenGroup,
  } as const;

  for (const { slug, visibleTo } of MATRIX) {
    for (const viewer of ['anon', 'none', 'direct', 'group'] as const) {
      const expected = visibleTo.includes(viewer) ? 200 : 404;
      it(`${slug} → ${expected} for ${viewer}`, async () => {
        const res = await req(`/events/${slug}`, { token: TOKENS[viewer]() });
        expect(res.status).toBe(expected);
      });
    }
  }
});

// ===========================================================================
// 404, never 403 — and byte-identical
// ===========================================================================

describe('the not-found response is not an enumeration oracle', () => {
  it('answers an out-of-audience slug with a body byte-identical to a nonexistent one', async () => {
    // Compared against each other, not against a literal: any field added to
    // one branch later breaks this even if both still "look like" a 404.
    const outOfAudience = await req('/events/restricted-not-granted', { token: tokenNoGrant });
    const nonexistent = await req('/events/there-is-no-such-event-anywhere', { token: tokenNoGrant });

    expect(outOfAudience.status).toBe(nonexistent.status);
    expect(outOfAudience.headers.get('content-type')).toBe(nonexistent.headers.get('content-type'));
    expect(await outOfAudience.text()).toBe(await nonexistent.text());
  });

  it('answers the same way for a draft as for a nonexistent slug', async () => {
    const draft = await req('/events/draft-public');
    const nonexistent = await req('/events/there-is-no-such-event-anywhere');

    expect(draft.status).toBe(nonexistent.status);
    expect(await draft.text()).toBe(await nonexistent.text());
  });

  it('never answers 403 on this surface', async () => {
    for (const slug of ['restricted-not-granted', 'draft-public', 'archived-public']) {
      for (const token of [undefined, tokenNoGrant, tokenDirect, tokenGroup]) {
        const res = await req(`/events/${slug}`, { token });
        expect(res.status).not.toBe(403);
      }
    }
  });

  it('gives the flyer route the same not-found body as the detail route', async () => {
    const flyer = await req('/events/restricted-not-granted/flyer');
    const detail = await req('/events/restricted-not-granted');

    expect(flyer.status).toBe(404);
    expect(await flyer.text()).toBe(await detail.text());
  });
});

// ===========================================================================
// Audience is never a request parameter
// ===========================================================================

describe('audience cannot be influenced by the request', () => {
  it('ignores query, header and cookie attempts to widen the slice', async () => {
    const baseline = await slugsOf(await req('/events'));

    const attempts = [
      '/events?audience=restricted',
      '/events?viewerUserId=' + MEMBER_DIRECT,
      '/events?userId=' + MEMBER_DIRECT,
      '/events?scope=upcoming&audience=members',
    ];

    for (const path of attempts) {
      const res = await req(path);
      expect(res.status).toBe(200);
      expect(await slugsOf(res)).toEqual(baseline);
    }
  });

  it('ignores an X-Forwarded-For style identity header', async () => {
    const request = new IncomingRequest(`http://example.com${v1('/events')}`, {
      headers: {
        'CF-Connecting-IP': '198.51.100.9',
        'X-User-Id': MEMBER_DIRECT,
        'X-Viewer-User-Id': MEMBER_DIRECT,
      },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(request, env as AppEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(await slugsOf(res)).toEqual(ANONYMOUS_UPCOMING);
  });
});

// ===========================================================================
// A bad token degrades; it never rejects
// ===========================================================================

describe('an invalid or expired token degrades to anonymous', () => {
  const BAD_TOKENS: Array<[string, () => string]> = [
    ['expired', () => expiredToken],
    ['malformed', () => 'not-a-jwt-at-all'],
    ['tampered', () => 'aaa.bbb.ccc'],
  ];

  for (const [name, token] of BAD_TOKENS) {
    it(`list: ${name} token → 200 with the anonymous slice, never 401`, async () => {
      const res = await req('/events', { token: token() });

      expect(res.status).toBe(200);
      expect(await slugsOf(res)).toEqual(ANONYMOUS_UPCOMING);
    });

    it(`detail: ${name} token → 200 on a public event and 404 on a members one`, async () => {
      const pub = await req('/events/public-upcoming', { token: token() });
      const members = await req('/events/members-upcoming', { token: token() });

      expect(pub.status).toBe(200);
      expect(members.status).toBe(404);
    });

    it(`flyer: ${name} token → 302 on a public event and 404 on a members one`, async () => {
      const pub = await req('/events/public-upcoming/flyer', { token: token() });
      const members = await req('/events/members-upcoming/flyer', { token: token() });

      expect(pub.status).toBe(302);
      expect(members.status).toBe(404);
    });
  }
});

// ===========================================================================
// Scope
// ===========================================================================

describe('?scope', () => {
  it('defaults to upcoming and excludes an event that has expired', async () => {
    const slugs = await slugsOf(await req('/events'));

    expect(slugs).not.toContain('past-public');
    expect(slugs).toContain('public-upcoming');
  });

  it('returns the expired event under scope=past and not the upcoming ones', async () => {
    const slugs = await slugsOf(await req('/events?scope=past'));

    expect(slugs).toEqual(['past-public']);
  });

  it('writes nothing when an event crosses the boundary', async () => {
    const before = await env.DB
      .prepare('SELECT status, starts_at, ends_at, updated_at FROM events WHERE slug = ?')
      .bind('past-public')
      .first();

    await req('/events?scope=upcoming');
    await req('/events?scope=past');

    const after = await env.DB
      .prepare('SELECT status, starts_at, ends_at, updated_at FROM events WHERE slug = ?')
      .bind('past-public')
      .first();

    expect(after).toEqual(before);
  });

  it('applies the audience rule under scope=past too', async () => {
    // Both scopes go through the same repository predicate; this catches a
    // future split that filters only one of them.
    for (const token of [undefined, tokenNoGrant, tokenDirect, tokenGroup]) {
      const slugs = await slugsOf(await req('/events?scope=past', { token }));
      expect(slugs).not.toContain('restricted-not-granted');
      expect(slugs).not.toContain('archived-public');
    }
  });

  it('rejects an unknown scope with 400 rather than silently defaulting', async () => {
    const res = await req('/events?scope=whenever');

    expect(res.status).toBe(400);
  });

  it('rejects a non-numeric limit with 400', async () => {
    expect((await req('/events?limit=abc')).status).toBe(400);
    expect((await req('/events?offset=-1')).status).toBe(400);
  });

  it('paginates while reporting the audience-scoped total', async () => {
    const res = await req('/events?limit=1&offset=0');
    const body = await res.json<{ data: unknown[]; total: number; limit: number; offset: number }>();

    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(ANONYMOUS_UPCOMING.length);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);
  });
});

// ===========================================================================
// The detail payload
// ===========================================================================

describe('GET /v1/events/{slug}', () => {
  it('serves sanitised markdown', async () => {
    const res = await req('/events/public-upcoming');
    const body = await res.json<{ content: string }>();

    expect(body.content).not.toContain('<script>');
    expect(body.content).toContain('Welcome');
  });

  it('resolves the contact from the event own number', async () => {
    const res = await req('/events/public-upcoming');
    const body = await res.json<{ contact: { number: string; message: string; label: string } }>();

    expect(body.contact.number).toBe(WHATSAPP);
    expect(body.contact.message).toContain('"Open mat"');
    // Passed through as stored; the web resolves the dictionary default.
    expect(body.contact.label).toBe('');
  });

  it('returns contact: null when the event stores no number — no tenant fallback', async () => {
    const res = await req('/events/public-no-contact');
    const body = await res.json<{ contact: unknown }>();

    expect(body.contact).toBeNull();
  });

  it('reflects the current title in the composed message after a rename', async () => {
    const repo = new D1EventRepository(env.DB);
    const event = await repo.findBySlug('public-upcoming');
    await repo.update(event!.id, { title: 'Open mat — renamed' });

    const res = await req('/events/public-upcoming');
    const body = await res.json<{ title: string; contact: { message: string } }>();

    expect(body.title).toBe('Open mat — renamed');
    expect(body.contact.message).toContain('"Open mat — renamed"');
    // The slug is the public identity and does not follow the title.
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// The flyer redirect
// ===========================================================================

describe('GET /v1/events/{slug}/flyer', () => {
  it('redirects to a presigned GET rather than proxying the bytes', async () => {
    const res = await req('/events/public-upcoming/flyer');

    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toContain('X-Amz-Signature=');
    expect(location).toContain('X-Amz-Expires=3600');
    // Nothing was streamed through the Worker.
    expect(await res.text()).toBe('');
  });

  it('caches the redirect for a public event and not for any other audience', async () => {
    const pub = await req('/events/public-upcoming/flyer');
    const members = await req('/events/members-upcoming/flyer', { token: tokenNoGrant });

    expect(pub.headers.get('cache-control')).toBe('public, max-age=60');
    expect(members.status).toBe(302);
    expect(members.headers.get('cache-control')).toBe('no-store');
  });

  it('mints a fresh signature on every hit', async () => {
    const first = await req('/events/public-upcoming/flyer');
    const second = await req('/events/public-upcoming/flyer');

    expect(first.headers.get('location')).toBeTruthy();
    expect(second.headers.get('location')).toBeTruthy();
    // Same object, and the audience check ran both times.
    expect(first.status).toBe(302);
    expect(second.status).toBe(302);
  });

  it('404s when the event has no flyer', async () => {
    const res = await req('/events/public-no-flyer/flyer');

    expect(res.status).toBe(404);
  });

  it('404s when the caller is out of audience, without signing anything', async () => {
    const res = await req('/events/members-upcoming/flyer');

    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
  });
});

// ===========================================================================
// Rate limiting
// ===========================================================================

describe('IP rate limiting', () => {
  it('lets 60 requests through from one IP and answers 429 on the 61st', async () => {
    const ip = '203.0.113.77';

    for (let i = 1; i <= 60; i++) {
      const res = await req('/events?limit=1', { ip });
      expect(res.status, `request ${i} should still be allowed`).toBe(200);
    }

    const blocked = await req('/events?limit=1', { ip });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'TooManyRequests' });
    expect(blocked.headers.get('retry-after')).toBeTruthy();

    // A second IP in the same window is untouched: the bucket is per caller.
    const other = await req('/events?limit=1', { ip: '203.0.113.78' });
    expect(other.status).toBe(200);
  });

  it('meters the detail and flyer routes from the same bucket', async () => {
    const ip = '203.0.113.79';

    for (let i = 1; i <= 60; i++) {
      await req('/events/public-upcoming', { ip });
    }

    expect((await req('/events/public-upcoming', { ip })).status).toBe(429);
    expect((await req('/events/public-upcoming/flyer', { ip })).status).toBe(429);
  });
});
