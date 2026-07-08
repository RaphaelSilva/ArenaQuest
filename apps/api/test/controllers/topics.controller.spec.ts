import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TopicsController } from '@api/controllers/topics.controller';
import type { ITopicNodeRepository, IMediaRepository, IStorageAdapter, TopicNodeRecord } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PUBLISHED: TopicNodeRecord = {
  id: 'topic-pub',
  parentId: null,
  title: 'Published Topic',
  content: '',
  status: Entities.Config.TopicNodeStatus.PUBLISHED,
  tags: [],
  order: 0,
  estimatedMinutes: 0,
  prerequisiteIds: [],
  archived: false,
  visibility: Entities.Config.TopicVisibility.RESTRICTED,
};

const DRAFT: TopicNodeRecord = {
  ...PUBLISHED,
  id: 'topic-draft',
  title: 'Draft Topic',
  status: Entities.Config.TopicNodeStatus.DRAFT,
};

const ARCHIVED: TopicNodeRecord = { ...PUBLISHED, id: 'topic-archived', archived: true };

const READY_MEDIA: Entities.Content.Media = {
  id: 'media-1',
  topicNodeId: 'topic-pub',
  storageKey: 'topics/topic-pub/media-1-file.mp4',
  originalName: 'file.mp4',
  type: 'video/mp4',
  sizeBytes: 5_000_000,
  status: Entities.Config.MediaStatus.READY,
  uploadedById: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const PUB_CHILD: TopicNodeRecord = { ...PUBLISHED, id: 'child-pub', parentId: 'topic-pub', title: 'Published Child' };
const DRAFT_CHILD: TopicNodeRecord = { ...DRAFT, id: 'child-draft', parentId: 'topic-pub', title: 'Draft Child' };

function makeTopicsRepo(overrides: Partial<ITopicNodeRepository> = {}): ITopicNodeRepository {
  const all = [PUBLISHED, DRAFT, ARCHIVED];
  return {
    findById: vi.fn(async (id) => all.find(n => n.id === id) ?? null),
    listAll: vi.fn(async () => all),
    listChildren: vi.fn(async () => [PUB_CHILD, DRAFT_CHILD]),
    create: vi.fn(async () => PUBLISHED),
    update: vi.fn(async () => PUBLISHED),
    move: vi.fn(async () => PUBLISHED),
    archive: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    wouldCreateCycle: vi.fn(async () => false),
    ...overrides,
  };
}

function makeMediaRepo(overrides: Partial<IMediaRepository> = {}): IMediaRepository {
  return {
    findById: vi.fn(async () => READY_MEDIA),
    listByTopic: vi.fn(async () => [READY_MEDIA]),
    create: vi.fn(async () => READY_MEDIA),
    markReady: vi.fn(async () => READY_MEDIA),
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
    getPresignedDownloadUrl: vi.fn(async () => 'https://storage.example.com/download/file.mp4'),
    getPublicUrl: vi.fn(() => 'https://storage.example.com/public'),
    listObjects: vi.fn(async () => ({ objects: [] })),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TopicsController', () => {
  let controller: TopicsController;
  let storageAdapter: IStorageAdapter;

  beforeEach(() => {
    storageAdapter = makeStorageAdapter();
    controller = new TopicsController(makeTopicsRepo(), makeMediaRepo(), storageAdapter);
  });

  // ── listPublished ─────────────────────────────────────────────────────────

  describe('listPublished', () => {
    it('returns only published, non-archived nodes', async () => {
      const result = await controller.listPublished();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('topic-pub');
    });

    it('excludes draft nodes', async () => {
      const result = await controller.listPublished();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.data.map(n => n.id);
      expect(ids).not.toContain('topic-draft');
    });

    it('excludes archived nodes', async () => {
      const result = await controller.listPublished();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.data.map(n => n.id);
      expect(ids).not.toContain('topic-archived');
    });
  });

  // ── getPublishedById ──────────────────────────────────────────────────────

  describe('getPublishedById', () => {
    it('returns published node with published children and media with URLs', async () => {
      const result = await controller.getPublishedById('topic-pub');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBe('topic-pub');
      expect(result.data.children).toHaveLength(1);
      expect(result.data.children[0].id).toBe('child-pub');
      expect(result.data.media).toHaveLength(1);
      expect(result.data.media[0].url).toBe('https://storage.example.com/download/file.mp4');
    });

    it('filters out draft children', async () => {
      const result = await controller.getPublishedById('topic-pub');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const childIds = result.data.children.map(c => c.id);
      expect(childIds).not.toContain('child-draft');
    });

    it('resolves presigned download URLs for all media items', async () => {
      await controller.getPublishedById('topic-pub');
      expect(storageAdapter.getPresignedDownloadUrl).toHaveBeenCalledOnce();
    });

    it('returns 404 for unknown topic id', async () => {
      const result = await controller.getPublishedById('nonexistent');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('returns 404 for a draft topic', async () => {
      const result = await controller.getPublishedById('topic-draft');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('returns 404 for an archived topic', async () => {
      const result = await controller.getPublishedById('topic-archived');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });
  });
});
