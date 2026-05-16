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
    ('32a5cab1-e66f-5d23-a80d-80cfa927d057', 'tutor',           'Can monitor student progress'),
    ('bf3d0f1d-7d77-5151-922e-b87dff0fa7ad', 'student',         'Can consume content and tasks')`,
  `CREATE TABLE IF NOT EXISTS topic_nodes (
    id                TEXT    NOT NULL PRIMARY KEY,
    parent_id         TEXT    REFERENCES topic_nodes(id),
    title             TEXT    NOT NULL,
    content           TEXT    NOT NULL DEFAULT '',
    status            TEXT    NOT NULL DEFAULT 'draft',
    sort_order        INTEGER NOT NULL DEFAULT 0,
    estimated_minutes INTEGER NOT NULL DEFAULT 0,
    archived          INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS tags (id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE)`,
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
    id TEXT NOT NULL PRIMARY KEY, topic_node_id TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL, type TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending', uploaded_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT NOT NULL PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft', created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS task_stages (
    id TEXT NOT NULL PRIMARY KEY, task_id TEXT NOT NULL, label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS task_topic_links (
    task_id TEXT NOT NULL, topic_node_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (task_id, topic_node_id)
  )`,
  `CREATE TABLE IF NOT EXISTS task_stage_topic_links (
    stage_id TEXT NOT NULL, topic_node_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (stage_id, topic_node_id)
  )`,
  `CREATE TABLE IF NOT EXISTS activation_tokens (
    token TEXT NOT NULL PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS topic_progress (
    id TEXT NOT NULL PRIMARY KEY, user_id TEXT NOT NULL, topic_node_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started', completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, topic_node_id)
  )`,
  `CREATE TABLE IF NOT EXISTS task_progress (
    id TEXT NOT NULL PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started', current_stage_id TEXT, completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, task_id)
  )`,
  `CREATE TABLE IF NOT EXISTS task_stage_progress (
    id TEXT NOT NULL PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL, stage_id TEXT NOT NULL,
    checked_in_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (user_id, stage_id)
  )`,
  `CREATE TABLE IF NOT EXISTS user_groups (
    id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_group_members (
    group_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (group_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS enrollments_user (
    id TEXT NOT NULL PRIMARY KEY, user_id TEXT NOT NULL, topic_node_id TEXT NOT NULL,
    granted_by TEXT NOT NULL, granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, topic_node_id)
  )`,
  `CREATE TABLE IF NOT EXISTS enrollments_user_group (
    id TEXT NOT NULL PRIMARY KEY, group_id TEXT NOT NULL, topic_node_id TEXT NOT NULL,
    granted_by TEXT NOT NULL, granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (group_id, topic_node_id)
  )`,
];

const ADMIN_ID = 'admin-enr-test';
const STUDENT_ID = 'student-enr-test';
const GROUP_ID = 'group-enr-test';

let adminToken: string;
let studentToken: string;

// Topics created in beforeAll for tests that need pre-seeded data
let rootTopic: string;
let childTopic: string;
let listedTopic: string;   // pre-granted to STUDENT_ID for the GET test
let groupTopic: string;    // pre-granted to GROUP_ID for the group GET test

async function post(path: string, body: unknown, token = adminToken) {
  const req = new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function get(path: string, token = adminToken) {
  const req = new Request(`http://localhost${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function del(path: string, token = adminToken, body?: unknown) {
  const req = new Request(`http://localhost${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function noAuthGet(path: string) {
  const req = new Request(`http://localhost${path}`, { method: 'GET' });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeAll(async () => {
  await env.DB.batch(MIGRATION_SQL.map((sql) => env.DB.prepare(sql)));

  // Users
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, 'Admin', 'admin@enr.test', 'x')").bind(ADMIN_ID),
    env.DB.prepare("INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, 'Student', 'student@enr.test', 'x')").bind(STUDENT_ID),
    env.DB.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').bind(ADMIN_ID, 'bace0701-15e3-5144-97c5-47487d543032'),
    env.DB.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').bind(STUDENT_ID, 'bf3d0f1d-7d77-5151-922e-b87dff0fa7ad'),
    env.DB.prepare("INSERT OR IGNORE INTO user_groups (id, name) VALUES (?, 'Test Group')").bind(GROUP_ID),
  ]);

  // Topics
  rootTopic = crypto.randomUUID();
  childTopic = crypto.randomUUID();
  listedTopic = crypto.randomUUID();
  groupTopic = crypto.randomUUID();

  await env.DB.batch([
    env.DB.prepare("INSERT INTO topic_nodes (id, title, status) VALUES (?, 'Root', 'published')").bind(rootTopic),
    env.DB.prepare("INSERT INTO topic_nodes (id, parent_id, title, status) VALUES (?, ?, 'Child', 'published')").bind(childTopic, rootTopic),
    env.DB.prepare("INSERT INTO topic_nodes (id, title, status) VALUES (?, 'Listed', 'published')").bind(listedTopic),
    env.DB.prepare("INSERT INTO topic_nodes (id, title, status) VALUES (?, 'Group', 'published')").bind(groupTopic),
  ]);

  // Pre-seed grants for tests that verify GET listing
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), STUDENT_ID, listedTopic, ADMIN_ID),
    env.DB.prepare('INSERT OR IGNORE INTO enrollments_user_group (id, group_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), GROUP_ID, groupTopic, ADMIN_ID),
  ]);

  const auth = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [adminToken, studentToken] = await Promise.all([
    auth.signAccessToken({ sub: ADMIN_ID, email: 'admin@enr.test', roles: ['admin'] }),
    auth.signAccessToken({ sub: STUDENT_ID, email: 'student@enr.test', roles: ['student'] }),
  ]);
});

// ---------------------------------------------------------------------------

describe('Auth guards', () => {
  it('GET enrollments → 401 without token', async () => {
    const r = await noAuthGet(`/admin/users/${STUDENT_ID}/enrollments`);
    expect(r.status).toBe(401);
  });

  it('GET enrollments → 403 for students', async () => {
    const r = await get(`/admin/users/${STUDENT_ID}/enrollments`, studentToken);
    expect(r.status).toBe(403);
  });
});

describe('User enrollment', () => {
  it('POST creates a grant and returns 201', async () => {
    const r = await post(`/admin/users/${STUDENT_ID}/enrollments`, { topicNodeId: rootTopic });
    expect(r.status).toBe(201);
    const body = await r.json<{ topicNodeId: string }>();
    expect(body.topicNodeId).toBe(rootTopic);
  });

  it('POST same grant again is idempotent — returns 200', async () => {
    // Grant rootTopic twice; first call (from test above) already happened.
    // If tests share state: this returns 200. If not: grant fresh and re-grant.
    const r1 = await post(`/admin/users/${STUDENT_ID}/enrollments`, { topicNodeId: childTopic });
    expect([200, 201]).toContain(r1.status);

    const r2 = await post(`/admin/users/${STUDENT_ID}/enrollments`, { topicNodeId: childTopic });
    expect(r2.status).toBe(200);
  });

  it('GET lists pre-seeded user grants', async () => {
    const r = await get(`/admin/users/${STUDENT_ID}/enrollments`);
    expect(r.status).toBe(200);
    const body = await r.json<{ data: { topicNodeId: string }[] }>();
    expect(body.data.some((g) => g.topicNodeId === listedTopic)).toBe(true);
  });

  it('DELETE removes a grant — returns 204', async () => {
    // Grant a fresh unique topic, then delete it
    const freshTopic = crypto.randomUUID();
    await env.DB
      .prepare("INSERT INTO topic_nodes (id, title, status) VALUES (?, 'Fresh', 'published')")
      .bind(freshTopic)
      .run();

    await post(`/admin/users/${STUDENT_ID}/enrollments`, { topicNodeId: freshTopic });

    const r = await del(`/admin/users/${STUDENT_ID}/enrollments/${freshTopic}`);
    expect(r.status).toBe(204);
  });

  it('DELETE with cascade removes root and all explicit descendant grants', async () => {
    const cascadeRoot = crypto.randomUUID();
    const cascadeChild = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare("INSERT INTO topic_nodes (id, title, status) VALUES (?, 'CR', 'published')").bind(cascadeRoot),
      env.DB.prepare("INSERT INTO topic_nodes (id, parent_id, title, status) VALUES (?, ?, 'CC', 'published')").bind(cascadeChild, cascadeRoot),
    ]);

    await Promise.all([
      post(`/admin/users/${STUDENT_ID}/enrollments`, { topicNodeId: cascadeRoot }),
      post(`/admin/users/${STUDENT_ID}/enrollments`, { topicNodeId: cascadeChild }),
    ]);

    const r = await del(`/admin/users/${STUDENT_ID}/enrollments/${cascadeRoot}`, adminToken, { cascade: true });
    expect(r.status).toBe(204);

    const listR = await get(`/admin/users/${STUDENT_ID}/enrollments`);
    const body = await listR.json<{ data: { topicNodeId: string }[] }>();
    expect(body.data.find((g) => g.topicNodeId === cascadeRoot)).toBeUndefined();
    expect(body.data.find((g) => g.topicNodeId === cascadeChild)).toBeUndefined();
  });
});

describe('Group enrollment', () => {
  it('POST creates a group grant → 201', async () => {
    const freshTopic = crypto.randomUUID();
    await env.DB
      .prepare("INSERT INTO topic_nodes (id, title, status) VALUES (?, 'GroupTopic', 'published')")
      .bind(freshTopic)
      .run();

    const r = await post(`/admin/groups/${GROUP_ID}/enrollments`, { topicNodeId: freshTopic });
    expect(r.status).toBe(201);

    const r2 = await post(`/admin/groups/${GROUP_ID}/enrollments`, { topicNodeId: freshTopic });
    expect(r2.status).toBe(200);
  });

  it('GET lists pre-seeded group grants', async () => {
    const r = await get(`/admin/groups/${GROUP_ID}/enrollments`);
    expect(r.status).toBe(200);
    const body = await r.json<{ data: { topicNodeId: string }[] }>();
    expect(body.data.some((g) => g.topicNodeId === groupTopic)).toBe(true);
  });

  it('DELETE removes a group grant → 204', async () => {
    const freshTopic = crypto.randomUUID();
    await env.DB
      .prepare("INSERT INTO topic_nodes (id, title, status) VALUES (?, 'GroupDel', 'published')")
      .bind(freshTopic)
      .run();

    await post(`/admin/groups/${GROUP_ID}/enrollments`, { topicNodeId: freshTopic });
    const r = await del(`/admin/groups/${GROUP_ID}/enrollments/${freshTopic}`);
    expect(r.status).toBe(204);
  });
});
