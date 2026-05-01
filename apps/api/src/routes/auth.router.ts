import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AuthService } from '@api/core/auth/auth-service';
import { AuthController } from '@api/controllers/auth.controller';
import type { RegisterController } from '@api/controllers/register.controller';
import type { ActivateController } from '@api/controllers/activate.controller';
import { buildRegisterRouter } from '@api/routes/register.router';
import { buildActivateRouter } from '@api/routes/activate.router';
import type { IRateLimiter } from '@arenaquest/shared/ports';

const COOKIE_NAME = 'refresh_token';
const COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Accepted values for the `SameSite` cookie attribute.
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#samesitesamesite-value
 */
export type CookieSameSite = 'Strict' | 'Lax' | 'None';

/**
 * Parse and validate the COOKIE_SAMESITE env var.
 * Returns a type-safe SameSite value, defaulting to `'None'` when the
 * input is empty or unrecognised (logs a warning for the latter).
 */
export function parseCookieSameSite(raw: string | undefined): CookieSameSite {
  if (!raw || raw.trim() === '') return 'None';

  const normalised =
    raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1).toLowerCase();

  if (normalised === 'Strict' || normalised === 'Lax' || normalised === 'None') {
    return normalised;
  }

  console.warn(
    `[cookie] Unknown COOKIE_SAMESITE value "${raw}", falling back to "None"`,
  );
  return 'None';
}

export interface AuthRouterDeps {
  authService: AuthService;
  loginLimiter: IRateLimiter;
  cookieSameSite: CookieSameSite;
  registerController: RegisterController;
  registerLimiter: IRateLimiter;
  activateController: ActivateController;
  activateLimiter: IRateLimiter;
}

/**
 * Build the login rate-limit key from the request. Lower-casing the email
 * guarantees that attackers can't bypass the limit by changing letter case.
 */
function buildLoginKey(email: string | undefined, ip: string): string {
  return `${(email ?? '').toLowerCase()}:${ip}`;
}

function extractIp(header: string | undefined): string {
  // `cf-connecting-ip` is set by Cloudflare on every request it forwards.
  // Local dev and tests don't see it — bucket those under a shared "unknown".
  return header && header.length > 0 ? header : 'unknown';
}

export function buildAuthRouter(deps: AuthRouterDeps): Hono {
  const { authService, loginLimiter, cookieSameSite, registerController, registerLimiter, activateController, activateLimiter } = deps;
  const controller = new AuthController(authService);
  const router = new Hono();

  // Public self-registration (`POST /auth/register`). Mounted as a sub-router
  // so the rate limit + body parsing live in their own module without
  // colliding with login's limiter or cookie handling.
  router.route('/', buildRegisterRouter({ controller: registerController, limiter: registerLimiter }));
  router.route('/', buildActivateRouter({ controller: activateController, limiter: activateLimiter }));

  router.post('/login', async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();
    const ip = extractIp(c.req.header('cf-connecting-ip'));
    const key = buildLoginKey(body.email, ip);

    // S-04: check the limiter before spending CPU on password verification.
    // Fail-open — if the limiter itself errors, we still let the request
    // through (logged). A transient KV outage should not lock every user out.
    try {
      const state = await loginLimiter.peek(key);
      if (!state.allowed) {
        c.header('Retry-After', String(state.retryAfterSeconds ?? 1));
        return c.json({ error: 'TooManyRequests' }, 429);
      }
    } catch (err) {
      console.error('[rate-limit] peek failed, failing open', err);
    }

    const result = await controller.login(body);

    if (!result.ok) {
      // Only count credential failures (401) against the bucket — 400 (bad
      // payload) is a client shape bug, not an attack signal.
      if (result.status === 401) {
        try {
          await loginLimiter.hit(key);
        } catch (err) {
          console.error('[rate-limit] hit failed', err);
        }
      }
      return c.json({ error: result.error }, result.status);
    }

    try {
      await loginLimiter.reset(key);
    } catch (err) {
      console.error('[rate-limit] reset failed', err);
    }

    setCookie(c, COOKIE_NAME, result.data.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: cookieSameSite,
      maxAge: COOKIE_TTL_SECONDS,
      path: '/',
    });

    return c.json({ accessToken: result.data.accessToken, user: result.data.user });
  });

  router.post('/logout', async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    const result = await controller.logout(token);

    if (!result.ok) return c.json({ error: result.error }, result.status);

    deleteCookie(c, COOKIE_NAME, { path: '/' });
    return c.body(null, 204);
  });

  router.post('/refresh', async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    const result = await controller.refresh(token);

    if (!result.ok) return c.json({ error: result.error }, result.status);

    setCookie(c, COOKIE_NAME, result.data.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: cookieSameSite,
      maxAge: COOKIE_TTL_SECONDS,
      path: '/',
    });

    return c.json({ accessToken: result.data.accessToken });
  });

  return router;
}
