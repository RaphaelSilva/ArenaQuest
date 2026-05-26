import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { TaskSchema } from '@api/openapi/components/entities';
import { PublicTasksController } from '@api/controllers/public-tasks.controller';
import { respondWith } from '@api/routes/_shared/envelope';
import { authGuard } from '@api/middleware/auth-guard';
import { ROLES } from '@arenaquest/shared/constants/roles';
import type { EngagementContext, ContentContext, ProgressContext } from '@api/container';

const TaskListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50).openapi({
    example: 50,
    description: 'Number of tasks to return.',
  }),
  offset: z.coerce.number().int().min(0).default(0).openapi({
    example: 0,
    description: 'Number of tasks to skip.',
  }),
});

export const listTasksRoute = createRoute({
  method: 'get',
  path: '/tasks',
  summary: 'List all published tasks',
  description: 'Retrieves a paginated list of all published tasks.',
  tags: ['public:catalog'],
  request: {
    query: TaskListQuerySchema,
  },
  responses: {
    200: {
      description: 'Successfully retrieved list of tasks',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(TaskSchema),
          }),
        },
      },
    },
  },
});

export const getTaskByIdRoute = createRoute({
  method: 'get',
  path: '/tasks/{id}',
  summary: 'Retrieve a single published task by ID',
  description: 'Retrieves a specific published task, including its stages and linked topics.',
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
      description: 'Successfully retrieved task',
      content: {
        'application/json': {
          schema: TaskSchema,
        },
      },
    },
    404: {
      description: 'Task not found',
    },
  },
});

export function buildCatalogTasksRouter(slice: {
  engagement: EngagementContext;
  content: ContentContext;
  progress: ProgressContext;
}) {
  const { taskRepo: tasks, taskStages: stages, taskLinks: links } = slice.engagement;
  const { topics } = slice.content;
  // enrollment is not needed for public catalog reads, so pass null or undefined
  const { enrollmentRepo: enrollment } = slice.progress;

  const controller = new PublicTasksController(tasks, stages, links, topics, enrollment);

  const router = new OpenAPIHono();

  router.use('/tasks', authGuard);
  router.use('/tasks/*', authGuard);

  router.openapi(listTasksRoute, async (c) => {
    const user = c.get('user');
    const isAdmin = user.roles.includes(ROLES.ADMIN) || user.roles.includes(ROLES.CONTENT_CREATOR);
    const parsedQuery = c.req.valid('query');
    const result = await controller.list(
      {
        limit: parsedQuery.limit,
        offset: parsedQuery.offset,
      },
      isAdmin ? undefined : user.sub,
    );
    if (!result.ok) {
      return respondWith(c, result);
    }
    c.header('Cache-Control', 'private, max-age=30');
    return c.json({ data: result.data });
  });

  router.openapi(getTaskByIdRoute, async (c) => {
    const id = c.req.valid('param').id;
    const user = c.get('user');
    const isAdmin = user.roles.includes(ROLES.ADMIN) || user.roles.includes(ROLES.CONTENT_CREATOR);
    const result = await controller.getById(id, isAdmin ? undefined : user.sub);
    return respondWith(c, result);
  });

  return router;
}

