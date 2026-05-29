import { describe, it, expect, vi } from 'vitest';
import { createTopicsApi } from '../topics-api';
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

describe('createTopicsApi — markVideoWatched', () => {
  it('resolves void on success', async () => {
    const http = vi.fn().mockResolvedValueOnce(makeResponse({ status: 200 }));
    const api = createTopicsApi(http as unknown as HttpTransport);
    await expect(api.markVideoWatched('topic1', 'media1')).resolves.toBeUndefined();
    expect(http).toHaveBeenCalledWith('POST', '/topics/topic1/videos/media1/watched');
  });

  it('swallows network errors silently (non-blocking beacon)', async () => {
    const http = vi.fn().mockRejectedValueOnce(new Error('network'));
    const api = createTopicsApi(http as unknown as HttpTransport);
    await expect(api.markVideoWatched('topic1', 'media1')).resolves.toBeUndefined();
  });

  it('swallows non-ok responses silently', async () => {
    const http = vi.fn().mockResolvedValueOnce(makeResponse({ ok: false, status: 401 }));
    const api = createTopicsApi(http as unknown as HttpTransport);
    await expect(api.markVideoWatched('topic1', 'media1')).resolves.toBeUndefined();
  });
});
