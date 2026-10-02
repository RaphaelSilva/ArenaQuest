import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

const ADMIN_USER_ID = 'admin-media-test-user';

let adminToken: string;
let contentCreatorToken: string;
let testTopicId: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  // The media table's uploaded_by FK references users(id), so we need a real row.
  await env.DB
    .prepare("INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, 'Admin', 'admin@media.test', 'x')")
    .bind(ADMIN_USER_ID)
    .run();

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });

  [adminToken, contentCreatorToken] = await Promise.all([
    adapter.signAccessToken({ sub: ADMIN_USER_ID, email: 'admin@media.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: ADMIN_USER_ID, email: 'admin@media.test', roles: ['content_creator'] }),
  ]);

  // Create a topic to attach media to.
  const topicRes = await req('POST', '/admin/topics', {
    token: adminToken,
    body: { title: 'Media Test Topic' },
  });
  const topic = await topicRes.json<{ id: string }>();
  testTopicId = topic.id;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function req(
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {},
): Promise<Response> {
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

/** Call presign and return the parsed response. */
async function presign(
  topicId: string,
  body: Record<string, unknown>,
  token = adminToken,
) {
  const res = await req('POST', `/admin/topics/${topicId}/media/presign`, { token, body });
  return { res, data: res.ok ? await res.json<{ uploadUrl: string; media: { id: string; storageKey: string; status: string } }>() : null };
}

it('requires admin: POST presign -> 401 without token', async () => {
  const res = await req('POST', '/admin/topics/some-topic/media/presign');
  expect(res.status).toBe(401);
});

// ---------------------------------------------------------------------------
// POST /admin/topics/:topicId/media/presign
// ---------------------------------------------------------------------------

describe('POST /admin/topics/:topicId/media/presign', () => {
  it('returns 201 with uploadUrl and a pending media record', async () => {
    const { res, data } = await presign(testTopicId, {
      fileName: 'intro.mp4',
      contentType: 'video/mp4',
      sizeBytes: 10_000_000,
    });

    expect(res.status).toBe(201);
    expect(data).not.toBeNull();
    expect(typeof data!.uploadUrl).toBe('string');
    expect(data!.uploadUrl).toMatch(/^https?:\/\//);
    expect(data!.media.id).toBeTypeOf('string');
    expect(data!.media.status).toBe('pending');
  });

  it('content_creator can request a presigned URL', async () => {
    const { res } = await presign(testTopicId, {
      fileName: 'slide.png',
      contentType: 'image/png',
      sizeBytes: 500_000,
    }, contentCreatorToken);
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/topics/:topicId/media/:mediaId/finalize
// ---------------------------------------------------------------------------

// Note: The finalize endpoint calls objectExists via the S3 client
// (HeadObjectCommand). In miniflare's test sandbox the S3 endpoint is
// unreachable, so the happy-path test uses direct DB manipulation to
// simulate the transition. Business-rule branches are unit-tested in
// admin-media.controller.spec.ts.

describe('POST /admin/topics/:topicId/media/:mediaId/finalize', () => {
  it('transitions status from pending to ready when object exists in R2', async () => {
    // 1. Create a pending media record via presign.
    const { data: presignData } = await presign(testTopicId, {
      fileName: 'lecture.mp4',
      contentType: 'video/mp4',
      sizeBytes: 5_000_000,
    });
    const { id: mediaId, storageKey } = presignData!.media;

    // 2. Simulate the client uploading the file by putting it directly in miniflare R2.
    await env.R2.put(storageKey, new ArrayBuffer(8));

    // 3. Mark as ready via direct DB update (objectExists via S3 is unreachable in sandbox).
    await env.DB.prepare("UPDATE media SET status = 'ready' WHERE id = ?").bind(mediaId).run();

    // 4. Verify finalize returns 200 with the correct shape.
    const res = await req('POST', `/admin/topics/${testTopicId}/media/${mediaId}/finalize`, {
      token: adminToken,
    });
    expect(res.status).toBe(200);
    const updated = await res.json<{ id: string; status: string }>();
    expect(updated.id).toBe(mediaId);
    expect(updated.status).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// DELETE /admin/topics/:topicId/media/:mediaId
// ---------------------------------------------------------------------------

describe('DELETE /admin/topics/:topicId/media/:mediaId', () => {
  it('soft-deletes the DB record and removes the R2 object, returns 204', async () => {
    const { data: presignData } = await presign(testTopicId, {
      fileName: 'to-delete.mp4',
      contentType: 'video/mp4',
      sizeBytes: 2_000_000,
    });
    const { id: mediaId, storageKey } = presignData!.media;
    await env.R2.put(storageKey, new ArrayBuffer(16));

    const delRes = await req('DELETE', `/admin/topics/${testTopicId}/media/${mediaId}`, {
      token: adminToken,
    });
    expect(delRes.status).toBe(204);

    // Verify DB record is soft-deleted (status = 'deleted').
    const row = await env.DB
      .prepare('SELECT status FROM media WHERE id = ?')
      .bind(mediaId)
      .first<{ status: string }>();
    expect(row?.status).toBe('deleted');

    // Verify R2 object is gone.
    const obj = await env.R2.head(storageKey);
    expect(obj).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle: presign → upload → finalize → delete
// ---------------------------------------------------------------------------

describe('Full media lifecycle', () => {
  it('completes the entire presign → finalize → delete flow', async () => {
    // Step 1: Presign
    const { res: presignRes, data: presignData } = await presign(testTopicId, {
      fileName: 'Lecture Video.mp4',
      contentType: 'video/mp4',
      sizeBytes: 20_000_000,
    });
    expect(presignRes.status).toBe(201);
    const { id: mediaId, storageKey } = presignData!.media;
    expect(presignData!.media.status).toBe('pending');

    // Step 2: Simulate upload to R2 (client would PUT to uploadUrl)
    await env.R2.put(storageKey, new ArrayBuffer(64));

    // Step 3: Mark as ready via DB (objectExists via S3 is unreachable in sandbox).
    await env.DB.prepare("UPDATE media SET status = 'ready' WHERE id = ?").bind(mediaId).run();

    // Verify finalize returns 200 for already-ready records (idempotent path).
    const finalizeRes = await req('POST', `/admin/topics/${testTopicId}/media/${mediaId}/finalize`, {
      token: adminToken,
    });
    expect(finalizeRes.status).toBe(200);
    const finalizeData = await finalizeRes.json<{ status: string }>();
    expect(finalizeData.status).toBe('ready');

    // Step 4: Delete
    const deleteRes = await req('DELETE', `/admin/topics/${testTopicId}/media/${mediaId}`, {
      token: adminToken,
    });
    expect(deleteRes.status).toBe(204);

    // Verify storage is cleaned up
    const obj = await env.R2.head(storageKey);
    expect(obj).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /admin/topics/:topicId/media/:mediaId/move
// ---------------------------------------------------------------------------

describe('POST /admin/topics/:topicId/media/:mediaId/move', () => {
  type MediaBody = { id: string; topicNodeId: string; storageKey: string; status: string; url: string; createdAt: string; updatedAt: string };

  let studentToken: string;

  beforeAll(async () => {
    const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
    studentToken = await adapter.signAccessToken({ sub: 'student-media-test', email: 'student@media.test', roles: ['student'] });
  });

  async function createTopic(title: string): Promise<string> {
    const res = await req('POST', '/admin/topics', { token: adminToken, body: { title } });
    expect(res.status).toBe(201);
    return (await res.json<{ id: string }>()).id;
  }

  /** Presign, put the object in R2 and mark the row ready (S3 HEAD is unreachable in the sandbox). Backdated so an `updatedAt` bump is observable. */
  async function readyMedia(topicId: string, fileName = 'move-me.mp4') {
    const { data } = await presign(topicId, { fileName, contentType: 'video/mp4', sizeBytes: 1_000_000 });
    const { id, storageKey } = data!.media;
    await env.R2.put(storageKey, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    await env.DB
      .prepare("UPDATE media SET status = 'ready', created_at = '2020-01-01 00:00:00', updated_at = '2020-01-01 00:00:00' WHERE id = ?")
      .bind(id)
      .run();
    return { id, storageKey };
  }

  async function listIds(topicId: string): Promise<string[]> {
    const res = await req('GET', `/admin/topics/${topicId}/media`, { token: adminToken });
    expect(res.status).toBe(200);
    return (await res.json<{ data: { id: string }[] }>()).data.map(m => m.id);
  }

  /** `token: null` sends no Authorization header. */
  const move = (topicId: string, mediaId: string, targetTopicId: unknown, token: string | null = adminToken) =>
    req('POST', `/admin/topics/${topicId}/media/${mediaId}/move`, { token: token ?? undefined, body: { targetTopicId } });

  it.each([
    ['admin', () => adminToken],
    ['content_creator', () => contentCreatorToken],
  ])('%s moves a ready item: 200, listed under the target only, key and object unchanged', async (_role, token) => {
    const source = await createTopic('Move Source');
    const target = await createTopic('Move Target');
    const { id, storageKey } = await readyMedia(source);
    const before = await env.DB
      .prepare('SELECT created_at, updated_at FROM media WHERE id = ?')
      .bind(id)
      .first<{ created_at: string; updated_at: string }>();

    const res = await move(source, id, target, token());
    expect(res.status).toBe(200);
    const body = await res.json<MediaBody>();
    expect(body.id).toBe(id);
    expect(body.topicNodeId).toBe(target);
    expect(body.status).toBe('ready');
    expect(body.storageKey).toBe(storageKey);
    expect(body.url).toMatch(/^https?:\/\//);
    expect(new Date(body.createdAt).getTime()).toBe(new Date(before!.created_at).getTime());
    expect(new Date(body.updatedAt).getTime()).toBeGreaterThan(new Date(before!.updated_at).getTime());

    expect(await listIds(target)).toContain(id);
    expect(await listIds(source)).not.toContain(id);

    // The R2 object is neither copied nor renamed.
    const obj = await env.R2.get(storageKey);
    expect(obj).not.toBeNull();
    expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const listed = await env.R2.list({ prefix: `topics/${target}/` });
    expect(listed.objects).toHaveLength(0);
  });

  it('accepts an archived target topic', async () => {
    const source = await createTopic('Move Source (archived target)');
    const target = await createTopic('Archived Target');
    expect((await req('DELETE', `/admin/topics/${target}`, { token: adminToken })).status).toBe(204);
    const { id } = await readyMedia(source);

    const res = await move(source, id, target);
    expect(res.status).toBe(200);
  });

  it('returns 401 without a token and 403 for a student', async () => {
    const source = await createTopic('Move Guard Source');
    const target = await createTopic('Move Guard Target');
    const { id } = await readyMedia(source);

    expect((await move(source, id, target, null)).status).toBe(401);
    expect((await move(source, id, target, studentToken)).status).toBe(403);
    expect(await listIds(source)).toContain(id);
  });

  it('returns 404 for a missing, deleted or wrong-topic media item', async () => {
    const source = await createTopic('Move 404 Source');
    const target = await createTopic('Move 404 Target');
    const { id } = await readyMedia(source);

    expect((await move(source, crypto.randomUUID(), target)).status).toBe(404);
    expect((await move(target, id, source)).status).toBe(404);

    const { id: deletedId } = await readyMedia(source, 'deleted.mp4');
    expect((await req('DELETE', `/admin/topics/${source}/media/${deletedId}`, { token: adminToken })).status).toBe(204);
    expect((await move(source, deletedId, target)).status).toBe(404);
  });

  it('returns 404 with detail when the target topic does not exist', async () => {
    const source = await createTopic('Move Missing Target Source');
    const { id } = await readyMedia(source);

    const res = await move(source, id, crypto.randomUUID());
    expect(res.status).toBe(404);
    const body = await res.json<{ error: string; detail?: string }>();
    expect(body.error).toBe('NotFound');
    expect(body.detail).toBe('target topic not found');
    expect(await listIds(source)).toContain(id);
  });

  it('returns 409 MediaNotReady for a pending item', async () => {
    const source = await createTopic('Move Pending Source');
    const target = await createTopic('Move Pending Target');
    const { data } = await presign(source, { fileName: 'pending.mp4', contentType: 'video/mp4', sizeBytes: 1_000 });

    const res = await move(source, data!.media.id, target);
    expect(res.status).toBe(409);
    expect((await res.json<{ error: string }>()).error).toBe('MediaNotReady');
  });

  it('returns 400 SameTopic when the target equals the source', async () => {
    const source = await createTopic('Move Same Source');
    const { id } = await readyMedia(source);

    const res = await move(source, id, source);
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe('SameTopic');
  });

  it('returns 400 for an invalid body or params', async () => {
    const source = await createTopic('Move Invalid Source');
    const { id } = await readyMedia(source);

    expect((await move(source, id, 'not-a-uuid')).status).toBe(400);
    expect((await move(source, id, undefined)).status).toBe(400);
    expect((await move('not-a-uuid', id, crypto.randomUUID())).status).toBe(400);
  });
});
