import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

let adminToken: string;
let contentCreatorToken: string;
let studentToken: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [adminToken, contentCreatorToken, studentToken] = await Promise.all([
    adapter.signAccessToken({ sub: 'admin-tags-test', email: 'admin@tags.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: 'cc-tags-test', email: 'cc@tags.test', roles: ['content_creator'] }),
    adapter.signAccessToken({ sub: 'student-tags-test', email: 'student@tags.test', roles: ['student'] }),
  ]);

  const insert = env.DB.prepare('INSERT OR IGNORE INTO tags (id, name, slug) VALUES (?, ?, ?)');
  await env.DB.batch([
    insert.bind(crypto.randomUUID(), 'Chūdan', 'chudan'),
    insert.bind(crypto.randomUUID(), 'Chūdan Tsuki', 'chudan-tsuki'),
    insert.bind(crypto.randomUUID(), 'Jōdan', 'jodan'),
  ]);
});

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function get(path: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const request = new IncomingRequest(`http://example.com${v1(path)}`, { method: 'GET', headers });
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

type TagList = { data: { id: string; name: string; slug: string }[] };

describe('GET /admin/tags', () => {
  it('returns tags whose slug starts with slugify(q), ordered by slug, for admin', async () => {
    const res = await get('/admin/tags?q=chu', adminToken);
    expect(res.status).toBe(200);
    const { data } = await res.json<TagList>();
    expect(data.map(t => t.slug)).toEqual(['chudan', 'chudan-tsuki']);
    expect(data[0].name).toBe('Chūdan');
  });

  it('returns chudan for content_creator, slugifying an accented, upper-case q', async () => {
    const res = await get(`/admin/tags?q=${encodeURIComponent('CHŪ')}`, contentCreatorToken);
    expect(res.status).toBe(200);
    const { data } = await res.json<TagList>();
    expect(data.map(t => t.slug)).toContain('chudan');
  });

  it('honours limit', async () => {
    const res = await get('/admin/tags?q=chu&limit=1', adminToken);
    expect(res.status).toBe(200);
    const { data } = await res.json<TagList>();
    expect(data).toHaveLength(1);
  });

  it('lists from the start when q is omitted', async () => {
    const res = await get('/admin/tags', adminToken);
    expect(res.status).toBe(200);
    const { data } = await res.json<TagList>();
    expect(data.map(t => t.slug)).toEqual(expect.arrayContaining(['chudan', 'jodan']));
  });

  it('returns 400 when limit exceeds 100', async () => {
    const res = await get('/admin/tags?limit=500', adminToken);
    expect(res.status).toBe(400);
  });

  it('returns 403 for a student', async () => {
    const res = await get('/admin/tags?q=chu', studentToken);
    expect(res.status).toBe(403);
  });

  it('returns 401 without a token', async () => {
    const res = await get('/admin/tags?q=chu');
    expect(res.status).toBe(401);
  });
});
