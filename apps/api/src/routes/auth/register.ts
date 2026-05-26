import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { RegisterController } from '../../controllers/register.controller';
import { RegisterRequestSchema } from '../../openapi/components/entities';
import type { IRateLimiter } from '@arenaquest/shared/ports';

export const registerRoute = createRoute({
  method: 'post',
  path: '/register',
  summary: 'User Registration',
  description: 'Registers a new student account. Returns 202 Accepted on success.',
  tags: ['auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: RegisterRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: 'Registration request accepted (pending activation)',
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
      description: 'Bad Request / Validation Failed',
    },
    429: {
      description: 'Too Many Requests',
    },
  },
});

function extractIp(header: string | undefined): string {
  return header && header.length > 0 ? header : 'unknown';
}

export function buildRegisterRouter(deps: {
  controller: RegisterController;
  limiter: IRateLimiter;
}) {
  const { controller, limiter } = deps;
  const router = new OpenAPIHono();

  router.openapi(registerRoute, async (c) => {
    const ip = extractIp(c.req.header('cf-connecting-ip'));

    try {
      const state = await limiter.peek(ip);
      if (!state.allowed) {
        c.header('Retry-After', String(state.retryAfterSeconds ?? 1));
        return c.json({ error: 'TooManyRequests' }, 429);
      }
    } catch (err) {
      console.error('[rate-limit] register peek failed, failing open', err);
    }

    const body = c.req.valid('json');
    const result = await controller.register(body);

    if (!(result.ok === false && result.status === 400)) {
      try {
        await limiter.hit(ip);
      } catch (err) {
        console.error('[rate-limit] register hit failed', err);
      }
    }

    if (!result.ok) {
      const payload: Record<string, unknown> = { error: result.error };
      if (result.error === 'ValidationFailed' && result.meta?.fields) {
        payload.fields = result.meta.fields;
      }
      return c.json(payload, result.status as 400 | 429);
    }

    return c.json(result.data, 202);
  });

  return router;
}
