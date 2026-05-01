import { Hono } from 'hono';
import type { IRateLimiter } from '@arenaquest/shared/ports';
import type { ActivateController } from '@api/controllers/activate.controller';

export interface ActivateRouterDeps {
  controller: ActivateController;
  limiter: IRateLimiter;
}

function extractIp(header: string | undefined): string {
  return header && header.length > 0 ? header : 'unknown';
}

/**
 * Public activation sub-router. Mounted under `/auth` → `POST /auth/activate`.
 *
 * Rate-limited per IP (the spec calls for ~20 attempts / 15 min) — the
 * 256-bit token space already makes guessing impractical, but the limit
 * cheaply removes the attack surface and stops noisy bots from filling
 * the logs.
 */
export function buildActivateRouter(deps: ActivateRouterDeps): Hono {
  const { controller, limiter } = deps;
  const router = new Hono();

  router.post('/activate', async (c) => {
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

    let body: unknown = null;
    try {
      body = await c.req.json();
    } catch {
      body = null;
    }

    const result = await controller.activate(body);

    try {
      await limiter.hit(ip);
    } catch (err) {
      console.error('[rate-limit] activate hit failed', err);
    }

    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400 | 429);
    }

    return c.json(result.data, 200);
  });

  return router;
}
