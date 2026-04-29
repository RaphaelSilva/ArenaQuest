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

let adminToken: string;
let contentCreatorToken: string;
let studentToken: string;

beforeAll(async () => {
  await env.DB.batch(MIGRATION_SQL.map(sql => env.DB.prepare(sql)));

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });

  [adminToken, contentCreatorToken, studentToken] = await Promise.all([
    adapter.signAccessToken({ sub: 'admin-topics-test', email: 'admin@topics.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: 'cc-topics-test', email: 'cc@topics.test', roles: ['content_creator'] }),
    adapter.signAccessToken({ sub: 'student-topics-test', email: 'student@topics.test', roles: ['student'] }),
  ]);
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

async function createTopic(body: Record<string, unknown>, token = adminToken) {
  const res = await req('POST', '/admin/topics', { token, body });
  expect(res.status).toBe(201);
  return res.json<{ id: string; title: string; parentId: string | null; status: string; archived: boolean }>();
}

// ---------------------------------------------------------------------------
// Auth enforcement
// ---------------------------------------------------------------------------

describe('Auth enforcement', () => {
  const endpoints: [string, string][] = [
    ['GET',    '/admin/topics'],
    ['POST',   '/admin/topics'],
    ['GET',    '/admin/topics/some-id'],
    ['PATCH',  '/admin/topics/some-id'],
    ['POST',   '/admin/topics/some-id/move'],
    ['DELETE', '/admin/topics/some-id'],
  ];

  for (const [method, path] of endpoints) {
    it(`${method} ${path} -> 401 without token`, async () => {
      const res = await req(method, path);
      expect(res.status).toBe(401);
    });

    it(`${method} ${path} -> 403 with student token`, async () => {
      const res = await req(method, path, {
        token: studentToken,
        body: method !== 'GET' ? {} : undefined,
      });
      expect(res.status).toBe(403);
    });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/topics — create
// ---------------------------------------------------------------------------

describe('POST /admin/topics', () => {
  it('creates a root node and returns 201', async () => {
    const res = await req('POST', '/admin/topics', {
      token: adminToken,
      body: { title: 'Root Node A' },
    });
    expect(res.status).toBe(201);
    const node = await res.json<{ id: string; title: string; parentId: unknown; status: string }>();
    expect(node.id).toBeTypeOf('string');
    expect(node.title).toBe('Root Node A');
    expect(node.parentId).toBeNull();
    expect(node.status).toBe('draft');
  });

  it('content_creator can create a node', async () => {
    const res = await req('POST', '/admin/topics', {
      token: contentCreatorToken,
      body: { title: 'CC Created Node' },
    });
    expect(res.status).toBe(201);
  });

  it('creates a child node under a valid parent', async () => {
    const parent = await createTopic({ title: 'Parent For Child Test' });
    const res = await req('POST', '/admin/topics', {
      token: adminToken,
      body: { title: 'Child Node', parentId: parent.id },
    });
    expect(res.status).toBe(201);
    const child = await res.json<{ parentId: string }>();
    expect(child.parentId).toBe(parent.id);
  });

  it('returns 404 when parentId does not exist', async () => {
    const res = await req('POST', '/admin/topics', {
      token: adminToken,
      body: { title: 'Orphan', parentId: 'nonexistent-parent-id' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 422 UNKNOWN_PREREQ when prerequisite does not exist', async () => {
    const res = await req('POST', '/admin/topics', {
      token: adminToken,
      body: { title: 'With Bad Prereq', prerequisiteIds: ['does-not-exist'] },
    });
    expect(res.status).toBe(422);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('UNKNOWN_PREREQ');
  });

  it('accepts a valid prerequisite ID', async () => {
    const prereq = await createTopic({ title: 'Prereq Node' });
    const res = await req('POST', '/admin/topics', {
      token: adminToken,
      body: { title: 'Dependent Node', prerequisiteIds: [prereq.id] },
    });
    expect(res.status).toBe(201);
    const node = await res.json<{ prerequisiteIds: string[] }>();
    expect(node.prerequisiteIds).toContain(prereq.id);
  });

  it('sanitizes dangerous markdown content before storage', async () => {
    const res = await req('POST', '/admin/topics', {
      token: adminToken,
      body: { title: 'Sanitize Test', content: 'Safe text <script>alert(1)</script>' },
    });
    expect(res.status).toBe(201);
    const node = await res.json<{ content: string }>();
    expect(node.content).not.toContain('<script>');
    expect(node.content).toContain('Safe text');
  });

  it('returns 400 for missing title', async () => {
    const res = await req('POST', '/admin/topics', {
      token: adminToken,
      body: { content: 'No title' },
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/topics — list all
// ---------------------------------------------------------------------------

describe('GET /admin/topics', () => {
  it('returns flat array in { data: [] } shape', async () => {
    const res = await req('GET', '/admin/topics', { token: adminToken });
    expect(res.status).toBe(200);
    const body = await res.json<{ data: unknown[] }>();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('content_creator can list topics', async () => {
    const res = await req('GET', '/admin/topics', { token: contentCreatorToken });
    expect(res.status).toBe(200);
  });

  it('includes nodes of all statuses', async () => {
    await createTopic({ title: 'Draft List', status: 'draft' });
    await createTopic({ title: 'Published List', status: 'published' });

    const res = await req('GET', '/admin/topics', { token: adminToken });
    const { data } = await res.json<{ data: { status: string }[] }>();
    const statuses = new Set(data.map(n => n.status));
    expect(statuses.has('draft')).toBe(true);
    expect(statuses.has('published')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/topics/:id — single
// ---------------------------------------------------------------------------

describe('GET /admin/topics/:id', () => {
  it('returns the node with a children array', async () => {
    const parent = await createTopic({ title: 'Parent With Children' });
    await createTopic({ title: 'Child Alpha', parentId: parent.id });
    await createTopic({ title: 'Child Beta', parentId: parent.id });

    const res = await req('GET', `/admin/topics/${parent.id}`, { token: adminToken });
    expect(res.status).toBe(200);
    const body = await res.json<{ id: string; children: { title: string }[] }>();
    expect(body.id).toBe(parent.id);
    expect(Array.isArray(body.children)).toBe(true);
    expect(body.children.length).toBe(2);
    const childTitles = body.children.map(c => c.title);
    expect(childTitles).toContain('Child Alpha');
    expect(childTitles).toContain('Child Beta');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await req('GET', '/admin/topics/does-not-exist', { token: adminToken });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /admin/topics/:id — update
// ---------------------------------------------------------------------------

describe('PATCH /admin/topics/:id', () => {
  it('updates the title', async () => {
    const node = await createTopic({ title: 'Original Title' });
    const res = await req('PATCH', `/admin/topics/${node.id}`, {
      token: adminToken,
      body: { title: 'Updated Title' },
    });
    expect(res.status).toBe(200);
    const updated = await res.json<{ title: string }>();
    expect(updated.title).toBe('Updated Title');
  });

  it('PATCH { status: published } is immediately reflected in GET', async () => {
    const node = await createTopic({ title: 'Status Test Node' });

    await req('PATCH', `/admin/topics/${node.id}`, {
      token: adminToken,
      body: { status: 'published' },
    });

    const res = await req('GET', `/admin/topics/${node.id}`, { token: adminToken });
    const fetched = await res.json<{ status: string }>();
    expect(fetched.status).toBe('published');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await req('PATCH', '/admin/topics/does-not-exist', {
      token: adminToken,
      body: { title: 'Ghost' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 422 UNKNOWN_PREREQ when updating with a bad prerequisite', async () => {
    const node = await createTopic({ title: 'Prereq Patch Test' });
    const res = await req('PATCH', `/admin/topics/${node.id}`, {
      token: adminToken,
      body: { prerequisiteIds: ['nonexistent-prereq'] },
    });
    expect(res.status).toBe(422);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('UNKNOWN_PREREQ');
  });

  it('sanitizes dangerous content on update', async () => {
    const node = await createTopic({ title: 'Sanitize Patch' });
    const res = await req('PATCH', `/admin/topics/${node.id}`, {
      token: adminToken,
      body: { content: 'Good text <iframe src="evil.com"></iframe>' },
    });
    expect(res.status).toBe(200);
    const updated = await res.json<{ content: string }>();
    expect(updated.content).not.toContain('<iframe');
    expect(updated.content).toContain('Good text');
  });

  it('returns 400 for invalid status value', async () => {
    const node = await createTopic({ title: 'Bad Status' });
    const res = await req('PATCH', `/admin/topics/${node.id}`, {
      token: adminToken,
      body: { status: 'invalid_status' },
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/topics/:id/move
// ---------------------------------------------------------------------------

describe('POST /admin/topics/:id/move', () => {
  it('moves a node to a new parent', async () => {
    const oldParent = await createTopic({ title: 'Old Parent Move' });
    const newParent = await createTopic({ title: 'New Parent Move' });
    const child = await createTopic({ title: 'Moveable Child', parentId: oldParent.id });

    const res = await req('POST', `/admin/topics/${child.id}/move`, {
      token: adminToken,
      body: { newParentId: newParent.id },
    });
    expect(res.status).toBe(200);
    const moved = await res.json<{ parentId: string }>();
    expect(moved.parentId).toBe(newParent.id);
  });

  it('moves a node to root (newParentId: null)', async () => {
    const parent = await createTopic({ title: 'Move-to-Root Parent' });
    const child = await createTopic({ title: 'Move-to-Root Child', parentId: parent.id });

    const res = await req('POST', `/admin/topics/${child.id}/move`, {
      token: adminToken,
      body: { newParentId: null },
    });
    expect(res.status).toBe(200);
    const moved = await res.json<{ parentId: unknown }>();
    expect(moved.parentId).toBeNull();
  });

  it('returns 409 WOULD_CYCLE when moving a node under itself', async () => {
    const node = await createTopic({ title: 'Self Move' });
    const res = await req('POST', `/admin/topics/${node.id}/move`, {
      token: adminToken,
      body: { newParentId: node.id },
    });
    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('WOULD_CYCLE');
  });

  it('returns 409 WOULD_CYCLE when moving a node under a descendant', async () => {
    const grandparent = await createTopic({ title: 'Cycle GP' });
    const parent = await createTopic({ title: 'Cycle Parent', parentId: grandparent.id });
    const child = await createTopic({ title: 'Cycle Child', parentId: parent.id });

    const res = await req('POST', `/admin/topics/${grandparent.id}/move`, {
      token: adminToken,
      body: { newParentId: child.id },
    });
    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('WOULD_CYCLE');
  });

  it('returns 404 when node does not exist', async () => {
    const res = await req('POST', '/admin/topics/nonexistent/move', {
      token: adminToken,
      body: { newParentId: null },
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when newParentId does not exist', async () => {
    const node = await createTopic({ title: 'Move Bad Parent' });
    const res = await req('POST', `/admin/topics/${node.id}/move`, {
      token: adminToken,
      body: { newParentId: 'nonexistent-parent' },
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /admin/topics/:id — archive
// ---------------------------------------------------------------------------

describe('DELETE /admin/topics/:id', () => {
  it('archives a node and returns 204', async () => {
    const node = await createTopic({ title: 'To Archive' });
    const res = await req('DELETE', `/admin/topics/${node.id}`, { token: adminToken });
    expect(res.status).toBe(204);
  });

  it('archive cascades to all descendants', async () => {
    const root = await createTopic({ title: 'Archive Root' });
    const child = await createTopic({ title: 'Archive Child', parentId: root.id });
    const grandchild = await createTopic({ title: 'Archive Grandchild', parentId: child.id });

    await req('DELETE', `/admin/topics/${root.id}`, { token: adminToken });

    const [rootRes, childRes, grandchildRes] = await Promise.all([
      req('GET', `/admin/topics/${root.id}`, { token: adminToken }),
      req('GET', `/admin/topics/${child.id}`, { token: adminToken }),
      req('GET', `/admin/topics/${grandchild.id}`, { token: adminToken }),
    ]);

    const [rootData, childData, grandchildData] = await Promise.all([
      rootRes.json<{ archived: boolean }>(),
      childRes.json<{ archived: boolean }>(),
      grandchildRes.json<{ archived: boolean }>(),
    ]);

    expect(rootData.archived).toBe(true);
    expect(childData.archived).toBe(true);
    expect(grandchildData.archived).toBe(true);
  });

  it('returns 404 for an unknown node', async () => {
    const res = await req('DELETE', '/admin/topics/does-not-exist', { token: adminToken });
    expect(res.status).toBe(404);
  });
});
