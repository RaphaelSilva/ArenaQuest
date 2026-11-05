import { describe, expect, it, vi } from 'vitest';
import { createAdminEventsApi, type AdminEvent } from '../admin-events-api';
import type { HttpTransport } from '../api-client';

function makeResponse(jsonData: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(jsonData),
  } as unknown as Response;
}

const event: AdminEvent = {
  id: 'event-1',
  slug: 'event-1',
  title: 'Event one',
  summary: '',
  content: '',
  location: '',
  startsAt: '2026-10-10T13:00:00.000Z',
  endsAt: null,
  timezone: 'UTC',
  status: 'draft',
  audience: 'public',
  flyer: { status: 'none', key: null, type: null, sizeBytes: null, name: null },
  whatsappNumber: '',
  whatsappMessage: null,
  contactLabel: '',
  createdBy: 'admin-1',
  createdAt: '2026-09-23T00:00:00.000Z',
  updatedAt: '2026-09-23T00:00:00.000Z',
};

describe('createAdminEventsApi — findById', () => {
  it('loads the edit event with one request to its id endpoint', async () => {
    const http = vi.fn().mockResolvedValue(makeResponse(event));
    const api = createAdminEventsApi(http as unknown as HttpTransport);

    await expect(api.findById(event.id)).resolves.toEqual(event);
    expect(http).toHaveBeenCalledTimes(1);
    expect(http).toHaveBeenCalledWith('GET', `/admin/events/${event.id}`);
  });
});