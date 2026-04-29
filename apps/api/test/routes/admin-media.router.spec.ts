import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';

// ---------------------------------------------------------------------------
// DB bootstrap
// ---------------------------------------------------------------------------

const MIGRATION_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
    id            TEXT NOT NULL PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS roles (
    id          TEXT NOT NULL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
  )`,
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    token      TEXT NOT NULL PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO roles (id, name, description) VALUES
    ('bace0701-15e3-5144-97c5-47487d543032', 'admin',           'Full platform access'),
    ('3318927d-8b5e-52d9-a145-2e4323919ed6', 'content_creator', 'Can create/edit content'),
    ('32a5cab1-e66f-5d23-a80d-80cfa927d057', 'tutor',           'Can monitor student progress'),
    ('bf3d0f1d-7d77-5151-922e-b87dff0fa7ad', 'student',         'Can consume content and tasks')`,
  `CREATE TABLE IF NOT EXISTS topic_nodes (
    id                TEXT    NOT NULL PRIMARY KEY,
    parent_id         TEXT    REFERENCES topic_nodes(id) ON DELETE RESTRICT,
    title             TEXT    NOT NULL,
    content           TEXT    NOT NULL DEFAULT '',
    status            TEXT    NOT NULL DEFAULT 'draft',
    sort_order        INTEGER NOT NULL DEFAULT 0,
    estimated_minutes INTEGER NOT NULL DEFAULT 0,
    archived          INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    id         TEXT NOT NULL PRIMARY KEY,
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS topic_node_tags (
    topic_node_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
    tag_id        TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (topic_node_id, tag_id)
  )`,
  `CREATE TABLE IF NOT EXISTS topic_node_prerequisites (
    topic_node_id   TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
    prerequisite_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
    PRIMARY KEY (topic_node_id, prerequisite_id)
  )`,
  `CREATE TABLE IF NOT EXISTS media (
    id            TEXT NOT NULL PRIMARY KEY,
    topic_node_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
    storage_key   TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    type          TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'pending',
    uploaded_by   TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

const ADMIN_USER_ID = 'admin-media-test-user';
const STUDENT_USER_ID = 'student-media-test-user';

let adminToken: string;
let contentCreatorToken: string;
let studentToken: string;
let testTopicId: string;

beforeAll(async () => {
  await env.DB.batch(MIGRATION_SQL.map(sql => env.DB.prepare(sql)));

  // The media table's uploaded_by FK references users(id), so we need a real row.
  await env.DB
    .prepare("INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, 'Admin', 'admin@media.test', 'x')")
    .bind(ADMIN_USER_ID)
    .run();

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });

  [adminToken, contentCreatorToken, studentToken] = await Promise.all([
    adapter.signAccessToken({ sub: ADMIN_USER_ID, email: 'admin@media.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: ADMIN_USER_ID, email: 'admin@media.test', roles: ['content_creator'] }),
    adapter.signAccessToken({ sub: STUDENT_USER_ID, email: 'student@media.test', roles: ['student'] }),
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

  const request = new IncomingRequest(`http://example.com${path}`, {
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

// ---------------------------------------------------------------------------
// Auth enforcement
// ---------------------------------------------------------------------------

describe('Auth enforcement', () => {
  const topicId = 'some-topic';
  const mediaId = 'some-media';
  const endpoints: [string, string][] = [
    ['POST',   `/admin/topics/${topicId}/media/presign`],
    ['POST',   `/admin/topics/${topicId}/media/${mediaId}/finalize`],
    ['DELETE', `/admin/topics/${topicId}/media/${mediaId}`],
  ];

  for (const [method, path] of endpoints) {
    it(`${method} ${path} -> 401 without token`, async () => {
      const res = await req(method, path);
      expect(res.status).toBe(401);
    });

    it(`${method} ${path} -> 403 with student token`, async () => {
      const res = await req(method, path, { token: studentToken, body: method !== 'GET' ? {} : undefined });
      expect(res.status).toBe(403);
    });
  }
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

  it('storage key follows the topics/{topicId}/{mediaId}-{safeName} pattern', async () => {
    const { data } = await presign(testTopicId, {
      fileName: 'My Document.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1_000_000,
    });

    expect(data!.media.storageKey).toMatch(
      new RegExp(`^topics/${testTopicId}/[\\w-]+-my-document\\.pdf$`),
    );
  });

  it('content_creator can request a presigned URL', async () => {
    const { res } = await presign(testTopicId, {
      fileName: 'slide.png',
      contentType: 'image/png',
      sizeBytes: 500_000,
    }, contentCreatorToken);
    expect(res.status).toBe(201);
  });

  it('returns 404 when topic does not exist', async () => {
    const { res } = await presign('nonexistent-topic', {
      fileName: 'file.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1_000,
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for unsupported content type', async () => {
    const { res } = await presign(testTopicId, {
      fileName: 'doc.docx',
      contentType: 'application/msword',
      sizeBytes: 1_000,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing fileName', async () => {
    const { res } = await presign(testTopicId, {
      contentType: 'video/mp4',
      sizeBytes: 1_000,
    });
    expect(res.status).toBe(400);
  });

  it('returns 422 FileTooLarge for PDF exceeding 25 MB', async () => {
    const { res } = await presign(testTopicId, {
      fileName: 'huge.pdf',
      contentType: 'application/pdf',
      sizeBytes: 26 * 1024 * 1024,
    });
    expect(res.status).toBe(422);
    const body = await res.json<{ error: string; maxBytes: number }>();
    expect(body.error).toBe('FileTooLarge');
    expect(body.maxBytes).toBe(25 * 1024 * 1024);
  });

  it('returns 422 FileTooLarge for MP4 exceeding 100 MB', async () => {
    const { res } = await presign(testTopicId, {
      fileName: 'huge.mp4',
      contentType: 'video/mp4',
      sizeBytes: 101 * 1024 * 1024,
    });
    expect(res.status).toBe(422);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('FileTooLarge');
  });

  it('returns 422 FileTooLarge for image exceeding 5 MB', async () => {
    const { res } = await presign(testTopicId, {
      fileName: 'big.jpeg',
      contentType: 'image/jpeg',
      sizeBytes: 6 * 1024 * 1024,
    });
    expect(res.status).toBe(422);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('FileTooLarge');
  });

  it('accepts a file at exactly the size limit boundary', async () => {
    const { res } = await presign(testTopicId, {
      fileName: 'limit.pdf',
      contentType: 'application/pdf',
      sizeBytes: 25 * 1024 * 1024,
    });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/topics/:topicId/media/:mediaId/finalize
// ---------------------------------------------------------------------------

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

    // 3. Finalize.
    const res = await req('POST', `/admin/topics/${testTopicId}/media/${mediaId}/finalize`, {
      token: adminToken,
    });
    expect(res.status).toBe(200);
    const updated = await res.json<{ id: string; status: string }>();
    expect(updated.id).toBe(mediaId);
    expect(updated.status).toBe('ready');
  });

  it('finalize is idempotent — second call returns 200 without error', async () => {
    const { data: presignData } = await presign(testTopicId, {
      fileName: 'repeat.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1_000_000,
    });
    const { id: mediaId, storageKey } = presignData!.media;
    await env.R2.put(storageKey, new ArrayBuffer(4));

    // First finalize
    await req('POST', `/admin/topics/${testTopicId}/media/${mediaId}/finalize`, { token: adminToken });

    // Second finalize — must succeed with 200
    const res2 = await req('POST', `/admin/topics/${testTopicId}/media/${mediaId}/finalize`, { token: adminToken });
    expect(res2.status).toBe(200);
    const body = await res2.json<{ status: string }>();
    expect(body.status).toBe('ready');
  });

  it('returns 422 NotUploaded when object is not in R2 yet', async () => {
    const { data: presignData } = await presign(testTopicId, {
      fileName: 'not-uploaded.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100_000,
    });
    const { id: mediaId } = presignData!.media;

    // Do NOT put anything in R2.
    const res = await req('POST', `/admin/topics/${testTopicId}/media/${mediaId}/finalize`, {
      token: adminToken,
    });
    expect(res.status).toBe(422);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('NotUploaded');
  });

  it('returns 404 for an unknown mediaId', async () => {
    const res = await req('POST', `/admin/topics/${testTopicId}/media/nonexistent-id/finalize`, {
      token: adminToken,
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when mediaId belongs to a different topic', async () => {
    // Create media under testTopicId.
    const { data: presignData } = await presign(testTopicId, {
      fileName: 'cross.pdf',
      contentType: 'application/pdf',
      sizeBytes: 50_000,
    });
    const { id: mediaId } = presignData!.media;

    // Attempt to finalize under a different (nonexistent) topicId.
    const res = await req('POST', `/admin/topics/wrong-topic-id/media/${mediaId}/finalize`, {
      token: adminToken,
    });
    expect(res.status).toBe(404);
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

  it('returns 204 even when the R2 object no longer exists (best-effort deletion)', async () => {
    const { data: presignData } = await presign(testTopicId, {
      fileName: 'ghost.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10_000,
    });
    const { id: mediaId } = presignData!.media;
    // Intentionally do NOT put anything in R2.

    const res = await req('DELETE', `/admin/topics/${testTopicId}/media/${mediaId}`, {
      token: adminToken,
    });
    expect(res.status).toBe(204);
  });

  it('returns 404 for an unknown mediaId', async () => {
    const res = await req('DELETE', `/admin/topics/${testTopicId}/media/does-not-exist`, {
      token: adminToken,
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when mediaId belongs to a different topic', async () => {
    const { data: presignData } = await presign(testTopicId, {
      fileName: 'cross-delete.pdf',
      contentType: 'application/pdf',
      sizeBytes: 5_000,
    });
    const { id: mediaId } = presignData!.media;

    const res = await req('DELETE', `/admin/topics/wrong-topic/media/${mediaId}`, {
      token: adminToken,
    });
    expect(res.status).toBe(404);
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

    // Step 3: Finalize
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
