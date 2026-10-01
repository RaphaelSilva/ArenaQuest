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
