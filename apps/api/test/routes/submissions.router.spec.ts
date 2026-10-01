import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { JwtAuthAdapter } from '@api/adapters/auth';
import movFixture from '../fixtures/submissions/sample.mov?inline';
import mp4Fixture from '../fixtures/submissions/sample.mp4?inline';
import jpegFixture from '../fixtures/submissions/sample.jpg?inline';
import pdfFixture from '../fixtures/submissions/sample.pdf?inline';
import textFixture from '../fixtures/submissions/not-a-video.txt?inline';

/**
 * HTTP matrix of the student upload surface (RFC 0020 §5, §7, §10; M23 Task 03)
 * against a real D1, KV and R2. The client's PUT to the presigned URL is
 * simulated by writing the bytes straight into the R2 binding under the key the
 * server built — the same object the finalize step then inspects.
 *
 * Storage is isolated per test (writes inside an `it` roll back); only the
 * `beforeAll` users, topics and enrollments are shared.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const STUDENT_A = 'sub-student-a';
const STUDENT_B = 'sub-student-b';
const TUTOR = 'sub-tutor';
const ADMIN = 'sub-admin';
const CREATOR = 'sub-creator';

const T_MAIN = 'sub-t-main';
const T_OTHER = 'sub-t-other';
const T_LOST = 'sub-t-lost'; // A uploads, then loses access
const T_DRAFT = 'sub-t-draft';
const T_ARCHIVED = 'sub-t-archived';
const T_OUTSIDE = 'sub-t-outside'; // nobody enrolled
// The catalog's `GET /topics/{id}` validates a UUID.
const T_COURSE = '5b0e4c1a-23f4-4d6e-9a71-0c3d2e1f4a55';

const MB = 1024 * 1024;

let tokenA: string;
let tokenB: string;
let tutorToken: string;
let adminToken: string;
let creatorToken: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  const user = (id: string) =>
    env.DB.prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(id, `Name ${id}`, `${id}@submissions.test`, 'hash');
  const topic = (id: string, status = 'published', archived = 0) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO topic_nodes (id, title, status, archived, visibility) VALUES (?, ?, ?, ?, 'restricted')`,
    ).bind(id, `Title ${id}`, status, archived);
  const enroll = (userId: string, topicId: string) =>
    env.DB.prepare(
      'INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)',
    ).bind(`enr-${userId}-${topicId}`, userId, topicId, ADMIN);

  await env.DB.batch([
    ...[STUDENT_A, STUDENT_B, TUTOR, ADMIN, CREATOR].map(user),
    topic(T_MAIN),
    topic(T_OTHER),
    topic(T_LOST),
    topic(T_DRAFT, 'draft'),
    topic(T_ARCHIVED, 'published', 1),
    topic(T_OUTSIDE),
    topic(T_COURSE),
    ...[STUDENT_A, STUDENT_B, TUTOR].flatMap((u) =>
      [T_MAIN, T_OTHER, T_DRAFT, T_ARCHIVED, T_COURSE].map((t) => enroll(u, t)),
    ),
  ]);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [tokenA, tokenB, tutorToken, adminToken, creatorToken] = await Promise.all([
    adapter.signAccessToken({ sub: STUDENT_A, email: 'a@submissions.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: STUDENT_B, email: 'b@submissions.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: TUTOR, email: 't@submissions.test', roles: ['tutor'] }),
    adapter.signAccessToken({ sub: ADMIN, email: 'admin@submissions.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: CREATOR, email: 'creator@submissions.test', roles: ['content_creator'] }),
  ]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Json = Record<string, any>;

interface ReqOptions {
  body?: unknown;
  token?: string;
  /** Overrides merged over the Worker env for this request only (e.g. SUBMISSIONS_* vars). */
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

function bytesOf(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
}

const FIXTURES = {
  mov: { bytes: bytesOf(movFixture), contentType: 'video/quicktime', fileName: 'IMG_0042.MOV' },
  mp4: { bytes: bytesOf(mp4Fixture), contentType: 'video/mp4', fileName: 'kata.mp4' },
  jpeg: { bytes: bytesOf(jpegFixture), contentType: 'image/jpeg', fileName: 'stance.jpg' },
  pdf: { bytes: bytesOf(pdfFixture), contentType: 'application/pdf', fileName: 'worksheet.pdf' },
  text: { bytes: bytesOf(textFixture), contentType: 'text/plain', fileName: 'notes.txt' },
} as const;

function presignBody(over: Json = {}): Json {
  return { fileName: 'kata.mp4', contentType: 'video/mp4', sizeBytes: 1000, title: 'Kata', ...over };
}

const presign = (topicId: string, token: string, body: Json, envOverrides?: Record<string, unknown>) =>
  req('POST', `/topics/${topicId}/submissions/presign`, { token, body, envOverrides });

const finalize = (topicId: string, sid: string, token: string, envOverrides?: Record<string, unknown>) =>
  req('POST', `/topics/${topicId}/submissions/${sid}/finalize`, { token, envOverrides });

async function storageKeyOf(id: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT storage_key FROM topic_submissions WHERE id = ?')
    .bind(id)
    .first<{ storage_key: string | null }>();
  return row?.storage_key ?? null;
}

async function rowExists(id: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS x FROM topic_submissions WHERE id = ?').bind(id).first();
  return row !== null;
}

/** Presign, simulate the client's PUT with `bytes` under `storedType`, and return the submission id + key. */
async function presignAndUpload(
  topicId: string,
  token: string,
  file: { bytes: Uint8Array; contentType: string; fileName: string },
  declaredType = file.contentType,
): Promise<{ id: string; key: string }> {
  const res = await presign(topicId, token, presignBody({
    fileName: file.fileName,
    contentType: declaredType,
    sizeBytes: file.bytes.byteLength,
  }));
  expect(res.status).toBe(201);
  const { submission } = (await res.json()) as Json;
  const key = (await storageKeyOf(submission.id))!;
  await env.R2.put(key, file.bytes, { httpMetadata: { contentType: declaredType } });
  return { id: submission.id, key };
}

/** A ready submission of `token`'s user on `topicId`. */
async function readySubmission(topicId: string, token: string): Promise<{ id: string; key: string }> {
  const uploaded = await presignAndUpload(topicId, token, FIXTURES.mp4);
  expect((await finalize(topicId, uploaded.id, token)).status).toBe(200);
  return uploaded;
}

// ---------------------------------------------------------------------------

describe('auth', () => {
  it.each([
    ['POST', `/topics/${T_MAIN}/submissions/presign`],
    ['POST', `/topics/${T_MAIN}/submissions/x/finalize`],
    ['PATCH', `/topics/${T_MAIN}/submissions/x`],
    ['DELETE', `/topics/${T_MAIN}/submissions/x`],
    ['GET', `/topics/${T_MAIN}/submissions/summary`],
  ])('%s %s answers 401 without a token', async (method, path) => {
    const body = method === 'POST' || method === 'PATCH' ? { body: {} } : {};
    const res = await req(method, path, body);
    expect(res.status).toBe(401);
  });
});

describe('upload lifecycle - presign -> PUT -> finalize', () => {
  it.each(['mov', 'mp4', 'jpeg', 'pdf'] as const)('a %s fixture becomes ready', async (kind) => {
    const file = FIXTURES[kind];
    const res = await presign(T_MAIN, tokenA, presignBody({
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: file.bytes.byteLength,
      title: `My ${kind}`,
    }));
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as Json;
    expect(body.uploadUrl).toMatch(/^https?:\/\//);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    expect(body.submission).toMatchObject({
      topicNodeId: T_MAIN,
      authorId: STUDENT_A,
      title: `My ${kind}`,
      contentType: file.contentType,
      sizeBytes: file.bytes.byteLength,
      status: 'pending',
      visibility: 'private',
      moderated: false,
    });
    expect(body.submission).not.toHaveProperty('storageKey');

    // The key is built server-side: author first, never the topic id.
    const key = (await storageKeyOf(body.submission.id))!;
    expect(key.startsWith(`submissions/${STUDENT_A}/${body.submission.id}-`)).toBe(true);
    expect(key).not.toContain(T_MAIN);

    await env.R2.put(key, file.bytes, { httpMetadata: { contentType: file.contentType } });

    const done = await finalize(T_MAIN, body.submission.id, tokenA);
    expect(done.status).toBe(200);
    expect(((await done.json()) as Json)).toMatchObject({ id: body.submission.id, status: 'ready' });
  });

  it('the iPhone fixture is a real QuickTime file (ftyp qt)', () => {
    const head = FIXTURES.mov.bytes.slice(4, 12);
    expect(String.fromCharCode(...head)).toBe('ftypqt  ');
  });

  it('finalize is idempotent on a ready submission', async () => {
    const { id } = await readySubmission(T_MAIN, tokenA);
    const again = await finalize(T_MAIN, id, tokenA);
    expect(again.status).toBe(200);
    expect(((await again.json()) as Json).status).toBe('ready');
  });

  it('a text file uploaded as video/mp4 fails with 422 UPLOAD_MISMATCH and leaves neither row nor object', async () => {
    const { id, key } = await presignAndUpload(T_MAIN, tokenA, FIXTURES.text, 'video/mp4');
    const res = await finalize(T_MAIN, id, tokenA);
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error).toBe('UPLOAD_MISMATCH');
    expect(await rowExists(id)).toBe(false);
    expect(await env.R2.head(key)).toBeNull();
  });

  it('a JPEG declared as application/pdf fails the signature check', async () => {
    const { id, key } = await presignAndUpload(T_MAIN, tokenA, FIXTURES.jpeg, 'application/pdf');
    const res = await finalize(T_MAIN, id, tokenA);
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error).toBe('UPLOAD_MISMATCH');
    expect(await rowExists(id)).toBe(false);
    expect(await env.R2.head(key)).toBeNull();
  });

  it('a stored length different from the declared size is UPLOAD_MISMATCH', async () => {
    const res = await presign(T_MAIN, tokenA, presignBody({ sizeBytes: FIXTURES.mp4.bytes.byteLength + 1 }));
    const { submission } = (await res.json()) as Json;
    const key = (await storageKeyOf(submission.id))!;
    await env.R2.put(key, FIXTURES.mp4.bytes, { httpMetadata: { contentType: 'video/mp4' } });

    const done = await finalize(T_MAIN, submission.id, tokenA);
    expect(done.status).toBe(422);
    expect(((await done.json()) as Json).error).toBe('UPLOAD_MISMATCH');
    expect(await rowExists(submission.id)).toBe(false);
    expect(await env.R2.head(key)).toBeNull();
  });

  it('finalize without an upload is 422 NotUploaded and keeps the pending row', async () => {
    const res = await presign(T_MAIN, tokenA, presignBody());
    const { submission } = (await res.json()) as Json;
    const done = await finalize(T_MAIN, submission.id, tokenA);
    expect(done.status).toBe(422);
    expect(((await done.json()) as Json).error).toBe('NotUploaded');
    expect(await rowExists(submission.id)).toBe(true);
  });
});

describe('presign - validation and limits', () => {
  it('refuses a video over SUBMISSIONS_VIDEO_MAX_BYTES with 422 FileTooLarge', async () => {
    const overrides = { SUBMISSIONS_VIDEO_MAX_BYTES: String(10 * MB) };
    for (const contentType of ['video/mp4', 'video/quicktime']) {
      const res = await presign(T_MAIN, tokenA, presignBody({ contentType, sizeBytes: 10 * MB + 1 }), overrides);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error: 'FileTooLarge', maxBytes: 10 * MB });
    }
    // Exactly at the limit is accepted.
    const ok = await presign(T_MAIN, tokenA, presignBody({ sizeBytes: 10 * MB }), overrides);
    expect(ok.status).toBe(201);
  });

  it('applies the 250 MB default when the var is absent', async () => {
    const res = await presign(T_MAIN, tokenA, presignBody({ sizeBytes: 250 * MB + 1 }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'FileTooLarge', maxBytes: 250 * MB });
  });

  it('refuses an image over 5 MB and a PDF over 25 MB with 422 FileTooLarge', async () => {
    const image = await presign(T_MAIN, tokenA, presignBody({ contentType: 'image/jpeg', fileName: 'a.jpg', sizeBytes: 5 * MB + 1 }));
    expect(image.status).toBe(422);
    expect(await image.json()).toMatchObject({ error: 'FileTooLarge', maxBytes: 5 * MB });

    const pdf = await presign(T_MAIN, tokenA, presignBody({ contentType: 'application/pdf', fileName: 'a.pdf', sizeBytes: 25 * MB + 1 }));
    expect(pdf.status).toBe(422);
    expect(await pdf.json()).toMatchObject({ error: 'FileTooLarge', maxBytes: 25 * MB });
  });

  it('rejects a content type outside SUBMISSION_MEDIA_TYPES and a blank title with 400', async () => {
    expect((await presign(T_MAIN, tokenA, presignBody({ contentType: 'text/plain' }))).status).toBe(400);
    expect((await presign(T_MAIN, tokenA, presignBody({ title: '   ' }))).status).toBe(400);
    expect((await presign(T_MAIN, tokenA, presignBody({ title: 'x'.repeat(121) }))).status).toBe(400);
  });

  it('sanitises the description', async () => {
    const res = await presign(T_MAIN, tokenA, presignBody({ description: 'Left side <script>alert(1)</script>' }));
    expect(res.status).toBe(201);
    const { submission } = (await res.json()) as Json;
    expect(submission.description).not.toContain('<script>');
    expect(submission.description).toContain('Left side');
  });

  it('with SUBMISSIONS_PER_TOPIC_MAX=3 the fourth presign on a topic is 409 SUBMISSION_QUOTA (count)', async () => {
    const overrides = { SUBMISSIONS_PER_TOPIC_MAX: '3' };
    for (let i = 0; i < 3; i++) {
      expect((await presign(T_MAIN, tokenA, presignBody(), overrides)).status).toBe(201);
    }
    const fourth = await presign(T_MAIN, tokenA, presignBody(), overrides);
    expect(fourth.status).toBe(409);
    expect(await fourth.json()).toEqual({ error: 'SUBMISSION_QUOTA', reason: 'count', used: 3, limit: 3 });

    // The count is per topic: another topic still has room.
    expect((await presign(T_OTHER, tokenA, presignBody(), overrides)).status).toBe(201);
  });

  it('a presign crossing the storage quota is 409 SUBMISSION_QUOTA (storage)', async () => {
    const overrides = { SUBMISSIONS_STORAGE_PER_STUDENT_BYTES: '5000', SUBMISSIONS_VIDEO_MAX_BYTES: '5000' };
    expect((await presign(T_MAIN, tokenA, presignBody({ sizeBytes: 3000 }), overrides)).status).toBe(201);
    const over = await presign(T_OTHER, tokenA, presignBody({ sizeBytes: 3000 }), overrides);
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: 'SUBMISSION_QUOTA', reason: 'storage', used: 3000, limit: 5000 });
  });

  it('the 31st presign within an hour by one user is 429; another user is unaffected', async () => {
    // Oversized bodies keep the run fast: the budget counts every presign past the gate.
    const body = presignBody({ contentType: 'image/png', fileName: 'a.png', sizeBytes: 6 * MB });
    for (let i = 0; i < 30; i++) {
      expect((await presign(T_MAIN, tokenA, body)).status).toBe(422);
    }
    const blocked = await presign(T_MAIN, tokenA, presignBody());
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as Json).error).toBe('TooManyRequests');
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);

    expect((await presign(T_MAIN, tokenB, presignBody())).status).toBe(201);
  });

  it.each([
    ['draft', T_DRAFT],
    ['archived', T_ARCHIVED],
    ['out-of-access', T_OUTSIDE],
    ['missing', 'sub-t-missing'],
  ])('presign on a %s topic is 404', async (_label, topicId) => {
    const res = await presign(topicId, tokenA, presignBody());
    expect(res.status).toBe(404);
  });

  it('a tutor uploads like a student', async () => {
    expect((await presign(T_MAIN, tutorToken, presignBody())).status).toBe(201);
  });
});

describe("another student's submission", () => {
  it('answers 404 on every write route, and on a mismatched topic id', async () => {
    const { id } = await presignAndUpload(T_MAIN, tokenA, FIXTURES.mp4);

    expect((await finalize(T_MAIN, id, tokenB)).status).toBe(404);
    expect((await req('PATCH', `/topics/${T_MAIN}/submissions/${id}`, { token: tokenB, body: { title: 'x' } })).status).toBe(404);
    expect((await req('DELETE', `/topics/${T_MAIN}/submissions/${id}`, { token: tokenB })).status).toBe(404);

    // The author through the wrong topic id is a miss too.
    expect((await finalize(T_OTHER, id, tokenA)).status).toBe(404);
    expect((await req('DELETE', `/topics/${T_OTHER}/submissions/${id}`, { token: tokenA })).status).toBe(404);

    // Untouched: A can still finalize it.
    expect((await finalize(T_MAIN, id, tokenA)).status).toBe(200);
  });

  it("staff get 403 on a submission someone else authored - they read and moderate it, they do not edit or delete it", async () => {
    const { id } = await readySubmission(T_MAIN, tokenA);
    expect((await req('PATCH', `/topics/${T_MAIN}/submissions/${id}`, { token: adminToken, body: { title: 'x' } })).status).toBe(403);
    expect((await req('DELETE', `/topics/${T_MAIN}/submissions/${id}`, { token: creatorToken })).status).toBe(403);
    expect(await rowExists(id)).toBe(true);
  });
});

describe('staff authors (RFC 0020 §7 amended 2026-10-01; M23 Task 11)', () => {
  const STAFF = [
    ['admin', ADMIN, () => adminToken],
    ['content_creator', CREATOR, () => creatorToken],
  ] as const;

  it.each(STAFF)(
    'a %s presigns, uploads and finalizes to ready on a published topic they are not enrolled in',
    async (_label, userId, token) => {
      const { id, key } = await presignAndUpload(T_OUTSIDE, token(), FIXTURES.mp4);
      expect(key.startsWith(`submissions/${userId}/${id}-`)).toBe(true);
      const done = await finalize(T_OUTSIDE, id, token());
      expect(done.status).toBe(200);
      expect(await done.json()).toMatchObject({ id, authorId: userId, topicNodeId: T_OUTSIDE, status: 'ready' });
    },
  );

  it.each(STAFF)('a %s presign on a draft, archived or missing topic is 404', async (_label, _userId, token) => {
    for (const topicId of [T_DRAFT, T_ARCHIVED, 'sub-t-missing']) {
      expect((await presign(topicId, token(), presignBody())).status).toBe(404);
    }
  });

  it.each(STAFF)('a %s is bound by the size and type limits', async (_label, _userId, token) => {
    const overrides = { SUBMISSIONS_VIDEO_MAX_BYTES: String(10 * MB) };
    const video = await presign(T_MAIN, token(), presignBody({ sizeBytes: 10 * MB + 1 }), overrides);
    expect(video.status).toBe(422);
    expect(await video.json()).toMatchObject({ error: 'FileTooLarge', maxBytes: 10 * MB });

    const image = await presign(T_MAIN, token(), presignBody({ contentType: 'image/jpeg', fileName: 'a.jpg', sizeBytes: 5 * MB + 1 }));
    expect(image.status).toBe(422);
    expect((await presign(T_MAIN, token(), presignBody({ contentType: 'text/plain' }))).status).toBe(400);

    // The finalize signature check applies too.
    const { id, key } = await presignAndUpload(T_MAIN, token(), FIXTURES.text, 'video/mp4');
    const mismatch = await finalize(T_MAIN, id, token());
    expect(mismatch.status).toBe(422);
    expect(((await mismatch.json()) as Json).error).toBe('UPLOAD_MISMATCH');
    expect(await env.R2.head(key)).toBeNull();
  });

  it.each(STAFF)('a %s is bound by the per-topic and storage quotas', async (_label, _userId, token) => {
    const count = { SUBMISSIONS_PER_TOPIC_MAX: '1' };
    expect((await presign(T_MAIN, token(), presignBody(), count)).status).toBe(201);
    const second = await presign(T_MAIN, token(), presignBody(), count);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'SUBMISSION_QUOTA', reason: 'count', used: 1, limit: 1 });

    const storage = { SUBMISSIONS_STORAGE_PER_STUDENT_BYTES: '5000', SUBMISSIONS_VIDEO_MAX_BYTES: '5000' };
    const over = await presign(T_OTHER, token(), presignBody({ sizeBytes: 4500 }), storage);
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: 'SUBMISSION_QUOTA', reason: 'storage', used: 1000, limit: 5000 });
  });

  it.each(STAFF)('a %s is bound by the presign rate limit and the sharing switch', async (_label, _userId, token) => {
    const off = { SUBMISSIONS_SHARING_ENABLED: 'false' };
    const shared = await presign(T_MAIN, token(), presignBody({ visibility: 'shared' }), off);
    expect(shared.status).toBe(409);
    expect(((await shared.json()) as Json).error).toBe('SUBMISSION_SHARING_DISABLED');

    // The refused presign above already counted against the budget.
    const body = presignBody({ contentType: 'image/png', fileName: 'a.png', sizeBytes: 6 * MB });
    for (let i = 0; i < 29; i++) {
      expect((await presign(T_MAIN, token(), body)).status).toBe(422);
    }
    const blocked = await presign(T_MAIN, token(), presignBody());
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as Json).error).toBe('TooManyRequests');
  });

  it.each(STAFF)('a %s edits, shares and hard-deletes their own submission', async (_label, _userId, token) => {
    const { id, key } = await readySubmission(T_OUTSIDE, token());
    const patch = await req('PATCH', `/topics/${T_OUTSIDE}/submissions/${id}`, {
      token: token(),
      body: { title: 'Reference kata', description: '**Watch** the hips', visibility: 'shared' },
    });
    expect(patch.status).toBe(200);
    const body = (await patch.json()) as Json;
    expect(body).toMatchObject({ title: 'Reference kata', visibility: 'shared' });
    expect(body.sharedAt).not.toBeNull();

    const sharingOff = await req('PATCH', `/topics/${T_OUTSIDE}/submissions/${id}`, {
      token: token(),
      body: { visibility: 'shared' },
      envOverrides: { SUBMISSIONS_SHARING_ENABLED: 'false' },
    });
    expect(sharingOff.status).toBe(409);

    expect((await req('DELETE', `/topics/${T_OUTSIDE}/submissions/${id}`, { token: token() })).status).toBe(204);
    expect(await rowExists(id)).toBe(false);
    expect(await env.R2.head(key)).toBeNull();
  });

  it("a staff member gets 403 on another staff member's submission", async () => {
    const { id } = await readySubmission(T_MAIN, adminToken);
    expect((await req('PATCH', `/topics/${T_MAIN}/submissions/${id}`, { token: creatorToken, body: { title: 'x' } })).status).toBe(403);
    expect((await req('DELETE', `/topics/${T_MAIN}/submissions/${id}`, { token: creatorToken })).status).toBe(403);
    expect((await finalize(T_MAIN, id, creatorToken)).status).toBe(403);
    expect(await rowExists(id)).toBe(true);
  });

  it.each(STAFF)("the summary gives a %s their own usage and the topic total", async (_label, _userId, token) => {
    await readySubmission(T_MAIN, tokenA);
    await readySubmission(T_MAIN, token());
    const res = await req('GET', `/topics/${T_MAIN}/submissions/summary`, { token: token() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      usage: { topicCount: 1, bytes: FIXTURES.mp4.bytes.byteLength },
      totalCount: 2,
    });
  });
});

describe('PATCH - edit', () => {
  it('edits title and sanitised description, and shares', async () => {
    const { id } = await readySubmission(T_MAIN, tokenA);
    const res = await req('PATCH', `/topics/${T_MAIN}/submissions/${id}`, {
      token: tokenA,
      body: { title: '  Final take  ', description: '**Left** <img src=x onerror=alert(1)>', visibility: 'shared' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body).toMatchObject({ title: 'Final take', visibility: 'shared' });
    expect(body.sharedAt).not.toBeNull();
    expect(body.description).toContain('**Left**');
    expect(body.description).not.toContain('onerror');
  });

  it('with SUBMISSIONS_SHARING_ENABLED=false, presign or PATCH asking for shared is 409', async () => {
    const off = { SUBMISSIONS_SHARING_ENABLED: 'false' };
    const res = await presign(T_MAIN, tokenA, presignBody({ visibility: 'shared' }), off);
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json).error).toBe('SUBMISSION_SHARING_DISABLED');

    const { id } = await readySubmission(T_MAIN, tokenA);
    const patch = await req('PATCH', `/topics/${T_MAIN}/submissions/${id}`, {
      token: tokenA,
      body: { visibility: 'shared' },
      envOverrides: off,
    });
    expect(patch.status).toBe(409);
    expect(((await patch.json()) as Json).error).toBe('SUBMISSION_SHARING_DISABLED');

    // Private edits still work.
    const title = await req('PATCH', `/topics/${T_MAIN}/submissions/${id}`, {
      token: tokenA,
      body: { title: 'Still mine', visibility: 'private' },
      envOverrides: off,
    });
    expect(title.status).toBe(200);
  });

  it('sharing a moderated submission is 409 SUBMISSION_MODERATED', async () => {
    const { id } = await readySubmission(T_MAIN, tokenA);
    await env.DB.prepare(
      "UPDATE topic_submissions SET moderated_at = datetime('now'), moderated_by = ? WHERE id = ?",
    ).bind(ADMIN, id).run();

    const res = await req('PATCH', `/topics/${T_MAIN}/submissions/${id}`, { token: tokenA, body: { visibility: 'shared' } });
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json).error).toBe('SUBMISSION_MODERATED');

    const title = await req('PATCH', `/topics/${T_MAIN}/submissions/${id}`, { token: tokenA, body: { title: 'Renamed' } });
    expect(title.status).toBe(200);
    expect(((await title.json()) as Json)).toMatchObject({ title: 'Renamed', moderated: true, visibility: 'private' });
  });
});

describe('DELETE', () => {
  it('removes the object, then the row', async () => {
    const { id, key } = await readySubmission(T_MAIN, tokenA);
    const res = await req('DELETE', `/topics/${T_MAIN}/submissions/${id}`, { token: tokenA });
    expect(res.status).toBe(204);
    expect(await rowExists(id)).toBe(false);
    expect(await env.R2.head(key)).toBeNull();
  });

  it('deletes a pending row whose object never arrived', async () => {
    const res = await presign(T_MAIN, tokenA, presignBody());
    const { submission } = (await res.json()) as Json;
    expect((await req('DELETE', `/topics/${T_MAIN}/submissions/${submission.id}`, { token: tokenA })).status).toBe(204);
    expect(await rowExists(submission.id)).toBe(false);
  });

  it('dismisses a tombstone', async () => {
    const { id } = await readySubmission(T_MAIN, tokenA);
    await env.DB.prepare(
      "UPDATE topic_submissions SET status = 'removed', storage_key = NULL, removed_at = datetime('now'), removed_by = ? WHERE id = ?",
    ).bind(ADMIN, id).run();
    expect((await req('DELETE', `/topics/${T_MAIN}/submissions/${id}`, { token: tokenA })).status).toBe(204);
    expect(await rowExists(id)).toBe(false);
  });

  it('still works on a topic the author lost access to', async () => {
    await env.DB.prepare(
      'INSERT INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)',
    ).bind('enr-lost', STUDENT_A, T_LOST, ADMIN).run();
    const { id } = await readySubmission(T_LOST, tokenA);
    await env.DB.prepare('DELETE FROM enrollments_user WHERE id = ?').bind('enr-lost').run();

    expect((await finalize(T_LOST, id, tokenA)).status).toBe(404);
    expect((await req('DELETE', `/topics/${T_LOST}/submissions/${id}`, { token: tokenA })).status).toBe(204);
  });

  it('answers 502 and keeps the row when R2 fails', async () => {
    const { id, key } = await readySubmission(T_MAIN, tokenA);
    const real = env.R2;
    const failingR2 = {
      head: (k: string) => real.head(k),
      get: (k: string, o?: R2GetOptions) => real.get(k, o),
      put: real.put.bind(real),
      list: real.list.bind(real),
      delete: () => Promise.reject(new Error('R2 is down')),
    };
    const res = await req('DELETE', `/topics/${T_MAIN}/submissions/${id}`, {
      token: tokenA,
      envOverrides: { R2: failingR2 },
    });
    expect(res.status).toBe(502);
    expect(await rowExists(id)).toBe(true);
    expect(await env.R2.head(key)).not.toBeNull();
  });
});

describe('summary', () => {
  it('returns the effective limits, sharing switch, usage and class count', async () => {
    const mine = await readySubmission(T_MAIN, tokenA);
    const shared = await readySubmission(T_MAIN, tokenB);
    await req('PATCH', `/topics/${T_MAIN}/submissions/${shared.id}`, { token: tokenB, body: { visibility: 'shared' } });

    const res = await req('GET', `/topics/${T_MAIN}/submissions/summary`, { token: tokenA });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body).toEqual({
      limits: { perTopicMax: 10, storagePerStudentBytes: 1024 * MB, videoMaxBytes: 250 * MB },
      sharingEnabled: true,
      usage: { topicCount: 1, bytes: FIXTURES.mp4.bytes.byteLength },
      classCount: 1,
    });
    expect(mine.id).toBeTruthy();

    const off = await req('GET', `/topics/${T_MAIN}/submissions/summary`, {
      token: tokenA,
      envOverrides: { SUBMISSIONS_SHARING_ENABLED: 'false', SUBMISSIONS_PER_TOPIC_MAX: '3' },
    });
    expect(await off.json()).toMatchObject({ sharingEnabled: false, classCount: 0, limits: { perTopicMax: 3 } });
  });

  it('gives staff the total', async () => {
    await readySubmission(T_MAIN, tokenA);
    const res = await req('GET', `/topics/${T_MAIN}/submissions/summary`, { token: creatorToken });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).totalCount).toBe(1);
  });

  it.each([T_DRAFT, T_ARCHIVED, T_OUTSIDE])('is 404 on unreadable topic %s', async (topicId) => {
    expect((await req('GET', `/topics/${topicId}/submissions/summary`, { token: tokenA })).status).toBe(404);
  });
});

describe('configuration', () => {
  it('a malformed SUBMISSIONS_* var makes every route answer 500 SUBMISSION_CONFIG_INVALID', async () => {
    const { id } = await presignAndUpload(T_MAIN, tokenA, FIXTURES.mp4);
    for (const bad of [
      { SUBMISSIONS_PER_TOPIC_MAX: 'abc' },
      { SUBMISSIONS_SHARING_ENABLED: 'yes' },
      { SUBMISSIONS_VIDEO_MAX_BYTES: '-1' },
    ]) {
      const calls = [
        presign(T_MAIN, tokenA, presignBody(), bad),
        finalize(T_MAIN, id, tokenA, bad),
        req('PATCH', `/topics/${T_MAIN}/submissions/${id}`, { token: tokenA, body: { title: 'x' }, envOverrides: bad }),
        req('DELETE', `/topics/${T_MAIN}/submissions/${id}`, { token: tokenA, envOverrides: bad }),
        req('GET', `/topics/${T_MAIN}/submissions/summary`, { token: tokenA, envOverrides: bad }),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'SUBMISSION_CONFIG_INVALID' });
      }
    }
    // Nothing was written or deleted by the refused calls.
    expect(await rowExists(id)).toBe(true);
  });
});

describe('course media isolation', () => {
  it('GET /v1/topics/{id} returns the same media before and after students upload', async () => {
    await env.DB.prepare(
      `INSERT INTO media (id, topic_node_id, uploaded_by, storage_key, original_name, type, size_bytes, status)
       VALUES ('sub-course-media', ?, ?, 'topics/course/course.mp4', 'course.mp4', 'video/mp4', 10, 'ready')`,
    ).bind(T_COURSE, ADMIN).run();

    // Presigned GET URLs carry a timestamp; everything else must be byte-identical.
    const media = async () => {
      const res = await req('GET', `/topics/${T_COURSE}`, { token: tokenA });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Json;
      return JSON.stringify(body.media.map((m: Json) => ({ ...m, url: String(m.url).split('?')[0] })));
    };

    const before = await media();
    await readySubmission(T_COURSE, tokenA);
    await readySubmission(T_COURSE, tokenB);
    await presign(T_COURSE, tokenA, presignBody()); // a pending one too
    const after = await media();

    expect(after).toBe(before);
    expect(JSON.parse(before)).toHaveLength(1);
  });
});
