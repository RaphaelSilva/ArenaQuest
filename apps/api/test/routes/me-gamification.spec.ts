import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { JwtAuthAdapter } from '@api/adapters/auth';

// ---------------------------------------------------------------------------
// DB bootstrap
// ---------------------------------------------------------------------------


const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

let studentToken: string;
const STUDENT_ID = 'gamif-student-1';

beforeAll(async () => {
  await applyMigrations(env.DB);

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
  it('returns seeded daily quests with null progress for a new user', async () => {
    const res = await req('GET', '/me/quests/daily', { token: studentToken });
    expect(res.status).toBe(200);
    const body = await res.json<unknown[]>();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });
});

describe('GET /me/quests/weekly', () => {
  it('returns seeded weekly quests with null progress for a new user', async () => {
    const res = await req('GET', '/me/quests/weekly', { token: studentToken });
    expect(res.status).toBe(200);
    const body = await res.json<unknown[]>();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
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
  it('returns DashboardShape for a new user — xp/streak/badges/missions null, quests seeded', async () => {
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
    const body = await res.json<Record<string, unknown>>();
    expect(body.xp).toBeNull();
    expect(body.streak).toBeNull();
    expect(Array.isArray(body.questsDaily)).toBe(true);
    expect(Array.isArray(body.questsWeekly)).toBe(true);
    expect(body.missions).toBeNull();
    expect(body.badges).toBeNull();
  });
});
