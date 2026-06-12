import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { PasswordController } from '@api/controllers/password.controller';
import { ForgotPasswordRequestSchema, ResetPasswordRequestSchema } from '@api/openapi/components/entities';
import { ValidationErrorBody } from '@api/openapi/components/errors';
import { respondWith } from '@api/routes/_shared/envelope';
import type { IRateLimiter } from '@arenaquest/shared/ports';

export const forgotPasswordRoute = createRoute({
  method: 'post',
  path: '/forgot-password',
  summary: 'Forgot Password Request',
  description: 'Initiates a password reset flow, sending an email if the account exists.',
  tags: ['auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: ForgotPasswordRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Request successfully processed',
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

export const resetPasswordRoute = createRoute({
  method: 'post',
  path: '/reset-password',
  summary: 'Reset Password',
  description: 'Resets the password of a user using a valid password reset token.',
  tags: ['auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: ResetPasswordRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Password successfully reset',
    },
    400: {
      description: 'Bad Request / Invalid or Expired Token',
      content: {
        'application/json': {
          schema: ValidationErrorBody,
        },
      },
    },
  },
});

function extractIp(header: string | undefined): string {
  return header && header.length > 0 ? header : 'unknown';
}

export function buildPasswordRouter(deps: {
  controller: PasswordController;
  forgotPasswordLimiter: IRateLimiter;
}) {
  const { controller, forgotPasswordLimiter } = deps;
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'ValidationError' as const, issues: result.error.issues }, 400);
      }
    },
  });

  router.openapi(forgotPasswordRoute, async (c) => {
    const ip = extractIp(c.req.header('cf-connecting-ip'));

    try {
      const state = await forgotPasswordLimiter.peek(ip);
      if (!state.allowed) {
        c.header('Retry-After', String(state.retryAfterSeconds ?? 1));
        return c.json({ error: 'TooManyRequests' }, 429);
      }
    } catch (err) {
      console.error('[rate-limit] forgot-password peek failed, failing open', err);
    }

    const body = c.req.valid('json');
    const result = await controller.forgotPassword(body);

    if (result.ok) {
      try {
        await forgotPasswordLimiter.hit(ip);
      } catch (err) {
        console.error('[rate-limit] forgot-password hit failed', err);
      }
    }

    if (!result.ok) {
      return respondWith(c, result);
    }

    return c.body(null, 200);
  });

  router.openapi(resetPasswordRoute, async (c) => {
    const body = c.req.valid('json');
    const result = await controller.resetPassword(body);

    if (!result.ok) {
      return respondWith(c, result);
    }

    return c.body(null, 200);
  });

  return router;
}
