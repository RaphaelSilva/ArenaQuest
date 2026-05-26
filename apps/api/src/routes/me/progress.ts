import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { ProgressService } from '@api/core/progress/progress-service';
import { respondWith } from '@api/routes/_shared/envelope';
import type { ProgressContext, EngagementContext, ContentContext, GamificationContext } from '@api/container';

const CACHE_CONTROL = 'private, max-age=15';

function buildService(
  slice: { progress: ProgressContext; engagement: EngagementContext; content: ContentContext },
): ProgressService {
  const { progressRepo: progress, enrollmentRepo: enrollment } = slice.progress;
  const { taskRepo: tasks, taskStages: stages, taskLinks: links } = slice.engagement;
  const { topics } = slice.content;
  return new ProgressService(progress, enrollment, tasks, stages, links, topics);
}

export const summaryRoute = createRoute({
  method: 'get',
  path: '/progress/summary',
  summary: 'Get Progress Summary',
  description: 'Retrieves the authenticated user\'s overall progress summary across topics and tasks.',
  tags: ['me:progress'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved summary',
      content: {
        'application/json': {
          schema: z.object({
            totalTopics: z.number().int(),
            completedTopics: z.number().int(),
            overallCompletionPercentage: z.number(),
          }),
        },
      },
    },
  },
});

export const topicsProgressRoute = createRoute({
  method: 'get',
  path: '/progress/topics',
  summary: 'Get Topic Progress list',
  description: 'Retrieves the progress details of all enrolled topic subtrees.',
  tags: ['me:progress'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved topic progress list',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(z.any()),
          }),
        },
      },
    },
  },
});

export const tasksProgressRoute = createRoute({
  method: 'get',
  path: '/progress/tasks',
  summary: 'Get Task Progress list',
  description: 'Retrieves the progress details of all assigned/available tasks.',
  tags: ['me:progress'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved task progress list',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(z.any()),
          }),
        },
      },
    },
  },
});

export const visitTopicRoute = createRoute({
  method: 'post',
  path: '/topics/{id}/visit',
  summary: 'Visit Topic',
  description: 'Marks a topic node as visited, creating progress if it did not exist.',
  tags: ['me:progress'],
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
      description: 'Successfully marked topic as visited',
      content: {
        'application/json': {
          schema: z.object({
            topicNodeId: z.string().uuid(),
            status: z.string(),
          }),
        },
      },
    },
    403: {
      description: 'Forbidden / User not enrolled in topic subtree',
    },
    404: {
      description: 'Topic not found',
    },
  },
});

export const completeTopicRoute = createRoute({
  method: 'post',
  path: '/topics/{id}/complete',
  summary: 'Complete Topic',
  description: 'Marks a topic node as completed, triggering XP rewards, streak engine, quests, and badge evaluations.',
  tags: ['me:progress'],
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
      description: 'Successfully completed topic',
      content: {
        'application/json': {
          schema: z.object({
            topicNodeId: z.string().uuid(),
            status: z.string(),
            completedAt: z.string().datetime(),
          }),
        },
      },
    },
    403: {
      description: 'Forbidden / Prerequisites not met',
    },
    404: {
      description: 'Topic not found',
    },
  },
});

export const checkInStageRoute = createRoute({
  method: 'post',
  path: '/tasks/{id}/stages/{stageId}/check-in',
  summary: 'Check In Stage',
  description: 'Checks in (completes) a stage in a task, granting XP rewards and triggering streaking / gamification engines.',
  tags: ['me:progress'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({
        example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      }),
      stageId: z.string().uuid().openapi({
        example: 'f8e7d6c5-b4a3-2109-8765-43210fedcba9',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Stage already checked in',
      content: {
        'application/json': {
          schema: z.object({
            taskId: z.string().uuid(),
            stageId: z.string().uuid(),
            completed: z.boolean(),
            changed: z.boolean(),
          }),
        },
      },
    },
    201: {
      description: 'Stage successfully checked in',
      content: {
        'application/json': {
          schema: z.object({
            taskId: z.string().uuid(),
            stageId: z.string().uuid(),
            completed: z.boolean(),
            changed: z.boolean(),
          }),
        },
      },
    },
    403: {
      description: 'Forbidden / User not enrolled in the linked topic subtree',
    },
    404: {
      description: 'Task or Stage not found',
    },
  },
});

export function buildMeProgressRouter(slice: {
  progress: ProgressContext;
  engagement: EngagementContext;
  content: ContentContext;
  gamification: GamificationContext;
}) {
  const { xpEngine, streakEngine, questEvaluator, badgeEngine } = slice.gamification;
  const service = buildService(slice);
  const router = new OpenAPIHono();

  router.openapi(summaryRoute, async (c) => {
    const userId = c.get('user').sub;
    const result = await service.getProgressSummary(userId);
    if (!result.ok) return respondWith(c, result);
    c.header('Cache-Control', CACHE_CONTROL);
    return respondWith(c, result);
  });

  router.openapi(topicsProgressRoute, async (c) => {
    const userId = c.get('user').sub;
    const result = await service.listAccessibleTopicProgress(userId);
    if (!result.ok) return respondWith(c, result);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json({ data: result.data });
  });

  router.openapi(tasksProgressRoute, async (c) => {
    const userId = c.get('user').sub;
    const result = await service.listAccessibleTaskProgress(userId);
    if (!result.ok) return respondWith(c, result);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json({ data: result.data });
  });

  router.openapi(visitTopicRoute, async (c) => {
    const userId = c.get('user').sub;
    const topicId = c.req.valid('param').id;

    const result = await service.visitTopic(userId, topicId);
    return respondWith(c, result);
  });

  router.openapi(completeTopicRoute, async (c) => {
    const userId = c.get('user').sub;
    const topicId = c.req.valid('param').id;

    const result = await service.completeTopic(userId, topicId);
    if (!result.ok) {
      return respondWith(c, result);
    }
    if (result.data.changed && xpEngine) {
      try {
        await xpEngine.award({ userId, action: 'topic_complete', sourceKind: 'topic', sourceId: topicId });
      } catch (err) {
        console.error('[XP] topic_complete award failed:', err);
      }
    }
    if (result.data.changed && streakEngine) {
      try {
        await streakEngine.recordActivity(userId, new Date());
      } catch (err) {
        console.error('[streak] topic_complete recordActivity failed:', err);
      }
    }
    if (result.data.changed && questEvaluator) {
      try {
        await questEvaluator.evaluate(userId, 'topic', new Date());
      } catch (err) {
        console.error('[quest] topic_complete evaluate failed:', err);
      }
    }
    if (result.data.changed && badgeEngine) {
      try {
        await badgeEngine.evaluate(userId, new Date());
      } catch (err) {
        console.error('[badge] topic_complete evaluate failed:', err);
      }
    }
    return respondWith(c, result);
  });

  router.openapi(checkInStageRoute, async (c) => {
    const userId = c.get('user').sub;
    const taskId = c.req.valid('param').id;
    const stageId = c.req.valid('param').stageId;

    const result = await service.stageCheckIn(userId, taskId, stageId);
    if (!result.ok) {
      return respondWith(c, result);
    }
    if (result.data.changed && xpEngine) {
      try {
        await xpEngine.award({ userId, action: 'stage_checkin', sourceKind: 'stage', sourceId: stageId });
      } catch (err) {
        console.error('[XP] stage_checkin award failed:', err);
      }
    }
    if (result.data.changed && streakEngine) {
      try {
        await streakEngine.recordActivity(userId, new Date());
      } catch (err) {
        console.error('[streak] stage_checkin recordActivity failed:', err);
      }
    }
    if (result.data.changed && questEvaluator) {
      try {
        await questEvaluator.evaluate(userId, 'stage', new Date());
      } catch (err) {
        console.error('[quest] stage_checkin evaluate failed:', err);
      }
    }
    if (result.data.changed && badgeEngine) {
      try {
        await badgeEngine.evaluate(userId, new Date());
      } catch (err) {
        console.error('[badge] stage_checkin evaluate failed:', err);
      }
    }
    const status = result.data.changed ? 201 : 200;
    return c.json(result.data, status as 200 | 201);
  });

  return router;
}
