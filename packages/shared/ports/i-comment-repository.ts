export interface CommentRecord {
  id: string;
  topicNodeId: string;
  parentCommentId: string | null;
  userId: string;
  body: string | null; // null when soft-deleted
  createdAt: string;
  deletedAt: string | null;
}

export interface CommentWithMeta extends CommentRecord {
  likeCount: number;
  likedByMe: boolean;
}

export interface InsertCommentParams {
  topicNodeId: string;
  parentCommentId?: string | null;
  userId: string;
  body: string;
}

export interface ICommentRepository {
  listByTopic(topicNodeId: string, viewerUserId: string): Promise<CommentWithMeta[]>;
  insert(params: InsertCommentParams): Promise<CommentRecord>;
  softDelete(commentId: string): Promise<CommentRecord | null>;
  toggleLike(commentId: string, userId: string): Promise<{ liked: boolean }>;
  getLikeCount(commentId: string): Promise<number>;
  isLikedByUser(commentId: string, userId: string): Promise<boolean>;
}
