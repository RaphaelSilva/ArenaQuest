import { describe, it, expect, vi, afterEach } from 'vitest';
import { authApi, REFRESH_LOCK_NAME } from '../auth-api';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function okResponse(accessToken: string): Response {
  return { ok: true, status: 200, json: () => Promise.resolve({ accessToken }) } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('authApi.refresh — rotation is serialised', () => {
  it('shares one request between concurrent callers in the same tab', async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetchMock);

    const a = authApi.refresh();
    const b = authApi.refresh();
    pending.resolve(okResponse('tok-1'));

    await expect(a).resolves.toEqual({ accessToken: 'tok-1' });
    await expect(b).resolves.toEqual({ accessToken: 'tok-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a new request once the previous one settled', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse('tok-1'))
      .mockResolvedValueOnce(okResponse('tok-2'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(authApi.refresh()).resolves.toEqual({ accessToken: 'tok-1' });
    await expect(authApi.refresh()).resolves.toEqual({ accessToken: 'tok-2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null on a rejected refresh and does not stick', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
      .mockResolvedValueOnce(okResponse('tok-2'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(authApi.refresh()).resolves.toBeNull();
    await expect(authApi.refresh()).resolves.toEqual({ accessToken: 'tok-2' });
  });

  it('holds the cross-tab Web Lock while the request is in flight', async () => {
    const request = vi.fn((_name: string, cb: () => Promise<unknown>) => cb());
    vi.stubGlobal('navigator', { locks: { request } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('tok-1')));

    await expect(authApi.refresh()).resolves.toEqual({ accessToken: 'tok-1' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(REFRESH_LOCK_NAME);
  });
});
