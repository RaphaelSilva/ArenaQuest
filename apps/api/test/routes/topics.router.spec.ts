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

const ADMIN_USER_ID = 'admin-topics-public-test-user';

let adminToken: string;
let studentToken: string;

// Topic IDs populated in beforeAll
let publishedTopicId: string;
let draftTopicId: string;
let archivedTopicId: string;
let readyMediaStorageKey: string;

beforeAll(async () => {
  await env.DB.batch(MIGRATION_SQL.map(sql => env.DB.prepare(sql)));

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
  const draftRes = await req('POST', '/admin/topics', {
    token: adminToken,
    body: { title: 'Draft Root' },
  });
  const draftTopic = await draftRes.json<{ id: string }>();
  draftTopicId = draftTopic.id;

  // Create an archived root topic (create as published, then archive).
  const archRes = await req('POST', '/admin/topics', {
    token: adminToken,
    body: { title: 'Archived Root', status: 'published' },
  });
  const archTopic = await archRes.json<{ id: string }>();
  archivedTopicId = archTopic.id;
  await req('DELETE', `/admin/topics/${archivedTopicId}`, { token: adminToken });

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

  // Finalize the media record.
  await req('POST', `/admin/topics/${publishedTopicId}/media/${presignData.media.id}/finalize`, {
    token: adminToken,
  });

  // Seed a pending (not-finalized) media item — should not appear in public response.
  await req('POST', `/admin/topics/${publishedTopicId}/media/presign`, {
    token: adminToken,
    body: { fileName: 'pending.png', contentType: 'image/png', sizeBytes: 512 },
  });
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

  it('GET /topics/:id -> 401 without token', async () => {
    const res = await req('GET', `/topics/${publishedTopicId}`);
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

  it('includes the published root node', async () => {
    const res = await req('GET', '/topics', { token: studentToken });
    const { data } = await res.json<{ data: { id: string }[] }>();
    expect(data.some(n => n.id === publishedTopicId)).toBe(true);
  });

  it('excludes draft nodes', async () => {
    const res = await req('GET', '/topics', { token: studentToken });
    const { data } = await res.json<{ data: { id: string }[] }>();
    expect(data.some(n => n.id === draftTopicId)).toBe(false);
  });

  it('excludes archived nodes', async () => {
    const res = await req('GET', '/topics', { token: studentToken });
    const { data } = await res.json<{ data: { id: string }[] }>();
    expect(data.some(n => n.id === archivedTopicId)).toBe(false);
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

  it('returns 404 for a draft topic', async () => {
    const res = await req('GET', `/topics/${draftTopicId}`, { token: studentToken });
    expect(res.status).toBe(404);
  });

  it('returns 404 for an archived topic', async () => {
    const res = await req('GET', `/topics/${archivedTopicId}`, { token: studentToken });
    expect(res.status).toBe(404);
  });

  it('returns 404 for a non-existent id', async () => {
    const res = await req('GET', '/topics/does-not-exist', { token: studentToken });
    expect(res.status).toBe(404);
  });

  it('includes published children but not draft children', async () => {
    const res = await req('GET', `/topics/${publishedTopicId}`, { token: studentToken });
    const body = await res.json<{ children: { title: string }[] }>();
    const titles = body.children.map(c => c.title);
    expect(titles).toContain('Published Child');
    expect(titles).not.toContain('Draft Child');
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

  it('excludes pending media from the response', async () => {
    const res = await req('GET', `/topics/${publishedTopicId}`, { token: studentToken });
    const body = await res.json<{ media: { status: string }[] }>();
    expect(body.media.every(m => m.status === 'ready')).toBe(true);
  });

  it('sets Cache-Control: private, max-age=30', async () => {
    const res = await req('GET', `/topics/${publishedTopicId}`, { token: studentToken });
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=30');
  });
});
