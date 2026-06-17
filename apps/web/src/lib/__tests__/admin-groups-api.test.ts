import { describe, it, expect, vi } from 'vitest';
import { createAdminGroupsApi } from '../admin-groups-api';
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

const fakeGroups = [
  { id: 'g1', name: 'Alpha', description: 'First group', memberCount: 5, createdAt: '2024-01-01T00:00:00Z' },
  { id: 'g2', name: 'Beta', description: 'Second group', memberCount: 3, createdAt: '2024-02-01T00:00:00Z' },
];

describe('createAdminGroupsApi — list', () => {
  it('issues GET /admin/groups', async () => {
    const http = vi.fn().mockResolvedValueOnce(makeResponse({ jsonData: { data: fakeGroups } }));
    const api = createAdminGroupsApi(http as unknown as HttpTransport);
    await api.list();
    expect(http).toHaveBeenCalledWith('GET', '/admin/groups');
  });

  it('returns body.data array', async () => {
    const http = vi.fn().mockResolvedValueOnce(makeResponse({ jsonData: { data: fakeGroups } }));
    const api = createAdminGroupsApi(http as unknown as HttpTransport);
    const result = await api.list();
    expect(result).toEqual(fakeGroups);
  });

  it('throws when response is not ok', async () => {
    const http = vi.fn().mockResolvedValueOnce(
      makeResponse({ ok: false, status: 403, jsonData: {} }),
    );
    const api = createAdminGroupsApi(http as unknown as HttpTransport);
    await expect(api.list()).rejects.toThrow('Failed to list groups (403)');
  });
});
