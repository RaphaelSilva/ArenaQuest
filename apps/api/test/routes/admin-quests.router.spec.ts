import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { JwtAuthAdapter } from '@api/adapters/auth';
import type { QuestDefinition } from '@arenaquest/shared/domain/quest';

// ---------------------------------------------------------------------------
// DB bootstrap
// ---------------------------------------------------------------------------

let adminToken: string;
let contentCreatorToken: string;
let studentToken: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });

  [adminToken, contentCreatorToken, studentToken] = await Promise.all([
    adapter.signAccessToken({ sub: 'admin-quests-test', email: 'admin@quests.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: 'cc-quests-test', email: 'cc@quests.test', roles: ['content_creator'] }),
    adapter.signAccessToken({ sub: 'student-quests-test', email: 'student@quests.test', roles: ['student'] }),
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

const validBody = {
  kind: 'daily' as const,
  title: 'Daily Login',
  description: 'Log in today.',
  predicateKind: 'login_count',
  predicateParams: '{"count":1}',
  xpReward: 50,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Admin Quests CRUD', () => {
  it('GET /admin/quests -> 401 without token', async () => {
    const res = await req('GET', '/admin/quests');
    expect(res.status).toBe(401);
  });

  it('CRUD round-trip', async () => {
    // Create
    const createRes = await req('POST', '/admin/quests', { token: adminToken, body: validBody });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json<{ data: QuestDefinition }>()).data;
    expect(created.id).toBeDefined();
    expect(created.title).toBe('Daily Login');
    expect(created.xpReward).toBe(50);
    expect(created.active).toBe(true);

    // List
    const listRes = await req('GET', '/admin/quests', { token: adminToken });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json<{ data: QuestDefinition[] }>()).data;
    expect(list.some(q => q.id === created.id)).toBe(true);

    // Update
    const updateRes = await req('PATCH', `/admin/quests/${created.id}`, {
      token: adminToken,
      body: { title: 'Renamed Quest', xpReward: 100 },
    });
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json<{ data: QuestDefinition }>()).data;
    expect(updated.title).toBe('Renamed Quest');
    expect(updated.xpReward).toBe(100);

    // Delete (hard)
    const deleteRes = await req('DELETE', `/admin/quests/${created.id}`, { token: adminToken });
    expect(deleteRes.status).toBe(200);

    const afterList = (await (await req('GET', '/admin/quests', { token: adminToken })).json<{ data: QuestDefinition[] }>()).data;
    expect(afterList.some(q => q.id === created.id)).toBe(false);
  });

  it('POST /admin/quests -> 400 on bad kind', async () => {
    const res = await req('POST', '/admin/quests', {
      token: adminToken,
      body: { ...validBody, kind: 'monthly' },
    });
    expect(res.status).toBe(400);
  });

  it('POST /admin/quests -> 400 on unparseable predicateParams', async () => {
    const res = await req('POST', '/admin/quests', {
      token: adminToken,
      body: { ...validBody, predicateParams: 'not-json{' },
    });
    expect(res.status).toBe(400);
  });

  it('POST /admin/quests -> 400 on negative xpReward', async () => {
    const res = await req('POST', '/admin/quests', {
      token: adminToken,
      body: { ...validBody, xpReward: -5 },
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /admin/quests/:id -> 404 on unknown id', async () => {
    const res = await req('PATCH', '/admin/quests/00000000-0000-0000-0000-000000000000', {
      token: adminToken,
      body: { title: 'Nope' },
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /admin/quests/:id -> 404 on unknown id', async () => {
    const res = await req('DELETE', '/admin/quests/00000000-0000-0000-0000-000000000000', {
      token: adminToken,
    });
    expect(res.status).toBe(404);
  });

  it('POST /admin/quests -> 403 when CONTENT_CREATOR sets xpReward', async () => {
    const res = await req('POST', '/admin/quests', {
      token: contentCreatorToken,
      body: validBody,
    });
    expect(res.status).toBe(403);
  });

  it('PATCH /admin/quests/:id -> 403 when CONTENT_CREATOR changes xpReward', async () => {
    // Admin creates a quest first.
    const created = (await (await req('POST', '/admin/quests', { token: adminToken, body: validBody })).json<{ data: QuestDefinition }>()).data;

    const res = await req('PATCH', `/admin/quests/${created.id}`, {
      token: contentCreatorToken,
      body: { xpReward: 999 },
    });
    expect(res.status).toBe(403);
  });

  it('PATCH /admin/quests/:id -> 200 when CONTENT_CREATOR edits a non-economy field', async () => {
    const created = (await (await req('POST', '/admin/quests', { token: adminToken, body: validBody })).json<{ data: QuestDefinition }>()).data;

    const res = await req('PATCH', `/admin/quests/${created.id}`, {
      token: contentCreatorToken,
      body: { title: 'CC Edited Title' },
    });
    expect(res.status).toBe(200);
    const updated = (await res.json<{ data: QuestDefinition }>()).data;
    expect(updated.title).toBe('CC Edited Title');
  });

  it('POST /admin/quests -> 403 for student (role guard)', async () => {
    const res = await req('POST', '/admin/quests', { token: studentToken, body: validBody });
    expect(res.status).toBe(403);
  });
});
