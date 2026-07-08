import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { getHealth } from '@api/controllers/health.controller';
import { respondWith } from '@api/routes/_shared/envelope';

const HealthResponseSchema = z.object({
  status: z.string(),
  version: z.string(),
  timestamp: z.string(),
  adapters: z.record(z.string()),
}).openapi('HealthResponse');

export const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  summary: 'Health check endpoint',
  description: 'Returns the health status of the API and its dependencies',
  tags: ['public:health'],
  responses: {
    200: {
      description: 'API is healthy',
      content: {
        'application/json': {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

export function buildHealthRouter(): OpenAPIHono {
  const router = new OpenAPIHono();
  router.openapi(healthRoute, (c) =>
    respondWith(c, {
      ok: true,
      data: getHealth({ auth: 'jwt_pbkdf2', database: 'd1', storage: 'not_wired' }),
    }) as any
  );
  return router;
}
