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
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
  )`,
  `INSERT OR IGNORE INTO roles (id, name) VALUES ('r-admin', 'admin'), ('r-student', 'student')`,
  `CREATE TABLE IF NOT EXISTS xp_events (
    id              TEXT    NOT NULL PRIMARY KEY,
    user_id         TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_kind     TEXT    NOT NULL,
    source_id       TEXT,
    points          INTEGER NOT NULL,
    idempotency_key TEXT    NOT NULL,
    earned_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_xp_events_idempotency
    ON xp_events(user_id, source_kind, idempotency_key)`,
  `CREATE TABLE IF NOT EXISTS user_xp (
    user_id    TEXT    NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_xp   INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_streak (
    user_id            TEXT    NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_streak     INTEGER NOT NULL DEFAULT 0,
    longest_streak     INTEGER NOT NULL DEFAULT 0,
    last_activity_date TEXT,
    updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS level_definitions (
    level      INTEGER NOT NULL PRIMARY KEY,
    rank_title TEXT    NOT NULL,
    min_xp     INTEGER NOT NULL,
    max_xp     INTEGER
  )`,
  `INSERT OR IGNORE INTO level_definitions (level, rank_title, min_xp, max_xp) VALUES
    (1, 'Aspirante', 0, 100),
    (2, 'Aspirante', 100, 300),
    (5, 'Treinador Júnior', 1000, 1500)`,
  `CREATE TABLE IF NOT EXISTS badges (
    id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, icon_emoji TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', xp_reward INTEGER NOT NULL DEFAULT 0,
    rule_kind TEXT NOT NULL, rule_params TEXT NOT NULL DEFAULT '{}',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_badges (
    id TEXT NOT NULL, user_id TEXT NOT NULL, badge_id TEXT NOT NULL,
    earned_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, badge_id)
  )`,
  `CREATE TABLE IF NOT EXISTS quest_definitions (
    id TEXT NOT NULL PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,
    description TEXT NOT NULL, predicate_kind TEXT NOT NULL, predicate_params TEXT NOT NULL,
    xp_reward INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS quest_progress (
    user_id TEXT NOT NULL, quest_id TEXT NOT NULL, period_key TEXT NOT NULL,
    current_value INTEGER NOT NULL DEFAULT 0, target_value INTEGER NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, quest_id, period_key)
  )`,
  `CREATE TABLE IF NOT EXISTS missions (
    id TEXT NOT NULL PRIMARY KEY, title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', start_at TEXT NOT NULL, end_at TEXT NOT NULL,
    predicate_kind TEXT NOT NULL, predicate_params TEXT NOT NULL DEFAULT '{}',
    xp_reward INTEGER NOT NULL DEFAULT 0, badge_id TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS mission_progress (
    user_id TEXT NOT NULL, mission_id TEXT NOT NULL,
    current_value INTEGER NOT NULL DEFAULT 0, target_value INTEGER NOT NULL DEFAULT 1,
    completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, mission_id)
  )`,
  `CREATE TABLE IF NOT EXISTS topic_nodes (
    id TEXT NOT NULL PRIMARY KEY, parent_id TEXT, title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
    sort_order INTEGER NOT NULL DEFAULT 0, estimated_minutes INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS topic_progress (
    user_id TEXT NOT NULL, topic_node_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started', visited_at TEXT, completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, topic_node_id)
  )`,
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
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS enrollments_user (
    id TEXT NOT NULL PRIMARY KEY, user_id TEXT NOT NULL,
    topic_node_id TEXT NOT NULL, granted_by TEXT NOT NULL,
    granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, topic_node_id)
  )`,
  `CREATE TABLE IF NOT EXISTS enrollments_user_group (
    id TEXT NOT NULL PRIMARY KEY, group_id TEXT NOT NULL,
    topic_node_id TEXT NOT NULL, granted_by TEXT NOT NULL,
    granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(group_id, topic_node_id)
  )`,
];

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

let userAToken: string;
let userCToken: string;

const USER_A = 'lb-user-a';
const USER_B = 'lb-user-b';
const USER_C = 'lb-user-c';

beforeAll(async () => {
  await env.DB.batch(MIGRATION_SQL.map(sql => env.DB.prepare(sql)));

  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`)
      .bind(USER_A, 'User A', 'a@lb.test', 'hash'),
    env.DB.prepare(`INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`)
      .bind(USER_B, 'User B', 'b@lb.test', 'hash'),
    env.DB.prepare(`INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`)
      .bind(USER_C, 'User C', 'c@lb.test', 'hash'),
    // User A: 500 XP, last event 2026-01-03
    env.DB.prepare(`INSERT OR IGNORE INTO user_xp (user_id, total_xp) VALUES (?, ?)`).bind(USER_A, 500),
    env.DB.prepare(`INSERT OR IGNORE INTO xp_events (id, user_id, source_kind, points, idempotency_key, earned_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('evt-a', USER_A, 'test', 500, 'key-a', '2026-01-03T12:00:00Z'),
    // User B: 500 XP (same as A), last event 2026-01-05 (later → lower rank)
    env.DB.prepare(`INSERT OR IGNORE INTO user_xp (user_id, total_xp) VALUES (?, ?)`).bind(USER_B, 500),
    env.DB.prepare(`INSERT OR IGNORE INTO xp_events (id, user_id, source_kind, points, idempotency_key, earned_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('evt-b', USER_B, 'test', 500, 'key-b', '2026-01-05T12:00:00Z'),
    // User C: 200 XP
    env.DB.prepare(`INSERT OR IGNORE INTO user_xp (user_id, total_xp) VALUES (?, ?)`).bind(USER_C, 200),
    env.DB.prepare(`INSERT OR IGNORE INTO xp_events (id, user_id, source_kind, points, idempotency_key, earned_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('evt-c', USER_C, 'test', 200, 'key-c', '2026-01-04T12:00:00Z'),
  ]);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [userAToken, , userCToken] = await Promise.all([
    adapter.signAccessToken({ sub: USER_A, email: 'a@lb.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: USER_B, email: 'b@lb.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: USER_C, email: 'c@lb.test', roles: ['student'] }),
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
  it('GET /leaderboard → 401 without token', async () => {
    const res = await req('GET', '/leaderboard');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Sorting: total_xp DESC, last_xp_event_at ASC on tie
// ---------------------------------------------------------------------------

describe('GET /leaderboard — ordering', () => {
  it('returns rows sorted by XP DESC with tie-break on last event ASC', async () => {
    const res = await req('GET', '/leaderboard', { token: userAToken });
    expect(res.status).toBe(200);
    const body = await res.json<{ rows: Array<{ userId: string; totalXp: number }> }>();
    expect(body.rows.length).toBeGreaterThanOrEqual(3);

    // USER_A (500 XP, earlier event) should be rank 1, USER_B (500 XP, later event) rank 2, USER_C last
    const ids = body.rows.map(r => r.userId);
    const aIdx = ids.indexOf(USER_A);
    const bIdx = ids.indexOf(USER_B);
    const cIdx = ids.indexOf(USER_C);

    expect(aIdx).toBeLessThan(bIdx);
    expect(bIdx).toBeLessThan(cIdx);
  });
});

// ---------------------------------------------------------------------------
// me.rank is global rank, not page-relative
// ---------------------------------------------------------------------------

describe('GET /leaderboard — me.rank is global', () => {
  it('me.rank for USER_C reflects global position regardless of page', async () => {
    // Request with limit=1 (only first row on page), USER_C is rank 3 globally
    const res = await req('GET', '/leaderboard?limit=1&offset=0', { token: userCToken });
    expect(res.status).toBe(200);
    const body = await res.json<{ me: { rank: number } }>();
    // USER_C has 200 XP, two users have 500 XP, so rank >= 3
    expect(body.me.rank).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('GET /leaderboard — pagination', () => {
  it('respects limit and offset', async () => {
    const res = await req('GET', '/leaderboard?limit=1&offset=0', { token: userAToken });
    expect(res.status).toBe(200);
    const body = await res.json<{ rows: unknown[]; limit: number; offset: number; total: number }>();
    expect(body.rows).toHaveLength(1);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);
    expect(body.total).toBeGreaterThanOrEqual(3);
  });

  it('rejects limit > 100', async () => {
    const res = await req('GET', '/leaderboard?limit=101', { token: userAToken });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// scope=topic requires topicId
// ---------------------------------------------------------------------------

describe('GET /leaderboard — validation', () => {
  it('returns 400 when scope=topic and topicId is missing', async () => {
    const res = await req('GET', '/leaderboard?scope=topic', { token: userAToken });
    expect(res.status).toBe(400);
  });
});
