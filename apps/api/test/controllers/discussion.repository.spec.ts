import { describe, it, expect, vi } from 'vitest';
import type { ICommentRepository, CommentRecord, CommentWithMeta } from '@arenaquest/shared/ports';

function makeComment(overrides: Partial<CommentRecord> = {}): CommentRecord {
  return {
    id: 'comment-1',
    topicNodeId: 'topic-1',
    parentCommentId: null,
    userId: 'user-1',
    userName: 'User One',
    body: 'Hello world',
    createdAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
    ...overrides,
  };
}

function makeCommentWithMeta(overrides: Partial<CommentWithMeta> = {}): CommentWithMeta {
  return {
    ...makeComment(),
    likeCount: 0,
    likedByMe: false,
    ...overrides,
  };
}

function makeRepo(overrides: Partial<ICommentRepository> = {}): ICommentRepository {
  return {
    listByTopic: vi.fn(async () => []),
    insert: vi.fn(async () => makeComment()),
    softDelete: vi.fn(async () => null),
    toggleLike: vi.fn(async () => ({ liked: true })),
    getLikeCount: vi.fn(async () => 0),
    isLikedByUser: vi.fn(async () => false),
    ...overrides,
  };
}

describe('ICommentRepository contract', () => {
  describe('insert', () => {
    it('returns a CommentRecord', async () => {
      const comment = makeComment({ body: 'Test body' });
      const repo = makeRepo({ insert: vi.fn(async () => comment) });

      const result = await repo.insert({
        topicNodeId: 'topic-1',
        userId: 'user-1',
        body: 'Test body',
      });

      expect(result.id).toBe('comment-1');
      expect(result.body).toBe('Test body');
      expect(result.deletedAt).toBeNull();
    });
  });

  describe('softDelete', () => {
    it('sets body to null in subsequent reads after soft delete', async () => {
      let deleted = false;
      const repo = makeRepo({
        softDelete: vi.fn(async (commentId) => {
          deleted = true;
          return makeComment({ id: commentId, body: 'original', deletedAt: '2026-01-02T00:00:00Z' });
        }),
        listByTopic: vi.fn(async () => {
          return [makeCommentWithMeta({ body: deleted ? null : 'original', deletedAt: deleted ? '2026-01-02T00:00:00Z' : null })];
        }),
      });

      const [beforeDelete] = await repo.listByTopic('topic-1', 'user-1');
      expect(beforeDelete.body).toBe('original');

      await repo.softDelete('comment-1');

      const [afterDelete] = await repo.listByTopic('topic-1', 'user-1');
      expect(afterDelete.body).toBeNull();
      expect(afterDelete.deletedAt).not.toBeNull();
    });
  });

  describe('toggleLike', () => {
    it('returns opposite liked state on second call (idempotent toggle)', async () => {
      let liked = false;
      const repo = makeRepo({
        toggleLike: vi.fn(async () => {
          liked = !liked;
          return { liked };
        }),
      });

      const first = await repo.toggleLike('comment-1', 'user-1');
      expect(first.liked).toBe(true);

      const second = await repo.toggleLike('comment-1', 'user-1');
      expect(second.liked).toBe(false);
    });
  });

  describe('listByTopic', () => {
    it('includes likedByMe projection for the viewer', async () => {
      const commentForViewer = makeCommentWithMeta({ likedByMe: true, likeCount: 3 });
      const repo = makeRepo({
        listByTopic: vi.fn(async (_topicId, viewerUserId) => {
          return [makeCommentWithMeta({ likedByMe: viewerUserId === 'user-viewer' })];
        }),
      });

      const resultsForViewer = await repo.listByTopic('topic-1', 'user-viewer');
      expect(resultsForViewer[0].likedByMe).toBe(true);

      const resultsForOther = await repo.listByTopic('topic-1', 'user-other');
      expect(resultsForOther[0].likedByMe).toBe(false);

      // suppress unused warning
      void commentForViewer;
    });
  });
});
