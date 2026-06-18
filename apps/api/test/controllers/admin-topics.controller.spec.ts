import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminTopicsController } from '@api/controllers/admin-topics.controller';
import type { ITopicNodeRepository, ITagRepository, TopicNodeRecord } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROOT: TopicNodeRecord = {
  id: 'root-1',
  parentId: null,
  title: 'Root',
  content: '',
  status: Entities.Config.TopicNodeStatus.DRAFT,
  tags: [],
  order: 0,
  estimatedMinutes: 0,
  prerequisiteIds: [],
  archived: false,
  visibility: Entities.Config.TopicVisibility.RESTRICTED,
};

const CHILD: TopicNodeRecord = { ...ROOT, id: 'child-1', parentId: 'root-1', title: 'Child' };

function makeTopicsRepo(overrides: Partial<ITopicNodeRepository> = {}): ITopicNodeRepository {
  const store = new Map<string, TopicNodeRecord>([[ROOT.id, ROOT], [CHILD.id, CHILD]]);
  return {
    findById: vi.fn(async (id) => store.get(id) ?? null),
    listAll: vi.fn(async () => [...store.values()]),
    listChildren: vi.fn(async (parentId) => [...store.values()].filter(n => n.parentId === parentId)),
    create: vi.fn(async (data) => ({ ...ROOT, id: 'new-1', title: data.title })),
    update: vi.fn(async (id, data) => ({ ...ROOT, id, ...data })),
    move: vi.fn(async (id, newParentId) => ({ ...ROOT, id, parentId: newParentId })),
    archive: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    wouldCreateCycle: vi.fn(async () => false),
    ...overrides,
  };
}

function makeTagsRepo(): ITagRepository {
  return {
    list: vi.fn(async () => []),
    findBySlug: vi.fn(async () => null),
    upsertMany: vi.fn(async () => []),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminTopicsController', () => {
  let controller: AdminTopicsController;
  let topicsRepo: ITopicNodeRepository;

  beforeEach(() => {
    topicsRepo = makeTopicsRepo();
    controller = new AdminTopicsController(topicsRepo, makeTagsRepo());
  });

  // ── listAll ───────────────────────────────────────────────────────────────

  describe('listAll', () => {
    it('returns all nodes', async () => {
      const result = await controller.listAll();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(2);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a node with valid body', async () => {
      const result = await controller.create({ title: 'New Topic' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.title).toBe('New Topic');
      expect(topicsRepo.create).toHaveBeenCalledOnce();
    });


    it('returns 404 when parentId does not exist', async () => {
      const result = await controller.create({ title: 'Child', parentId: 'nonexistent' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('accepts a valid parentId', async () => {
      const result = await controller.create({ title: 'Child', parentId: 'root-1' });
      expect(result.ok).toBe(true);
    });

    it('returns 422 UNKNOWN_PREREQ when a prerequisiteId does not exist', async () => {
      const result = await controller.create({ title: 'Topic', prerequisiteIds: ['nonexistent'] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(422);
      expect(result.error).toBe('UNKNOWN_PREREQ');
    });

    it('sanitizes markdown content', async () => {
      await controller.create({ title: 'Topic', content: '<script>alert(1)</script>' });
      const callArg = (topicsRepo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArg.content).not.toContain('<script>');
    });

    it('forwards visibility to the topics repo', async () => {
      await controller.create({ title: 'Private Topic', visibility: 'private' });
      const callArg = (topicsRepo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArg.visibility).toBe('private');
    });
  });

  // ── getById ───────────────────────────────────────────────────────────────

  describe('getById', () => {
    it('returns node with children', async () => {
      const result = await controller.getById('root-1');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBe('root-1');
      expect(result.data.children).toHaveLength(1);
      expect(result.data.children[0].id).toBe('child-1');
    });

    it('returns 404 for unknown id', async () => {
      const result = await controller.getById('nonexistent');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates a node with valid body', async () => {
      const result = await controller.update('root-1', { title: 'Updated' });
      expect(result.ok).toBe(true);
      expect(topicsRepo.update).toHaveBeenCalledOnce();
    });


    it('returns 404 when node does not exist', async () => {
      const result = await controller.update('nonexistent', { title: 'X' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('returns 422 UNKNOWN_PREREQ for unknown prerequisiteId', async () => {
      const result = await controller.update('root-1', { prerequisiteIds: ['missing'] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(422);
      expect(result.error).toBe('UNKNOWN_PREREQ');
    });

    it('sanitizes markdown content on update', async () => {
      await controller.update('root-1', { content: '<iframe src="evil.com"></iframe>' });
      const callArg = (topicsRepo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(callArg.content).not.toContain('<iframe');
    });

    it('forwards visibility to the topics repo', async () => {
      await controller.update('root-1', { visibility: 'public' });
      const callArg = (topicsRepo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(callArg.visibility).toBe('public');
    });
  });

  // ── move ──────────────────────────────────────────────────────────────────

  describe('move', () => {
    it('moves a node to a new parent', async () => {
      const result = await controller.move('child-1', { newParentId: null });
      expect(result.ok).toBe(true);
      expect(topicsRepo.move).toHaveBeenCalledWith('child-1', null, undefined);
    });


    it('returns 404 when node does not exist', async () => {
      const result = await controller.move('nonexistent', { newParentId: null });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('returns 409 WOULD_CYCLE when node is moved to itself', async () => {
      const result = await controller.move('root-1', { newParentId: 'root-1' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);
      expect(result.error).toBe('WOULD_CYCLE');
    });

    it('returns 404 when newParentId does not exist', async () => {
      const result = await controller.move('root-1', { newParentId: 'no-such-parent' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });

    it('returns 409 WOULD_CYCLE when move creates a cycle', async () => {
      topicsRepo.wouldCreateCycle = vi.fn(async () => true);
      const result = await controller.move('root-1', { newParentId: 'child-1' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(409);
      expect(result.error).toBe('WOULD_CYCLE');
    });
  });

  // ── archive ───────────────────────────────────────────────────────────────

  describe('archive', () => {
    it('archives an existing node', async () => {
      const result = await controller.archive('root-1');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBeNull();
      expect(topicsRepo.archive).toHaveBeenCalledWith('root-1');
    });

    it('returns 404 when node does not exist', async () => {
      const result = await controller.archive('nonexistent');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
    });
  });
});
