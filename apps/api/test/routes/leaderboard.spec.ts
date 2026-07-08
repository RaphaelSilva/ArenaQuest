import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { JwtAuthAdapter } from '@api/adapters/auth';

// ---------------------------------------------------------------------------
// DB bootstrap
// ---------------------------------------------------------------------------


const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

let userAToken: string;
let userCToken: string;

const USER_A = 'lb-user-a';
const USER_B = 'lb-user-b';
const USER_C = 'lb-user-c';

beforeAll(async () => {
  await applyMigrations(env.DB);

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

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900, pbkdf2Iterations: 1 });
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
