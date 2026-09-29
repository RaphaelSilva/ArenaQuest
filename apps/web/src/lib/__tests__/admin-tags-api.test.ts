import { describe, it, expect, vi } from 'vitest';
import { createAdminTagsApi } from '../admin-tags-api';
import type { HttpTransport } from '../api-client';

function makeResponse(overrides: Partial<Response> & { jsonData?: unknown } = {}): Response {
  const { jsonData, ...rest } = overrides;
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(jsonData ?? {}),
    ...rest,
  } as unknown as Response;
}

const CHUDAN = { id: 't1', name: 'Chūdan', slug: 'chudan' };

describe('createAdminTagsApi — list', () => {
  it('issues GET /admin/tags with q and limit, and unwraps data', async () => {
    const http = vi.fn().mockResolvedValueOnce(makeResponse({ jsonData: { data: [CHUDAN] } }));
    const api = createAdminTagsApi(http as unknown as HttpTransport);
    const tags = await api.list({ q: 'chu', limit: 10 });
    expect(http).toHaveBeenCalledWith('GET', '/admin/tags?q=chu&limit=10');
    expect(tags).toEqual([CHUDAN]);
  });

  it('URL-encodes the query', async () => {
    const http = vi.fn().mockResolvedValueOnce(makeResponse({ jsonData: { data: [] } }));
    const api = createAdminTagsApi(http as unknown as HttpTransport);
    await api.list({ q: 'kihon novo&x=1' });
    const [, path] = http.mock.calls[0];
    expect(path).toBe('/admin/tags?q=kihon+novo%26x%3D1');
    expect(new URLSearchParams((path as string).split('?')[1]).get('q')).toBe('kihon novo&x=1');
  });

  it('omits the query string when no params are given', async () => {
    const http = vi.fn().mockResolvedValueOnce(makeResponse({ jsonData: { data: [] } }));
    const api = createAdminTagsApi(http as unknown as HttpTransport);
    await api.list();
    expect(http).toHaveBeenCalledWith('GET', '/admin/tags');
  });

  it('throws when the response is not ok', async () => {
    const http = vi.fn().mockResolvedValueOnce(makeResponse({ ok: false, status: 403 }));
    const api = createAdminTagsApi(http as unknown as HttpTransport);
    await expect(api.list({ q: 'chu' })).rejects.toThrow('Failed to list tags (403)');
  });
});
