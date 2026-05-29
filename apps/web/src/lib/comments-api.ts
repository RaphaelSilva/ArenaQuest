import type { HttpTransport } from './api-client';

export type CommentItem = {
  id: string;
  userId: string;
  body: string | null;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  parentCommentId: string | null;
};

export type CommentsApiErrorCode = 'Unauthorized' | 'NetworkError' | 'NotFound' | 'Unknown';

export class CommentsApiError extends Error {
  readonly code: CommentsApiErrorCode;
  readonly status: number;

  constructor(code: CommentsApiErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function createCommentsApi(http: HttpTransport) {
  return {
    async listForTopic(topicId: string): Promise<CommentItem[]> {
      let res: Response;
      try {
        res = await http('GET', `/topics/${topicId}/comments`);
      } catch {
        throw new CommentsApiError('NetworkError', 0, 'Network failure.');
      }
      if (res.status === 401) throw new CommentsApiError('Unauthorized', 401, 'Unauthorized.');
      if (res.status === 404) throw new CommentsApiError('NotFound', 404, 'Topic not found.');
      if (!res.ok) throw new CommentsApiError('Unknown', res.status, `Failed (${res.status})`);
      return res.json() as Promise<CommentItem[]>;
    },

    async createForTopic(topicId: string, body: string): Promise<CommentItem> {
      let res: Response;
      try {
        res = await http('POST', `/topics/${topicId}/comments`, {
          body: JSON.stringify({ body }),
        });
      } catch {
        throw new CommentsApiError('NetworkError', 0, 'Network failure.');
      }
      if (res.status === 401) throw new CommentsApiError('Unauthorized', 401, 'Unauthorized.');
      if (res.status === 404) throw new CommentsApiError('NotFound', 404, 'Topic not found.');
      if (!res.ok) throw new CommentsApiError('Unknown', res.status, `Failed (${res.status})`);
      return res.json() as Promise<CommentItem>;
    },

    async toggleLike(commentId: string): Promise<void> {
      let res: Response;
      try {
        res = await http('POST', `/comments/${commentId}/like`);
      } catch {
        throw new CommentsApiError('NetworkError', 0, 'Network failure.');
      }
      if (res.status === 401) throw new CommentsApiError('Unauthorized', 401, 'Unauthorized.');
      if (res.status === 404) throw new CommentsApiError('NotFound', 404, 'Comment not found.');
      if (!res.ok) throw new CommentsApiError('Unknown', res.status, `Failed (${res.status})`);
    },
  };
}
