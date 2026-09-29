import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AdminStorageController,
  classifyObject,
  PREVIEW_URL_TTL_SECONDS,
} from '@api/controllers/admin-storage.controller';
import { ORPHAN_GRACE_MS } from '@arenaquest/shared/domain/storage';
import type {
  IStorageAdapter,
  IStorageReferenceRepository,
  ListObjectsOptions,
  ListObjectsResult,
  StorageObject,
  StorageReference,
  MediaStorageReference,
  EventFlyerStorageReference,
  ExistingOwnersQuery,
  ListReferencedKeysOptions,
} from '@arenaquest/shared/ports';

/**
 * Controller-level spec over in-memory ports: the classification rule, the
 * orphan hints, folder labels, paging and the 24 h `stale` flag (which needs a
 * controllable clock — a real R2 object cannot be back-dated).
 */

const NOW = Date.parse('2026-09-29T12:00:00Z');
const HOUR = 60 * 60 * 1000;

const TOPIC = '11111111-1111-4111-8111-111111111111';
const GONE_TOPIC = '22222222-2222-4222-8222-222222222222';
const EVENT = '33333333-3333-4333-8333-333333333333';
const GONE_EVENT = '44444444-4444-4444-8444-444444444444';
const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

const mediaKey = (topic: string, n: number) => `topics/${topic}/${uuid(n)}-file-${n}.pdf`;
const flyerKey = (event: string, n: number) => `events/${event}/flyer-${uuid(n)}-flyer.png`;

class FakeStorage implements IStorageAdapter {
  objects = new Map<string, StorageObject>();
  listCalls: { prefix: string; options?: ListObjectsOptions }[] = [];
  /** Force every list page to be at most this many entries (simulates R2 short pages). */
  maxPage = Infinity;

  put(key: string, ageMs = HOUR) {
    this.objects.set(key, { key, size: 10, lastModified: new Date(NOW - ageMs), contentType: 'application/pdf' });
  }

  async listObjects(prefix: string, options?: ListObjectsOptions): Promise<ListObjectsResult> {
    this.listCalls.push({ prefix, options });
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const entries: ({ kind: 'o'; key: string } | { kind: 'p'; prefix: string })[] = [];
    const seen = new Set<string>();
    for (const k of keys) {
      const rest = k.slice(prefix.length);
      const idx = options?.delimiter ? rest.indexOf(options.delimiter) : -1;
      if (idx >= 0) {
        const p = prefix + rest.slice(0, idx + 1);
        if (!seen.has(p)) {
          seen.add(p);
          entries.push({ kind: 'p', prefix: p });
        }
      } else {
        entries.push({ kind: 'o', key: k });
      }
    }
    const start = options?.cursor ? Number(options.cursor) : 0;
    const size = Math.min(options?.limit ?? 100, this.maxPage);
    const slice = entries.slice(start, start + size);
    const end = start + slice.length;
    return {
      objects: slice.flatMap((e) => (e.kind === 'o' ? [this.objects.get(e.key)!] : [])),
      prefixes: slice.flatMap((e) => (e.kind === 'p' ? [e.prefix] : [])),
      nextCursor: end < entries.length ? String(end) : undefined,
    };
  }

  async headObject(key: string) {
    return this.objects.get(key) ?? null;
  }
  async objectExists(key: string) {
    return this.objects.has(key);
  }
  getPresignedDownloadUrl = vi.fn(async (key: string) => `https://signed.example/${encodeURIComponent(key)}`);

  putObject = vi.fn();
  getObject = vi.fn();
  deleteObject = vi.fn(async (key: string) => {
    this.objects.delete(key);
  });
  deleteObjects = vi.fn();
  getPresignedUploadUrl = vi.fn();
  getPublicUrl = vi.fn();
}

class FakeRefs implements IStorageReferenceRepository {
  refs: StorageReference[] = [];
  topics = new Map<string, string>([[TOPIC, 'Kata Basics']]);
  events = new Map<string, string>([[EVENT, 'Summer Seminar']]);
  existingOwnersCalls: ExistingOwnersQuery[] = [];

  async resolveKeys(keys: readonly string[]) {
    const out = new Map<string, StorageReference[]>();
    for (const r of this.refs) {
      if (!keys.includes(r.key)) continue;
      out.set(r.key, [...(out.get(r.key) ?? []), r]);
    }
    return out;
  }

  async existingOwners(q: ExistingOwnersQuery) {
    this.existingOwnersCalls.push(q);
    const pick = (ids: readonly string[] | undefined, src: Map<string, string>) =>
      new Map((ids ?? []).filter((id) => src.has(id)).map((id) => [id, src.get(id)!] as const));
    return { topics: pick(q.topicIds, this.topics), events: pick(q.eventIds, this.events) };
  }

  async listReferencedKeys({ cursor, limit }: ListReferencedKeysOptions) {
    if (cursor === 'bad') {
      const err = new Error('Invalid storage reference cursor');
      err.name = 'InvalidStorageReferenceCursorError';
      throw err;
    }
    const live = this.refs.filter((r) => r.kind !== 'media' || r.status !== 'deleted');
    const start = cursor ? Number(cursor) : 0;
    const items = live.slice(start, start + limit);
    const end = start + items.length;
    return { items, ...(end < live.length ? { nextCursor: String(end) } : {}) };
  }
}

function media(key: string, status: MediaStorageReference['status'], topic = TOPIC): MediaStorageReference {
  return {
    kind: 'media',
    key,
    mediaId: uuid(99),
    status,
    originalName: 'Lesson One.pdf',
    type: 'application/pdf',
    sizeBytes: 10,
    uploaderId: 'u1',
    uploader: { id: 'u1', name: 'Ada' },
    topicId: topic,
    topic: { id: topic, title: 'Kata Basics', status: 'published' },
    createdAt: new Date(NOW - HOUR),
  };
}

function flyer(
  key: string,
  kind: EventFlyerStorageReference['kind'],
  flyerStatus: EventFlyerStorageReference['flyerStatus'],
): EventFlyerStorageReference {
  return { kind, key, eventId: EVENT, title: 'Summer Seminar', slug: 'summer', flyerStatus, flyerName: 'flyer.png' };
}

/** One fixture object per status / hint, all inside TOPIC's folder or EVENT's. */
function fixtures() {
  const storage = new FakeStorage();
  const refs = new FakeRefs();
  const k = {
    linkedMedia: mediaKey(TOPIC, 1),
    pending: mediaKey(TOPIC, 2),
    stalePending: mediaKey(TOPIC, 3),
    deletedRow: mediaKey(TOPIC, 4),
    rowGone: mediaKey(TOPIC, 5),
    topicGone: mediaKey(GONE_TOPIC, 6),
    linkedFlyer: flyerKey(EVENT, 7),
    displaced: flyerKey(EVENT, 8),
    eventGone: flyerKey(GONE_EVENT, 9),
    unknown: 'misc/readme.txt',
  };
  for (const key of Object.values(k)) storage.put(key);
  storage.put(k.stalePending, ORPHAN_GRACE_MS + HOUR);
  refs.refs.push(
    media(k.linkedMedia, 'ready'),
    media(k.pending, 'pending'),
    media(k.stalePending, 'pending'),
    media(k.deletedRow, 'deleted'),
    flyer(k.linkedFlyer, 'event-flyer', 'ready'),
    flyer(k.displaced, 'event-flyer-displaced', 'pending'),
  );
  return { storage, refs, k, controller: new AdminStorageController(storage, refs, () => NOW) };
}

const noOwners = { topicExists: () => false, eventExists: () => false };

describe('classifyObject', () => {
  const obj = (key: string, ageMs = HOUR) => ({ key, lastModified: new Date(NOW - ageMs) });

  it('prefers linked over every weaker reference', () => {
    const key = mediaKey(TOPIC, 1);
    const c = classifyObject(obj(key), [media(key, 'deleted'), media(key, 'pending'), media(key, 'ready')], noOwners, NOW);
    expect(c).toEqual({ status: 'linked', stale: false, hint: null });
  });

  it('treats a pending flyer as pending, and a flyer with no other ref as linked when ready', () => {
    const key = flyerKey(EVENT, 1);
    expect(classifyObject(obj(key), [flyer(key, 'event-flyer', 'pending')], noOwners, NOW).status).toBe('pending');
    expect(classifyObject(obj(key), [flyer(key, 'event-flyer', 'ready')], noOwners, NOW).status).toBe('linked');
  });

  it('sets stale only past the 24 h grace window', () => {
    const key = mediaKey(TOPIC, 1);
    const refs = [media(key, 'pending')];
    expect(classifyObject(obj(key, ORPHAN_GRACE_MS - 1), refs, noOwners, NOW).stale).toBe(false);
    expect(classifyObject(obj(key, ORPHAN_GRACE_MS + 1), refs, noOwners, NOW).stale).toBe(true);
  });

  it('ranks displaced above deleted-row', () => {
    const key = flyerKey(EVENT, 1);
    const c = classifyObject(obj(key), [media(key, 'deleted'), flyer(key, 'event-flyer-displaced', 'ready')], noOwners, NOW);
    expect(c.status).toBe('displaced');
  });
});

describe('AdminStorageController.browse', () => {
  it('labels topic and event folders with their owner title, flagging a gone owner', async () => {
    const { controller, refs } = fixtures();

    const topics = await controller.browse({ prefix: 'topics/' });
    expect(topics.ok).toBe(true);
    if (!topics.ok) return;
    expect(topics.data.objects).toEqual([]);
    expect(topics.data.folders).toEqual([
      { prefix: `topics/${TOPIC}/`, name: TOPIC, owner: { kind: 'topic', id: TOPIC, title: 'Kata Basics' }, ownerGone: false },
      { prefix: `topics/${GONE_TOPIC}/`, name: GONE_TOPIC, owner: null, ownerGone: true },
    ]);
    expect(refs.existingOwnersCalls).toHaveLength(1);

    const events = await controller.browse({ prefix: 'events/' });
    if (!events.ok) throw new Error('expected ok');
    expect(events.data.folders.map((f) => [f.name, f.owner?.title ?? null, f.ownerGone])).toEqual([
      [EVENT, 'Summer Seminar', false],
      [GONE_EVENT, null, true],
    ]);

    const root = await controller.browse({ prefix: '' });
    if (!root.ok) throw new Error('expected ok');
    expect(root.data.folders.map((f) => [f.prefix, f.owner, f.ownerGone])).toEqual([
      ['events/', null, false],
      ['misc/', null, false],
      ['topics/', null, false],
    ]);
  });

  it('classifies every object in a topic folder', async () => {
    const { controller, k } = fixtures();
    const res = await controller.browse({ prefix: `topics/${TOPIC}/` });
    if (!res.ok) throw new Error('expected ok');

    const byKey = new Map(res.data.objects.map((o) => [o.key, o]));
    expect(byKey.get(k.linkedMedia)).toMatchObject({ status: 'linked', stale: false, hint: null });
    expect(byKey.get(k.pending)).toMatchObject({ status: 'pending', stale: false, hint: null });
    expect(byKey.get(k.stalePending)).toMatchObject({ status: 'pending', stale: true, hint: null });
    expect(byKey.get(k.deletedRow)).toMatchObject({ status: 'deleted-row', hint: null });
    expect(byKey.get(k.rowGone)).toMatchObject({ status: 'orphan', hint: 'row-gone', references: [] });

    const linked = byKey.get(k.linkedMedia)!;
    expect(linked.name).toBe(k.linkedMedia.split('/').pop());
    expect(linked.contentType).toBe('application/pdf');
    expect(linked.references[0]).toMatchObject({ kind: 'media', originalName: 'Lesson One.pdf', createdAt: expect.any(String) });
    expect(res.data.nextCursor).toBeUndefined();
  });

  it('gives each orphan hint', async () => {
    const { controller, k } = fixtures();
    const hintOf = async (prefix: string, key: string) => {
      const res = await controller.browse({ prefix });
      if (!res.ok) throw new Error('expected ok');
      return res.data.objects.find((o) => o.key === key);
    };
    expect(await hintOf(`topics/${GONE_TOPIC}/`, k.topicGone)).toMatchObject({ status: 'orphan', hint: 'owner-topic-gone' });
    expect(await hintOf(`events/${GONE_EVENT}/`, k.eventGone)).toMatchObject({ status: 'orphan', hint: 'owner-event-gone' });
    expect(await hintOf('misc/', k.unknown)).toMatchObject({ status: 'orphan', hint: 'unknown-shape' });
    expect(await hintOf(`events/${EVENT}/`, k.linkedFlyer)).toMatchObject({ status: 'linked' });
    expect(await hintOf(`events/${EVENT}/`, k.displaced)).toMatchObject({ status: 'displaced' });
  });

  it('rejects a prefix without a trailing slash', async () => {
    const { controller } = fixtures();
    expect(await controller.browse({ prefix: 'topics' })).toMatchObject({ ok: false, status: 400 });
  });

  it('lists one delimited page and returns its cursor', async () => {
    const { controller, storage } = fixtures();
    const res = await controller.browse({ prefix: `topics/${TOPIC}/`, limit: 2 });
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.objects).toHaveLength(2);
    expect(res.data.nextCursor).toBe('2');
    expect(storage.listCalls).toEqual([{ prefix: `topics/${TOPIC}/`, options: { delimiter: '/', cursor: undefined, limit: 2 } }]);
  });
});

describe('AdminStorageController.object', () => {
  it('returns the classification, references and a 5-minute presigned URL', async () => {
    const { controller, storage, k } = fixtures();
    const res = await controller.object(k.linkedMedia);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toMatchObject({ key: k.linkedMedia, status: 'linked', size: 10 });
    expect(res.data.references).toHaveLength(1);
    expect(res.data.downloadUrl).toContain('signed.example');
    expect(res.data.downloadUrlExpiresAt).toBe(new Date(NOW + PREVIEW_URL_TTL_SECONDS * 1000).toISOString());
    expect(storage.getPresignedDownloadUrl).toHaveBeenCalledWith(k.linkedMedia, { expiresInSeconds: 300 });
  });

  it('returns 404 for an unknown key', async () => {
    const { controller, storage } = fixtures();
    expect(await controller.object('topics/nope/x.pdf')).toMatchObject({ ok: false, status: 404, error: 'NotFound' });
    expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
  });
});

describe('AdminStorageController.audit', () => {
  it('returns every non-linked object and none of the linked ones, paging to the end', async () => {
    const { controller, k } = fixtures();
    const seen: string[] = [];
    let scanned = 0;
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await controller.audit({ cursor, limit: 3 });
      if (!res.ok) throw new Error('expected ok');
      expect(res.data.scanned).toBeLessThanOrEqual(3);
      scanned += res.data.scanned;
      seen.push(...res.data.objects.map((o) => o.key));
      cursor = res.data.nextCursor;
      pages++;
    } while (cursor && pages < 50);

    expect(scanned).toBe(Object.keys(k).length);
    expect(seen.sort()).toEqual(
      [k.pending, k.stalePending, k.deletedRow, k.rowGone, k.topicGone, k.displaced, k.eventGone, k.unknown].sort(),
    );
  });

  it('fills a page across short storage pages but never past the limit', async () => {
    const { controller, storage } = fixtures();
    storage.maxPage = 2;
    const res = await controller.audit({ limit: 5 });
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.scanned).toBe(5);
    expect(res.data.nextCursor).toBe('5');
    expect(storage.listCalls.map((c) => c.options?.limit)).toEqual([5, 3, 1]);
    expect(storage.listCalls.every((c) => c.prefix === '' && c.options?.delimiter === undefined)).toBe(true);
  });

  it('caps the page at 1000 keys', async () => {
    const { controller, storage } = fixtures();
    await controller.audit({ limit: 5000 });
    expect(storage.listCalls[0].options?.limit).toBe(1000);
  });
});

describe('AdminStorageController.auditMissing', () => {
  it('returns exactly the references whose object is gone', async () => {
    const { controller, refs } = fixtures();
    const ghost = mediaKey(TOPIC, 50);
    refs.refs.push(media(ghost, 'ready'), media(mediaKey(TOPIC, 51), 'deleted'));

    const res = await controller.auditMissing({});
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.items).toEqual([
      { key: ghost, status: 'missing-object', reference: expect.objectContaining({ kind: 'media', status: 'ready' }) },
    ]);
    expect(res.data.scanned).toBe(6);
    expect(res.data.nextCursor).toBeUndefined();
  });

  it('caps a page at 50 references and pages on the cursor', async () => {
    const { controller, refs, storage } = fixtures();
    for (let i = 100; i < 160; i++) refs.refs.push(media(mediaKey(TOPIC, i), 'ready'));
    const head = vi.spyOn(storage, 'headObject');

    const first = await controller.auditMissing({ limit: 500 });
    if (!first.ok) throw new Error('expected ok');
    expect(first.data.scanned).toBe(50);
    expect(head.mock.calls.length).toBeLessThanOrEqual(50);
    expect(first.data.nextCursor).toBeDefined();

    const second = await controller.auditMissing({ cursor: first.data.nextCursor });
    if (!second.ok) throw new Error('expected ok');
    expect(second.data.nextCursor).toBeUndefined();
    expect(first.data.items.length + second.data.items.length).toBe(60);
  });

  it('maps an invalid reference cursor to 400', async () => {
    const { controller } = fixtures();
    expect(await controller.auditMissing({ cursor: 'bad' })).toMatchObject({ ok: false, status: 400, error: 'InvalidCursor' });
  });
});

describe('AdminStorageController.deleteObject', () => {
  const ADMIN = 'admin-1';
  const OLD = ORPHAN_GRACE_MS + HOUR; // 25 h

  afterEach(() => vi.restoreAllMocks());

  /** Every `storage.orphan.deleted` line logged through `console.info`. */
  function auditLines(spy: ReturnType<typeof vi.spyOn>) {
    return spy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((l) => l.event === 'storage.orphan.deleted');
  }

  it.each([
    ['linked media', 'linkedMedia', 'linked'],
    ['linked flyer', 'linkedFlyer', 'linked'],
    ['pending upload', 'pending', 'pending'],
    ['stale pending upload', 'stalePending', 'pending'],
    ['displaced flyer', 'displaced', 'displaced'],
  ] as const)('refuses a %s with 409 and the current classification, keeping the object', async (_, name, status) => {
    const { controller, storage, k } = fixtures();
    storage.put(k[name], OLD); // old enough — the status alone must refuse
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const res = await controller.deleteObject(k[name], ADMIN);

    expect(res).toMatchObject({
      ok: false,
      status: 409,
      error: 'StorageObjectNotDeletable',
      meta: { reason: 'not-deletable-status', object: { key: k[name], status } },
    });
    expect(storage.objects.has(k[name])).toBe(true);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(auditLines(info)).toHaveLength(0);
  });

  it.each([
    ['orphan uploaded 1 hour ago', 'rowGone', 'orphan', HOUR],
    ['deleted-row uploaded 1 hour ago', 'deletedRow', 'deleted-row', HOUR],
    ['orphan exactly at the grace boundary', 'rowGone', 'orphan', ORPHAN_GRACE_MS],
  ] as const)('refuses an %s with 409 within-grace-window', async (_, name, status, age) => {
    const { controller, storage, k } = fixtures();
    storage.put(k[name], age);

    const res = await controller.deleteObject(k[name], ADMIN);

    expect(res).toMatchObject({
      ok: false,
      status: 409,
      meta: { reason: 'within-grace-window', object: { key: k[name], status } },
    });
    expect(storage.objects.has(k[name])).toBe(true);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('deletes an orphan uploaded 25 hours ago and logs exactly one audit line', async () => {
    const { controller, storage, k } = fixtures();
    storage.put(k.rowGone, OLD);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const res = await controller.deleteObject(k.rowGone, ADMIN);

    expect(res).toEqual({ ok: true, data: { deleted: true, key: k.rowGone, size: 10, status: 'orphan' } });
    expect(storage.objects.has(k.rowGone)).toBe(false);
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).toHaveBeenCalledWith(k.rowGone);
    expect(info).toHaveBeenCalledTimes(1);
    const lines = auditLines(info);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      event: 'storage.orphan.deleted',
      actor: ADMIN,
      key: k.rowGone,
      size: 10,
      status: 'orphan',
      at: new Date(NOW).toISOString(),
    });
    expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('deletes an unknown-shape and an owner-gone orphan past the grace window', async () => {
    const { controller, storage, k } = fixtures();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    for (const name of ['unknown', 'topicGone', 'eventGone'] as const) {
      storage.put(k[name], OLD);
      expect(await controller.deleteObject(k[name], ADMIN)).toMatchObject({ ok: true, data: { status: 'orphan' } });
      expect(storage.objects.has(k[name])).toBe(false);
    }
  });

  it('deletes a deleted-row object older than 24 h', async () => {
    const { controller, storage, refs, k } = fixtures();
    storage.put(k.deletedRow, OLD);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const refsBefore = structuredClone(refs.refs);

    const res = await controller.deleteObject(k.deletedRow, ADMIN);

    expect(res).toMatchObject({ ok: true, data: { deleted: true, key: k.deletedRow, status: 'deleted-row' } });
    expect(storage.objects.has(k.deletedRow)).toBe(false);
    expect(refs.refs).toEqual(refsBefore);
    expect(auditLines(info)).toMatchObject([{ key: k.deletedRow, actor: ADMIN, status: 'deleted-row' }]);
  });

  it('returns 404 for an absent key without deleting or logging', async () => {
    const { controller, storage } = fixtures();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(await controller.deleteObject('topics/nope/x.pdf', ADMIN)).toMatchObject({
      ok: false,
      status: 404,
      error: 'NotFound',
    });
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(auditLines(info)).toHaveLength(0);
  });
});
