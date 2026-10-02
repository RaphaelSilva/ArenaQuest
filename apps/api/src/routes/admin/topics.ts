import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  AdminTopicsController,
  TAG_NAME_MAX_LENGTH,
  TAG_NAMES_MAX_COUNT,
} from '@api/controllers/admin-topics.controller';
import { AdminMediaController } from '@api/controllers/admin-media.controller';
import { respondWith, respondCreated, respondNoContent } from '@api/routes/_shared/envelope';
import type { AppContainer } from '@api/container';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const TopicStatusSchema = z.enum(['draft', 'published', 'archived']);

const TopicVisibilitySchema = z.enum(['public', 'restricted', 'private']);

const MediaStatusSchema = z.enum(['pending', 'ready', 'deleted']);

const TagSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});

const TagNamesBodySchema = z
  .array(z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH))
  .max(TAG_NAMES_MAX_COUNT)
  .optional()
  .openapi({
    description:
      'Tag names (1–40 characters each after trim, at most 20). Each name is slugified; an existing slug is ' +
      'reused with its stored name, a new one is created. Mutually exclusive with `tagIds`. On PATCH, `[]` ' +
      'removes every tag and omitting the field leaves them unchanged.',
    example: ['Chūdan', 'Kata'],
  });

const MediaSchema = z.object({
  id: z.string().uuid(),
  topicNodeId: z.string().uuid(),
  url: z.string(),
  type: z.string(),
  storageKey: z.string(),
  sizeBytes: z.number().int(),
  originalName: z.string(),
  uploadedById: z.string().uuid(),
  status: MediaStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const TopicNodeRecordSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  title: z.string(),
  content: z.string(),
  status: TopicStatusSchema,
  visibility: TopicVisibilitySchema,
  order: z.number().int(),
  estimatedMinutes: z.number().int(),
  prerequisiteIds: z.array(z.string().uuid()),
  media: z.array(MediaSchema).optional(),
  tags: z.array(TagSchema).optional(),
});

const PresignRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.enum(['application/pdf', 'video/mp4', 'image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().positive(),
});

const PresignResultSchema = z.object({
  uploadUrl: z.string(),
  media: MediaSchema,
});

const MoveMediaBodySchema = z.object({
  targetTopicId: z.string().uuid().openapi({
    description: 'The topic the media item moves to. Any existing topic other than the current one, archived included.',
  }),
});

// ---------------------------------------------------------------------------
// Routes Definitions
// ---------------------------------------------------------------------------

export const listAllTopicsRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'List All Topics',
  description: 'Retrieve flat list of all nodes (all statuses, all archive states).',
  tags: ['admin:topics'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved topics list',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(TopicNodeRecordSchema),
          }),
        },
      },
    },
  },
});

export const createTopicRoute = createRoute({
  method: 'post',
  path: '/',
  summary: 'Create Topic Node',
  description: 'Create a new topic node.',
  tags: ['admin:topics'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            parentId: z.string().uuid().nullable().optional(),
            title: z.string().min(1),
            content: z.string().optional(),
            status: TopicStatusSchema.optional(),
            visibility: TopicVisibilitySchema.optional(),
            estimatedMinutes: z.number().int().min(0).optional(),
            tagIds: z.array(z.string()).optional().openapi({
              description: 'Tag IDs to link. Mutually exclusive with `tags`; an unknown ID returns 422 UNKNOWN_TAG.',
            }),
            tags: TagNamesBodySchema,
            prerequisiteIds: z.array(z.string()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Topic successfully created',
      content: {
        'application/json': {
          schema: TopicNodeRecordSchema,
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed (including `tags` with `tagIds`, or a tag name with no usable characters)',
    },
    404: {
      description: 'Parent topic not found',
    },
    422: {
      description: 'UNKNOWN_TAG or UNKNOWN_PREREQ — a referenced ID does not exist; nothing is written',
    },
  },
});

export const getTopicRoute = createRoute({
  method: 'get',
  path: '/{id}',
  summary: 'Get Topic Node',
  description: 'Retrieve a single topic node with its direct children.',
  tags: ['admin:topics'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Topic details',
      content: {
        'application/json': {
          schema: TopicNodeRecordSchema,
        },
      },
    },
    404: {
      description: 'Topic not found',
    },
  },
});

export const updateTopicRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  summary: 'Update Topic Node',
  description: 'Update metadata of a topic node.',
  tags: ['admin:topics'],
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
            content: z.string().optional(),
            status: TopicStatusSchema.optional(),
            visibility: TopicVisibilitySchema.optional(),
            estimatedMinutes: z.number().int().min(0).optional(),
            tagIds: z.array(z.string()).optional().openapi({
              description: 'Tag IDs to link. Mutually exclusive with `tags`; an unknown ID returns 422 UNKNOWN_TAG.',
            }),
            tags: TagNamesBodySchema,
            prerequisiteIds: z.array(z.string()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully updated topic node',
      content: {
        'application/json': {
          schema: TopicNodeRecordSchema,
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed (including `tags` with `tagIds`, or a tag name with no usable characters)',
    },
    404: {
      description: 'Topic not found',
    },
    422: {
      description: 'UNKNOWN_TAG or UNKNOWN_PREREQ — a referenced ID does not exist; nothing is written',
    },
  },
});

export const moveTopicRoute = createRoute({
  method: 'post',
  path: '/{id}/move',
  summary: 'Move Topic Node',
  description: 'Re-parent and/or reorder a topic node.',
  tags: ['admin:topics'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            newParentId: z.string().uuid().nullable(),
            newSortOrder: z.number().int().min(0).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully moved topic node',
      content: {
        'application/json': {
          schema: TopicNodeRecordSchema,
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    404: {
      description: 'Topic not found',
    },
  },
});

export const archiveTopicRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  summary: 'Archive Topic Node',
  description: 'Soft-archive a topic node and cascades to descendants.',
  tags: ['admin:topics'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    204: {
      description: 'Topic successfully archived',
    },
    404: {
      description: 'Topic not found',
    },
  },
});

// ---------------------------------------------------------------------------
// Media Sub-Routes
// ---------------------------------------------------------------------------

export const listTopicMediaRoute = createRoute({
  method: 'get',
  path: '/{topicId}/media',
  summary: 'List Topic Media',
  description: 'List all media associated with a topic.',
  tags: ['admin:media'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      topicId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Successfully retrieved media list',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(MediaSchema),
          }),
        },
      },
    },
    404: {
      description: 'Topic not found',
    },
  },
});

export const presignUploadRoute = createRoute({
  method: 'post',
  path: '/{topicId}/media/presign',
  summary: 'Presign Upload',
  description: 'Request a presigned upload URL for media associated with a topic.',
  tags: ['admin:media'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      topicId: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: PresignRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Presigned upload URL successfully generated',
      content: {
        'application/json': {
          schema: PresignResultSchema,
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    404: {
      description: 'Topic not found',
    },
  },
});

export const finalizeUploadRoute = createRoute({
  method: 'post',
  path: '/{topicId}/media/{mediaId}/finalize',
  summary: 'Finalize Upload',
  description: 'Mark media upload as complete and ready for use.',
  tags: ['admin:media'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      topicId: z.string().uuid(),
      mediaId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Upload successfully finalized',
      content: {
        'application/json': {
          schema: MediaSchema,
        },
      },
    },
    404: {
      description: 'Topic or Media not found',
    },
  },
});

export const deleteMediaRoute = createRoute({
  method: 'delete',
  path: '/{topicId}/media/{mediaId}',
  summary: 'Delete Media',
  description: 'Soft delete media from a topic node.',
  tags: ['admin:media'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      topicId: z.string().uuid(),
      mediaId: z.string().uuid(),
    }),
  },
  responses: {
    204: {
      description: 'Successfully deleted media',
    },
    404: {
      description: 'Topic or Media not found',
    },
  },
});

export const moveMediaRoute = createRoute({
  method: 'post',
  path: '/{topicId}/media/{mediaId}/move',
  summary: 'Move Media',
  description:
    'Reassign a ready media item to another topic (logical transfer). Only the row\'s topic changes: the ' +
    'storage object is neither copied nor renamed, and its storage key keeps the original topic id. ' +
    'The item\'s catalog audience becomes the target topic\'s.',
  tags: ['admin:media'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      topicId: z.string().uuid(),
      mediaId: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: MoveMediaBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Media moved; the updated item with a fresh signed `url`',
      content: {
        'application/json': {
          schema: MediaSchema,
        },
      },
    },
    400: {
      description: 'SameTopic — the target equals the current topic; or Bad Request / Validation Failed',
    },
    404: {
      description: 'Media not found, deleted or not on `{topicId}`; or target topic not found',
    },
    409: {
      description: 'MediaNotReady — only ready media can be moved',
    },
  },
});

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildAdminTopicsRouter(container: AppContainer) {
  const { topics, tags, media, storage } = container.content;
  const controller = new AdminTopicsController(topics, tags);
  const mediaController = new AdminMediaController(topics, media, storage);
  const router = new OpenAPIHono();

  // Topics endpoints
  router.openapi(listAllTopicsRoute, async (c) => {
    const result = await controller.listAll();
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(createTopicRoute, async (c) => {
    const body = c.req.valid('json');
    const result = await controller.create(body);
    return respondCreated(c, result);
  });

  router.openapi(getTopicRoute, async (c) => {
    const id = c.req.valid('param').id;
    const result = await controller.getById(id);
    return respondWith(c, result);
  });

  router.openapi(updateTopicRoute, async (c) => {
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const result = await controller.update(id, body);
    return respondWith(c, result);
  });

  router.openapi(moveTopicRoute, async (c) => {
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const result = await controller.move(id, body);
    return respondWith(c, result);
  });

  router.openapi(archiveTopicRoute, async (c) => {
    const id = c.req.valid('param').id;
    const result = await controller.archive(id);
    return respondNoContent(c, result);
  });

  // Media endpoints
  router.openapi(listTopicMediaRoute, async (c) => {
    const topicId = c.req.valid('param').topicId;
    const result = await mediaController.listMedia(topicId);
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  router.openapi(presignUploadRoute, async (c) => {
    const topicId = c.req.valid('param').topicId;
    const body = c.req.valid('json');
    const result = await mediaController.presignUpload(topicId, body, c.get('user').sub);
    return respondCreated(c, result);
  });

  router.openapi(finalizeUploadRoute, async (c) => {
    const { topicId, mediaId } = c.req.valid('param');
    const result = await mediaController.finalizeUpload(topicId, mediaId);
    return respondWith(c, result);
  });

  router.openapi(deleteMediaRoute, async (c) => {
    const { topicId, mediaId } = c.req.valid('param');
    const result = await mediaController.deleteMedia(topicId, mediaId);
    return respondNoContent(c, result);
  });

  router.openapi(moveMediaRoute, async (c) => {
    const { topicId, mediaId } = c.req.valid('param');
    const { targetTopicId } = c.req.valid('json');
    const result = await mediaController.moveMedia(topicId, mediaId, targetTopicId);
    return respondWith(c, result);
  });

  return router;
}
