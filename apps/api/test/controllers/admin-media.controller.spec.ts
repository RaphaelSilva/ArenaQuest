import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminMediaController } from '@api/controllers/admin-media.controller';
import type { ITopicNodeRepository, IMediaRepository, IStorageAdapter, TopicNodeRecord } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOPIC: TopicNodeRecord = {
  id: 'topic-1',
  parentId: null,
  title: 'Intro',
  content: '',
  status: Entities.Config.TopicNodeStatus.PUBLISHED,
  tags: [],
  order: 0,
  estimatedMinutes: 0,
  prerequisiteIds: [],
  archived: false,
};

const MEDIA_PENDING: Entities.Content.Media = {
  id: 'media-1',
  topicNodeId: 'topic-1',
  storageKey: 'topics/topic-1/media-1-file.pdf',
  originalName: 'file.pdf',
  type: 'application/pdf',
  sizeBytes: 1000,
  status: Entities.Config.MediaStatus.PENDING,
  uploadedById: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MEDIA_READY: Entities.Content.Media = { ...MEDIA_PENDING, status: Entities.Config.MediaStatus.READY };

function makeTopicsRepo(overrides: Partial<ITopicNodeRepository> = {}): ITopicNodeRepository {
  return {
    findById: vi.fn(async (id) => (id === TOPIC.id ? TOPIC : null)),
    listAll: vi.fn(async () => []),
    listChildren: vi.fn(async () => []),
    create: vi.fn(async () => TOPIC),
    update: vi.fn(async () => TOPIC),
    move: vi.fn(async () => TOPIC),
    archive: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    wouldCreateCycle: vi.fn(async () => false),
    ...overrides,
  };
}

function makeMediaRepo(overrides: Partial<IMediaRepository> = {}): IMediaRepository {
  return {
    findById: vi.fn(async (id) => (id === MEDIA_PENDING.id ? MEDIA_PENDING : null)),
    listByTopic: vi.fn(async () => [MEDIA_PENDING]),
    create: vi.fn(async () => MEDIA_PENDING),
    markReady: vi.fn(async () => MEDIA_READY),
    softDelete: vi.fn(async () => {}),
    hardDelete: vi.fn(async () => {}),
    ...overrides,
  };
}

function makeStorageAdapter(overrides: Partial<IStorageAdapter> = {}): IStorageAdapter {
  return {
    putObject: vi.fn(async () => {}),
    getObject: vi.fn(async () => null),
    deleteObject: vi.fn(async () => {}),
    deleteObjects: vi.fn(async () => {}),
    objectExists: vi.fn(async () => true),
    headObject: vi.fn(async () => null),
    getPresignedUploadUrl: vi.fn(async () => 'https://storage.example.com/upload'),
    getPresignedDownloadUrl: vi.fn(async () => 'https://storage.example.com/download'),
    getPublicUrl: vi.fn(() => 'https://storage.example.com/public'),
    listObjects: vi.fn(async () => ({ objects: [] })),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminMediaController', () => {
  let controller: AdminMediaController;
  let topicsRepo: ITopicNodeRepository;
  let mediaRepo: IMediaRepository;
  let storageAdapter: IStorageAdapter;

  beforeEach(() => {
    topicsRepo = makeTopicsRepo();
    mediaRepo = makeMediaRepo();
    storageAdapter = makeStorageAdapter();
    controller = new AdminMediaController(topicsRepo, mediaRepo, storageAdapter);
  });

  // ── listMedia ─────────────────────────────────────────────────────────────

  describe('listMedia', () => {
    it('returns media list for a known topic', async () => {
      const result = await controller.listMedia('topic-1');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(1);
    });

    it('resolves presigned download URL only for READY media', async () => {
      mediaRepo.listByTopic = vi.fn(async () => [MEDIA_READY]);
      const result = await controller.listMedia('topic-1');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data[0].url).toMatch(/^https?:\/\//);
      expect(storageAdapter.getPresignedDownloadUrl).toHaveBeenCalledOnce();
    });

    it('does not resolve URL for PENDING media', async () => {
      const result = await controller.listMedia('topic-1');
      expect(result.ok).toBe(true);
      expect(storageAdapter.getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('returns 404 when topic does not exist', async () => {
      const result = await controller.listMedia('nonexistent');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
      expect(result.error).toBe('NotFound');
    });
  });

  // ── presignUpload ─────────────────────────────────────────────────────────

  describe('presignUpload', () => {
    const validBody = { fileName: 'lecture.mp4', contentType: 'video/mp4', sizeBytes: 10_000_000 };

    it('returns uploadUrl and pending media record on valid input', async () => {
      const result = await controller.presignUpload('topic-1', validBody, 'user-1');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.uploadUrl).toMatch(/^https?:\/\//);
      expect(result.data.media).toBeDefined();
    });

    it('returns 404 when topic does not exist', async () => {
      const result = await controller.presignUpload('bad-topic', validBody, 'user-1');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });



    it('returns 422 FileTooLarge when sizeBytes exceeds the limit', async () => {
      const result = await controller.presignUpload('topic-1', { fileName: 'huge.pdf', contentType: 'application/pdf', sizeBytes: 26 * 1024 * 1024 }, 'user-1');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(422);
      expect(result.error).toBe('FileTooLarge');
      expect(result.meta?.maxBytes).toBe(25 * 1024 * 1024);
    });

    it('accepts a file at exactly the size limit boundary', async () => {
      const result = await controller.presignUpload('topic-1', { fileName: 'limit.pdf', contentType: 'application/pdf', sizeBytes: 25 * 1024 * 1024 }, 'user-1');
      expect(result.ok).toBe(true);
    });

    it('generates storage key in topics/{topicId}/{mediaId}-{safeName} pattern', async () => {
      await controller.presignUpload('topic-1', { fileName: 'My Document.pdf', contentType: 'application/pdf', sizeBytes: 1_000_000 }, 'user-1');
      const createArg = (mediaRepo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createArg.storageKey).toMatch(/^topics\/topic-1\/[\w-]+-my-document\.pdf$/);
    });

    it('returns 422 FileTooLarge for MP4 exceeding 100 MB', async () => {
      const result = await controller.presignUpload('topic-1', { fileName: 'huge.mp4', contentType: 'video/mp4', sizeBytes: 101 * 1024 * 1024 }, 'user-1');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(422);
      expect(result.error).toBe('FileTooLarge');
    });

    it('returns 422 FileTooLarge for image exceeding 5 MB', async () => {
      const result = await controller.presignUpload('topic-1', { fileName: 'big.jpeg', contentType: 'image/jpeg', sizeBytes: 6 * 1024 * 1024 }, 'user-1');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(422);
      expect(result.error).toBe('FileTooLarge');
    });
  });

  // ── finalizeUpload ────────────────────────────────────────────────────────

  describe('finalizeUpload', () => {
    it('transitions pending media to ready when object exists in storage', async () => {
      const result = await controller.finalizeUpload('topic-1', 'media-1');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.status).toBe(Entities.Config.MediaStatus.READY);
      expect(mediaRepo.markReady).toHaveBeenCalledWith('media-1');
    });

    it('is idempotent — returns current record without calling markReady if already READY', async () => {
      mediaRepo.findById = vi.fn(async () => MEDIA_READY);
      const result = await controller.finalizeUpload('topic-1', 'media-1');
      expect(result.ok).toBe(true);
      expect(mediaRepo.markReady).not.toHaveBeenCalled();
    });

    it('returns 404 for unknown mediaId', async () => {
      const result = await controller.finalizeUpload('topic-1', 'nonexistent');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('returns 404 when media belongs to a different topic', async () => {
      const result = await controller.finalizeUpload('other-topic', 'media-1');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('returns 422 NotUploaded when object is not yet in storage', async () => {
      storageAdapter.objectExists = vi.fn(async () => false);
      const result = await controller.finalizeUpload('topic-1', 'media-1');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(422);
      expect(result.error).toBe('NotUploaded');
    });
  });

  // ── deleteMedia ───────────────────────────────────────────────────────────

  describe('deleteMedia', () => {
    it('soft-deletes the record and removes the storage object', async () => {
      const result = await controller.deleteMedia('topic-1', 'media-1');
      expect(result.ok).toBe(true);
      expect(mediaRepo.softDelete).toHaveBeenCalledWith('media-1');
      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(MEDIA_PENDING.storageKey);
    });

    it('returns null data on success', async () => {
      const result = await controller.deleteMedia('topic-1', 'media-1');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBeNull();
    });

    it('returns 404 for unknown mediaId', async () => {
      const result = await controller.deleteMedia('topic-1', 'nonexistent');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('returns 404 when media belongs to a different topic', async () => {
      const result = await controller.deleteMedia('other-topic', 'media-1');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('succeeds even when storage.deleteObject rejects (best-effort)', async () => {
      storageAdapter.deleteObject = vi.fn(async () => { throw new Error('storage error'); });
      const result = await controller.deleteMedia('topic-1', 'media-1');
      expect(result.ok).toBe(true);
    });
  });
});
