import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

const ADMIN_SUB = 'admin-progression-test';
const PLAYER_ID = 'player-progression-test';
const BADGE_ID = 'badge-alicerce-solido'; // seeded by migration 0021

let adminToken: string;
let creatorToken: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [adminToken, creatorToken] = await Promise.all([
    adapter.signAccessToken({ sub: ADMIN_SUB, email: 'admin@progression.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: 'cc-progression-test', email: 'cc@progression.test', roles: ['content_creator'] }),
  ]);
});

beforeEach(async () => {
  // Clean slate for the player on every test.
  await env.DB.prepare('DELETE FROM xp_events WHERE user_id = ?').bind(PLAYER_ID).run();
  await env.DB.prepare('DELETE FROM user_xp WHERE user_id = ?').bind(PLAYER_ID).run();
  await env.DB.prepare('DELETE FROM user_badges WHERE user_id = ?').bind(PLAYER_ID).run();
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(PLAYER_ID).run();
  await env.DB
    .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .bind(PLAYER_ID, 'Player', `${PLAYER_ID}@progression.test`, 'hash')
    .run();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function req(method: string, path: string, body?: unknown, token = adminToken): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const request = new IncomingRequest(`http://example.com${v1(path)}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function countXpEvents(): Promise<number> {
  const row = await env.DB
    .prepare('SELECT COUNT(*) AS cnt FROM xp_events WHERE user_id = ?')
    .bind(PLAYER_ID)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

async function countAdminAdjustments(): Promise<{ cnt: number; sourceIds: string[] }> {
  const { results } = await env.DB
    .prepare("SELECT source_id FROM xp_events WHERE user_id = ? AND source_kind = 'admin_adjustment'")
    .bind(PLAYER_ID)
    .all<{ source_id: string }>();
  return { cnt: results.length, sourceIds: results.map((r) => r.source_id) };
}

async function getTotalXp(): Promise<number | null> {
  const row = await env.DB
    .prepare('SELECT total_xp FROM user_xp WHERE user_id = ?')
    .bind(PLAYER_ID)
    .first<{ total_xp: number }>();
  return row ? row.total_xp : null;
}

// ---------------------------------------------------------------------------
// GET progression
// ---------------------------------------------------------------------------

describe('GET /admin/players/{userId}/progression', () => {
  it('returns the PlayerProgression shape with XP, level/rank, badges, recent events', async () => {
    await env.DB
      .prepare('INSERT INTO user_xp (user_id, total_xp) VALUES (?, ?)')
      .bind(PLAYER_ID, 150)
      .run();
    await env.DB
      .prepare('INSERT INTO user_badges (id, user_id, badge_id) VALUES (?, ?, ?)')
      .bind(crypto.randomUUID(), PLAYER_ID, BADGE_ID)
      .run();
    await env.DB
      .prepare(
        'INSERT INTO xp_events (id, user_id, source_kind, source_id, points, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(crypto.randomUUID(), PLAYER_ID, 'topic_completed', 't1', 100, 'k1')
      .run();
    await env.DB
      .prepare(
        'INSERT INTO xp_events (id, user_id, source_kind, source_id, points, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(crypto.randomUUID(), PLAYER_ID, 'topic_completed', 't2', 50, 'k2')
      .run();

    const res = await req('GET', `/admin/players/${PLAYER_ID}/progression`);
    expect(res.status).toBe(200);
    const body = await res.json<{
      userId: string;
      xp: { totalXp: number; level: number; rankTitle: string };
      badges: Array<{ badgeId: string; slug: string; name: string; earnedAt: string }>;
      recentXpEvents: Array<{ id: string; sourceKind: string; points: number; earnedAt: string }>;
    }>();

    expect(body.userId).toBe(PLAYER_ID);
    expect(body.xp.totalXp).toBe(150);
    expect(typeof body.xp.level).toBe('number');
    expect(typeof body.xp.rankTitle).toBe('string');
    expect(body.badges).toHaveLength(1);
    expect(body.badges[0].badgeId).toBe(BADGE_ID);
    expect(body.recentXpEvents).toHaveLength(2);
  });

  it('returns zeroed XP and empty arrays for an untouched player', async () => {
    const res = await req('GET', `/admin/players/${PLAYER_ID}/progression`);
    expect(res.status).toBe(200);
    const body = await res.json<{ xp: { totalXp: number }; badges: unknown[]; recentXpEvents: unknown[] }>();
    expect(body.xp.totalXp).toBe(0);
    expect(body.badges).toEqual([]);
    expect(body.recentXpEvents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Award / revoke badge
// ---------------------------------------------------------------------------

describe('DELETE /admin/players/{userId}/badges/{badgeId}', () => {
  it('removes the user_badges row and a follow-up read omits it', async () => {
    const award = await req('POST', `/admin/players/${PLAYER_ID}/badges/${BADGE_ID}`);
    expect(award.status).toBe(200);

    const del = await req('DELETE', `/admin/players/${PLAYER_ID}/badges/${BADGE_ID}`);
    expect(del.status).toBe(204);

    const res = await req('GET', `/admin/players/${PLAYER_ID}/progression`);
    const body = await res.json<{ badges: unknown[] }>();
    expect(body.badges).toEqual([]);
  });

  it('returns 404 when revoking a badge the user does not hold', async () => {
    const res = await req('DELETE', `/admin/players/${PLAYER_ID}/badges/${BADGE_ID}`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// XP adjustments
// ---------------------------------------------------------------------------

describe('POST /admin/players/{userId}/xp-adjustments', () => {
  it('applies a positive adjustment: one admin_adjustment row with admin sub as source_id', async () => {
    const res = await req('POST', `/admin/players/${PLAYER_ID}/xp-adjustments`, {
      points: 200,
      reason: 'Manual award',
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ previousTotal: number; newTotal: number }>();
    expect(body.previousTotal).toBe(0);
    expect(body.newTotal).toBe(200);

    const { cnt, sourceIds } = await countAdminAdjustments();
    expect(cnt).toBe(1);
    expect(sourceIds[0]).toBe(ADMIN_SUB);
    expect(await getTotalXp()).toBe(200);
  });

  it('applies a negative adjustment and never lets total_xp drop below 0', async () => {
    await req('POST', `/admin/players/${PLAYER_ID}/xp-adjustments`, { points: 50, reason: 'seed' });

    const res = await req('POST', `/admin/players/${PLAYER_ID}/xp-adjustments`, {
      points: -200,
      reason: 'Correction',
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ newTotal: number }>();
    expect(body.newTotal).toBe(0);

    const { cnt, sourceIds } = await countAdminAdjustments();
    expect(cnt).toBe(2);
    expect(sourceIds.every((id) => id === ADMIN_SUB)).toBe(true);
    expect(await getTotalXp()).toBe(0);
  });

  it('rejects a missing reason with 400 and writes no ledger row', async () => {
    const res = await req('POST', `/admin/players/${PLAYER_ID}/xp-adjustments`, { points: 10 });
    expect(res.status).toBe(400);
    expect(await countXpEvents()).toBe(0);
  });

  it('rejects an empty/whitespace reason with 400 and writes no ledger row', async () => {
    const res = await req('POST', `/admin/players/${PLAYER_ID}/xp-adjustments`, { points: 10, reason: '   ' });
    expect(res.status).toBe(400);
    expect(await countXpEvents()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Recompute
// ---------------------------------------------------------------------------

describe('POST /admin/players/{userId}/xp-recompute', () => {
  it('restores total_xp to MAX(0, SUM(points)), returns before/after, appends no new event', async () => {
    await env.DB
      .prepare(
        'INSERT INTO xp_events (id, user_id, source_kind, source_id, points, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(crypto.randomUUID(), PLAYER_ID, 'topic_completed', null, 120, 'rc1')
      .run();
    await env.DB
      .prepare(
        'INSERT INTO xp_events (id, user_id, source_kind, source_id, points, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(crypto.randomUUID(), PLAYER_ID, 'topic_completed', null, 30, 'rc2')
      .run();
    // Drift the read model away from the ledger sum (150).
    await env.DB.prepare('INSERT INTO user_xp (user_id, total_xp) VALUES (?, ?)').bind(PLAYER_ID, 9999).run();

    const before = await countXpEvents();

    const res = await req('POST', `/admin/players/${PLAYER_ID}/xp-recompute`);
    expect(res.status).toBe(200);
    const body = await res.json<{ previousTotal: number; newTotal: number }>();
    expect(body.previousTotal).toBe(9999);
    expect(body.newTotal).toBe(150);

    expect(await getTotalXp()).toBe(150);
    expect(await countXpEvents()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Role gate — ADMIN only
// ---------------------------------------------------------------------------

describe('ADMIN-only role gate (CONTENT_CREATOR rejected)', () => {
  it('rejects CONTENT_CREATOR on every endpoint with 403', async () => {
    const calls: Array<Promise<Response>> = [
      req('GET', `/admin/players/${PLAYER_ID}/progression`, undefined, creatorToken),
      req('POST', `/admin/players/${PLAYER_ID}/badges/${BADGE_ID}`, undefined, creatorToken),
      req('DELETE', `/admin/players/${PLAYER_ID}/badges/${BADGE_ID}`, undefined, creatorToken),
      req('POST', `/admin/players/${PLAYER_ID}/xp-adjustments`, { points: 10, reason: 'x' }, creatorToken),
      req('POST', `/admin/players/${PLAYER_ID}/xp-recompute`, undefined, creatorToken),
    ];
    const results = await Promise.all(calls);
    for (const res of results) {
      expect(res.status).toBe(403);
    }
  });
});
