import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { ActivateController } from '@api/controllers/activate.controller';
import { ActivateRequestSchema } from '@api/openapi/components/entities';
import { respondWith } from '@api/routes/_shared/envelope';
import type { IRateLimiter } from '@arenaquest/shared/ports';

export const activateRoute = createRoute({
  method: 'post',
  path: '/activate',
  summary: 'Activate Account',
  description: 'Activates a newly registered user account using the activation token.',
  tags: ['auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: ActivateRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Account successfully activated',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string().uuid(),
            status: z.string(),
          }),
        },
      },
    },
    400: {
      description: 'Bad Request / Invalid or Expired Token',
    },
    429: {
      description: 'Too Many Requests',
    },
  },
});

function extractIp(header: string | undefined): string {
  return header && header.length > 0 ? header : 'unknown';
}

export function buildActivateRouter(deps: {
  controller: ActivateController;
  limiter: IRateLimiter;
}) {
  const { controller, limiter } = deps;
  const router = new OpenAPIHono();

  router.openapi(activateRoute, async (c) => {
    const ip = extractIp(c.req.header('cf-connecting-ip'));

    try {
      const state = await limiter.peek(ip);
      if (!state.allowed) {
        c.header('Retry-After', String(state.retryAfterSeconds ?? 1));
        return c.json({ error: 'TooManyRequests' }, 429);
      }
    } catch (err) {
      console.error('[rate-limit] activate peek failed, failing open', err);
    }

    const body = c.req.valid('json');
    const result = await controller.activate(body);

    try {
      await limiter.hit(ip);
    } catch (err) {
      console.error('[rate-limit] activate hit failed', err);
    }

    return respondWith(c, result);
  });

  return router;
}
