import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

type LevelRow = { level: number; rankTitle: string; minXp: number; maxXp: number | null };

let adminToken: string;
let creatorToken: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [adminToken, creatorToken] = await Promise.all([
    adapter.signAccessToken({ sub: 'admin-levels-test', email: 'admin@levels.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: 'cc-levels-test', email: 'cc@levels.test', roles: ['content_creator'] }),
  ]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function levelsRequest(
  method: string,
  path: string,
  body?: unknown,
  token = adminToken,
): Promise<Response> {
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

const VALID_CURVE: LevelRow[] = [
  { level: 1, rankTitle: 'Bronze', minXp: 0, maxXp: 100 },
  { level: 2, rankTitle: 'Silver', minXp: 100, maxXp: 300 },
  { level: 3, rankTitle: 'Gold', minXp: 300, maxXp: null },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /admin/levels', () => {
  it('returns rows ordered by level', async () => {
    const res = await levelsRequest('GET', '/admin/levels');
    expect(res.status).toBe(200);
    const body = await res.json<LevelRow[]>();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    const levels = body.map((r) => r.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });
});

describe('PUT /admin/levels — happy path', () => {
  it('persists a valid curve and reflects it on a follow-up GET', async () => {
    const putRes = await levelsRequest('PUT', '/admin/levels', VALID_CURVE);
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json<LevelRow[]>();
    expect(putBody).toEqual(VALID_CURVE);

    const getRes = await levelsRequest('GET', '/admin/levels');
    const getBody = await getRes.json<LevelRow[]>();
    expect(getBody).toEqual(VALID_CURVE);
  });
});

describe('PUT /admin/levels — curve validation (400)', () => {
  it('rejects a non-monotonic minXp', async () => {
    const res = await levelsRequest('PUT', '/admin/levels', [
      { level: 1, rankTitle: 'Bronze', minXp: 0, maxXp: 100 },
      { level: 2, rankTitle: 'Silver', minXp: 0, maxXp: 300 },
      { level: 3, rankTitle: 'Gold', minXp: 300, maxXp: null },
    ]);
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('ValidationError');
  });

  it('rejects a gapped / overlapping curve', async () => {
    const res = await levelsRequest('PUT', '/admin/levels', [
      { level: 1, rankTitle: 'Bronze', minXp: 0, maxXp: 100 },
      { level: 2, rankTitle: 'Silver', minXp: 150, maxXp: 300 },
      { level: 3, rankTitle: 'Gold', minXp: 300, maxXp: null },
    ]);
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('ValidationError');
  });

  it('rejects a curve with zero maxXp = null rows', async () => {
    const res = await levelsRequest('PUT', '/admin/levels', [
      { level: 1, rankTitle: 'Bronze', minXp: 0, maxXp: 100 },
      { level: 2, rankTitle: 'Silver', minXp: 100, maxXp: 300 },
    ]);
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('ValidationError');
  });

  it('rejects a curve with two maxXp = null rows', async () => {
    const res = await levelsRequest('PUT', '/admin/levels', [
      { level: 1, rankTitle: 'Bronze', minXp: 0, maxXp: null },
      { level: 2, rankTitle: 'Silver', minXp: 100, maxXp: null },
    ]);
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('ValidationError');
  });

  it('leaves the prior curve intact after a rejected PUT', async () => {
    // Establish a known-good curve first.
    await levelsRequest('PUT', '/admin/levels', VALID_CURVE);

    // Now submit an invalid curve.
    const bad = await levelsRequest('PUT', '/admin/levels', [
      { level: 1, rankTitle: 'X', minXp: 0, maxXp: 50 },
      { level: 2, rankTitle: 'Y', minXp: 25, maxXp: null },
    ]);
    expect(bad.status).toBe(400);

    // The prior curve must be unchanged.
    const getRes = await levelsRequest('GET', '/admin/levels');
    const getBody = await getRes.json<LevelRow[]>();
    expect(getBody).toEqual(VALID_CURVE);
  });
});

describe('PUT/GET /admin/levels — ADMIN-only role gate', () => {
  it('rejects a CONTENT_CREATOR on GET with 403', async () => {
    const res = await levelsRequest('GET', '/admin/levels', undefined, creatorToken);
    expect(res.status).toBe(403);
  });

  it('rejects a CONTENT_CREATOR on PUT with 403', async () => {
    const res = await levelsRequest('PUT', '/admin/levels', VALID_CURVE, creatorToken);
    expect(res.status).toBe(403);
  });

  it('allows an ADMIN on GET', async () => {
    const res = await levelsRequest('GET', '/admin/levels', undefined, adminToken);
    expect(res.status).toBe(200);
  });
});
