import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

let adminToken: string;
let contentCreatorToken: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });

  [adminToken, contentCreatorToken] = await Promise.all([
    adapter.signAccessToken({ sub: 'admin-topics-test', email: 'admin@topics.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: 'cc-topics-test', email: 'cc@topics.test', roles: ['content_creator'] }),
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

async function createTopic(body: Record<string, unknown>, token = adminToken) {
  const res = await req('POST', '/admin/topics', { token, body });
  expect(res.status).toBe(201);
  return res.json<{ id: string; title: string; parentId: string | null; status: string; archived: boolean }>();
}

it('requires admin: GET /admin/topics -> 401 without token', async () => {
  const res = await req('GET', '/admin/topics');
  expect(res.status).toBe(401);
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
});
