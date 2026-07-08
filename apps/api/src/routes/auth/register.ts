import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { RegisterController } from '@api/controllers/register.controller';
import { RegisterRequestSchema } from '@api/openapi/components/entities';
import { ValidationErrorBody } from '@api/openapi/components/errors';
import { respondWith } from '@api/routes/_shared/envelope';
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
      content: {
        'application/json': {
          schema: ValidationErrorBody,
        },
      },
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
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'ValidationError' as const, issues: result.error.issues }, 400);
      }
    },
  });

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

    try {
      await limiter.hit(ip);
    } catch (err) {
      console.error('[rate-limit] register hit failed', err);
    }

    if (!result.ok) {
      return respondWith(c, result);
    }

    return c.json(result.data, 202);
  });

  return router;
}
