import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { AdminTagsController, TAG_LIST_DEFAULT_LIMIT } from '@api/controllers/admin-tags.controller';
import { respondWith } from '@api/routes/_shared/envelope';
import { TagSchema } from '@api/openapi/components/entities';
import type { AppContainer } from '@api/container';

// ---------------------------------------------------------------------------
// Routes Definitions
// ---------------------------------------------------------------------------

export const listTagsRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'List Tags',
  description:
    'Tags whose slug starts with `slugify(q)`, ordered by slug. Backs the admin tag combobox. ' +
    'Readable by `admin` and `content_creator`.',
  tags: ['admin:tags'],
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      q: z.string().max(80).optional().openapi({
        description: 'Free text; slugified server-side and matched as a slug prefix.',
        example: 'chu',
      }),
      limit: z.coerce.number().int().min(1).max(100).default(TAG_LIST_DEFAULT_LIMIT).openapi({
        description: 'Maximum number of tags to return (1–100).',
        example: TAG_LIST_DEFAULT_LIMIT,
      }),
    }),
  },
  responses: {
    200: {
      description: 'Matching tags',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(TagSchema),
          }),
        },
      },
    },
    400: {
      description: 'Bad Request / Validation Failed (e.g. `limit` outside 1–100)',
    },
  },
});

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildAdminTagsRouter(container: AppContainer) {
  const controller = new AdminTagsController(container.content.tags);
  const router = new OpenAPIHono();

  router.openapi(listTagsRoute, async (c) => {
    const { q, limit } = c.req.valid('query');
    const result = await controller.list({ q, limit });
    if (!result.ok) return respondWith(c, result);
    return c.json({ data: result.data }, 200);
  });

  return router;
}
