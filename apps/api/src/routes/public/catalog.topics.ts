import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { TopicNodeSchema } from '@api/openapi/components/entities';
import { TopicsController } from '@api/controllers/topics.controller';
import { respondWith } from '@api/routes/_shared/envelope';
import { authGuard } from '@api/middleware/auth-guard';
import { ROLES } from '@arenaquest/shared/constants/roles';
import type { ContentContext, ProgressContext } from '@api/container';

export const listTopicsRoute = createRoute({
  method: 'get',
  path: '/topics',
  summary: 'List all published topic nodes',
  description: 'Retrieves a list of all published topic nodes, including their media and tags.',
  tags: ['public:catalog'],
  responses: {
    200: {
      description: 'Successfully retrieved list of topic nodes',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(TopicNodeSchema),
          }),
        },
      },
    },
  },
});

export const getTopicByIdRoute = createRoute({
  method: 'get',
  path: '/topics/{id}',
  summary: 'Retrieve a single published topic node by ID',
  description: 'Retrieves a specific published topic node, including its media and tags.',
  tags: ['public:catalog'],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({
        example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Successfully retrieved topic node',
      content: {
        'application/json': {
          schema: TopicNodeSchema,
        },
      },
    },
    404: {
      description: 'Topic node not found',
    },
  },
});

export function buildCatalogTopicsRouter(slice: {
  content: ContentContext;
  progress: ProgressContext;
}) {
  const { topics, media, storage } = slice.content;
  const { enrollmentRepo } = slice.progress;
  // enrollment adapter gates non-admin reads against the effective-access set
  const controller = new TopicsController(topics, media, storage, enrollmentRepo);

  const router = new OpenAPIHono();

  router.use('/topics', authGuard);
  router.use('/topics/*', authGuard);

  router.openapi(listTopicsRoute, async (c) => {
    const user = c.get('user');
    const isAdmin = user.roles.includes(ROLES.ADMIN) || user.roles.includes(ROLES.CONTENT_CREATOR);
    const result = await controller.listPublished(isAdmin ? undefined : user.sub);
    if (!result.ok) {
      return respondWith(c, result) as any;
    }
    c.header('Cache-Control', 'private, max-age=30');
    return c.json({ data: result.data });
  });

  router.openapi(getTopicByIdRoute, async (c) => {
    const id = c.req.valid('param').id;
    const user = c.get('user');
    const isAdmin = user.roles.includes(ROLES.ADMIN) || user.roles.includes(ROLES.CONTENT_CREATOR);
    const result = await controller.getPublishedById(id, isAdmin ? undefined : user.sub);
    c.header('Cache-Control', 'private, max-age=30');
    return respondWith(c, result) as any;
  });

  return router;
}