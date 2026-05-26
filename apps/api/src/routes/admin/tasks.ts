import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { AdminTasksController } from '@api/controllers/admin-tasks.controller';
import { AdminTaskStagesController } from '@api/controllers/admin-task-stages.controller';
import { AdminTaskLinkingController } from '@api/controllers/admin-task-linking.controller';
import { respondWith, respondCreated, respondNoContent } from '@api/routes/_shared/envelope';
import type { AppContainer } from '@api/container';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const TaskStatusSchema = z.enum(['draft', 'published', 'archived']);

const TaskStageSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  order: z.number().int(),
  createdAt: z.string(),
});

const TopicLinkSimplifiedSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
});

const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stages: z.array(TaskStageSchema),
  linkedTopics: z.array(TopicLinkSimplifiedSchema).optional(),
});

// ---------------------------------------------------------------------------
// Task Routes
// ---------------------------------------------------------------------------

export const listTasksRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'List Tasks',
  description: 'Retrieve all tasks, optionally filtered by status with pagination.',
  tags: ['admin:tasks'],
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      status: z.string().optional().openapi({ example: 'published' }),
      limit: z.string().optional().openapi({ example: '20' }),
      offset: z.string().optional().openapi({ example: '0' }),
    }),
  },
  responses: {
    200: {
      description: 'Successfully retrieved tasks list',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(TaskSchema),
          }),
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
  },
});

export const createTaskRoute = createRoute({
  method: 'post',
  path: '/',
  summary: 'Create Task',
  description: 'Create a new task.',
  tags: ['admin:tasks'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            title: z.string().min(1),
            description: z.string().optional().default(''),
            status: TaskStatusSchema.optional().default('draft'),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully created task',
      content: {
        'application/json': {
          schema: TaskSchema,
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
  },
});

export const getTaskRoute = createRoute({
  method: 'get',
  path: '/{id}',
  summary: 'Get Task',
  description: 'Retrieve a single task by ID.',
  tags: ['admin:tasks'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Task details',
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

export const updateTaskRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  summary: 'Update Task',
  description: 'Update metadata of an existing task.',
  tags: ['admin:tasks'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            title: z.string().min(1).optional(),
            description: z.string().optional(),
            status: TaskStatusSchema.optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully updated task',
      content: {
        'application/json': {
          schema: TaskSchema,
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    404: {
      description: 'Task not found',
    },
  },
});

export const archiveTaskRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  summary: 'Archive Task',
  description: 'Soft-archive a task.',
  tags: ['admin:tasks'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    204: {
      description: 'Successfully archived task',
    },
    404: {
      description: 'Task not found',
    },
  },
});

// ---------------------------------------------------------------------------
// Stage Routes
// ---------------------------------------------------------------------------

export const createTaskStageRoute = createRoute({
  method: 'post',
  path: '/{id}/stages',
  summary: 'Create Task Stage',
  description: 'Append a new stage to a task.',
  tags: ['admin:tasks'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            label: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully created task stage',
      content: {
        'application/json': {
          schema: TaskStageSchema,
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    404: {
      description: 'Task not found',
    },
  },
});

export const reorderTaskStagesRoute = createRoute({
  method: 'post',
  path: '/{id}/stages/reorder',
  summary: 'Reorder Task Stages',
  description: 'Set custom ordering for all stages within a task.',
  tags: ['admin:tasks'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            stageIds: z.array(z.string().uuid()),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully reordered stages',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(TaskStageSchema),
          }),
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    404: {
      description: 'Task not found',
    },
  },
});

export const updateTaskStageRoute = createRoute({
  method: 'patch',
  path: '/{id}/stages/{stageId}',
  summary: 'Update Task Stage',
  description: 'Update the label of a specific stage.',
  tags: ['admin:tasks'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
      stageId: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            label: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully updated task stage',
      content: {
        'application/json': {
          schema: TaskStageSchema,
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    404: {
      description: 'Task or Stage not found',
    },
  },
});

export const deleteTaskStageRoute = createRoute({
  method: 'delete',
  path: '/{id}/stages/{stageId}',
  summary: 'Delete Task Stage',
  description: 'Delete a stage from a task.',
  tags: ['admin:tasks'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
      stageId: z.string().uuid(),
    }),
  },
  responses: {
    204: {
      description: 'Successfully deleted stage',
    },
    404: {
      description: 'Task or Stage not found',
    },
  },
});

// ---------------------------------------------------------------------------
// Linking Routes
// ---------------------------------------------------------------------------

export const replaceTaskTopicsRoute = createRoute({
  method: 'post',
  path: '/{id}/topics',
  summary: 'Replace Task Topics',
  description: 'Replace task-level link set with specified topics.',
  tags: ['admin:tasks'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            topicNodeIds: z.array(z.string().uuid()),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully updated topic links',
      content: {
        'application/json': {
          schema: z.array(z.object({
            id: z.string().uuid(),
            taskId: z.string().uuid(),
            topicNodeId: z.string().uuid(),
            stageId: z.string().uuid().nullable(),
          })),
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    404: {
      description: 'Task not found',
    },
  },
});

export const replaceStageTopicsRoute = createRoute({
  method: 'post',
  path: '/{id}/stages/{stageId}/topics',
  summary: 'Replace Stage Topics',
  description: 'Replace stage-level link set with specified topics.',
  tags: ['admin:tasks'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
      stageId: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            topicNodeIds: z.array(z.string().uuid()),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully updated stage topic links',
      content: {
        'application/json': {
          schema: z.array(z.object({
            id: z.string().uuid(),
            taskId: z.string().uuid(),
            topicNodeId: z.string().uuid(),
            stageId: z.string().uuid().nullable(),
          })),
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    404: {
      description: 'Task or Stage not found',
    },
  },
});

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildAdminTasksRouter(container: AppContainer) {
  const { taskRepo: tasks, taskStages: stages, taskLinks: links } = container.engagement;
  const { topics } = container.content;

  const controller = new AdminTasksController(tasks, stages, links, topics);
  const stagesController = new AdminTaskStagesController(tasks, stages);
  const linkingController = new AdminTaskLinkingController(tasks, stages, links, topics);
  const router = new OpenAPIHono();

  // Task endpoints
  router.openapi(listTasksRoute, async (c) => {
    const status = c.req.query('status');
    const limitStr = c.req.query('limit');
    const offsetStr = c.req.query('offset');
    const result = await controller.list({
      status,
      limit: limitStr !== undefined ? Number(limitStr) : undefined,
      offset: offsetStr !== undefined ? Number(offsetStr) : undefined,
    });
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(createTaskRoute, async (c) => {
    const body = c.req.valid('json');
    const user = c.get('user');
    const result = await controller.create(body, user.sub);
    return respondCreated(c, result);
  });

  router.openapi(getTaskRoute, async (c) => {
    const id = c.req.valid('param').id;
    const result = await controller.getById(id);
    return respondWith(c, result);
  });

  router.openapi(updateTaskRoute, async (c) => {
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const result = await controller.update(id, body);
    return respondWith(c, result);
  });

  router.openapi(archiveTaskRoute, async (c) => {
    const id = c.req.valid('param').id;
    const result = await controller.archive(id);
    return respondNoContent(c, result);
  });

  // Stage endpoints
  router.openapi(createTaskStageRoute, async (c) => {
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const result = await stagesController.create(id, body);
    return respondCreated(c, result);
  });

  router.openapi(reorderTaskStagesRoute, async (c) => {
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const result = await stagesController.reorder(id, body);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(updateTaskStageRoute, async (c) => {
    const { id, stageId } = c.req.valid('param');
    const body = c.req.valid('json');
    const result = await stagesController.update(id, stageId, body);
    return respondWith(c, result);
  });

  router.openapi(deleteTaskStageRoute, async (c) => {
    const { id, stageId } = c.req.valid('param');
    const result = await stagesController.delete(id, stageId);
    return respondNoContent(c, result);
  });

  // Linking endpoints
  router.openapi(replaceTaskTopicsRoute, async (c) => {
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const result = await linkingController.replaceTaskTopics(id, body);
    return respondWith(c, result);
  });

  router.openapi(replaceStageTopicsRoute, async (c) => {
    const { id, stageId } = c.req.valid('param');
    const body = c.req.valid('json');
    const result = await linkingController.replaceStageTopics(id, stageId, body);
    return respondWith(c, result);
  });

  return router;
}
