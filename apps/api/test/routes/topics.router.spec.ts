import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';

// ---------------------------------------------------------------------------
// DB bootstrap
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = 'admin-topics-public-test-user';

let adminToken: string;
let studentToken: string;

// Topic IDs populated in beforeAll
let publishedTopicId: string;
let readyMediaStorageKey: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  // User row required by media.uploaded_by FK.
  await env.DB
    .prepare("INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, 'Admin', 'admin@topics-pub.test', 'x')")
    .bind(ADMIN_USER_ID)
    .run();

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });

  [adminToken, studentToken] = await Promise.all([
    adapter.signAccessToken({ sub: ADMIN_USER_ID, email: 'admin@topics-pub.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: ADMIN_USER_ID, email: 'admin@topics-pub.test', roles: ['student'] }),
  ]);

  // Create a published root topic.
  const pubRes = await req('POST', '/admin/topics', {
    token: adminToken,
    body: { title: 'Published Root', status: 'published' },
  });
  const pubTopic = await pubRes.json<{ id: string }>();
  publishedTopicId = pubTopic.id;

  // Create a draft root topic.
  await req('POST', '/admin/topics', {
    token: adminToken,
    body: { title: 'Draft Root' },
  });

  // Create an archived root topic (create as published, then archive).
  const archRes = await req('POST', '/admin/topics', {
    token: adminToken,
    body: { title: 'Archived Root', status: 'published' },
  });
  const archTopic = await archRes.json<{ id: string }>();
  await req('DELETE', `/admin/topics/${archTopic.id}`, { token: adminToken });

  // Seed a published child under publishedTopicId.
  await req('POST', '/admin/topics', {
    token: adminToken,
    body: { title: 'Published Child', status: 'published', parentId: publishedTopicId },
  });

  // Seed a draft child under publishedTopicId (should not appear in public response).
  await req('POST', '/admin/topics', {
    token: adminToken,
    body: { title: 'Draft Child', parentId: publishedTopicId },
  });

  // Seed a ready media item on publishedTopicId.
  const presignRes = await req('POST', `/admin/topics/${publishedTopicId}/media/presign`, {
    token: adminToken,
    body: { fileName: 'lesson.pdf', contentType: 'application/pdf', sizeBytes: 1024 },
  });
  const presignData = await presignRes.json<{ media: { id: string; storageKey: string } }>();
  readyMediaStorageKey = presignData.media.storageKey;

  // Simulate client upload directly into miniflare R2.
  await env.R2.put(readyMediaStorageKey, 'test-pdf-content');

  // Mark the media record as 'ready' directly in the DB. The finalize endpoint
  // relies on objectExists (S3 client) which is unreachable in miniflare's test
  // sandbox. The finalize flow itself is tested in admin-media.controller.spec.ts.
  await env.DB
    .prepare("UPDATE media SET status = 'ready' WHERE storage_key = ?")
    .bind(readyMediaStorageKey)
    .run();

  // Seed a pending (not-finalized) media item — should not appear in public response.
  await req('POST', `/admin/topics/${publishedTopicId}/media/presign`, {
    token: adminToken,
    body: { fileName: 'pending.png', contentType: 'image/png', sizeBytes: 512 },
  });

  // Enroll the student user in the published topic subtree so the
  // access-aware filter (Task 07) allows the student token to see it.
  // Admin tokens bypass the filter, so only the student grant is needed.
  await env.DB
    .prepare('INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), ADMIN_USER_ID, publishedTopicId, ADMIN_USER_ID)
    .run();
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

// ---------------------------------------------------------------------------
// Auth enforcement
// ---------------------------------------------------------------------------

describe('Auth enforcement', () => {
  it('GET /topics -> 401 without token', async () => {
    const res = await req('GET', '/topics');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /topics
// ---------------------------------------------------------------------------

describe('GET /topics', () => {
  it('returns 200 with a data array for an authenticated student', async () => {
    const res = await req('GET', '/topics', { token: studentToken });
    expect(res.status).toBe(200);
    const body = await res.json<{ data: unknown[] }>();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('sets Cache-Control: private, max-age=30', async () => {
    const res = await req('GET', '/topics', { token: studentToken });
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=30');
  });
});

// ---------------------------------------------------------------------------
// GET /topics/:id
// ---------------------------------------------------------------------------

describe('GET /topics/:id', () => {
  it('returns 200 with the published topic', async () => {
    const res = await req('GET', `/topics/${publishedTopicId}`, { token: studentToken });
    expect(res.status).toBe(200);
    const body = await res.json<{ id: string; title: string }>();
    expect(body.id).toBe(publishedTopicId);
    expect(body.title).toBe('Published Root');
  });

  it('includes ready media with a non-empty url', async () => {
    const res = await req('GET', `/topics/${publishedTopicId}`, { token: studentToken });
    const body = await res.json<{ media: { storageKey: string; url: string; status: string }[] }>();
    expect(Array.isArray(body.media)).toBe(true);
    const readyItem = body.media.find(m => m.storageKey === readyMediaStorageKey);
    expect(readyItem).toBeDefined();
    expect(readyItem!.status).toBe('ready');
    expect(typeof readyItem!.url).toBe('string');
    expect(readyItem!.url.length).toBeGreaterThan(0);
  });

  it('sets Cache-Control: private, max-age=30', async () => {
    const res = await req('GET', `/topics/${publishedTopicId}`, { token: studentToken });
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=30');
  });
});
