import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { CommentsController } from '@api/controllers/comments.controller';
import { respondWith, respondNoContent } from '@api/routes/_shared/envelope';
import type { EngagementContext } from '@api/container';

export const likeCommentRoute = createRoute({
  method: 'post',
  path: '/comments/{id}/like',
  summary: 'Like Comment',
  description: 'Toggles the liked state of a comment for the authenticated user.',
  tags: ['me:comments'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({
        example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Successfully toggled like state',
      content: {
        'application/json': {
          schema: z.object({
            liked: z.boolean(),
          }),
        },
      },
    },
    404: {
      description: 'Comment not found',
    },
  },
});

export const deleteCommentRoute = createRoute({
  method: 'delete',
  path: '/comments/{id}',
  summary: 'Delete Comment',
  description: 'Soft-deletes a comment. Only the author or an admin can delete a comment.',
  tags: ['me:comments'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({
        example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      }),
    }),
  },
  responses: {
    204: {
      description: 'Comment successfully deleted',
    },
    403: {
      description: 'Forbidden / Unauthorized to delete',
    },
    404: {
      description: 'Comment not found',
    },
  },
});

export function buildMeCommentsRouter(slice: {
  engagement: EngagementContext;
}) {
  const { commentRepo } = slice.engagement;
  const controller = new CommentsController(commentRepo);
  const router = new OpenAPIHono();

  router.openapi(likeCommentRoute, async (c) => {
    const userId = c.get('user').sub;
    const commentId = c.req.valid('param').id;

    const result = await controller.likeComment(commentId, userId);
    return respondWith(c, result);
  });

  router.openapi(deleteCommentRoute, async (c) => {
    const userId = c.get('user').sub;
    const commentId = c.req.valid('param').id;
    const userRoles = c.get('user').roles;

    const result = await controller.deleteComment(commentId, userId, userRoles);
    return respondNoContent(c, result);
  });

  return router;
}
