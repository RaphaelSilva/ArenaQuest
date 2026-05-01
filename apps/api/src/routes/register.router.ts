import { Hono } from 'hono';
import type { IRateLimiter } from '@arenaquest/shared/ports';
import type { RegisterController } from '@api/controllers/register.controller';

export interface RegisterRouterDeps {
  controller: RegisterController;
  limiter: IRateLimiter;
}

function extractIp(header: string | undefined): string {
  return header && header.length > 0 ? header : 'unknown';
}

/**
 * Build the public registration sub-router. Mounted under `/auth` so the
 * effective path is `POST /auth/register`.
 *
 * Security notes:
 *  - Public, unauthenticated. No admin guard.
 *  - Rate-limited per source IP — registration is a known abuse vector
 *    (spam signups, password-spray reconnaissance).
 *  - Always returns 202 on a well-formed body, regardless of whether the
 *    email was new or duplicate, to avoid leaking which addresses are
 *    registered.
 */
export function buildRegisterRouter(deps: RegisterRouterDeps): Hono {
  const { controller, limiter } = deps;
  const router = new Hono();

  router.post('/register', async (c) => {
    const ip = extractIp(c.req.header('cf-connecting-ip'));

    // Check the limiter BEFORE parsing the body so abusive bursts cannot
    // even cause us to hash a password.
    try {
      const state = await limiter.peek(ip);
      if (!state.allowed) {
        c.header('Retry-After', String(state.retryAfterSeconds ?? 1));
        return c.json({ error: 'TooManyRequests' }, 429);
      }
    } catch (err) {
      // Fail-open on KV outage — losing rate limiting briefly is preferable
      // to locking every prospective user out of registration.
      console.error('[rate-limit] register peek failed, failing open', err);
    }

    let body: unknown = null;
    try {
      body = await c.req.json();
    } catch {
      body = null;
    }

    const result = await controller.register(body);

    // Count every accepted attempt against the bucket (success or duplicate).
    // Validation failures are NOT counted — those are client shape bugs, not
    // attack signals. (Same rationale as the login limiter.)
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
