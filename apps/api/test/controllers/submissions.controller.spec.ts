import { describe, it, expect, vi } from 'vitest';
import {
  SubmissionsController,
  matchesSignature,
  type SubmissionCaller,
} from '@api/controllers/submissions.controller';
import type {
  IEnrollmentRepository,
  IRateLimiter,
  IStorageAdapter,
  ISubmissionRepository,
  ITopicNodeRepository,
  SubmissionRecord,
  TopicNodeRecord,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { SUBMISSION_TUNABLE_DEFAULTS } from '@arenaquest/shared/domain/submissions/limits';
import type { SubmissionConfigResult } from '@api/core/submissions/config';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOPIC: TopicNodeRecord = {
  id: 'topic-1',
  parentId: null,
  title: 'Topic',
  content: '',
  status: Entities.Config.TopicNodeStatus.PUBLISHED,
  tags: [],
  order: 0,
  estimatedMinutes: 0,
  prerequisiteIds: [],
  archived: false,
  visibility: Entities.Config.TopicVisibility.RESTRICTED,
};

const STUDENT: SubmissionCaller = { userId: 'student-1', roles: ['student'] };

const OK_CONFIG: SubmissionConfigResult = { ok: true, config: { ...SUBMISSION_TUNABLE_DEFAULTS } };

function record(over: Partial<SubmissionRecord> = {}): SubmissionRecord {
  return {
    id: 'sub-1',
    topicNodeId: TOPIC.id,
    authorId: STUDENT.userId,
    authorName: 'Student',
    title: 'Kata',
    description: '',
    storageKey: 'submissions/student-1/sub-1-kata.mp4',
    originalName: 'kata.mp4',
    contentType: 'video/mp4',
    sizeBytes: 32,
    status: Entities.Config.SubmissionStatus.PENDING,
    visibility: Entities.Config.ShareVisibility.PRIVATE,
    sharedAt: null,
    moderatedAt: null,
    moderatedBy: null,
    removedAt: null,
    removedBy: null,
    removedByName: null,
    createdAt: '2026-09-29 10:00:00',
    updatedAt: '2026-09-29 10:00:00',
    ...over,
  };
}

function setup(opts: {
  submissions?: Partial<ISubmissionRepository>;
  storage?: Partial<IStorageAdapter>;
  limiter?: Partial<IRateLimiter>;
  config?: SubmissionConfigResult;
} = {}) {
  const submissions = {
    findById: vi.fn().mockResolvedValue(record()),
    createPending: vi.fn(),
    usage: vi.fn().mockResolvedValue({ topicCount: 0, bytes: 0 }),
    markReady: vi.fn(),
    updateMeta: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    topicSummary: vi.fn(),
    ...opts.submissions,
  } as unknown as ISubmissionRepository;
  const topics = { findById: vi.fn().mockResolvedValue(TOPIC) } as unknown as ITopicNodeRepository;
  const enrollment = {
    getEffectiveAccessTopicIds: vi.fn().mockResolvedValue([TOPIC.id]),
  } as unknown as IEnrollmentRepository;
  const storage = {
    headObject: vi.fn(),
    readHead: vi.fn(),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    getPresignedUploadUrl: vi.fn().mockResolvedValue('https://r2.test/upload'),
    ...opts.storage,
  } as unknown as IStorageAdapter;
  const limiter = {
    peek: vi.fn().mockResolvedValue({ allowed: true, remaining: 30 }),
    hit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29 }),
    reset: vi.fn(),
    ...opts.limiter,
  } as unknown as IRateLimiter;
  const controller = new SubmissionsController(
    submissions,
    topics,
    enrollment,
    storage,
    opts.config ?? OK_CONFIG,
    limiter,
  );
  return { controller, submissions, storage, limiter };
}

const ascii = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));

// ---------------------------------------------------------------------------

describe('matchesSignature', () => {
  const ftyp = new Uint8Array([0, 0, 0, 0x14, ...ascii('ftypqt  ')]);

  it.each([
    ['video/mp4', ftyp],
    ['video/quicktime', ftyp],
    ['image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
    ['image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])],
    ['image/webp', ascii('RIFF\0\0\0\0WEBPVP8 ')],
    ['application/pdf', ascii('%PDF-1.7')],
  ])('accepts a %s signature', (type, head) => {
    expect(matchesSignature(type, head)).toBe(true);
  });

  it.each([
    ['video/mp4', ascii('This is text')],
    ['video/quicktime', new Uint8Array([0, 0])],
    ['image/jpeg', ascii('%PDF-1.7')],
    ['image/png', new Uint8Array([0xff, 0xd8, 0xff])],
    ['image/webp', ascii('RIFF\0\0\0\0AVI ')],
    ['application/pdf', new Uint8Array([])],
    ['text/plain', ascii('anything')],
  ])('rejects a wrong or short head for %s', (type, head) => {
    expect(matchesSignature(type, head)).toBe(false);
  });
});

describe('SubmissionsController', () => {
  it('finalize reads only the leading 32 bytes', async () => {
    const { controller, storage, submissions } = setup({
      storage: {
        headObject: vi.fn().mockResolvedValue({ key: 'k', size: 32, lastModified: new Date() }),
        readHead: vi.fn().mockResolvedValue(new Uint8Array([0, 0, 0, 0x20, ...ascii('ftypisom')])),
      },
      submissions: {
        markReady: vi.fn().mockResolvedValue(record({ status: Entities.Config.SubmissionStatus.READY })),
      },
    });
    const result = await controller.finalize(TOPIC.id, 'sub-1', STUDENT);
    expect(result.ok).toBe(true);
    expect(storage.readHead).toHaveBeenCalledWith(record().storageKey, 32);
    expect(submissions.markReady).toHaveBeenCalledWith('sub-1');
  });

  it('finalize mismatch answers 502 and keeps the row when the object delete fails', async () => {
    const { controller, submissions } = setup({
      storage: {
        headObject: vi.fn().mockResolvedValue({ key: 'k', size: 99, lastModified: new Date() }),
        deleteObject: vi.fn().mockRejectedValue(new Error('R2 down')),
      },
    });
    const result = await controller.finalize(TOPIC.id, 'sub-1', STUDENT);
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(submissions.delete).not.toHaveBeenCalled();
  });

  it('finalize mismatch on a reported content type deletes object and row', async () => {
    const { controller, submissions, storage } = setup({
      storage: {
        headObject: vi.fn().mockResolvedValue({
          key: 'k', size: 32, lastModified: new Date(), metadata: { contentType: 'text/plain' },
        }),
      },
    });
    const result = await controller.finalize(TOPIC.id, 'sub-1', STUDENT);
    expect(result).toMatchObject({ ok: false, status: 422, error: 'UPLOAD_MISMATCH' });
    expect(storage.readHead).not.toHaveBeenCalled();
    expect(storage.deleteObject).toHaveBeenCalled();
    expect(submissions.delete).toHaveBeenCalledWith('sub-1');
  });

  it('delete removes the object before the row', async () => {
    const order: string[] = [];
    const { controller } = setup({
      storage: { deleteObject: vi.fn(async () => { order.push('object'); }) },
      submissions: { delete: vi.fn(async () => { order.push('row'); }) },
    });
    expect((await controller.remove(TOPIC.id, 'sub-1', STUDENT)).ok).toBe(true);
    expect(order).toEqual(['object', 'row']);
  });

  it('edit and finalize refuse a tombstone with 409 SUBMISSION_REMOVED', async () => {
    const tombstone = record({ status: Entities.Config.SubmissionStatus.REMOVED, storageKey: null });
    const { controller } = setup({ submissions: { findById: vi.fn().mockResolvedValue(tombstone) } });
    expect(await controller.edit(TOPIC.id, 'sub-1', STUDENT, { title: 'x' })).toMatchObject({
      status: 409,
      error: 'SUBMISSION_REMOVED',
    });
    expect(await controller.finalize(TOPIC.id, 'sub-1', STUDENT)).toMatchObject({
      status: 409,
      error: 'SUBMISSION_REMOVED',
    });
  });

  it('presign fails open when the rate limiter is unavailable', async () => {
    const { controller } = setup({
      limiter: { peek: vi.fn().mockRejectedValue(new Error('KV down')) },
      submissions: { createPending: vi.fn().mockResolvedValue(record()) },
    });
    const result = await controller.presign(TOPIC.id, STUDENT, {
      fileName: 'kata.mp4',
      contentType: 'video/mp4',
      sizeBytes: 32,
      title: 'Kata',
    });
    expect(result.ok).toBe(true);
  });

  it('a config error short-circuits before any repository call', async () => {
    const { controller, submissions } = setup({
      config: { ok: false, variable: 'SUBMISSIONS_PER_TOPIC_MAX', reason: 'must be a positive integer' },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await controller.summary(TOPIC.id, STUDENT)).toEqual({
      ok: false,
      status: 500,
      error: 'SUBMISSION_CONFIG_INVALID',
    });
    expect(submissions.usage).not.toHaveBeenCalled();
  });
});

describe('SubmissionsController - read and move (Task 04)', () => {
  const OTHER: SubmissionCaller = { userId: 'student-2', roles: ['student'] };
  const ADMIN_CALLER: SubmissionCaller = { userId: 'admin-1', roles: ['admin'] };
  const CREATOR_CALLER: SubmissionCaller = { userId: 'creator-1', roles: ['content_creator'] };
  const READY = Entities.Config.SubmissionStatus.READY;
  const SHARED = Entities.Config.ShareVisibility.SHARED;
  const signer = { getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://r2.test/get') };

  it('scope=all is 403 before any read', async () => {
    const listByTopic = vi.fn();
    const { controller } = setup({ submissions: { listByTopic } });
    expect(await controller.listForTopic(TOPIC.id, STUDENT, 'all', null)).toMatchObject({ ok: false, status: 403 });
    expect(listByTopic).not.toHaveBeenCalled();
  });

  it('listing passes the sharing switch and filters any row the caller may not see', async () => {
    const shared = record({ id: 'a', authorId: OTHER.userId, status: READY, visibility: SHARED });
    const leaked = record({ id: 'b', authorId: OTHER.userId, status: READY });
    const listByTopic = vi.fn().mockResolvedValue({ data: [shared, leaked], nextCursor: null });
    const { controller } = setup({ submissions: { listByTopic }, storage: signer });
    const result = await controller.listForTopic(TOPIC.id, STUDENT, 'class', null);
    expect(listByTopic).toHaveBeenCalledWith(TOPIC.id, {
      viewerId: STUDENT.userId,
      scope: 'class',
      sharingEnabled: true,
      page: { cursor: null, limit: 20 },
    });
    expect(result).toMatchObject({ ok: true, data: { data: [{ id: 'a', isMine: false, url: 'https://r2.test/get' }] } });
  });

  it('single read signs a GET with a 1 h TTL on a ready submission only', async () => {
    const ready = record({ status: READY });
    const { controller, storage } = setup({
      submissions: { findById: vi.fn().mockResolvedValue(ready) },
      storage: { getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://r2.test/get') },
    });
    expect(await controller.getOne(TOPIC.id, ready.id, STUDENT)).toMatchObject({ ok: true, data: { url: 'https://r2.test/get' } });
    expect(storage.getPresignedDownloadUrl).toHaveBeenCalledWith(ready.storageKey, { expiresInSeconds: 3600 });

    const { controller: pendingController } = setup({ storage: signer });
    expect(await pendingController.getOne(TOPIC.id, 'sub-1', STUDENT)).toMatchObject({ ok: true, data: { url: null } });
  });

  it('single read of a shared submission by another student is 404 while sharing is off', async () => {
    const shared = record({ status: READY, visibility: SHARED });
    const { controller } = setup({
      submissions: { findById: vi.fn().mockResolvedValue(shared) },
      storage: signer,
      config: { ok: true, config: { ...SUBMISSION_TUNABLE_DEFAULTS, sharingEnabled: false } },
    });
    expect(await controller.getOne(TOPIC.id, shared.id, OTHER)).toMatchObject({ ok: false, status: 404 });
    expect(await controller.getOne(TOPIC.id, shared.id, STUDENT)).toMatchObject({ ok: true });
  });

  it('listMine flags topicAccessible from the topic and the effective access set', async () => {
    const listByAuthor = vi.fn().mockResolvedValue({
      data: [
        { ...record({ id: 'a', status: READY }), topicTitle: 'Topic' },
        { ...record({ id: 'b', topicNodeId: 'lost' }), topicTitle: 'Lost' },
      ],
      nextCursor: null,
    });
    const { controller } = setup({ submissions: { listByAuthor }, storage: signer });
    const result = await controller.listMine(STUDENT, null);
    expect(listByAuthor).toHaveBeenCalledWith(STUDENT.userId, { scope: 'self', page: { cursor: null, limit: 20 } });
    expect(result).toMatchObject({
      ok: true,
      data: {
        data: [
          { id: 'a', topicTitle: 'Topic', topicAccessible: true, url: 'https://r2.test/get' },
          { id: 'b', topicTitle: 'Lost', topicAccessible: false, url: null },
        ],
      },
    });
  });

  it("move refuses staff naming someone else's submission with 403 and an unreadable target with 404, before the repository", async () => {
    const moveFn = vi.fn();
    // The default findById row is authored by the student.
    const { controller } = setup({ submissions: { move: moveFn } });
    expect(await controller.move(ADMIN_CALLER, { ids: ['a'], targetTopicId: TOPIC.id })).toMatchObject({ status: 403 });
    expect(await controller.move(CREATOR_CALLER, { ids: ['a'], targetTopicId: TOPIC.id })).toMatchObject({ status: 403 });
    expect(await controller.move(STUDENT, { ids: ['a'], targetTopicId: 'not-mine' })).toMatchObject({ status: 404 });
    expect(moveFn).not.toHaveBeenCalled();
  });

  it.each([
    ['admin', ADMIN_CALLER],
    ['content_creator', CREATOR_CALLER],
  ])('a %s moves their own submissions through the same guarded move (Task 11)', async (_label, caller) => {
    const moveFn = vi.fn().mockResolvedValue({ moved: [record({ authorId: caller.userId, status: READY })], refused: [] });
    const findById = vi.fn(async (id: string) => (id === 'gone' ? null : record({ id, authorId: caller.userId })));
    const { controller } = setup({ submissions: { move: moveFn, findById } });
    const result = await controller.move(caller, { ids: ['sub-1', 'gone'], targetTopicId: TOPIC.id });
    expect(result).toMatchObject({ ok: true });
    // A missing id is left to the repository's per-item `not_found`.
    expect(moveFn).toHaveBeenCalledWith(caller.userId, ['sub-1', 'gone'], TOPIC.id, SUBMISSION_TUNABLE_DEFAULTS.perTopicMax);
  });

  it('move passes the effective per-topic limit and strips storage keys', async () => {
    const moveFn = vi.fn().mockResolvedValue({
      moved: [record({ status: READY })],
      refused: [{ id: 'x', reason: 'quota' }],
    });
    const { controller } = setup({
      submissions: { move: moveFn },
      config: { ok: true, config: { ...SUBMISSION_TUNABLE_DEFAULTS, perTopicMax: 3 } },
    });
    const result = await controller.move(STUDENT, { ids: ['sub-1', 'x'], targetTopicId: TOPIC.id });
    expect(moveFn).toHaveBeenCalledWith(STUDENT.userId, ['sub-1', 'x'], TOPIC.id, 3);
    expect(result).toMatchObject({ ok: true, data: { refused: [{ id: 'x', reason: 'quota' }] } });
    if (result.ok) expect(result.data.moved[0]).not.toHaveProperty('storageKey');
  });
});

describe('SubmissionsController - staff (Task 05)', () => {
  const ADMIN_CALLER: SubmissionCaller = { userId: 'admin-1', roles: ['admin'] };
  const CREATOR_CALLER: SubmissionCaller = { userId: 'creator-1', roles: ['content_creator'] };
  const TUTOR_CALLER: SubmissionCaller = { userId: 'tutor-1', roles: ['tutor'] };
  const { READY, REMOVED, PENDING } = Entities.Config.SubmissionStatus;
  const signer = { getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://r2.test/get') };

  it.each([ADMIN_CALLER, CREATOR_CALLER])('scope=all gives $roles every ready and removed row with provenance, bypassing access', async (caller) => {
    const ready = record({ id: 'a', status: READY, moderatedAt: '2026-09-29 11:00:00', moderatedBy: 'creator-1' });
    const removed = record({ id: 'b', status: REMOVED, storageKey: null, removedAt: '2026-09-29 12:00:00', removedBy: 'admin-1', removedByName: 'Admin' });
    const pending = record({ id: 'c', status: PENDING });
    const listByTopic = vi.fn().mockResolvedValue({ data: [ready, removed, pending], nextCursor: null });
    const { controller } = setup({ submissions: { listByTopic }, storage: signer });
    const result = await controller.listForTopic(TOPIC.id, caller, 'all', null);
    expect(listByTopic).toHaveBeenCalledWith(TOPIC.id, expect.objectContaining({ scope: 'all' }));
    expect(result).toMatchObject({
      ok: true,
      data: {
        data: [
          { id: 'a', url: 'https://r2.test/get', moderated: true, moderatedBy: 'creator-1', isMine: false },
          { id: 'b', url: null, removedBy: 'admin-1', removedByName: 'Admin' },
        ],
      },
    });
    if (result.ok) {
      expect(result.data.data).toHaveLength(2);
      for (const s of result.data.data) expect(s).not.toHaveProperty('storageKey');
    }
  });

  it('scope=all stays 403 for a tutor', async () => {
    const listByTopic = vi.fn();
    const { controller } = setup({ submissions: { listByTopic } });
    expect(await controller.listForTopic(TOPIC.id, TUTOR_CALLER, 'all', null)).toMatchObject({ status: 403 });
    expect(listByTopic).not.toHaveBeenCalled();
  });

  it("staff read any ready or removed submission, but not another student's pending one", async () => {
    for (const status of [READY, REMOVED] as const) {
      const { controller } = setup({ submissions: { findById: vi.fn().mockResolvedValue(record({ status })) }, storage: signer });
      expect(await controller.getOne(TOPIC.id, 'sub-1', CREATOR_CALLER)).toMatchObject({ ok: true, data: { status, moderatedAt: null } });
    }
    const { controller } = setup({ submissions: { findById: vi.fn().mockResolvedValue(record({ status: PENDING })) } });
    expect(await controller.getOne(TOPIC.id, 'sub-1', ADMIN_CALLER)).toMatchObject({ status: 404 });
  });

  it('per-student list uses the staff scope and adds the topic title', async () => {
    const listByAuthor = vi.fn().mockResolvedValue({
      data: [{ ...record({ status: READY }), topicTitle: 'Topic' }],
      nextCursor: null,
    });
    const { controller } = setup({ submissions: { listByAuthor }, storage: signer });
    const result = await controller.listByUserForStaff(STUDENT.userId, CREATOR_CALLER, null);
    expect(listByAuthor).toHaveBeenCalledWith(STUDENT.userId, { scope: 'staff', page: { cursor: null, limit: 20 } });
    expect(result).toMatchObject({ ok: true, data: { data: [{ id: 'sub-1', topicTitle: 'Topic', url: 'https://r2.test/get' }] } });
    expect(await controller.listByUserForStaff(STUDENT.userId, STUDENT, null)).toMatchObject({ status: 403 });
  });

  it('force-unshare records the staff member; clear passes null; both 404 on a missing or pending row', async () => {
    const setModeration = vi.fn().mockResolvedValue(record({ status: READY, moderatedAt: 'now', moderatedBy: 'creator-1' }));
    const findById = vi.fn().mockResolvedValue(record({ status: READY }));
    const { controller } = setup({ submissions: { setModeration, findById }, storage: signer });
    expect(await controller.forceUnshare('sub-1', CREATOR_CALLER)).toMatchObject({ ok: true, data: { moderated: true, moderatedBy: 'creator-1' } });
    expect(setModeration).toHaveBeenLastCalledWith('sub-1', 'creator-1');
    expect(await controller.clearModeration('sub-1', ADMIN_CALLER)).toEqual({ ok: true, data: null });
    expect(setModeration).toHaveBeenLastCalledWith('sub-1', null);

    findById.mockResolvedValueOnce(null);
    expect(await controller.forceUnshare('x', ADMIN_CALLER)).toMatchObject({ status: 404 });
    findById.mockResolvedValueOnce(record({ status: PENDING }));
    expect(await controller.clearModeration('sub-1', ADMIN_CALLER)).toMatchObject({ status: 404 });
    expect(await controller.forceUnshare('sub-1', STUDENT)).toMatchObject({ status: 403 });
  });

  it('remove is admin-only: a content creator gets 403 before anything is read', async () => {
    const findById = vi.fn();
    const { controller, storage } = setup({ submissions: { findById } });
    expect(await controller.removeByStaff('sub-1', CREATOR_CALLER)).toMatchObject({ status: 403 });
    expect(findById).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('remove deletes the object first, then writes the tombstone', async () => {
    const order: string[] = [];
    const markRemoved = vi.fn().mockImplementation(async () => { order.push('row'); return record({ status: REMOVED }); });
    const deleteObject = vi.fn().mockImplementation(async () => { order.push('object'); });
    const { controller } = setup({
      submissions: { findById: vi.fn().mockResolvedValue(record({ status: READY })), markRemoved },
      storage: { deleteObject },
    });
    expect(await controller.removeByStaff('sub-1', ADMIN_CALLER)).toEqual({ ok: true, data: null });
    expect(deleteObject).toHaveBeenCalledWith('submissions/student-1/sub-1-kata.mp4');
    expect(markRemoved).toHaveBeenCalledWith('sub-1', 'admin-1');
    expect(order).toEqual(['object', 'row']);
  });

  it('remove answers 502 and leaves the row alone when storage fails', async () => {
    const markRemoved = vi.fn();
    const { controller } = setup({
      submissions: { findById: vi.fn().mockResolvedValue(record({ status: READY })), markRemoved },
      storage: { deleteObject: vi.fn().mockRejectedValue(new Error('down')) },
    });
    expect(await controller.removeByStaff('sub-1', ADMIN_CALLER)).toMatchObject({ status: 502, error: 'StorageUnavailable' });
    expect(markRemoved).not.toHaveBeenCalled();
  });

  it('remove is idempotent on a tombstone and 404 on a pending row', async () => {
    const markRemoved = vi.fn();
    const findById = vi.fn().mockResolvedValueOnce(record({ status: REMOVED, storageKey: null }))
      .mockResolvedValueOnce(record({ status: PENDING }));
    const { controller, storage } = setup({ submissions: { findById, markRemoved } });
    expect(await controller.removeByStaff('sub-1', ADMIN_CALLER)).toEqual({ ok: true, data: null });
    expect(await controller.removeByStaff('sub-1', ADMIN_CALLER)).toMatchObject({ status: 404 });
    expect(markRemoved).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
});
