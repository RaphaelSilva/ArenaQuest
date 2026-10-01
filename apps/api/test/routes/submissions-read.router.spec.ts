import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { encodeCursor } from '@api/routes/_shared/cursor';

/**
 * HTTP matrix of the student read and move surface (RFC 0020 §6, §7, §10;
 * M23 Task 04) against a real D1. Rows are inserted directly — the upload
 * lifecycle is covered by `submissions.router.spec.ts`; here only the audience
 * of each read, the sharing switch and the move matter.
 *
 * Storage is isolated per test (writes inside an `it` roll back); only the
 * `beforeAll` users, topics and enrollments are shared.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const STUDENT_A = 'rd-student-a';
const STUDENT_B = 'rd-student-b';
const TUTOR = 'rd-tutor';
const ADMIN = 'rd-admin';
const CREATOR = 'rd-creator';

const T_MAIN = 'rd-t-main';
const T_TARGET = 'rd-t-target';
const T_LOST = 'rd-t-lost'; // A uploaded there, then lost access
const T_DRAFT = 'rd-t-draft';
const T_OUTSIDE = 'rd-t-outside'; // nobody enrolled

let tokenA: string;
let tokenB: string;
let tutorToken: string;
let adminToken: string;
let creatorToken: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  const user = (id: string) =>
    env.DB.prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(id, `Name ${id}`, `${id}@submissions-read.test`, 'hash');
  const topic = (id: string, status = 'published') =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO topic_nodes (id, title, status, archived, visibility) VALUES (?, ?, ?, 0, 'restricted')`,
    ).bind(id, `Title ${id}`, status);
  const enroll = (userId: string, topicId: string) =>
    env.DB.prepare(
      'INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)',
    ).bind(`enr-${userId}-${topicId}`, userId, topicId, ADMIN);

  await env.DB.batch([
    ...[STUDENT_A, STUDENT_B, TUTOR, ADMIN, CREATOR].map(user),
    topic(T_MAIN),
    topic(T_TARGET),
    topic(T_LOST),
    topic(T_DRAFT, 'draft'),
    topic(T_OUTSIDE),
    ...[STUDENT_A, STUDENT_B, TUTOR].flatMap((u) => [T_MAIN, T_TARGET, T_DRAFT].map((t) => enroll(u, t))),
  ]);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [tokenA, tokenB, tutorToken, adminToken, creatorToken] = await Promise.all([
    adapter.signAccessToken({ sub: STUDENT_A, email: 'a@submissions-read.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: STUDENT_B, email: 'b@submissions-read.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: TUTOR, email: 't@submissions-read.test', roles: ['tutor'] }),
    adapter.signAccessToken({ sub: ADMIN, email: 'admin@submissions-read.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: CREATOR, email: 'creator@submissions-read.test', roles: ['content_creator'] }),
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

const SHARING_OFF = { SUBMISSIONS_SHARING_ENABLED: 'false' };

let seq = 0;

interface Row {
  id?: string;
  topic?: string;
  author?: string;
  status?: 'pending' | 'ready' | 'removed';
  visibility?: 'private' | 'shared';
  moderated?: boolean;
  /** Seconds before now, so listings have a deterministic order. */
  ageSeconds?: number;
}

/** Inserts one submission row and returns its id and storage key. */
async function insert(row: Row = {}): Promise<{ id: string; key: string | null }> {
  seq += 1;
  const id = row.id ?? `rd-sub-${seq}-${crypto.randomUUID()}`;
  const author = row.author ?? STUDENT_A;
  const status = row.status ?? 'ready';
  const visibility = row.visibility ?? 'private';
  const key = status === 'removed' ? null : `submissions/${author}/${id}-kata.mp4`;
  const age = `-${row.ageSeconds ?? 0} seconds`;
  await env.DB.prepare(
    `INSERT INTO topic_submissions
       (id, topic_node_id, author_id, title, storage_key, original_name, content_type, size_bytes,
        status, visibility, shared_at, moderated_at, moderated_by, removed_at, removed_by, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'kata.mp4', 'video/mp4', 1000, ?6, ?7,
             CASE WHEN ?7 = 'shared' THEN datetime('now', ?10) END,
             CASE WHEN ?8 = 1 THEN datetime('now') END, CASE WHEN ?8 = 1 THEN ?9 END,
             CASE WHEN ?6 = 'removed' THEN datetime('now') END, CASE WHEN ?6 = 'removed' THEN ?9 END,
             datetime('now', ?10), datetime('now', ?10))`,
  )
    .bind(id, row.topic ?? T_MAIN, author, `Title ${seq}`, key, status, visibility, row.moderated ? 1 : 0, ADMIN, age)
    .run();
  return { id, key };
}

async function rowOf(id: string) {
  return env.DB.prepare('SELECT * FROM topic_submissions WHERE id = ?').bind(id).first<Json>();
}

const list = (topicId: string, token: string, query = '', envOverrides?: Record<string, unknown>) =>
  req('GET', `/topics/${topicId}/submissions${query}`, { token, envOverrides });

const readOne = (topicId: string, sid: string, token: string, envOverrides?: Record<string, unknown>) =>
  req('GET', `/topics/${topicId}/submissions/${sid}`, { token, envOverrides });

const move = (token: string, body: unknown, envOverrides?: Record<string, unknown>) =>
  req('POST', '/me/submissions/move', { token, body, envOverrides });

const ids = (body: Json) => (body.data as Json[]).map((s) => s.id);

// ---------------------------------------------------------------------------

describe('auth', () => {
  it.each([
    ['GET', `/topics/${T_MAIN}/submissions`],
    ['GET', `/topics/${T_MAIN}/submissions/x`],
    ['GET', '/me/submissions'],
    ['POST', '/me/submissions/move'],
  ])('%s %s answers 401 without a token', async (method, path) => {
    const res = await req(method, path, method === 'POST' ? { body: {} } : {});
    expect(res.status).toBe(401);
  });
});

describe('GET /topics/{id}/submissions?scope=mine', () => {
  it("returns the caller's pending, ready and removed submissions, URLs on ready ones only", async () => {
    const pending = await insert({ status: 'pending', ageSeconds: 30 });
    const ready = await insert({ status: 'ready', ageSeconds: 20 });
    const removed = await insert({ status: 'removed', ageSeconds: 10 });
    await insert({ author: STUDENT_B, visibility: 'shared' }); // not mine

    const res = await list(T_MAIN, tokenA, '?scope=mine');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as Json;
    expect(ids(body)).toEqual([removed.id, ready.id, pending.id]);
    expect(body.nextCursor).toBeNull();

    const byId = new Map((body.data as Json[]).map((s) => [s.id, s]));
    expect(byId.get(ready.id)).toMatchObject({ status: 'ready', isMine: true });
    expect(byId.get(ready.id)!.url).toMatch(/^https?:\/\//);
    expect(byId.get(pending.id)).toMatchObject({ status: 'pending', url: null });
    expect(byId.get(removed.id)).toMatchObject({ status: 'removed', url: null });
    for (const s of body.data as Json[]) expect(s).not.toHaveProperty('storageKey');
  });

  it('defaults to scope=mine', async () => {
    const own = await insert();
    await insert({ author: STUDENT_B, visibility: 'shared' });
    expect(ids((await (await list(T_MAIN, tokenA)).json()) as Json)).toEqual([own.id]);
  });

  it('pages by 20, newest first, with an opaque cursor', async () => {
    const all: string[] = [];
    for (let i = 0; i < 21; i++) all.unshift((await insert({ ageSeconds: 100 - i })).id);

    const first = (await (await list(T_MAIN, tokenA, '?scope=mine')).json()) as Json;
    expect(ids(first)).toEqual(all.slice(0, 20));
    expect(typeof first.nextCursor).toBe('string');

    const second = (await (await list(T_MAIN, tokenA, `?scope=mine&cursor=${first.nextCursor}`)).json()) as Json;
    expect(ids(second)).toEqual(all.slice(20));
    expect(second.nextCursor).toBeNull();
  });

  it('answers 400 InvalidCursor on a malformed cursor', async () => {
    const res = await list(T_MAIN, tokenA, '?scope=mine&cursor=%%%');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'InvalidCursor' });
  });
});

describe('GET /topics/{id}/submissions?scope=class', () => {
  it('returns only shared ready submissions, with author names and isMine on the caller\'s own', async () => {
    const bShared = await insert({ author: STUDENT_B, visibility: 'shared', ageSeconds: 20 });
    const aShared = await insert({ author: STUDENT_A, visibility: 'shared', ageSeconds: 10 });
    await insert({ author: STUDENT_B }); // private
    await insert({ author: STUDENT_B, status: 'pending', visibility: 'shared' });
    await insert({ author: STUDENT_B, status: 'removed' });

    const res = await list(T_MAIN, tokenA, '?scope=class');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as Json;
    expect(ids(body)).toEqual([aShared.id, bShared.id]);
    expect(body.data[0]).toMatchObject({ isMine: true, authorName: `Name ${STUDENT_A}` });
    expect(body.data[1]).toMatchObject({ isMine: false, authorName: `Name ${STUDENT_B}`, visibility: 'shared' });
    expect(body.data[1].url).toMatch(/^https?:\/\//);
  });

  it.each([
    ['student', () => tokenB],
    ['tutor', () => tutorToken],
  ])(
    "never contains another student's private, pending or removed rows for a %s, even with a cursor from the author's scope=mine",
    async (_label, token) => {
      const hidden: string[] = [];
      // 21 private/pending/removed rows by A, so A's `mine` has a second page.
      for (let i = 0; i < 21; i++) {
        const status = (['ready', 'pending', 'removed'] as const)[i % 3];
        hidden.push((await insert({ status, ageSeconds: 200 - i })).id);
      }
      // A pending row asking for `shared` is still not visible.
      hidden.push((await insert({ status: 'pending', visibility: 'shared', ageSeconds: 300 })).id);
      const visible = await insert({ visibility: 'shared', ageSeconds: 500 });

      const mine = (await (await list(T_MAIN, tokenA, '?scope=mine')).json()) as Json;
      expect(mine.nextCursor).toEqual(expect.any(String));

      const crafted = [
        mine.nextCursor as string,
        encodeCursor({ sortKey: '9999-12-31 23:59:59', id: 'zzzzzzzz' }),
      ];
      for (const cursor of ['', ...crafted]) {
        const query = cursor ? `?scope=class&cursor=${cursor}` : '?scope=class';
        const res = await list(T_MAIN, token(), query);
        expect(res.status).toBe(200);
        const got = ids((await res.json()) as Json);
        for (const id of hidden) expect(got).not.toContain(id);
        expect(got).toEqual([visible.id]);
      }

      // `scope=mine` for the other student is their own rows only — none here.
      expect(ids((await (await list(T_MAIN, token(), `?scope=mine&cursor=${crafted[0]}`)).json()) as Json)).toEqual([]);
    },
  );

  it('is empty while sharing is disabled, and lists the same rows unchanged once it is back on', async () => {
    const shared = await insert({ author: STUDENT_B, visibility: 'shared' });
    const before = (await rowOf(shared.id))!;

    const off = await list(T_MAIN, tokenA, '?scope=class', SHARING_OFF);
    expect(off.status).toBe(200);
    expect((await off.json()) as Json).toEqual({ data: [], nextCursor: null });
    // The author still sees their own row through `mine`.
    expect(ids((await (await list(T_MAIN, tokenB, '?scope=mine', SHARING_OFF)).json()) as Json)).toEqual([shared.id]);

    // The switch is a read-time filter: the row was not rewritten.
    expect(await rowOf(shared.id)).toEqual(before);

    const on = (await (await list(T_MAIN, tokenA, '?scope=class')).json()) as Json;
    expect(ids(on)).toEqual([shared.id]);
    expect(on.data[0]).toMatchObject({ visibility: 'shared', sharedAt: before.shared_at });
  });
});

describe('GET /topics/{id}/submissions?scope=all', () => {
  it.each([
    ['student', () => tokenA],
    ['tutor', () => tutorToken],
  ])('a %s gets 403', async (_label, token) => {
    const res = await list(T_MAIN, token(), '?scope=all');
    expect(res.status).toBe(403);
    expect(((await res.json()) as Json).error).toBe('Forbidden');
  });

  it('rejects an unknown scope with 400', async () => {
    expect((await list(T_MAIN, tokenA, '?scope=everything')).status).toBe(400);
  });
});

describe('listing on an unreadable topic', () => {
  it.each([T_DRAFT, T_OUTSIDE, 'rd-t-missing'])('is 404 on %s', async (topicId) => {
    expect((await list(topicId, tokenA, '?scope=mine')).status).toBe(404);
    expect((await list(topicId, tokenA, '?scope=class')).status).toBe(404);
  });
});

describe('GET /topics/{id}/submissions/{sid}', () => {
  it('the author reads their own in every status', async () => {
    for (const status of ['pending', 'ready', 'removed'] as const) {
      const { id } = await insert({ status });
      const res = await readOne(T_MAIN, id, tokenA);
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      const body = (await res.json()) as Json;
      expect(body).toMatchObject({ id, status, isMine: true });
      if (status === 'ready') expect(body.url).toMatch(/^https?:\/\//);
      else expect(body.url).toBeNull();
    }
  });

  it.each([
    ['student', () => tokenB],
    ['tutor', () => tutorToken],
  ])("another %s gets 404 on a private, pending or removed submission, 200 on a shared one", async (_label, token) => {
    const priv = await insert();
    const pending = await insert({ status: 'pending', visibility: 'shared' });
    const removed = await insert({ status: 'removed' });
    const shared = await insert({ visibility: 'shared' });

    for (const { id } of [priv, pending, removed]) {
      const res = await readOne(T_MAIN, id, token());
      expect(res.status).toBe(404);
      expect(((await res.json()) as Json).error).toBe('NotFound');
    }
    const ok = await readOne(T_MAIN, shared.id, token());
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Json;
    expect(body).toMatchObject({ id: shared.id, isMine: false, authorName: `Name ${STUDENT_A}` });
    expect(body.url).toMatch(/^https?:\/\//);
  });

  it('a shared submission is 404 to other students while sharing is off, and back once it is on', async () => {
    const shared = await insert({ visibility: 'shared' });
    expect((await readOne(T_MAIN, shared.id, tokenB, SHARING_OFF)).status).toBe(404);
    expect((await readOne(T_MAIN, shared.id, tokenA, SHARING_OFF)).status).toBe(200);
    expect((await readOne(T_MAIN, shared.id, tokenB)).status).toBe(200);
  });

  it('is 404 through the wrong topic id, on a missing id and on an unreadable topic', async () => {
    const shared = await insert({ visibility: 'shared' });
    expect((await readOne(T_TARGET, shared.id, tokenA)).status).toBe(404);
    expect((await readOne(T_MAIN, 'rd-missing', tokenA)).status).toBe(404);

    const draft = await insert({ topic: T_DRAFT });
    expect((await readOne(T_DRAFT, draft.id, tokenA)).status).toBe(404);
  });

  it('still routes the summary, not a submission called "summary"', async () => {
    const res = await req('GET', `/topics/${T_MAIN}/submissions/summary`, { token: tokenA });
    expect(res.status).toBe(200);
    expect((await res.json()) as Json).toHaveProperty('limits');
  });
});

describe('GET /me/submissions', () => {
  async function loseAccessTo(topicId: string, upload: () => Promise<{ id: string }>) {
    const enrollment = `enr-lost-${crypto.randomUUID()}`;
    await env.DB.prepare(
      'INSERT INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)',
    ).bind(enrollment, STUDENT_A, topicId, ADMIN).run();
    const result = await upload();
    await env.DB.prepare('DELETE FROM enrollments_user WHERE id = ?').bind(enrollment).run();
    return result;
  }

  it("lists all of the caller's submissions across topics with topic title and topicAccessible", async () => {
    const onMain = await insert({ status: 'pending', ageSeconds: 30 });
    const onTarget = await insert({ topic: T_TARGET, ageSeconds: 20 });
    const onLost = await loseAccessTo(T_LOST, () => insert({ topic: T_LOST, ageSeconds: 10 }));
    const removed = await insert({ status: 'removed', ageSeconds: 40 });
    await insert({ author: STUDENT_B, visibility: 'shared' });

    const res = await req('GET', '/me/submissions', { token: tokenA });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as Json;
    expect(ids(body)).toEqual([onLost.id, onTarget.id, onMain.id, removed.id]);
    expect(body.nextCursor).toBeNull();

    const byId = new Map((body.data as Json[]).map((s) => [s.id, s]));
    expect(byId.get(onLost.id)).toMatchObject({ topicTitle: `Title ${T_LOST}`, topicAccessible: false });
    expect(byId.get(onLost.id)!.url).toMatch(/^https?:\/\//);
    expect(byId.get(onTarget.id)).toMatchObject({ topicTitle: `Title ${T_TARGET}`, topicAccessible: true });
    expect(byId.get(onMain.id)).toMatchObject({ status: 'pending', url: null, topicAccessible: true });
    expect(byId.get(removed.id)).toMatchObject({ status: 'removed', url: null });
  });

  it('answers 400 on a malformed cursor', async () => {
    expect((await req('GET', '/me/submissions?cursor=%%%', { token: tokenA })).status).toBe(400);
  });

  it('on an inaccessible topic, PATCH is refused while DELETE and move succeed', async () => {
    const [toEdit, toMove, toDelete] = [
      await loseAccessTo(T_LOST, () => insert({ topic: T_LOST })),
      await loseAccessTo(T_LOST, () => insert({ topic: T_LOST, visibility: 'shared' })),
      await loseAccessTo(T_LOST, () => insert({ topic: T_LOST })),
    ];

    for (const body of [{ title: 'Renamed' }, { visibility: 'shared' }]) {
      const patch = await req('PATCH', `/topics/${T_LOST}/submissions/${toEdit.id}`, { token: tokenA, body });
      expect(patch.status).toBe(404);
    }
    expect((await rowOf(toEdit.id))!.title).not.toBe('Renamed');

    expect((await req('DELETE', `/topics/${T_LOST}/submissions/${toDelete.id}`, { token: tokenA })).status).toBe(204);
    expect(await rowOf(toDelete.id)).toBeNull();

    const moved = await move(tokenA, { ids: [toMove.id], targetTopicId: T_TARGET });
    expect(moved.status).toBe(200);
    const result = (await moved.json()) as Json;
    expect(result.refused).toEqual([]);
    expect(result.moved).toHaveLength(1);
    expect(result.moved[0]).toMatchObject({ id: toMove.id, topicNodeId: T_TARGET, visibility: 'private' });
  });
});

describe('POST /me/submissions/move', () => {
  it('moves 2 of 3 into a topic with 2 free slots; moved ones are private, keep moderation and their key', async () => {
    const overrides = { SUBMISSIONS_PER_TOPIC_MAX: '3' };
    await insert({ topic: T_TARGET }); // 1 of 3 used on the target
    const first = await insert({ visibility: 'shared' });
    const second = await insert({ moderated: true });
    const third = await insert();

    const res = await move(tokenA, { ids: [first.id, second.id, third.id], targetTopicId: T_TARGET }, overrides);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as Json;
    expect((body.moved as Json[]).map((s) => s.id)).toEqual([first.id, second.id]);
    expect(body.refused).toEqual([{ id: third.id, reason: 'quota' }]);
    expect(body.moved[0]).toMatchObject({ topicNodeId: T_TARGET, visibility: 'private', sharedAt: null });
    expect(body.moved[1]).toMatchObject({ topicNodeId: T_TARGET, moderated: true });
    for (const s of body.moved as Json[]) expect(s).not.toHaveProperty('storageKey');

    const [r1, r2, r3] = await Promise.all([rowOf(first.id), rowOf(second.id), rowOf(third.id)]);
    expect(r1).toMatchObject({ topic_node_id: T_TARGET, visibility: 'private', storage_key: first.key });
    expect(r2).toMatchObject({ topic_node_id: T_TARGET, storage_key: second.key, moderated_by: ADMIN });
    expect(r2!.moderated_at).not.toBeNull();
    expect(r3).toMatchObject({ topic_node_id: T_MAIN, storage_key: third.key });
  });

  it('refuses same topic, pending, removed and foreign ids per item', async () => {
    const same = await insert({ topic: T_TARGET });
    const pending = await insert({ status: 'pending' });
    const removed = await insert({ status: 'removed' });
    const foreign = await insert({ author: STUDENT_B, visibility: 'shared' });
    const ok = await insert();

    const res = await move(tokenA, {
      ids: [same.id, pending.id, removed.id, foreign.id, 'rd-does-not-exist', ok.id],
      targetTopicId: T_TARGET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect((body.moved as Json[]).map((s) => s.id)).toEqual([ok.id]);
    expect(body.refused).toEqual([
      { id: same.id, reason: 'same_topic' },
      { id: pending.id, reason: 'not_ready' },
      { id: removed.id, reason: 'not_ready' },
      { id: foreign.id, reason: 'not_found' },
      { id: 'rd-does-not-exist', reason: 'not_found' },
    ]);
    expect((await rowOf(foreign.id))!.topic_node_id).toBe(T_MAIN);
  });

  it.each([
    ['draft', T_DRAFT],
    ['out-of-access', T_OUTSIDE],
    ['missing', 'rd-t-missing'],
  ])('an unreadable (%s) target is 404 and moves nothing', async (_label, target) => {
    const { id } = await insert();
    const res = await move(tokenA, { ids: [id], targetTopicId: target });
    expect(res.status).toBe(404);
    expect((await rowOf(id))!.topic_node_id).toBe(T_MAIN);
  });

  it('validates the body: 1..10 ids and a target', async () => {
    expect((await move(tokenA, { ids: [], targetTopicId: T_TARGET })).status).toBe(400);
    const eleven = Array.from({ length: 11 }, (_, i) => `id-${i}`);
    expect((await move(tokenA, { ids: eleven, targetTopicId: T_TARGET })).status).toBe(400);
    expect((await move(tokenA, { ids: ['x'] })).status).toBe(400);
  });

  it('a tutor moves like a student; staff get 403', async () => {
    const { id } = await insert({ author: TUTOR });
    const res = await move(tutorToken, { ids: [id], targetTopicId: T_TARGET });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).moved).toHaveLength(1);

    const own = await insert();
    expect((await move(adminToken, { ids: [own.id], targetTopicId: T_TARGET })).status).toBe(403);
    expect((await move(creatorToken, { ids: [own.id], targetTopicId: T_TARGET })).status).toBe(403);
    expect((await rowOf(own.id))!.topic_node_id).toBe(T_MAIN);
  });
});
