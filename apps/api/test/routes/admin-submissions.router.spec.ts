import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { JwtAuthAdapter } from '@api/adapters/auth';

/**
 * HTTP matrix of the staff submissions surface (RFC 0020 §7, §8, §10; M23
 * Task 05) against a real D1 and R2: `scope=all` and staff single reads on the
 * topic routes, the per-student list, force-unshare, clear moderation and the
 * admin-only removal with its tombstone. Business rules are unit-tested in
 * `test/controllers/submissions.controller.spec.ts`.
 *
 * Mount-order regression guard: `routes/admin/users.ts` puts an ADMIN-only
 * `requireRole` on `/users/*`; the submissions router is registered before it,
 * so a content creator must get `200` on `GET /v1/admin/users/{userId}/submissions`.
 *
 * Storage is isolated per test; only the `beforeAll` users, topics and
 * enrollments are shared.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const STUDENT_A = 'ssub-student-a';
const STUDENT_B = 'ssub-student-b';
const TUTOR = 'ssub-tutor';
const ADMIN = 'ssub-admin';
const CREATOR = 'ssub-creator';

const T_MAIN = 'ssub-t-main';
const T_TARGET = 'ssub-t-target';
const T_OUTSIDE = 'ssub-t-outside'; // nobody enrolled — staff bypass the access set

let tokenA: string;
let tokenB: string;
let tutorToken: string;
let adminToken: string;
let creatorToken: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  const user = (id: string) =>
    env.DB.prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(id, `Name ${id}`, `${id}@staff-submissions.test`, 'hash');
  const topic = (id: string) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO topic_nodes (id, title, status, archived, visibility) VALUES (?, ?, 'published', 0, 'restricted')`,
    ).bind(id, `Title ${id}`);
  const enroll = (userId: string, topicId: string) =>
    env.DB.prepare(
      'INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)',
    ).bind(`enr-${userId}-${topicId}`, userId, topicId, ADMIN);

  await env.DB.batch([
    ...[STUDENT_A, STUDENT_B, TUTOR, ADMIN, CREATOR].map(user),
    topic(T_MAIN),
    topic(T_TARGET),
    topic(T_OUTSIDE),
    ...[STUDENT_A, STUDENT_B, TUTOR].flatMap((u) => [T_MAIN, T_TARGET].map((t) => enroll(u, t))),
  ]);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [tokenA, tokenB, tutorToken, adminToken, creatorToken] = await Promise.all([
    adapter.signAccessToken({ sub: STUDENT_A, email: 'a@staff-submissions.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: STUDENT_B, email: 'b@staff-submissions.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: TUTOR, email: 't@staff-submissions.test', roles: ['tutor'] }),
    adapter.signAccessToken({ sub: ADMIN, email: 'admin@staff-submissions.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: CREATOR, email: 'creator@staff-submissions.test', roles: ['content_creator'] }),
  ]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Json = Record<string, any>;

interface ReqOptions {
  body?: unknown;
  token?: string;
  envOverrides?: Record<string, unknown>;
}

async function req(method: string, path: string, options: ReqOptions = {}) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  const request = new IncomingRequest(`http://example.com${v1(path)}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const ctx = createExecutionContext();
  const workerEnv = (options.envOverrides ? { ...env, ...options.envOverrides } : env) as AppEnv;
  const res = await worker.fetch(request, workerEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

let seq = 0;

interface Row {
  topic?: string;
  author?: string;
  status?: 'pending' | 'ready' | 'removed';
  visibility?: 'private' | 'shared';
  ageSeconds?: number;
}

/** Inserts one submission row (and, unless removed, its object in R2). */
async function insert(row: Row = {}): Promise<{ id: string; key: string | null }> {
  seq += 1;
  const id = `ssub-${seq}-${crypto.randomUUID()}`;
  const author = row.author ?? STUDENT_A;
  const status = row.status ?? 'ready';
  const visibility = row.visibility ?? 'private';
  const key = status === 'removed' ? null : `submissions/${author}/${id}-kata.mp4`;
  const age = `-${row.ageSeconds ?? 0} seconds`;
  await env.DB.prepare(
    `INSERT INTO topic_submissions
       (id, topic_node_id, author_id, title, description, storage_key, original_name, content_type, size_bytes,
        status, visibility, shared_at, removed_at, removed_by, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'Some notes', ?5, 'kata.mp4', 'video/mp4', 1000, ?6, ?7,
             CASE WHEN ?7 = 'shared' THEN datetime('now', ?8) END,
             CASE WHEN ?6 = 'removed' THEN datetime('now') END, CASE WHEN ?6 = 'removed' THEN ?9 END,
             datetime('now', ?8), datetime('now', ?8))`,
  )
    .bind(id, row.topic ?? T_MAIN, author, `Title ${seq}`, key, status, visibility, age, ADMIN)
    .run();
  if (key) await env.R2.put(key, new Uint8Array(1000), { httpMetadata: { contentType: 'video/mp4' } });
  return { id, key };
}

async function rowOf(id: string) {
  return env.DB.prepare('SELECT * FROM topic_submissions WHERE id = ?').bind(id).first<Json>();
}

const list = (topicId: string, token: string, query = '') =>
  req('GET', `/topics/${topicId}/submissions${query}`, { token });
const readOne = (topicId: string, sid: string, token: string) =>
  req('GET', `/topics/${topicId}/submissions/${sid}`, { token });
const share = (topicId: string, sid: string, token: string) =>
  req('PATCH', `/topics/${topicId}/submissions/${sid}`, { token, body: { visibility: 'shared' } });
const unshare = (id: string, token: string) => req('POST', `/admin/submissions/${id}/unshare`, { token });
const clearModeration = (id: string, token: string) => req('DELETE', `/admin/submissions/${id}/moderation`, { token });
const remove = (id: string, token: string, envOverrides?: Record<string, unknown>) =>
  req('DELETE', `/admin/submissions/${id}`, { token, envOverrides });
const userList = (userId: string, token: string, query = '') =>
  req('GET', `/admin/users/${userId}/submissions${query}`, { token });

const ids = (body: Json) => (body.data as Json[]).map((s) => s.id);

const STAFF: Array<[string, () => string, string]> = [
  ['admin', () => adminToken, ADMIN],
  ['content_creator', () => creatorToken, CREATOR],
];

// ---------------------------------------------------------------------------

describe('auth and roles on /v1/admin', () => {
  const routes = (id: string): Array<[string, string]> => [
    ['GET', `/admin/users/${STUDENT_A}/submissions`],
    ['POST', `/admin/submissions/${id}/unshare`],
    ['DELETE', `/admin/submissions/${id}/moderation`],
    ['DELETE', `/admin/submissions/${id}`],
  ];

  it('answers 401 without a token on every route', async () => {
    for (const [method, path] of routes('ssub-any')) {
      expect((await req(method, path)).status, `${method} ${path}`).toBe(401);
    }
  });

  it.each([
    ['student', () => tokenB],
    ['tutor', () => tutorToken],
    ['the author', () => tokenA],
  ])('answers 403 to %s on every route, changing nothing', async (_label, token) => {
    const { id, key } = await insert({ visibility: 'shared' });
    const before = await rowOf(id);
    for (const [method, path] of routes(id)) {
      const res = await req(method, path, { token: token() });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(await rowOf(id)).toEqual(before);
    expect(await env.R2.head(key!)).not.toBeNull();
  });
});

describe('GET /topics/{id}/submissions?scope=all', () => {
  it.each(STAFF)(
    '%s gets every ready and removed submission with author and provenance, on a topic outside any access set',
    async (_label, token) => {
      const ready = await insert({ topic: T_OUTSIDE, ageSeconds: 30 });
      const shared = await insert({ topic: T_OUTSIDE, author: STUDENT_B, visibility: 'shared', ageSeconds: 20 });
      const removed = await insert({ topic: T_OUTSIDE, status: 'removed', ageSeconds: 10 });
      const pending = await insert({ topic: T_OUTSIDE, status: 'pending', ageSeconds: 5 });

      const res = await list(T_OUTSIDE, token(), '?scope=all');
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      const body = (await res.json()) as Json;
      expect(ids(body)).toEqual([removed.id, shared.id, ready.id]);
      expect(ids(body)).not.toContain(pending.id);

      const byId = new Map((body.data as Json[]).map((s) => [s.id, s]));
      expect(byId.get(ready.id)).toMatchObject({
        authorId: STUDENT_A,
        authorName: `Name ${STUDENT_A}`,
        visibility: 'private',
        isMine: false,
        moderatedAt: null,
      });
      expect(byId.get(ready.id)!.url).toMatch(/^https?:\/\//);
      expect(byId.get(shared.id)).toMatchObject({ authorId: STUDENT_B, visibility: 'shared' });
      expect(byId.get(removed.id)).toMatchObject({
        status: 'removed',
        url: null,
        removedBy: ADMIN,
        removedByName: `Name ${ADMIN}`,
      });
      for (const s of body.data as Json[]) expect(s).not.toHaveProperty('storageKey');
    },
  );

  it.each(STAFF)("%s reads another student's private and removed submissions, but not their pending one", async (_l, token) => {
    const priv = await insert({ topic: T_OUTSIDE });
    const removed = await insert({ topic: T_OUTSIDE, status: 'removed' });
    const pending = await insert({ topic: T_OUTSIDE, status: 'pending' });

    const res = await readOne(T_OUTSIDE, priv.id, token());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toMatchObject({ id: priv.id, visibility: 'private', moderatedAt: null });
    expect((await readOne(T_OUTSIDE, removed.id, token())).status).toBe(200);
    expect((await readOne(T_OUTSIDE, pending.id, token())).status).toBe(404);
  });
});

describe('GET /admin/users/{userId}/submissions', () => {
  it.each(STAFF)("%s gets the student's ready and removed submissions across topics, never pending", async (_l, token) => {
    const a = await insert({ topic: T_MAIN, ageSeconds: 30 });
    const b = await insert({ topic: T_TARGET, status: 'removed', ageSeconds: 20 });
    await insert({ topic: T_MAIN, status: 'pending', ageSeconds: 10 });
    await insert({ author: STUDENT_B });

    const res = await userList(STUDENT_A, token());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as Json;
    expect(ids(body)).toEqual([b.id, a.id]);
    expect(body.data[0]).toMatchObject({ topicTitle: `Title ${T_TARGET}`, status: 'removed', removedBy: ADMIN, url: null });
    expect(body.data[1]).toMatchObject({ topicTitle: `Title ${T_MAIN}`, status: 'ready' });
    expect(body.nextCursor).toBeNull();
  });

  it('pages by 20 with an opaque cursor, and rejects a malformed one', async () => {
    const all: string[] = [];
    for (let i = 0; i < 21; i++) all.unshift((await insert({ ageSeconds: 100 - i })).id);
    const first = (await (await userList(STUDENT_A, creatorToken)).json()) as Json;
    expect(ids(first)).toEqual(all.slice(0, 20));
    const second = (await (await userList(STUDENT_A, creatorToken, `?cursor=${first.nextCursor}`)).json()) as Json;
    expect(ids(second)).toEqual(all.slice(20));

    const bad = await userList(STUDENT_A, creatorToken, '?cursor=%%%');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'InvalidCursor' });
  });

  it('yields an empty page for an unknown user', async () => {
    const res = await userList('ssub-nobody', adminToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], nextCursor: null });
  });
});

describe('force-unshare and clear moderation', () => {
  it.each(STAFF)(
    '%s force-unshares: classmates lose it, the author cannot re-share until moderation is cleared',
    async (_l, token, staffId) => {
      const { id } = await insert({ visibility: 'shared' });
      expect(ids((await (await list(T_MAIN, tokenB, '?scope=class')).json()) as Json)).toContain(id);

      const res = await unshare(id, token());
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id, visibility: 'private', moderated: true, moderatedBy: staffId });

      const row = (await rowOf(id))!;
      expect(row).toMatchObject({ visibility: 'private', moderated_by: staffId, title: expect.any(String), description: 'Some notes' });
      expect(row.moderated_at).not.toBeNull();

      expect(ids((await (await list(T_MAIN, tokenB, '?scope=class')).json()) as Json)).not.toContain(id);
      expect((await readOne(T_MAIN, id, tokenB)).status).toBe(404);

      const blocked = await share(T_MAIN, id, tokenA);
      expect(blocked.status).toBe(409);
      expect(((await blocked.json()) as Json).error).toBe('SUBMISSION_MODERATED');

      expect((await clearModeration(id, token())).status).toBe(204);
      expect((await rowOf(id))!.visibility).toBe('private'); // clearing never re-shares
      expect((await share(T_MAIN, id, tokenA)).status).toBe(200);
      expect(ids((await (await list(T_MAIN, tokenB, '?scope=class')).json()) as Json)).toContain(id);
    },
  );

  it('moderation survives a move', async () => {
    const { id } = await insert({ visibility: 'shared' });
    expect((await unshare(id, creatorToken)).status).toBe(200);

    const moved = await req('POST', '/me/submissions/move', { token: tokenA, body: { ids: [id], targetTopicId: T_TARGET } });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as Json).moved[0]).toMatchObject({ id, moderated: true });

    const blocked = await share(T_TARGET, id, tokenA);
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as Json).error).toBe('SUBMISSION_MODERATED');
  });

  it('answers 404 on a missing or pending submission', async () => {
    const pending = await insert({ status: 'pending' });
    for (const id of ['ssub-missing', pending.id]) {
      expect((await unshare(id, adminToken)).status).toBe(404);
      expect((await clearModeration(id, creatorToken)).status).toBe(404);
    }
    expect((await rowOf(pending.id))!.moderated_at).toBeNull();
  });
});

describe('DELETE /admin/submissions/{id} (remove)', () => {
  it('a content creator gets 403 and nothing changes', async () => {
    const { id, key } = await insert({ visibility: 'shared' });
    const before = await rowOf(id);
    const res = await remove(id, creatorToken);
    expect(res.status).toBe(403);
    expect(await rowOf(id)).toEqual(before);
    expect(await env.R2.head(key!)).not.toBeNull();
  });

  it('an admin removes: object gone, tombstone for the author and staff only, outside the quota', async () => {
    const { id, key } = await insert({ visibility: 'shared' });
    const usageBefore = (await (await req('GET', `/topics/${T_MAIN}/submissions/summary`, { token: tokenA })).json()) as Json;
    expect(usageBefore.usage).toMatchObject({ topicCount: 1, bytes: 1000 });

    const res = await remove(id, adminToken);
    expect(res.status).toBe(204);
    expect(await env.R2.head(key!)).toBeNull();

    const row = (await rowOf(id))!;
    expect(row).toMatchObject({
      status: 'removed',
      storage_key: null,
      description: '',
      visibility: 'private',
      removed_by: ADMIN,
    });
    expect(row.removed_at).not.toBeNull();

    // The author sees a tombstone with title and date.
    const mine = (await (await list(T_MAIN, tokenA, '?scope=mine')).json()) as Json;
    expect(mine.data).toEqual([
      expect.objectContaining({ id, status: 'removed', title: row.title, removedAt: row.removed_at, createdAt: row.created_at, url: null }),
    ]);
    const myList = (await (await req('GET', '/me/submissions', { token: tokenA })).json()) as Json;
    expect(myList.data).toEqual([expect.objectContaining({ id, status: 'removed' })]);

    // Classmates do not.
    expect(ids((await (await list(T_MAIN, tokenB, '?scope=class')).json()) as Json)).not.toContain(id);
    expect((await readOne(T_MAIN, id, tokenB)).status).toBe(404);

    // Staff still do, with who removed it.
    const all = (await (await list(T_MAIN, creatorToken, '?scope=all')).json()) as Json;
    expect(all.data).toEqual([expect.objectContaining({ id, status: 'removed', removedBy: ADMIN })]);

    // The quota is freed.
    const usageAfter = (await (await req('GET', `/topics/${T_MAIN}/submissions/summary`, { token: tokenA })).json()) as Json;
    expect(usageAfter.usage).toEqual({ topicCount: 0, bytes: 0 });

    // A second removal is a no-op; the author can still dismiss the tombstone.
    expect((await remove(id, adminToken)).status).toBe(204);
    expect((await req('DELETE', `/topics/${T_MAIN}/submissions/${id}`, { token: tokenA })).status).toBe(204);
    expect(await rowOf(id)).toBeNull();
  });

  it('answers 502 and leaves the row unchanged when R2 fails', async () => {
    const { id, key } = await insert({ visibility: 'shared' });
    const before = await rowOf(id);
    const real = env.R2;
    const failingR2 = {
      head: (k: string) => real.head(k),
      get: (k: string, o?: R2GetOptions) => real.get(k, o),
      put: real.put.bind(real),
      list: real.list.bind(real),
      delete: () => Promise.reject(new Error('R2 is down')),
    };
    const res = await remove(id, adminToken, { R2: failingR2 });
    expect(res.status).toBe(502);
    expect(((await res.json()) as Json).error).toBe('StorageUnavailable');
    expect(await rowOf(id)).toEqual(before);
    expect(await env.R2.head(key!)).not.toBeNull();
  });

  it('answers 404 on a missing or pending submission', async () => {
    const pending = await insert({ status: 'pending' });
    expect((await remove('ssub-missing', adminToken)).status).toBe(404);
    expect((await remove(pending.id, adminToken)).status).toBe(404);
    expect((await rowOf(pending.id))!.status).toBe('pending');
  });
});
