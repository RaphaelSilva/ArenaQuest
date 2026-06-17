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
  options: { token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  const request = new IncomingRequest(`http://example.com${v1(path)}`, {
    method,
    headers,
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
