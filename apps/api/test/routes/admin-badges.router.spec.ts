import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

let adminToken: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  adminToken = await adapter.signAccessToken({ sub: 'admin-badges-test', email: 'admin@badges.test', roles: ['admin'] });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function adminRequest(
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /admin/badges', () => {
  it('returns 200 with empty data array on fresh DB', async () => {
    const res = await adminRequest('GET', '/admin/badges');
    expect(res.status).toBe(200);
    const body = await res.json<{ data: unknown[] }>();
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('POST /admin/badges', () => {
  it('returns 400 with ValidationErrorBody for invalid body (missing slug)', async () => {
    const res = await adminRequest('POST', '/admin/badges', {
      name: 'Missing Slug Badge',
      iconEmoji: '🔥',
      ruleKind: 'streak_days',
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; issues: unknown[] }>();
    expect(body.error).toBe('ValidationError');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('creates a badge and returns 201 for valid body', async () => {
    const res = await adminRequest('POST', '/admin/badges', {
      slug: 'router-test-badge',
      name: 'Router Test Badge',
      iconEmoji: '🏆',
      ruleKind: 'total_xp',
      xpReward: 50,
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ data: { slug: string; name: string } }>();
    expect(body.data.slug).toBe('router-test-badge');
    expect(body.data.name).toBe('Router Test Badge');
  });
});

describe('PATCH /admin/badges/:id', () => {
  it('returns 400 with ValidationErrorBody for invalid ruleKind', async () => {
    const res = await adminRequest('PATCH', '/admin/badges/a1b2c3d4-e5f6-7890-1234-567890abcdef', {
      ruleKind: 'invalid_rule_kind',
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; issues: unknown[] }>();
    expect(body.error).toBe('ValidationError');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('returns 404 for non-existent id', async () => {
    const res = await adminRequest('PATCH', '/admin/badges/a1b2c3d4-e5f6-7890-1234-567890abcdef', {
      name: 'Updated Name',
    });
    expect(res.status).toBe(404);
  });
});
