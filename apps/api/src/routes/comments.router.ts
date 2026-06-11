import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { authGuard } from '@api/middleware/auth-guard';
import { CommentsController, CreateCommentSchema } from '@api/controllers/comments.controller';
import { CommentSchema, CommentWithMetaSchema } from '@api/openapi/components/entities';
import { ErrorBody } from '@api/openapi/components/errors';
import { respondWith } from '@api/routes/_shared/envelope';
import type { EngagementContext, ProgressContext, GamificationContext } from '@api/container';

const topicParamSchema = z.object({
  id: z.string().openapi({ example: 'cmt-topic-1', description: 'Topic node ID' }),
});

export const listCommentsRoute = createRoute({
  method: 'get',
  path: '/topics/{id}/comments',
  summary: 'List comments on a topic',
  description: 'Returns all comments on a topic node ordered top-level DESC then replies ASC. Requires enrollment.',
  tags: ['topics:comments'],
  security: [{ bearerAuth: [] }],
  request: {
    params: topicParamSchema,
  },
  responses: {
    200: {
      description: 'Comments retrieved successfully',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(CommentWithMetaSchema) }),
        },
      },
    },
    403: {
      description: 'Forbidden — user is not enrolled in this topic',
      content: { 'application/json': { schema: ErrorBody } },
    },
  },
});

export const createCommentRoute = createRoute({
  method: 'post',
  path: '/topics/{id}/comments',
  summary: 'Create a comment on a topic',
  description: 'Creates a top-level comment or a reply. Awards XP on success. Requires enrollment.',
  tags: ['topics:comments'],
  security: [{ bearerAuth: [] }],
  request: {
    params: topicParamSchema,
    body: {
      content: {
        'application/json': {
          schema: CreateCommentSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Comment created',
      content: {
        'application/json': {
          schema: CommentSchema,
        },
      },
    },
    400: {
      description: 'Bad request — malformed body, validation error, or nested reply forbidden',
      content: { 'application/json': { schema: ErrorBody } },
    },
    403: {
      description: 'Forbidden — user is not enrolled in this topic',
      content: { 'application/json': { schema: ErrorBody } },
    },
    422: {
      description: 'Unprocessable — parent comment not found',
      content: { 'application/json': { schema: ErrorBody } },
    },
  },
});

export function buildCommentsRouter(slice: {
  engagement: EngagementContext;
  progress: ProgressContext;
  gamification: GamificationContext;
}): OpenAPIHono {
  const { commentRepo } = slice.engagement;
  const { enrollmentRepo } = slice.progress;
  const { xpEngine } = slice.gamification;

  const router = new OpenAPIHono();
  const controller = new CommentsController(commentRepo);

  router.use('*', authGuard);

  router.openapi(listCommentsRoute, async (c) => {
    const userId = c.get('user').sub;
    const topicId = c.req.valid('param').id;
    const enrolledIds = await enrollmentRepo.getEffectiveAccessTopicIds(userId);
    const result = await controller.listComments(topicId, userId, enrolledIds);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(createCommentRoute, async (c) => {
    const userId = c.get('user').sub;
    const topicId = c.req.valid('param').id;
    const body = c.req.valid('json');
    const enrolledIds = await enrollmentRepo.getEffectiveAccessTopicIds(userId);
    const result = await controller.createComment(topicId, userId, body, enrolledIds);
    if (!result.ok) return respondWith(c, result);
    if (xpEngine) {
      const todayKey = new Date().toISOString().slice(0, 10);
      try {
        await xpEngine.award({ userId, action: 'comment_posted', sourceKind: 'comment', sourceId: null, version: todayKey });
      } catch (err) {
        console.error('[XP] comment_posted award failed:', err);
      }
    }
    return c.json(result.data, 201);
  });

  return router;
}
