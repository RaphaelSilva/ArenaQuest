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

// ---------------------------------------------------------------------------
// Tags by name (M24 Task 02)
// ---------------------------------------------------------------------------

type TopicWithTags = { id: string; tags?: { id: string; name: string; slug: string }[] };

async function countRows(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return row!.n;
}

async function getTopic(id: string): Promise<TopicWithTags> {
  const res = await req('GET', `/admin/topics/${id}`, { token: adminToken });
  expect(res.status).toBe(200);
  return res.json<TopicWithTags>();
}

describe('tags on POST / PATCH /admin/topics', () => {
  it('PATCH tags [CHUDAN] links the stored Chūdan tag without renaming it or adding a row', async () => {
    await env.DB
      .prepare("INSERT OR IGNORE INTO tags (id, name, slug) VALUES (?, 'Chūdan', 'chudan')")
      .bind(crypto.randomUUID())
      .run();
    const stored = await env.DB.prepare("SELECT id, name FROM tags WHERE slug = 'chudan'").first<{ id: string; name: string }>();
    const topic = await createTopic({ title: 'Tag CHUDAN Topic' });
    const before = await countRows('SELECT COUNT(*) AS n FROM tags');

    const res = await req('PATCH', `/admin/topics/${topic.id}`, { token: adminToken, body: { tags: ['CHUDAN'] } });
    expect(res.status).toBe(200);

    const after = await countRows('SELECT COUNT(*) AS n FROM tags');
    expect(after).toBe(before);
    const node = await getTopic(topic.id);
    expect(node.tags).toEqual([{ id: stored!.id, name: stored!.name, slug: 'chudan' }]);
    expect(stored!.name).toBe('Chūdan');
  });

  it('POST tags [Soco, soco, " SOCO "] creates exactly one soco tag and one link', async () => {
    const res = await req('POST', '/admin/topics', {
      token: adminToken,
      body: { title: 'Soco Topic', tags: ['Soco', 'soco', ' SOCO '] },
    });
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();

    expect(await countRows("SELECT COUNT(*) AS n FROM tags WHERE slug = 'soco'")).toBe(1);
    expect(await countRows('SELECT COUNT(*) AS n FROM topic_node_tags WHERE topic_node_id = ?', id)).toBe(1);
    const node = await getTopic(id);
    expect(node.tags?.map(t => [t.name, t.slug])).toEqual([['Soco', 'soco']]);
  });

  it('content_creator can tag a topic by name', async () => {
    const res = await req('POST', '/admin/topics', {
      token: contentCreatorToken,
      body: { title: 'CC Tagged', tags: ['Kata'] },
    });
    expect(res.status).toBe(201);
  });

  it.each([
    ['a name with no usable characters', ['!!!']],
    ['a 41-character name', ['x'.repeat(41)]],
    ['21 names', Array.from({ length: 21 }, (_, i) => `tag ${i}`)],
    ['an empty name', ['   ']],
  ])('returns 400 for %s', async (_label, tags) => {
    const res = await req('POST', '/admin/topics', { token: adminToken, body: { title: 'Bad Tags', tags } });
    expect(res.status).toBe(400);
  });

  it('returns 400 when tags and tagIds are sent together', async () => {
    const topic = await createTopic({ title: 'Both Fields' });
    const res = await req('PATCH', `/admin/topics/${topic.id}`, {
      token: adminToken,
      body: { tags: ['x'], tagIds: [] },
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ detail?: string }>();
    expect(body.detail).toContain('tagIds');
  });

  it('unknown tagIds -> 422 UNKNOWN_TAG with the id in detail, topic_node_tags unchanged', async () => {
    const topic = await createTopic({ title: 'Unknown TagId Topic', tags: ['Keep Me'] });
    const linksBefore = await countRows('SELECT COUNT(*) AS n FROM topic_node_tags');
    const ghost = crypto.randomUUID();

    const res = await req('PATCH', `/admin/topics/${topic.id}`, { token: adminToken, body: { tagIds: [ghost] } });
    expect(res.status).toBe(422);
    const body = await res.json<{ error: string; detail: string }>();
    expect(body.error).toBe('UNKNOWN_TAG');
    expect(body.detail).toContain(ghost);

    expect(await countRows('SELECT COUNT(*) AS n FROM topic_node_tags')).toBe(linksBefore);
    expect((await getTopic(topic.id)).tags?.map(t => t.slug)).toEqual(['keep-me']);

    const postRes = await req('POST', '/admin/topics', { token: adminToken, body: { title: 'Ghost', tagIds: [ghost] } });
    expect(postRes.status).toBe(422);
    expect(await countRows("SELECT COUNT(*) AS n FROM topic_nodes WHERE title = 'Ghost'")).toBe(0);
  });

  it('PATCH tags [] removes every link; PATCH without tags keeps them', async () => {
    const topic = await createTopic({ title: 'Clear Tags Topic', tags: ['One', 'Two'] });
    expect((await getTopic(topic.id)).tags).toHaveLength(2);

    const keep = await req('PATCH', `/admin/topics/${topic.id}`, { token: adminToken, body: { title: 'Still Tagged' } });
    expect(keep.status).toBe(200);
    expect((await getTopic(topic.id)).tags).toHaveLength(2);

    const clear = await req('PATCH', `/admin/topics/${topic.id}`, { token: adminToken, body: { tags: [] } });
    expect(clear.status).toBe(200);
    expect((await getTopic(topic.id)).tags ?? []).toHaveLength(0);
    expect(await countRows('SELECT COUNT(*) AS n FROM topic_node_tags WHERE topic_node_id = ?', topic.id)).toBe(0);
  });
});
