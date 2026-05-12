import { Hono } from 'hono';
import type { IRateLimiter } from '@arenaquest/shared/ports';
import type { PasswordController } from '@api/controllers/password.controller';

export interface PasswordRouterDeps {
  controller: PasswordController;
  forgotPasswordLimiter: IRateLimiter;
}

function extractIp(header: string | undefined): string {
  return header && header.length > 0 ? header : 'unknown';
}

export function buildPasswordRouter(deps: PasswordRouterDeps): Hono {
  const { controller, forgotPasswordLimiter } = deps;
  const router = new Hono();

  /**
   * POST /auth/forgot-password
   *
   * Public, unauthenticated. Rate-limited per source IP (3 req/hour).
   * Always returns 200 regardless of whether the email is registered
   * to prevent user enumeration.
   */
  router.post('/forgot-password', async (c) => {
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

    let body: unknown = null;
    try {
      body = await c.req.json();
    } catch {
      body = null;
    }

    const result = await controller.forgotPassword(body);

    // Count valid email requests against the bucket; skip validation errors
    // (400 from bad email format) so client mistakes don't burn the allowance.
    if (result.ok) {
      try {
        await forgotPasswordLimiter.hit(ip);
      } catch (err) {
        console.error('[rate-limit] forgot-password hit failed', err);
      }
    }

    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400 | 429);
    }

    return c.body(null, 200);
  });

  /**
   * POST /auth/reset-password
   *
   * Public, unauthenticated. No additional rate limit — the one-time token
   * with a 1-hour TTL is the natural throttle. Concurrent double-submits
   * are handled atomically in the repository layer.
   */
  router.post('/reset-password', async (c) => {
    let body: unknown = null;
    try {
      body = await c.req.json();
    } catch {
      body = null;
    }

    const result = await controller.resetPassword(body);

    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400);
    }

    return c.body(null, 200);
  });

  return router;
}
