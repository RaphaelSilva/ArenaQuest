import { describe, it, expect, vi } from 'vitest';
import { createAdminTopicsApi } from '../admin-topics-api';
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

describe('createAdminTopicsApi — update', () => {
  it('issues PATCH /admin/topics/:id with visibility in body', async () => {
    const http = vi.fn().mockResolvedValueOnce(makeResponse({ jsonData: {} }));
    const api = createAdminTopicsApi(http as unknown as HttpTransport);
    await api.update('topic-abc', { visibility: 'public' });
    expect(http).toHaveBeenCalledWith(
      'PATCH',
      '/admin/topics/topic-abc',
      expect.objectContaining({
        body: expect.stringContaining('"visibility":"public"'),
      }),
    );
  });

  it('passes visibility:restricted correctly', async () => {
    const http = vi.fn().mockResolvedValueOnce(makeResponse({ jsonData: {} }));
    const api = createAdminTopicsApi(http as unknown as HttpTransport);
    await api.update('topic-xyz', { visibility: 'restricted' });
    const [, , opts] = http.mock.calls[0];
    const body = JSON.parse((opts as { body: string }).body);
    expect(body.visibility).toBe('restricted');
  });

  it('passes visibility:private correctly', async () => {
    const http = vi.fn().mockResolvedValueOnce(makeResponse({ jsonData: {} }));
    const api = createAdminTopicsApi(http as unknown as HttpTransport);
    await api.update('topic-xyz', { visibility: 'private' });
    const [, , opts] = http.mock.calls[0];
    const body = JSON.parse((opts as { body: string }).body);
    expect(body.visibility).toBe('private');
  });

  it('throws when response is not ok', async () => {
    const http = vi.fn().mockResolvedValueOnce(
      makeResponse({ ok: false, status: 404, jsonData: { error: 'Not found' } }),
    );
    const api = createAdminTopicsApi(http as unknown as HttpTransport);
    await expect(api.update('topic-abc', { visibility: 'public' })).rejects.toThrow('Not found');
  });
});
