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
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    timezone      TEXT NOT NULL DEFAULT 'UTC'
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
    ('bf3d0f1d-7d77-5151-922e-b87dff0fa7ad', 'student',         'Can consume content and tasks')`,
  `CREATE TABLE IF NOT EXISTS missions (
    id               TEXT    NOT NULL PRIMARY KEY,
    title            TEXT    NOT NULL,
    description      TEXT    NOT NULL DEFAULT '',
    start_at         TEXT    NOT NULL,
    end_at           TEXT    NOT NULL,
    predicate_kind   TEXT    NOT NULL,
    predicate_params TEXT    NOT NULL DEFAULT '{}',
    xp_reward        INTEGER NOT NULL DEFAULT 0,
    badge_id         TEXT,
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
];

let adminToken: string;
let contentCreatorToken: string;
let studentToken: string;

beforeAll(async () => {
  await env.DB.batch(MIGRATION_SQL.map(sql => env.DB.prepare(sql)));

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });

  [adminToken, contentCreatorToken, studentToken] = await Promise.all([
    adapter.signAccessToken({ sub: 'admin-missions-test', email: 'admin@missions.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: 'cc-missions-test', email: 'cc@missions.test', roles: ['content_creator'] }),
    adapter.signAccessToken({ sub: 'student-missions-test', email: 'student@missions.test', roles: ['student'] }),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Admin Missions CRUD', () => {
  const futureDate = new Date(Date.now() + 86400000).toISOString(); // +1 day
  const furtherFutureDate = new Date(Date.now() + 172800000).toISOString(); // +2 days
  const pastDate = new Date(Date.now() - 86400000).toISOString(); // -1 day

  it('POST /admin/missions -> 201 created', async () => {
    const res = await req('POST', '/admin/missions', {
      token: adminToken,
      body: {
        title: 'Test Mission',
        description: 'Do something cool',
        startAt: new Date().toISOString(),
        endAt: futureDate,
        predicateKind: 'topic_completed',
        predicateParams: '{"topicId": "some-id"}',
        xpReward: 1000,
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ data: { id: string; title: string } }>();
    expect(body.data.title).toBe('Test Mission');
    expect(body.data.id).toBeDefined();
  });

  it('POST /admin/missions -> 400 if endAt <= startAt', async () => {
    const res = await req('POST', '/admin/missions', {
      token: adminToken,
      body: {
        title: 'Invalid Dates',
        description: '...',
        startAt: futureDate,
        endAt: futureDate,
        predicateKind: 'topic_completed',
        predicateParams: '{}',
        xpReward: 100,
      },
    });
    expect(res.status).toBe(400);
  });

  it('POST /admin/missions -> 403 for student', async () => {
    const res = await req('POST', '/admin/missions', {
      token: studentToken,
      body: { title: 'Cheater' },
    });
    expect(res.status).toBe(403);
  });

  it('GET /admin/missions -> 200 list all', async () => {
    // Ensure at least one exists
    await req('POST', '/admin/missions', {
      token: adminToken,
      body: {
        title: 'List Seed',
        description: '...',
        startAt: new Date().toISOString(),
        endAt: futureDate,
        predicateKind: 'k',
        predicateParams: '{}',
        xpReward: 0,
      },
    });

    const res = await req('GET', '/admin/missions', { token: adminToken });
    expect(res.status).toBe(200);
    const body = await res.json<{ data: any[] }>();
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('PATCH /admin/missions/:id -> 200 update', async () => {
    // Create first
    const createRes = await req('POST', '/admin/missions', {
      token: adminToken,
      body: {
        title: 'To Update',
        description: '...',
        startAt: new Date().toISOString(),
        endAt: futureDate,
        predicateKind: 'k',
        predicateParams: '{}',
        xpReward: 10,
      },
    });
    const mission = (await createRes.json<{ data: { id: string } }>()).data;

    const res = await req('PATCH', `/admin/missions/${mission.id}`, {
      token: adminToken,
      body: { title: 'Updated Title', endAt: furtherFutureDate },
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { title: string; endAt: string } }>();
    expect(body.data.title).toBe('Updated Title');
    expect(body.data.endAt).toBe(furtherFutureDate);
  });

  it('PATCH /admin/missions/:id -> 400 when shortening endAt below now', async () => {
    const createRes = await req('POST', '/admin/missions', {
      token: adminToken,
      body: {
        title: 'Shorten Test',
        description: '...',
        startAt: new Date().toISOString(),
        endAt: futureDate,
        predicateKind: 'k',
        predicateParams: '{}',
        xpReward: 10,
      },
    });
    const mission = (await createRes.json<{ data: { id: string } }>()).data;

    const res = await req('PATCH', `/admin/missions/${mission.id}`, {
      token: adminToken,
      body: { endAt: pastDate },
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /admin/missions/:id -> 200 soft delete', async () => {
    const createRes = await req('POST', '/admin/missions', {
      token: adminToken,
      body: {
        title: 'To Delete',
        description: '...',
        startAt: new Date().toISOString(),
        endAt: futureDate,
        predicateKind: 'k',
        predicateParams: '{}',
        xpReward: 10,
      },
    });
    const mission = (await createRes.json<{ data: { id: string } }>()).data;

    const res = await req('DELETE', `/admin/missions/${mission.id}`, { token: adminToken });
    expect(res.status).toBe(200);

    // Verify it's inactive but still exists
    const listRes = await req('GET', '/admin/missions', { token: adminToken });
    const list = (await listRes.json<{ data: any[] }>()).data;
    const deleted = list.find(m => m.id === mission.id);
    expect(deleted).toBeDefined();
    expect(deleted.active).toBe(false);
  });
});
