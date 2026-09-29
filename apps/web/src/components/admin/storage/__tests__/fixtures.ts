import { vi } from 'vitest';
import type {
  ClassifiedObject,
  StorageBrowseResponse,
  StorageObjectDetail,
} from '@web/lib/admin-storage-api';

/**
 * A fake `HttpTransport`. The tests drive the real `createAdminStorageApi`
 * over it, so an assertion on a path is an assertion on the request that would
 * actually go out. A handler returns `{ status, body }` to answer non-200.
 */
export type Reply = unknown | { __status: number; body?: unknown };

export function makeTransport(handler: (method: string, path: string) => Reply) {
  return vi.fn(async (method: string, path: string) => {
    const reply = handler(method, path) as { __status?: number; body?: unknown } | undefined;
    const status = reply && typeof reply === 'object' && '__status' in reply ? reply.__status! : 200;
    const body = status === 200 ? reply : reply?.body;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body ?? {},
    } as unknown as Response;
  });
}

export function fail(status: number, error: string): Reply {
  return { __status: status, body: { error } };
}

export const TOPIC_ID = '3f2c0000-0000-4000-8000-000000000001';
export const EVENT_ID = 'e1e10000-0000-4000-8000-000000000002';

export const root: StorageBrowseResponse = {
  prefix: '',
  folders: [
    { prefix: 'events/', name: 'events', owner: null, ownerGone: false },
    { prefix: 'topics/', name: 'topics', owner: null, ownerGone: false },
  ],
  objects: [],
};

export const topicsFolder: StorageBrowseResponse = {
  prefix: 'topics/',
  folders: [
    {
      prefix: `topics/${TOPIC_ID}/`,
      name: TOPIC_ID,
      owner: { kind: 'topic', id: TOPIC_ID, title: '9th Kyu' },
      ownerGone: false,
    },
    { prefix: 'topics/gone-id/', name: 'gone-id', owner: null, ownerGone: true },
  ],
  objects: [],
};

export function mediaObject(overrides: Partial<ClassifiedObject> = {}): ClassifiedObject {
  const key = overrides.key ?? `topics/${TOPIC_ID}/a1-kata_final.mp4`;
  return {
    key,
    name: key.split('/').pop()!,
    size: 2 * 1024 * 1024,
    uploadedAt: '2026-09-29T12:00:00.000Z',
    contentType: 'video/mp4',
    status: 'linked',
    stale: false,
    hint: null,
    references: [
      {
        kind: 'media',
        key,
        mediaId: 'm1',
        status: 'ready',
        originalName: 'kata_final.mp4',
        type: 'video/mp4',
        sizeBytes: 2 * 1024 * 1024,
        uploaderId: 'u1',
        uploader: { id: 'u1', name: 'Ana' },
        topicId: TOPIC_ID,
        topic: { id: TOPIC_ID, title: '9th Kyu', status: 'published' },
        createdAt: '2026-09-29T12:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

export function flyerObject(overrides: Partial<ClassifiedObject> = {}): ClassifiedObject {
  const key = `events/${EVENT_ID}/flyer.png`;
  return {
    key,
    name: 'flyer.png',
    size: 300,
    uploadedAt: '2026-09-28T08:30:00.000Z',
    contentType: 'image/png',
    status: 'linked',
    stale: false,
    hint: null,
    references: [
      {
        kind: 'event-flyer',
        key,
        eventId: EVENT_ID,
        title: 'Summer Seminar',
        slug: 'summer-seminar',
        flyerStatus: 'ready',
        flyerName: 'flyer.png',
      },
    ],
    ...overrides,
  };
}

export function orphanObject(overrides: Partial<ClassifiedObject> = {}): ClassifiedObject {
  return {
    key: 'topics/gone-id/stray.pdf',
    name: 'stray.pdf',
    size: 1024,
    uploadedAt: '2026-09-01T00:00:00.000Z',
    contentType: 'application/pdf',
    status: 'orphan',
    stale: false,
    hint: 'owner-topic-gone',
    references: [],
    ...overrides,
  };
}

export function detailOf(object: ClassifiedObject): StorageObjectDetail {
  return {
    ...object,
    downloadUrl: `https://r2.example.test/${encodeURIComponent(object.key)}?sig=abc`,
    downloadUrlExpiresAt: '2026-09-29T12:05:00.000Z',
  };
}
