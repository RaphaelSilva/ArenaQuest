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
  `INSERT OR IGNORE INTO roles (id, name) VALUES
    ('r-admin', 'admin'),
    ('r-student', 'student')`,
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
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    icon_emoji TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    xp_reward INTEGER NOT NULL DEFAULT 0,
    rule_kind TEXT NOT NULL,
    rule_params TEXT NOT NULL DEFAULT '{}',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_badges (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    badge_id TEXT NOT NULL,
    earned_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, badge_id),
    FOREIGN KEY (badge_id) REFERENCES badges(id)
  )`,
  `CREATE TABLE IF NOT EXISTS quest_definitions (
    id               TEXT    NOT NULL PRIMARY KEY,
    kind             TEXT    NOT NULL,
    title            TEXT    NOT NULL,
    description      TEXT    NOT NULL,
    predicate_kind   TEXT    NOT NULL,
    predicate_params TEXT    NOT NULL,
    xp_reward        INTEGER NOT NULL,
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS quest_progress (
    user_id       TEXT    NOT NULL,
    quest_id      TEXT    NOT NULL,
    period_key    TEXT    NOT NULL,
    current_value INTEGER NOT NULL DEFAULT 0,
    target_value  INTEGER NOT NULL,
    completed     INTEGER NOT NULL DEFAULT 0,
    completed_at  TEXT,
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, quest_id, period_key)
  )`,
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
  `CREATE TABLE IF NOT EXISTS mission_progress (
    user_id       TEXT    NOT NULL,
    mission_id    TEXT    NOT NULL,
    current_value INTEGER NOT NULL DEFAULT 0,
    target_value  INTEGER NOT NULL DEFAULT 1,
    completed     INTEGER NOT NULL DEFAULT 0,
    completed_at  TEXT,
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, mission_id)
  )`,
  `CREATE TABLE IF NOT EXISTS topic_nodes (
    id TEXT NOT NULL PRIMARY KEY,
    parent_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    sort_order INTEGER NOT NULL DEFAULT 0,
    estimated_minutes INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS topic_progress (
    user_id TEXT NOT NULL,
    topic_node_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started',
    visited_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, topic_node_id)
  )`,
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    token      TEXT NOT NULL PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  )`,
];

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

let studentToken: string;
const STUDENT_ID = 'gamif-student-1';

beforeAll(async () => {
  await env.DB.batch(MIGRATION_SQL.map(sql => env.DB.prepare(sql)));

  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, password_hash, status) VALUES (?, ?, ?, ?, 'active')`,
  ).bind(STUDENT_ID, 'Test Student', 'student@gamif.test', 'hash').run();

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  studentToken = await adapter.signAccessToken({
    sub: STUDENT_ID,
    email: 'student@gamif.test',
    roles: ['student'],
  });
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
// Auth guard — all endpoints return 401 without a token
// ---------------------------------------------------------------------------

describe('auth guard', () => {
  const endpoints = [
    '/me/xp',
    '/me/streak',
    '/me/badges',
    '/me/quests/daily',
    '/me/quests/weekly',
    '/me/missions',
    '/me/dashboard',
  ];

  for (const path of endpoints) {
    it(`GET ${path} → 401 without token`, async () => {
      const res = await req('GET', path);
      expect(res.status).toBe(401);
    });
  }
});

// ---------------------------------------------------------------------------
// Empty states — new user has no data → all return null
// ---------------------------------------------------------------------------

describe('GET /me/xp', () => {
  it('returns null for a user with no XP', async () => {
    const res = await req('GET', '/me/xp', { token: studentToken });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns XP data after seeding user_xp', async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO user_xp (user_id, total_xp) VALUES (?, ?)`,
    ).bind(STUDENT_ID, 150).run();

    const res = await req('GET', '/me/xp', { token: studentToken });
    expect(res.status).toBe(200);
    const body = await res.json<{ totalXp: number; level: number; rankTitle: string }>();
    expect(body.totalXp).toBe(150);
    expect(body.level).toBe(2);
    expect(body.rankTitle).toBe('Aspirante');
  });
});

describe('GET /me/streak', () => {
  it('returns null for a user with no streak', async () => {
    const res = await req('GET', '/me/streak', { token: studentToken });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns streak data after seeding', async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO user_streak (user_id, current_streak, longest_streak, last_activity_date) VALUES (?, ?, ?, ?)`,
    ).bind(STUDENT_ID, 5, 10, '2026-05-14').run();

    const res = await req('GET', '/me/streak', { token: studentToken });
    expect(res.status).toBe(200);
    const body = await res.json<{ currentStreak: number; longestStreak: number }>();
    expect(body.currentStreak).toBe(5);
    expect(body.longestStreak).toBe(10);
  });
});

describe('GET /me/badges', () => {
  it('returns null for a user with no badges', async () => {
    const res = await req('GET', '/me/badges', { token: studentToken });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

describe('GET /me/quests/daily', () => {
  it('returns null when no active daily quests exist', async () => {
    const res = await req('GET', '/me/quests/daily', { token: studentToken });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

describe('GET /me/quests/weekly', () => {
  it('returns null when no active weekly quests exist', async () => {
    const res = await req('GET', '/me/quests/weekly', { token: studentToken });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

describe('GET /me/missions', () => {
  it('returns null when no active missions exist', async () => {
    const res = await req('GET', '/me/missions', { token: studentToken });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

describe('GET /me/dashboard', () => {
  it('returns a DashboardShape with all null sections for a new user', async () => {
    const freshUserId = 'fresh-dashboard-user';
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`,
    ).bind(freshUserId, 'Fresh', 'fresh@gamif.test', 'hash').run();

    const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
    const freshToken = await adapter.signAccessToken({
      sub: freshUserId,
      email: 'fresh@gamif.test',
      roles: ['student'],
    });

    const res = await req('GET', '/me/dashboard', { token: freshToken });
    expect(res.status).toBe(200);
    const body = await res.json<{
      xp: null;
      streak: null;
      questsDaily: null;
      questsWeekly: null;
      missions: null;
      badges: null;
    }>();
    expect(body.xp).toBeNull();
    expect(body.streak).toBeNull();
    expect(body.questsDaily).toBeNull();
    expect(body.questsWeekly).toBeNull();
    expect(body.missions).toBeNull();
    expect(body.badges).toBeNull();
  });
});
