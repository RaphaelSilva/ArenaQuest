import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { JwtAuthAdapter } from '@api/adapters/auth';

/**
 * HTTP matrix of the staff notes surface (RFC 0016 §3, M21 Task 04):
 * the per-student listing, force-unshare and clear-moderation under
 * `/v1/admin`. Business rules are unit-tested in
 * `test/controllers/notes.controller.spec.ts`; this suite proves the wiring,
 * the role matrix and the moderation round-trip against a real D1.
 *
 * Mount-order regression guard: `routes/admin/users.ts` puts an ADMIN-only
 * `requireRole` on `/users/*`. The notes router is registered before it in
 * `routes/admin/index.ts`, so a content creator must get `200` on
 * `GET /v1/admin/users/{userId}/notes` — see the "staff roles" block.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const STUDENT_A = 'snote-student-a';
const STUDENT_B = 'snote-student-b';
const TUTOR = 'snote-tutor';
const ADMIN = 'snote-admin';
const CREATOR = 'snote-creator';

const T_ONE = 'snote-t-one';
const T_TWO = 'snote-t-two';

let tokenA: string;
let tokenB: string;
let tutorToken: string;
let adminToken: string;
let creatorToken: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  const user = (id: string) =>
    env.DB.prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(id, `Name ${id}`, `${id}@snotes.test`, 'hash');
  const topic = (id: string) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO topic_nodes (id, title, status, archived, visibility) VALUES (?, ?, 'published', 0, 'restricted')`,
    ).bind(id, `Title ${id}`);
  const enroll = (userId: string, topicId: string) =>
    env.DB.prepare(
      'INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)',
    ).bind(`enr-${userId}-${topicId}`, userId, topicId, ADMIN);

  await env.DB.batch([
    ...[STUDENT_A, STUDENT_B, TUTOR, ADMIN, CREATOR].map((id) => user(id)),
    topic(T_ONE),
    topic(T_TWO),
    ...[STUDENT_A, STUDENT_B, TUTOR].flatMap((u) => [T_ONE, T_TWO].map((t) => enroll(u, t))),
  ]);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [tokenA, tokenB, tutorToken, adminToken, creatorToken] = await Promise.all([
    adapter.signAccessToken({ sub: STUDENT_A, email: 'a@snotes.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: STUDENT_B, email: 'b@snotes.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: TUTOR, email: 't@snotes.test', roles: ['tutor'] }),
    adapter.signAccessToken({ sub: ADMIN, email: 'admin@snotes.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: CREATOR, email: 'creator@snotes.test', roles: ['content_creator'] }),
  ]);
});

async function req(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = {};
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

type Json = Record<string, any>;

const put = (topicId: string, token: string, body: Json) =>
  req('PUT', `/topics/${topicId}/notes/me`, { token, body });

/** Creates student A's note on a topic and returns it. */
async function createNote(topicId: string, body: string, visibility: 'private' | 'shared'): Promise<Json> {
  const res = await put(topicId, tokenA, { body, visibility, baseRevision: 0 });
  expect(res.status).toBe(201);
  return (await res.json()) as Json;
}

const STAFF: Array<[string, () => string, string]> = [
  ['admin', () => adminToken, ADMIN],
  ['content_creator', () => creatorToken, CREATOR],
];

// ---------------------------------------------------------------------------

describe('auth and roles', () => {
  const routes = (): Array<[string, string]> => [
    ['GET', `/admin/users/${STUDENT_A}/notes`],
    ['POST', '/admin/notes/snote-any/unshare'],
    ['DELETE', '/admin/notes/snote-any/moderation'],
  ];

  it('answers 401 without a token on all three routes', async () => {
    for (const [method, path] of routes()) {
      expect((await req(method, path)).status, `${method} ${path}`).toBe(401);
    }
  });

  it.each([
    ['student', () => tokenB],
    ['tutor', () => tutorToken],
  ])('answers 403 to a %s on all three routes, changing nothing', async (_label, token) => {
    const shared = await createNote(T_ONE, 'still shared', 'shared');
    for (const [method, path] of [
      ['GET', `/admin/users/${STUDENT_A}/notes`],
      ['POST', `/admin/notes/${shared.id}/unshare`],
      ['DELETE', `/admin/notes/${shared.id}/moderation`],
    ] as const) {
      expect((await req(method, path, { token: token() })).status, `${method} ${path}`).toBe(403);
    }
    const mine = await req('GET', `/topics/${T_ONE}/notes/me`, { token: tokenA });
    expect(((await mine.json()) as Json).data).toMatchObject({ visibility: 'shared', revision: 1, moderated: false });
  });
});

describe.each(STAFF)('staff roles: %s', (_label, token, staffId) => {
  it('lists a student\'s notes, private included, newest updatedAt first, with topic title', async () => {
    const privateNote = await createNote(T_ONE, 'private words', 'private');
    // Force a strictly later updated_at so the order is deterministic.
    await env.DB.prepare(`UPDATE topic_notes SET updated_at = '2020-01-01 00:00:00' WHERE id = ?`)
      .bind(privateNote.id).run();
    const sharedNote = await createNote(T_TWO, 'shared words', 'shared');

    // Regression guard for the mount order: a content creator must reach this
    // path despite the ADMIN-only '/users/*' middleware in users.ts.
    const res = await req('GET', `/admin/users/${STUDENT_A}/notes`, { token: token() });
    expect(res.status).toBe(200);
    const page = (await res.json()) as Json;
    expect(page.nextCursor).toBeNull();
    expect(page.data.map((n: Json) => n.id)).toEqual([sharedNote.id, privateNote.id]);
    expect(page.data[1]).toMatchObject({
      body: 'private words',
      visibility: 'private',
      topicTitle: `Title ${T_ONE}`,
      moderated: false,
      moderatedAt: null,
      moderatedBy: null,
    });
    expect(page.data[0]).toMatchObject({ visibility: 'shared', topicTitle: `Title ${T_TWO}` });
  });

  it('answers an empty page for an unknown user and 400 on a malformed cursor', async () => {
    const empty = await req('GET', '/admin/users/snote-nobody/notes', { token: token() });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ data: [], nextCursor: null });

    const bad = await req('GET', `/admin/users/${STUDENT_A}/notes?cursor=!!!`, { token: token() });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'InvalidCursor' });
  });

  it('unshares, blocks re-sharing until cleared, and never re-shares on the author\'s behalf', async () => {
    const body = 'Shared **thoughts** — with <em>unicode</em> ✓\n\nline two';
    const before = await createNote(T_ONE, body, 'shared');
    const storedBody = (await env.DB.prepare('SELECT body FROM topic_notes WHERE id = ?')
      .bind(before.id).first<{ body: string }>())!.body;

    // Class listing shows it before moderation.
    const classBefore = (await (await req('GET', `/topics/${T_ONE}/notes`, { token: tokenB })).json()) as Json;
    expect(classBefore.data.map((n: Json) => n.id)).toContain(before.id);

    // Force-unshare.
    const unshared = await req('POST', `/admin/notes/${before.id}/unshare`, { token: token() });
    expect(unshared.status).toBe(200);
    const moderated = (await unshared.json()) as Json;
    expect(moderated).toMatchObject({
      id: before.id,
      body: before.body,
      visibility: 'private',
      moderated: true,
      moderatedBy: staffId,
      revision: before.revision + 1,
    });
    expect(moderated.moderatedAt).toEqual(expect.any(String));
    const storedAfter = (await env.DB.prepare('SELECT body FROM topic_notes WHERE id = ?')
      .bind(before.id).first<{ body: string }>())!.body;
    expect(storedAfter).toBe(storedBody);

    // Absent from the student class listing.
    const classAfter = (await (await req('GET', `/topics/${T_ONE}/notes`, { token: tokenB })).json()) as Json;
    expect(classAfter.data.map((n: Json) => n.id)).not.toContain(before.id);

    // An open editor holding the pre-moderation revision is stale.
    const stale = await put(T_ONE, tokenA, { body: 'autosave', baseRevision: before.revision });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'NOTE_STALE', current: { revision: moderated.revision } });

    // Sharing is refused while flagged, even at the current revision.
    const refused = await put(T_ONE, tokenA, { body, visibility: 'shared', baseRevision: moderated.revision });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'NOTE_MODERATED' });

    // Clear moderation — 204, and the note stays private.
    const cleared = await req('DELETE', `/admin/notes/${before.id}/moderation`, { token: token() });
    expect(cleared.status).toBe(204);
    const mine = ((await (await req('GET', `/topics/${T_ONE}/notes/me`, { token: tokenA })).json()) as Json).data;
    expect(mine).toMatchObject({ visibility: 'private', moderated: false, revision: moderated.revision });

    // Now the author may share again.
    const reshared = await put(T_ONE, tokenA, { body, visibility: 'shared', baseRevision: mine.revision });
    expect(reshared.status).toBe(200);
    expect(await reshared.json()).toMatchObject({ visibility: 'shared', moderated: false, revision: mine.revision + 1 });
  });

  it('unshares a private note: it stays private and becomes flagged', async () => {
    const privateNote = await createNote(T_TWO, 'only mine', 'private');
    const res = await req('POST', `/admin/notes/${privateNote.id}/unshare`, { token: token() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      visibility: 'private',
      moderated: true,
      body: 'only mine',
      revision: privateNote.revision + 1,
    });
  });

  it('answers 404 to unshare and clear on an unknown id', async () => {
    for (const [method, path] of [
      ['POST', '/admin/notes/snote-missing/unshare'],
      ['DELETE', '/admin/notes/snote-missing/moderation'],
    ] as const) {
      const res = await req(method, path, { token: token() });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.json()).toEqual({ error: 'NotFound' });
    }
  });

  it('exposes no staff route that edits or deletes a note', async () => {
    const note = await createNote(T_ONE, 'untouchable', 'shared');
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await req(method, `/admin/notes/${note.id}`, {
        token: token(),
        body: method === 'DELETE' ? undefined : { body: 'overwritten' },
      });
      expect([404, 405], `${method} /admin/notes/{id}`).toContain(res.status);
    }
    const mine = ((await (await req('GET', `/topics/${T_ONE}/notes/me`, { token: tokenA })).json()) as Json).data;
    expect(mine).toMatchObject({ id: note.id, body: 'untouchable', revision: 1 });
  });
});
