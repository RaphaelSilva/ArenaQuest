import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { encodeCursor, decodeCursor } from '@api/routes/_shared/cursor';
import { NOTE_BODY_MAX } from '@arenaquest/shared/domain/notes/limits';

/**
 * HTTP matrix of the student notes surface (RFC 0016 §3–§5, M21 Task 03).
 * Business rules are unit-tested in `test/controllers/notes.controller.spec.ts`;
 * this suite proves the wiring, the status codes and the audience split against
 * a real D1.
 *
 * Storage is isolated per test (writes inside an `it` roll back), so every test
 * that needs a note creates it; only `beforeAll` fixtures are shared.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const STUDENT_A = 'note-student-a';
const STUDENT_B = 'note-student-b';
const TUTOR = 'note-tutor';
const ADMIN = 'note-admin';
const CREATOR = 'note-creator';

// Every topic is published + restricted unless its name says otherwise.
const T_MAIN = 'note-t-main';
const T_CLASS = 'note-t-class';
const T_RACE = 'note-t-race';
const T_PAGE = 'note-t-page';
const T_LOST = 'note-t-lost';
const T_DRAFT = 'note-t-draft';
const T_ARCHIVED = 'note-t-archived';
const T_OUTSIDE = 'note-t-outside'; // nobody enrolled

const PAGE_FILLERS = 21; // one more than a page, so the staff listing has a cursor

let tokenA: string;
let tokenB: string;
let tutorToken: string;
let adminToken: string;
let creatorToken: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  const user = (id: string) =>
    env.DB.prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(id, `Name ${id}`, `${id}@notes.test`, 'hash');
  const topic = (id: string, status = 'published', archived = 0) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO topic_nodes (id, title, status, archived, visibility) VALUES (?, ?, ?, ?, 'restricted')`,
    ).bind(id, `Title ${id}`, status, archived);
  const enroll = (userId: string, topicId: string) =>
    env.DB.prepare(
      'INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)',
    ).bind(`enr-${userId}-${topicId}`, userId, topicId, ADMIN);

  const fillers = Array.from({ length: PAGE_FILLERS }, (_, i) => `note-filler-${i}`);

  await env.DB.batch([
    ...[STUDENT_A, STUDENT_B, TUTOR, ADMIN, CREATOR, ...fillers].map((id) => user(id)),
    topic(T_MAIN),
    topic(T_CLASS),
    topic(T_RACE),
    topic(T_PAGE),
    topic(T_LOST),
    topic(T_DRAFT, 'draft'),
    topic(T_ARCHIVED, 'published', 1),
    topic(T_OUTSIDE),
    ...[STUDENT_A, STUDENT_B, TUTOR].flatMap((u) =>
      [T_MAIN, T_CLASS, T_RACE, T_PAGE, T_LOST, T_DRAFT, T_ARCHIVED].map((t) => enroll(u, t)),
    ),
    // Page fixture: 21 private notes by other students, straight into the table.
    ...fillers.map((authorId, i) =>
      env.DB.prepare(
        `INSERT INTO topic_notes (id, topic_node_id, author_id, body, visibility, updated_at)
         VALUES (?, ?, ?, ?, 'private', ?)`,
      ).bind(`note-filler-row-${String(i).padStart(2, '0')}`, T_PAGE, authorId, `private ${i}`, `2026-01-01 00:00:${String(i).padStart(2, '0')}`),
    ),
  ]);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [tokenA, tokenB, tutorToken, adminToken, creatorToken] = await Promise.all([
    adapter.signAccessToken({ sub: STUDENT_A, email: 'a@notes.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: STUDENT_B, email: 'b@notes.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: TUTOR, email: 't@notes.test', roles: ['tutor'] }),
    adapter.signAccessToken({ sub: ADMIN, email: 'admin@notes.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: CREATOR, email: 'creator@notes.test', roles: ['content_creator'] }),
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

// ---------------------------------------------------------------------------

describe('auth', () => {
  it.each([
    ['GET', `/topics/${T_MAIN}/notes/me`],
    ['PUT', `/topics/${T_MAIN}/notes/me`],
    ['DELETE', `/topics/${T_MAIN}/notes/me`],
    ['GET', `/topics/${T_MAIN}/notes`],
    ['GET', '/me/notes'],
  ])('%s %s answers 401 without a token', async (method, path) => {
    const res = await req(method, path, method === 'PUT' ? { body: { body: 'x', baseRevision: 0 } } : {});
    expect(res.status).toBe(401);
  });
});

describe('my note — save, read, delete', () => {
  it('creates with 201, reads revision 1, deletes with 204', async () => {
    const created = await put(T_MAIN, tokenA, { body: 'first thoughts', baseRevision: 0 });
    expect(created.status).toBe(201);
    const note = (await created.json()) as Json;
    expect(note).toMatchObject({ body: 'first thoughts', visibility: 'private', revision: 1, moderated: false });
    expect(note).not.toHaveProperty('moderatedBy');

    const read = await req('GET', `/topics/${T_MAIN}/notes/me`, { token: tokenA });
    expect(read.status).toBe(200);
    expect(((await read.json()) as Json).data).toMatchObject({ id: note.id, revision: 1 });

    const updated = await put(T_MAIN, tokenA, { body: 'second', baseRevision: 1 });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ body: 'second', revision: 2, visibility: 'private' });

    expect((await req('DELETE', `/topics/${T_MAIN}/notes/me`, { token: tokenA })).status).toBe(204);
    const after = await req('GET', `/topics/${T_MAIN}/notes/me`, { token: tokenA });
    expect(await after.json()).toEqual({ data: null });
    expect((await req('DELETE', `/topics/${T_MAIN}/notes/me`, { token: tokenA })).status).toBe(404);
  });

  it('keeps each student\'s note their own', async () => {
    await put(T_MAIN, tokenA, { body: 'A private', baseRevision: 0 });
    const readB = await req('GET', `/topics/${T_MAIN}/notes/me`, { token: tokenB });
    expect(await readB.json()).toEqual({ data: null });
    await req('DELETE', `/topics/${T_MAIN}/notes/me`, { token: tokenA });
  });

  it.each([T_DRAFT, T_ARCHIVED, T_OUTSIDE, 'note-t-missing'])(
    'answers 404 to GET, PUT and DELETE on %s',
    async (topicId) => {
      expect((await req('GET', `/topics/${topicId}/notes/me`, { token: tokenA })).status).toBe(404);
      expect((await put(topicId, tokenA, { body: 'x', baseRevision: 0 })).status).toBe(404);
      expect((await req('DELETE', `/topics/${topicId}/notes/me`, { token: tokenA })).status).toBe(404);
      expect((await req('GET', `/topics/${topicId}/notes`, { token: tokenA })).status).toBe(404);
    },
  );

  it('answers 404 to a tutor outside their access, like a student', async () => {
    expect((await req('GET', `/topics/${T_OUTSIDE}/notes/me`, { token: tutorToken })).status).toBe(404);
  });
});

describe('validation', () => {
  it('answers 400 NOTE_BODY_EMPTY on a blank body', async () => {
    const res = await put(T_MAIN, tokenB, { body: '   ', baseRevision: 0 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'NOTE_BODY_EMPTY' });
  });

  it('answers 400 NOTE_BODY_TOO_LONG above NOTE_BODY_MAX', async () => {
    const res = await put(T_MAIN, tokenB, { body: 'a'.repeat(NOTE_BODY_MAX + 1), baseRevision: 0 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'NOTE_BODY_TOO_LONG', max: NOTE_BODY_MAX });
  });

  it.each([
    { body: 'x' },
    { body: 'x', baseRevision: -1 },
    { body: 'x', baseRevision: 1.5 },
    { body: 'x', baseRevision: 0, visibility: 'public' },
    { baseRevision: 0 },
  ])('answers 400 on a malformed body %j', async (payload) => {
    expect((await put(T_MAIN, tokenB, payload)).status).toBe(400);
  });

  it('strips a <script> before storage', async () => {
    const res = await put(T_MAIN, tokenB, { body: 'ok <script>alert(1)</script>done', baseRevision: 0 });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare('SELECT body FROM topic_notes WHERE topic_node_id = ? AND author_id = ?')
      .bind(T_MAIN, STUDENT_B)
      .first<{ body: string }>();
    expect(row?.body).toBe('ok done');
    await req('DELETE', `/topics/${T_MAIN}/notes/me`, { token: tokenB });
  });
});

describe('conflicts', () => {
  it('answers 409 NOTE_STALE with the current note, leaving the row unchanged', async () => {
    const created = (await (await put(T_RACE, tokenA, { body: 'v1', baseRevision: 0 })).json()) as Json;
    const stale = await put(T_RACE, tokenA, { body: 'lost write', baseRevision: 7 });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as Json;
    expect(body.error).toBe('NOTE_STALE');
    expect(body.current).toMatchObject({ id: created.id, body: 'v1', revision: 1 });

    const row = await env.DB.prepare('SELECT body, revision FROM topic_notes WHERE id = ?').bind(created.id).first();
    expect(row).toEqual({ body: 'v1', revision: 1 });
  });

  it('a second create on an existing note is NOTE_STALE carrying the first', async () => {
    await put(T_RACE, tokenA, { body: 'v1', baseRevision: 0 });
    const res = await put(T_RACE, tokenA, { body: 'again', baseRevision: 0 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'NOTE_STALE', current: { body: 'v1' } });
  });

  it('two same-second saves on one revision: exactly one 200 and one 409 carrying the winner', async () => {
    await put(T_RACE, tokenA, { body: 'v1', baseRevision: 0 });
    const [r1, r2] = await Promise.all([
      put(T_RACE, tokenA, { body: 'tab A', baseRevision: 1 }),
      put(T_RACE, tokenA, { body: 'tab B', baseRevision: 1 }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const [winner, loser] = r1.status === 200 ? [r1, r2] : [r2, r1];
    const won = (await winner.json()) as Json;
    const lost = (await loser.json()) as Json;
    expect(won.revision).toBe(2);
    expect(lost).toMatchObject({ error: 'NOTE_STALE', current: { body: won.body, revision: 2 } });
  });

  it('answers 409 NOTE_MODERATED when re-sharing a moderated note; a private edit still works', async () => {
    const shared = (await (await put(T_MAIN, tokenB, { body: 'mine', visibility: 'shared', baseRevision: 0 })).json()) as Json;
    expect(shared.visibility).toBe('shared');
    await env.DB.prepare(
      `UPDATE topic_notes SET visibility = 'private', moderated_at = datetime('now'), moderated_by = ?, revision = revision + 1 WHERE id = ?`,
    ).bind(ADMIN, shared.id).run();

    const reshare = await put(T_MAIN, tokenB, { body: 'mine', visibility: 'shared', baseRevision: 2 });
    expect(reshare.status).toBe(409);
    expect(await reshare.json()).toEqual({ error: 'NOTE_MODERATED' });

    const edit = await put(T_MAIN, tokenB, { body: 'mine, edited', baseRevision: 2 });
    expect(edit.status).toBe(200);
    expect(await edit.json()).toMatchObject({ visibility: 'private', moderated: true, revision: 3 });
    await req('DELETE', `/topics/${T_MAIN}/notes/me`, { token: tokenB });
  });
});

describe('class listing', () => {
  let privateA: Json;
  let sharedB: Json;
  let sharedTutor: Json;

  beforeAll(async () => {
    privateA = (await (await put(T_CLASS, tokenA, { body: 'A private', baseRevision: 0 })).json()) as Json;
    sharedB = (await (await put(T_CLASS, tokenB, { body: 'B shared', visibility: 'shared', baseRevision: 0 })).json()) as Json;
    sharedTutor = (await (await put(T_CLASS, tutorToken, { body: 'T shared', visibility: 'shared', baseRevision: 0 })).json()) as Json;
  });

  async function list(token: string, topicId = T_CLASS, cursor?: string) {
    const qs = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
    const res = await req('GET', `/topics/${topicId}/notes${qs}`, { token });
    return { status: res.status, body: (await res.json()) as Json };
  }

  it('gives a student shared notes only, none flagged isMine', async () => {
    const { status, body } = await list(tokenA);
    expect(status).toBe(200);
    const ids = body.data.map((n: Json) => n.id).sort();
    expect(ids).toEqual([sharedB.id, sharedTutor.id].sort());
    expect(body.data.every((n: Json) => n.visibility === 'shared' && n.isMine === false)).toBe(true);
    expect(body.nextCursor).toBeNull();
  });

  it('flags the caller\'s own shared note isMine (student and tutor)', async () => {
    for (const [token, mine] of [[tokenB, sharedB.id], [tutorToken, sharedTutor.id]] as const) {
      const { body } = await list(token);
      expect(body.data.map((n: Json) => n.id)).not.toContain(privateA.id);
      expect(body.data.find((n: Json) => n.isMine)?.id).toBe(mine);
    }
  });

  it('gives admin and content creator every note with its visibility, without enrollment', async () => {
    for (const token of [adminToken, creatorToken]) {
      const { status, body } = await list(token);
      expect(status).toBe(200);
      const byId = Object.fromEntries(body.data.map((n: Json) => [n.id, n.visibility]));
      expect(byId).toEqual({ [privateA.id]: 'private', [sharedB.id]: 'shared', [sharedTutor.id]: 'shared' });
    }
  });

  it('pages staff listings by 20 with an opaque cursor', async () => {
    const first = await list(adminToken, T_PAGE);
    expect(first.body.data).toHaveLength(20);
    expect(typeof first.body.nextCursor).toBe('string');
    const second = await list(adminToken, T_PAGE, first.body.nextCursor);
    expect(second.body.data).toHaveLength(PAGE_FILLERS - 20);
    expect(second.body.nextCursor).toBeNull();
    const all = [...first.body.data, ...second.body.data].map((n: Json) => n.id);
    expect(new Set(all).size).toBe(PAGE_FILLERS);
  });

  it('never shows a student a private note, whatever cursor is sent', async () => {
    const staff = await list(adminToken, T_PAGE);
    const staffCursor = staff.body.nextCursor as string;
    const privateRow = staff.body.data[0];
    const crafted = [
      staffCursor,
      encodeCursor({ sortKey: '9999-12-31 23:59:59', id: 'zzzz' }),
      encodeCursor({ sortKey: privateRow.updatedAt, id: privateRow.id }),
    ];
    for (const cursor of crafted) {
      const { status, body } = await list(tokenA, T_PAGE, cursor);
      expect(status).toBe(200);
      expect(body.data.filter((n: Json) => n.visibility !== 'shared')).toEqual([]);
    }
    expect(decodeCursor(staffCursor)).not.toBeNull();
  });

  it('answers 400 InvalidCursor on a malformed cursor', async () => {
    for (const cursor of ['not base64!', encodeCursor({ sortKey: '', id: 'x' }).slice(0, 2), btoa('no-separator')]) {
      const { status, body } = await list(tokenA, T_CLASS, cursor);
      expect(status).toBe(400);
      expect(body).toEqual({ error: 'InvalidCursor' });
    }
  });
});

describe('my notes across topics', () => {
  it('lists every note with topic title and topicAccessible; a lost topic is read-only but deletable', async () => {
    await put(T_LOST, tokenB, { body: 'kept words', baseRevision: 0 });
    await put(T_RACE, tokenB, { body: 'race note', baseRevision: 0 });

    // B loses access to T_LOST.
    await env.DB.prepare('DELETE FROM enrollments_user WHERE user_id = ? AND topic_node_id = ?')
      .bind(STUDENT_B, T_LOST)
      .run();

    const res = await req('GET', '/me/notes', { token: tokenB });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.nextCursor).toBeNull();
    expect(body.data.every((n: Json) => n.authorId === STUDENT_B)).toBe(true);
    const lost = body.data.find((n: Json) => n.topicNodeId === T_LOST);
    const race = body.data.find((n: Json) => n.topicNodeId === T_RACE);
    expect(lost).toMatchObject({ body: 'kept words', topicTitle: `Title ${T_LOST}`, topicAccessible: false });
    expect(race).toMatchObject({ topicAccessible: true });

    // Edit and share are refused; delete succeeds.
    expect((await put(T_LOST, tokenB, { body: 'edit', baseRevision: 1 })).status).toBe(404);
    expect((await put(T_LOST, tokenB, { body: 'kept words', visibility: 'shared', baseRevision: 1 })).status).toBe(404);
    expect((await req('DELETE', `/topics/${T_LOST}/notes/me`, { token: tokenB })).status).toBe(204);

    const after = (await (await req('GET', '/me/notes', { token: tokenB })).json()) as Json;
    expect(after.data.map((n: Json) => n.topicNodeId)).not.toContain(T_LOST);
  });

  it('answers 400 InvalidCursor on a malformed cursor', async () => {
    const res = await req('GET', '/me/notes?cursor=a$b', { token: tokenA });
    expect(res.status).toBe(400);
  });
});
