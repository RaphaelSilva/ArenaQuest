import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

let adminToken: string;
let contentCreatorToken: string;

const ADMIN_USER_ID = 'admin-user-for-groups-tests';
const CONTENT_CREATOR_USER_ID = 'cc-user-for-groups-tests';

beforeAll(async () => {
  await applyMigrations(env.DB);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900, pbkdf2Iterations: 1 });

  adminToken = await adapter.signAccessToken({ sub: ADMIN_USER_ID, email: 'admin@example.com', roles: ['admin'] });
  contentCreatorToken = await adapter.signAccessToken({ sub: CONTENT_CREATOR_USER_ID, email: 'cc@example.com', roles: ['content_creator'] });

  // Seed two groups + some members
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO user_groups (id, name, description) VALUES (?, ?, ?)`,
    ).bind('group-alpha', 'Alpha Group', 'First group'),
    env.DB.prepare(
      `INSERT OR IGNORE INTO user_groups (id, name, description) VALUES (?, ?, ?)`,
    ).bind('group-zeta', 'Zeta Group', 'Second group'),
    // Seed a user so the FK on user_group_members is satisfied (if enforced)
    env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, name, email, password_hash, status) VALUES (?, ?, ?, ?, ?)`,
    ).bind('member-user-1', 'Member One', 'member1@example.com', 'hash', 'active'),
    env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, name, email, password_hash, status) VALUES (?, ?, ?, ?, ?)`,
    ).bind('member-user-2', 'Member Two', 'member2@example.com', 'hash', 'active'),
    env.DB.prepare(
      `INSERT OR IGNORE INTO user_group_members (group_id, user_id) VALUES (?, ?)`,
    ).bind('group-alpha', 'member-user-1'),
    env.DB.prepare(
      `INSERT OR IGNORE INTO user_group_members (group_id, user_id) VALUES (?, ?)`,
    ).bind('group-alpha', 'member-user-2'),
    env.DB.prepare(
      `INSERT OR IGNORE INTO user_group_members (group_id, user_id) VALUES (?, ?)`,
    ).bind('group-zeta', 'member-user-1'),
  ]);
});

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function req(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

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

// ---------------------------------------------------------------------------
// Auth guards
// ---------------------------------------------------------------------------

it('requires auth: GET /admin/groups -> 401 without token', async () => {
  const res = await req('GET', '/admin/groups');
  expect(res.status).toBe(401);
});

it('forbids non-admin/non-content_creator: GET /admin/groups -> 403', async () => {
  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900, pbkdf2Iterations: 1 });
  const studentToken = await adapter.signAccessToken({ sub: 'student-x', email: 'student@example.com', roles: ['student'] });
  const res = await req('GET', '/admin/groups', { token: studentToken });
  expect(res.status).toBe(403);
});

// ---------------------------------------------------------------------------
// GET /admin/groups
// ---------------------------------------------------------------------------

describe('GET /admin/groups', () => {
  it('returns 200 with data array for admin token', async () => {
    const res = await req('GET', '/admin/groups', { token: adminToken });
    expect(res.status).toBe(200);
    const body = await res.json<{ data: unknown[] }>();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns 200 with data array for content_creator token', async () => {
    const res = await req('GET', '/admin/groups', { token: contentCreatorToken });
    expect(res.status).toBe(200);
    const body = await res.json<{ data: unknown[] }>();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns groups ordered by name with correct memberCount', async () => {
    const res = await req('GET', '/admin/groups', { token: adminToken });
    expect(res.status).toBe(200);

    type GroupItem = { id: string; name: string; description: string; memberCount: number; createdAt: string };
    const body = await res.json<{ data: GroupItem[] }>();

    const alpha = body.data.find(g => g.id === 'group-alpha');
    const zeta = body.data.find(g => g.id === 'group-zeta');

    expect(alpha).toBeDefined();
    expect(zeta).toBeDefined();

    expect(alpha!.memberCount).toBe(2);
    expect(zeta!.memberCount).toBe(1);

    // Verify alphabetical ordering: Alpha before Zeta
    const alphaIdx = body.data.findIndex(g => g.id === 'group-alpha');
    const zetaIdx = body.data.findIndex(g => g.id === 'group-zeta');
    expect(alphaIdx).toBeLessThan(zetaIdx);
  });

  it('each group record has expected shape', async () => {
    const res = await req('GET', '/admin/groups', { token: adminToken });
    const body = await res.json<{ data: Record<string, unknown>[] }>();

    const group = body.data.find(g => g['id'] === 'group-alpha');
    expect(group).toBeDefined();
    expect(typeof group!['id']).toBe('string');
    expect(typeof group!['name']).toBe('string');
    expect(typeof group!['description']).toBe('string');
    expect(typeof group!['memberCount']).toBe('number');
    expect(typeof group!['createdAt']).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// POST /admin/groups
// ---------------------------------------------------------------------------

describe('POST /admin/groups', () => {
  it('creates a group and returns 201 with the record', async () => {
    const res = await req('POST', '/admin/groups', {
      token: adminToken,
      body: { name: 'Created Group', description: 'made in test' },
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; name: string; description: string; memberCount: number }>();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('Created Group');
    expect(body.description).toBe('made in test');
    expect(body.memberCount).toBe(0);
  });

  it('defaults description to empty string when omitted', async () => {
    const res = await req('POST', '/admin/groups', {
      token: adminToken,
      body: { name: 'No Description Group' },
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ description: string }>();
    expect(body.description).toBe('');
  });

  it('returns 409 when a group with the same name already exists', async () => {
    const res = await req('POST', '/admin/groups', {
      token: adminToken,
      body: { name: 'Alpha Group' },
    });
    expect(res.status).toBe(409);
  });

  it('returns 400 when name is empty', async () => {
    const res = await req('POST', '/admin/groups', {
      token: adminToken,
      body: { name: '' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await req('POST', '/admin/groups', { body: { name: 'X' } });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Group members
// ---------------------------------------------------------------------------

describe('GET /admin/groups/:groupId/members', () => {
  it('returns members for an existing group', async () => {
    const res = await req('GET', '/admin/groups/group-alpha/members', { token: adminToken });
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { userId: string; name: string; email: string }[] }>();
    expect(body.data.length).toBe(2);
    const ids = body.data.map(m => m.userId).sort();
    expect(ids).toEqual(['member-user-1', 'member-user-2']);
  });

  it('returns 404 for a missing group', async () => {
    const res = await req('GET', '/admin/groups/does-not-exist/members', { token: adminToken });
    expect(res.status).toBe(404);
  });
});

describe('POST /admin/groups/:groupId/members', () => {
  it('adds a member and returns 201', async () => {
    const res = await req('POST', '/admin/groups/group-zeta/members', {
      token: adminToken,
      body: { userId: 'member-user-2' },
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ userId: string; name: string; email: string }>();
    expect(body.userId).toBe('member-user-2');

    const list = await req('GET', '/admin/groups/group-zeta/members', { token: adminToken });
    const listBody = await list.json<{ data: { userId: string }[] }>();
    expect(listBody.data.map(m => m.userId)).toContain('member-user-2');
  });

  it('is idempotent: adding an existing member returns 201 without duplicating', async () => {
    await req('POST', '/admin/groups/group-zeta/members', {
      token: adminToken,
      body: { userId: 'member-user-1' },
    });
    const res = await req('POST', '/admin/groups/group-zeta/members', {
      token: adminToken,
      body: { userId: 'member-user-1' },
    });
    expect(res.status).toBe(201);

    const list = await req('GET', '/admin/groups/group-zeta/members', { token: adminToken });
    const listBody = await list.json<{ data: { userId: string }[] }>();
    const count = listBody.data.filter(m => m.userId === 'member-user-1').length;
    expect(count).toBe(1);
  });

  it('returns 404 for a missing group', async () => {
    const res = await req('POST', '/admin/groups/does-not-exist/members', {
      token: adminToken,
      body: { userId: 'member-user-1' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 for a missing user', async () => {
    const res = await req('POST', '/admin/groups/group-alpha/members', {
      token: adminToken,
      body: { userId: 'no-such-user' },
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /admin/groups/:groupId/members/:userId', () => {
  it('removes a member and returns 204', async () => {
    await req('POST', '/admin/groups/group-zeta/members', {
      token: adminToken,
      body: { userId: 'member-user-2' },
    });
    const res = await req('DELETE', '/admin/groups/group-zeta/members/member-user-2', {
      token: adminToken,
    });
    expect(res.status).toBe(204);

    const list = await req('GET', '/admin/groups/group-zeta/members', { token: adminToken });
    const listBody = await list.json<{ data: { userId: string }[] }>();
    expect(listBody.data.map(m => m.userId)).not.toContain('member-user-2');
  });

  it('returns 404 for a missing group', async () => {
    const res = await req('DELETE', '/admin/groups/does-not-exist/members/member-user-1', {
      token: adminToken,
    });
    expect(res.status).toBe(404);
  });
});
