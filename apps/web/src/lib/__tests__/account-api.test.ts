import { describe, it, expect, vi } from 'vitest';
import { createAccountApi, AccountApiError } from '../account-api';
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

describe('createAccountApi — getBadges', () => {
  const BADGE_RESPONSE = [
    { badge: { id: 'b1', iconEmoji: '🏆', name: 'Champion' }, earnedAt: '2026-01-01T00:00:00Z' },
    { badge: { id: 'b2', iconEmoji: '⭐', name: 'Star' }, earnedAt: '2026-02-01T00:00:00Z' },
  ];

  it('returns mapped BadgeItem array on success', async () => {
    const http = vi.fn().mockResolvedValueOnce(makeResponse({ jsonData: BADGE_RESPONSE }));
    const api = createAccountApi(http as unknown as HttpTransport);
    const result = await api.getBadges();
    expect(result).toEqual([
      { id: 'b1', emoji: '🏆', name: 'Champion', earned: true },
      { id: 'b2', emoji: '⭐', name: 'Star', earned: true },
    ]);
    expect(http).toHaveBeenCalledWith('GET', '/me/badges');
  });

  it('returns empty array for empty response', async () => {
    const http = vi.fn().mockResolvedValueOnce(makeResponse({ jsonData: [] }));
    const api = createAccountApi(http as unknown as HttpTransport);
    const result = await api.getBadges();
    expect(result).toEqual([]);
  });

  it('throws Unauthorized on 401', async () => {
    const http = vi.fn().mockResolvedValue(makeResponse({ ok: false, status: 401 }));
    const api = createAccountApi(http as unknown as HttpTransport);
    const err = await api.getBadges().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountApiError);
    expect((err as AccountApiError).code).toBe('Unauthorized');
    expect((err as AccountApiError).status).toBe(401);
  });

  it('throws Unknown on other non-ok responses', async () => {
    const http = vi.fn().mockResolvedValueOnce(makeResponse({ ok: false, status: 500 }));
    const api = createAccountApi(http as unknown as HttpTransport);
    await expect(api.getBadges()).rejects.toMatchObject({
      code: 'Unknown',
      status: 500,
    });
  });

  it('throws NetworkError on network failure', async () => {
    const http = vi.fn().mockRejectedValueOnce(new Error('network'));
    const api = createAccountApi(http as unknown as HttpTransport);
    await expect(api.getBadges()).rejects.toMatchObject({
      code: 'NetworkError',
      status: 0,
    });
  });
});
