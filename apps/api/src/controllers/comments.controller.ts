import { z } from 'zod';
import { ValidateBody, Body } from '@api/core/decorators';
import type { ICommentRepository, CommentRecord, CommentWithMeta } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';

export const CreateCommentSchema = z.object({
  body: z.string().min(1).max(2000),
  parentCommentId: z.string().uuid().nullable().optional(),
});

type CreateCommentInput = z.infer<typeof CreateCommentSchema>;

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

export class CommentsController {
  constructor(private readonly repo: ICommentRepository) {}

  async listComments(
    topicNodeId: string,
    userId: string,
    enrolledTopicIds: string[],
  ): Promise<ControllerResult<CommentWithMeta[]>> {
    if (!enrolledTopicIds.includes(topicNodeId)) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }

    const all = await this.repo.listByTopic(topicNodeId, userId);

    // Top-level sorted DESC by createdAt; replies sorted ASC by createdAt
    const topLevel = all
      .filter(c => c.parentCommentId === null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const replies = all
      .filter(c => c.parentCommentId !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return { ok: true, data: [...topLevel, ...replies] };
  }

  @ValidateBody(CreateCommentSchema)
  async createComment(
    topicNodeId: string,
    userId: string,
    @Body() input: CreateCommentInput,
    enrolledTopicIds: string[],
  ): Promise<ControllerResult<CommentRecord>> {
    if (!enrolledTopicIds.includes(topicNodeId)) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }

    const safeBody = stripHtml(input.body);

    if (input.parentCommentId) {
      const parent = await this.repo.findById(input.parentCommentId);
      if (!parent) {
        return { ok: false, status: 422, error: 'NotFound', meta: { detail: 'parent comment not found' } };
      }
      if (parent.parentCommentId !== null) {
        return { ok: false, status: 400, error: 'NESTED_REPLY_FORBIDDEN' };
      }
    }

    const comment = await this.repo.insert({
      topicNodeId,
      parentCommentId: input.parentCommentId ?? null,
      userId,
      body: safeBody,
    });

    return { ok: true, data: comment };
  }

  async likeComment(commentId: string, userId: string): Promise<ControllerResult<{ liked: boolean }>> {
    const comment = await this.repo.findById(commentId);
    if (!comment) return { ok: false, status: 404, error: 'NotFound' };

    const result = await this.repo.toggleLike(commentId, userId);
    return { ok: true, data: result };
  }

  async deleteComment(
    commentId: string,
    userId: string,
    userRoles: string[],
  ): Promise<ControllerResult<null>> {
    const comment = await this.repo.findById(commentId);
    if (!comment) return { ok: false, status: 404, error: 'NotFound' };

    if (comment.userId !== userId && !userRoles.includes('admin')) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }

    await this.repo.softDelete(commentId);
    return { ok: true, data: null };
  }
}
