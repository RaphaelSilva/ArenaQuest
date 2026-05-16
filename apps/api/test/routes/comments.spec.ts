import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';

// ---------------------------------------------------------------------------
// DB bootstrap
// ---------------------------------------------------------------------------

const MIGRATION_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), timezone TEXT NOT NULL DEFAULT 'UTC'
  )`,
  `CREATE TABLE IF NOT EXISTS roles (
    id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
  )`,
  `INSERT OR IGNORE INTO roles (id, name) VALUES ('r-admin', 'admin'), ('r-student', 'student')`,
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    token TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS user_groups (
    id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_group_members (
    group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS topic_nodes (
    id TEXT NOT NULL PRIMARY KEY, parent_id TEXT, title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
    sort_order INTEGER NOT NULL DEFAULT 0, estimated_minutes INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS enrollments_user (
    id TEXT NOT NULL PRIMARY KEY, user_id TEXT NOT NULL,
    topic_node_id TEXT NOT NULL, granted_by TEXT NOT NULL,
    granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, topic_node_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_enrollments_user_user ON enrollments_user(user_id)`,
  `CREATE TABLE IF NOT EXISTS enrollments_user_group (
    id TEXT NOT NULL PRIMARY KEY, group_id TEXT NOT NULL,
    topic_node_id TEXT NOT NULL, granted_by TEXT NOT NULL,
    granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(group_id, topic_node_id)
  )`,
  `CREATE TABLE IF NOT EXISTS topic_comments (
    id TEXT PRIMARY KEY, topic_node_id TEXT NOT NULL, parent_comment_id TEXT,
    user_id TEXT NOT NULL, body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT,
    FOREIGN KEY (topic_node_id) REFERENCES topic_nodes(id),
    FOREIGN KEY (parent_comment_id) REFERENCES topic_comments(id)
  )`,
  `CREATE TABLE IF NOT EXISTS comment_likes (
    comment_id TEXT NOT NULL, user_id TEXT NOT NULL,
    liked_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (comment_id, user_id),
    FOREIGN KEY (comment_id) REFERENCES topic_comments(id)
  )`,
  // Gamification stubs required by buildApp
  `CREATE TABLE IF NOT EXISTS xp_events (
    id TEXT NOT NULL PRIMARY KEY, user_id TEXT NOT NULL, source_kind TEXT NOT NULL,
    source_id TEXT, points INTEGER NOT NULL, idempotency_key TEXT NOT NULL,
    earned_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_xp_events_idempotency ON xp_events(user_id, source_kind, idempotency_key)`,
  `CREATE TABLE IF NOT EXISTS user_xp (
    user_id TEXT NOT NULL PRIMARY KEY, total_xp INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_streak (
    user_id TEXT NOT NULL PRIMARY KEY, current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0, last_activity_date TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS level_definitions (
    level INTEGER NOT NULL PRIMARY KEY, rank_title TEXT NOT NULL,
    min_xp INTEGER NOT NULL, max_xp INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS badges (
    id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    icon_emoji TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', xp_reward INTEGER NOT NULL DEFAULT 0,
    rule_kind TEXT NOT NULL, rule_params TEXT NOT NULL DEFAULT '{}', active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_badges (
    id TEXT NOT NULL, user_id TEXT NOT NULL, badge_id TEXT NOT NULL,
    earned_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, badge_id)
  )`,
  `CREATE TABLE IF NOT EXISTS quest_definitions (
    id TEXT NOT NULL PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,
    description TEXT NOT NULL, predicate_kind TEXT NOT NULL, predicate_params TEXT NOT NULL,
    xp_reward INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS quest_progress (
    user_id TEXT NOT NULL, quest_id TEXT NOT NULL, period_key TEXT NOT NULL,
    current_value INTEGER NOT NULL DEFAULT 0, target_value INTEGER NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, quest_id, period_key)
  )`,
  `CREATE TABLE IF NOT EXISTS missions (
    id TEXT NOT NULL PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    start_at TEXT NOT NULL, end_at TEXT NOT NULL, predicate_kind TEXT NOT NULL,
    predicate_params TEXT NOT NULL DEFAULT '{}', xp_reward INTEGER NOT NULL DEFAULT 0,
    badge_id TEXT, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS mission_progress (
    user_id TEXT NOT NULL, mission_id TEXT NOT NULL,
    current_value INTEGER NOT NULL DEFAULT 0, target_value INTEGER NOT NULL DEFAULT 1,
    completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, mission_id)
  )`,
  `CREATE TABLE IF NOT EXISTS topic_progress (
    user_id TEXT NOT NULL, topic_node_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started', visited_at TEXT, completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, topic_node_id)
  )`,
];

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const STUDENT_A = 'cmt-student-a';
const STUDENT_B = 'cmt-student-b';
const STUDENT_C = 'cmt-student-c'; // never enrolled
const ADMIN_ID = 'cmt-admin-1';
const TOPIC_ID = 'cmt-topic-1';

let tokenA: string;
let tokenB: string;
let tokenC: string;
let adminToken: string;

beforeAll(async () => {
  await env.DB.batch(MIGRATION_SQL.map(sql => env.DB.prepare(sql)));

  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`)
      .bind(STUDENT_A, 'Student A', 'a@cmt.test', 'hash'),
    env.DB.prepare(`INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`)
      .bind(STUDENT_B, 'Student B', 'b@cmt.test', 'hash'),
    env.DB.prepare(`INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`)
      .bind(STUDENT_C, 'Student C', 'c@cmt.test', 'hash'),
    env.DB.prepare(`INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`)
      .bind(ADMIN_ID, 'Admin', 'admin@cmt.test', 'hash'),
    env.DB.prepare(`INSERT OR IGNORE INTO topic_nodes (id, title) VALUES (?, ?)`)
      .bind(TOPIC_ID, 'Test Topic'),
    // Enroll student A in the topic
    env.DB.prepare(`INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)`)
      .bind('enroll-a', STUDENT_A, TOPIC_ID, ADMIN_ID),
    // Enroll student B in the topic (needed for delete test)
    env.DB.prepare(`INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)`)
      .bind('enroll-b-del', STUDENT_B, TOPIC_ID, ADMIN_ID),
    // Enroll admin in topic (needed for delete test)
    env.DB.prepare(`INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)`)
      .bind('enroll-admin', ADMIN_ID, TOPIC_ID, ADMIN_ID),
  ]);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [tokenA, tokenB, tokenC, adminToken] = await Promise.all([
    adapter.signAccessToken({ sub: STUDENT_A, email: 'a@cmt.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: STUDENT_B, email: 'b@cmt.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: STUDENT_C, email: 'c@cmt.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: ADMIN_ID, email: 'admin@cmt.test', roles: ['admin'] }),
  ]);
});

async function req(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
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
// Auth guard
// ---------------------------------------------------------------------------

describe('auth guard', () => {
  it('GET /topics/:id/comments returns 401 without token', async () => {
    const res = await req('GET', `/topics/${TOPIC_ID}/comments`);
    expect(res.status).toBe(401);
  });

  it('POST /topics/:id/comments returns 401 without token', async () => {
    const res = await req('POST', `/topics/${TOPIC_ID}/comments`, { body: { body: 'hi' } });
    expect(res.status).toBe(401);
  });

  it('POST /comments/:id/like returns 401 without token', async () => {
    const res = await req('POST', '/comments/any-id/like');
    expect(res.status).toBe(401);
  });

  it('DELETE /comments/:id returns 401 without token', async () => {
    const res = await req('DELETE', '/comments/any-id');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Enrollment access check
// ---------------------------------------------------------------------------

describe('enrollment access', () => {
  it('GET /topics/:id/comments returns 403 for unenrolled user', async () => {
    const res = await req('GET', `/topics/${TOPIC_ID}/comments`, { token: tokenC });
    expect(res.status).toBe(403);
  });

  it('POST /topics/:id/comments returns 403 for unenrolled user', async () => {
    const res = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenC,
      body: { body: 'Hi there' },
    });
    expect(res.status).toBe(403);
  });

  it('GET /topics/:id/comments returns 200 for enrolled user', async () => {
    const res = await req('GET', `/topics/${TOPIC_ID}/comments`, { token: tokenA });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Create, list, reply
// ---------------------------------------------------------------------------

describe('POST /topics/:id/comments', () => {
  it('creates a top-level comment', async () => {
    const res = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'First comment' },
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; body: string }>();
    expect(body.body).toBe('First comment');
    expect(body.id).toBeTruthy();
  });

  it('creates a reply to a top-level comment', async () => {
    const createRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Parent comment' },
    });
    const parent = await createRes.json<{ id: string }>();

    const replyRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Reply to parent', parentCommentId: parent.id },
    });
    expect(replyRes.status).toBe(201);
    const reply = await replyRes.json<{ parentCommentId: string }>();
    expect(reply.parentCommentId).toBe(parent.id);
  });

  it('returns 400 NESTED_REPLY_FORBIDDEN for reply to a reply', async () => {
    const parentRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Level 1' },
    });
    const parent = await parentRes.json<{ id: string }>();

    const replyRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Level 2', parentCommentId: parent.id },
    });
    const reply = await replyRes.json<{ id: string }>();

    const nestedRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Level 3 (forbidden)', parentCommentId: reply.id },
    });
    expect(nestedRes.status).toBe(400);
    const body = await nestedRes.json<{ error: string }>();
    expect(body.error).toBe('NESTED_REPLY_FORBIDDEN');
  });

  it('strips HTML tags from body', async () => {
    const res = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: '<b>Bold</b> text' },
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ body: string }>();
    expect(body.body).toBe('Bold text');
    expect(body.body).not.toContain('<b>');
  });
});

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------

describe('DELETE /comments/:id', () => {
  it('author can delete own comment', async () => {
    const createRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'To be deleted' },
    });
    const comment = await createRes.json<{ id: string }>();

    const deleteRes = await req('DELETE', `/comments/${comment.id}`, { token: tokenA });
    expect(deleteRes.status).toBe(204);
  });

  it('deleted comment body is null in listing', async () => {
    const createRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Will be deleted' },
    });
    const comment = await createRes.json<{ id: string }>();

    await req('DELETE', `/comments/${comment.id}`, { token: tokenA });

    const listRes = await req('GET', `/topics/${TOPIC_ID}/comments`, { token: tokenA });
    const { data } = await listRes.json<{ data: Array<{ id: string; body: string | null }> }>();
    const deleted = data.find(c => c.id === comment.id);
    expect(deleted).toBeDefined();
    expect(deleted?.body).toBeNull();
  });

  it('another user cannot delete a comment they do not own', async () => {
    const createRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Only A can delete this' },
    });
    const comment = await createRes.json<{ id: string }>();

    // B tries to delete A's comment
    const deleteRes = await req('DELETE', `/comments/${comment.id}`, { token: tokenB });
    expect(deleteRes.status).toBe(403);
  });

  it('admin can delete any comment', async () => {
    const createRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Admin will delete this' },
    });
    const comment = await createRes.json<{ id: string }>();

    const deleteRes = await req('DELETE', `/comments/${comment.id}`, { token: adminToken });
    expect(deleteRes.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// Like toggle
// ---------------------------------------------------------------------------

describe('POST /comments/:id/like', () => {
  it('liked_by_me reflects toggle state', async () => {
    const createRes = await req('POST', `/topics/${TOPIC_ID}/comments`, {
      token: tokenA,
      body: { body: 'Likeable comment' },
    });
    const comment = await createRes.json<{ id: string }>();

    // Like
    const likeRes = await req('POST', `/comments/${comment.id}/like`, { token: tokenA });
    expect(likeRes.status).toBe(200);
    const likeBody = await likeRes.json<{ liked: boolean }>();
    expect(likeBody.liked).toBe(true);

    // Unlike
    const unlikeRes = await req('POST', `/comments/${comment.id}/like`, { token: tokenA });
    const unlikeBody = await unlikeRes.json<{ liked: boolean }>();
    expect(unlikeBody.liked).toBe(false);
  });

  it('returns 404 for unknown comment', async () => {
    const res = await req('POST', '/comments/does-not-exist/like', { token: tokenA });
    expect(res.status).toBe(404);
  });
});
