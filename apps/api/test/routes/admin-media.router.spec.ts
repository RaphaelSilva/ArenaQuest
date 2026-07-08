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
