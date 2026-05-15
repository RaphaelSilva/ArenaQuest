import { D1Database } from '@cloudflare/workers-types';
import type {
  ICommentRepository,
  CommentRecord,
  CommentWithMeta,
  InsertCommentParams,
} from '@arenaquest/shared/ports';

type CommentRow = {
  id: string;
  topic_node_id: string;
  parent_comment_id: string | null;
  user_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
};

type CommentWithMetaRow = CommentRow & {
  like_count: number;
  liked_by_me: number;
};

function rowToComment(row: CommentRow): CommentRecord {
  return {
    id: row.id,
    topicNodeId: row.topic_node_id,
    parentCommentId: row.parent_comment_id,
    userId: row.user_id,
    body: row.deleted_at ? null : row.body,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

function rowToCommentWithMeta(row: CommentWithMetaRow, _viewerUserId: string): CommentWithMeta {
  return {
    id: row.id,
    topicNodeId: row.topic_node_id,
    parentCommentId: row.parent_comment_id,
    userId: row.user_id,
    body: row.deleted_at ? null : row.body,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    likeCount: row.like_count,
    likedByMe: row.liked_by_me === 1,
  };
}

export class D1CommentRepository implements ICommentRepository {
  constructor(private readonly db: D1Database) {}

  async listByTopic(topicNodeId: string, viewerUserId: string): Promise<CommentWithMeta[]> {
    const { results } = await this.db
      .prepare(
        `SELECT
           tc.*,
           COUNT(cl.comment_id) AS like_count,
           MAX(CASE WHEN cl.user_id = ? THEN 1 ELSE 0 END) AS liked_by_me
         FROM topic_comments tc
         LEFT JOIN comment_likes cl ON cl.comment_id = tc.id
         WHERE tc.topic_node_id = ?
         GROUP BY tc.id
         ORDER BY tc.created_at ASC`,
      )
      .bind(viewerUserId, topicNodeId)
      .all<CommentWithMetaRow>();

    return results.map((row) => rowToCommentWithMeta(row, viewerUserId));
  }

  async insert(params: InsertCommentParams): Promise<CommentRecord> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO topic_comments (id, topic_node_id, parent_comment_id, user_id, body)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        params.topicNodeId,
        params.parentCommentId ?? null,
        params.userId,
        params.body,
      )
      .run();

    const row = await this.db
      .prepare('SELECT * FROM topic_comments WHERE id = ?')
      .bind(id)
      .first<CommentRow>();

    if (!row) throw new Error('D1CommentRepository: comment not found after insert');
    return rowToComment(row);
  }

  async softDelete(commentId: string): Promise<CommentRecord | null> {
    await this.db
      .prepare(`UPDATE topic_comments SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`)
      .bind(commentId)
      .run();

    const row = await this.db
      .prepare('SELECT * FROM topic_comments WHERE id = ?')
      .bind(commentId)
      .first<CommentRow>();

    return row ? rowToComment(row) : null;
  }

  async toggleLike(commentId: string, userId: string): Promise<{ liked: boolean }> {
    const result = await this.db
      .prepare(`INSERT OR IGNORE INTO comment_likes (comment_id, user_id) VALUES (?, ?)`)
      .bind(commentId, userId)
      .run();

    if (result.meta.changes > 0) {
      return { liked: true };
    }

    // Already existed — remove it
    await this.db
      .prepare(`DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?`)
      .bind(commentId, userId)
      .run();

    return { liked: false };
  }

  async getLikeCount(commentId: string): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS count FROM comment_likes WHERE comment_id = ?')
      .bind(commentId)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  async isLikedByUser(commentId: string, userId: string): Promise<boolean> {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS count FROM comment_likes WHERE comment_id = ? AND user_id = ?')
      .bind(commentId, userId)
      .first<{ count: number }>();
    return (row?.count ?? 0) > 0;
  }
}
