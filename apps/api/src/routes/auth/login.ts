import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { AuthController } from '@api/controllers/auth.controller';
import { respondWith, respondNoContent } from '@api/routes/_shared/envelope';
import { LoginRequestSchema, LoginResponseSchema } from '@api/openapi/components/entities';
import type { IdentityContext, InfraContext, GamificationContext } from '@api/container';

const COOKIE_NAME = 'refresh_token';
const COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Accepted values for the `SameSite` cookie attribute.
 */
export type CookieSameSite = 'Strict' | 'Lax' | 'None';

/**
 * Parse and validate the COOKIE_SAMESITE env var.
 */
export function parseCookieSameSite(raw: string | undefined): CookieSameSite {
  if (!raw || raw.trim() === '') return 'None';

  const normalised =
    raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1).toLowerCase();

  if (normalised === 'Strict' || normalised === 'Lax' || normalised === 'None') {
    return normalised as CookieSameSite;
  }

  console.warn(
    `[cookie] Unknown COOKIE_SAMESITE value "${raw}", falling back to "None"`,
  );
  return 'None';
}

export const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  summary: 'User Login',
  description: 'Authenticates a user with email and password, setting a session cookie.',
  tags: ['auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: LoginRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully logged in',
      content: {
        'application/json': {
          schema: LoginResponseSchema,
        },
      },
    },
    400: {
      description: 'Bad Request',
    },
    401: {
      description: 'Invalid Credentials',
    },
    429: {
      description: 'Too Many Requests',
    },
  },
});

export const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  summary: 'User Logout',
  description: 'Logs out the user and clears the session cookie.',
  tags: ['auth'],
  responses: {
    204: {
      description: 'Successfully logged out',
    },
    401: {
      description: 'Unauthorized / Invalid Refresh Token',
    },
  },
});

export const refreshRoute = createRoute({
  method: 'post',
  path: '/refresh',
  summary: 'Rotate Session Token',
  description: 'Rotates the session refresh token and returns a new access token.',
  tags: ['auth'],
  responses: {
    200: {
      description: 'Successfully rotated session token',
      content: {
        'application/json': {
          schema: z.object({
            accessToken: z.string().openapi({ example: 'new-access-token' }),
          }),
        },
      },
    },
    401: {
      description: 'Unauthorized / Invalid Refresh Token',
    },
  },
});

function buildLoginKey(email: string | undefined, ip: string): string {
  return `${(email ?? '').toLowerCase()}:${ip}`;
}

function extractIp(header: string | undefined): string {
  return header && header.length > 0 ? header : 'unknown';
}

export function buildLoginRouter(slice: {
  identity: IdentityContext;
  infra: InfraContext;
  gamification: GamificationContext;
}) {
  const { authService } = slice.identity;
  const { rateLimiters, cookies } = slice.infra;
  const { login: loginLimiter } = rateLimiters;
  const cookieSameSite = cookies.sameSite;
  const { streakEngine, questEvaluator, badgeEngine } = slice.gamification;

  const controller = new AuthController(authService);
  const router = new OpenAPIHono();

  router.openapi(loginRoute, async (c) => {
    const body = c.req.valid('json');
    const ip = extractIp(c.req.header('cf-connecting-ip'));
    const key = buildLoginKey(body.email, ip);

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
      if (result.status === 401) {
        try {
          await loginLimiter.hit(key);
        } catch (err) {
          console.error('[rate-limit] hit failed', err);
        }
      }
      return respondWith(c, result);
    }

    try {
      await loginLimiter.reset(key);
    } catch (err) {
      console.error('[rate-limit] reset failed', err);
    }

    if (streakEngine) {
      try {
        await streakEngine.recordActivity(result.data.user.id, new Date());
      } catch (err) {
        console.error('[streak] login recordActivity failed:', err);
      }
    }

    if (questEvaluator) {
      try {
        await questEvaluator.evaluate(result.data.user.id, 'login', new Date());
      } catch (err) {
        console.error('[quest] login evaluate failed:', err);
      }
    }

    if (badgeEngine) {
      try {
        await badgeEngine.evaluate(result.data.user.id, new Date());
      } catch (err) {
        console.error('[badge] login evaluate failed:', err);
      }
    }

    setCookie(c, COOKIE_NAME, result.data.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: cookieSameSite,
      maxAge: COOKIE_TTL_SECONDS,
      path: '/',
    });

    return respondWith(c, result);
  });

  router.openapi(logoutRoute, async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    const result = await controller.logout(token);

    if (!result.ok) {
      return respondWith(c, result);
    }

    deleteCookie(c, COOKIE_NAME, { path: '/' });
    return respondNoContent(c, result);
  });

  router.openapi(refreshRoute, async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    const result = await controller.refresh(token);

    if (!result.ok) {
      return respondWith(c, result);
    }

    setCookie(c, COOKIE_NAME, result.data.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: cookieSameSite,
      maxAge: COOKIE_TTL_SECONDS,
      path: '/',
    });

    return respondWith(c, result);
  });

  return router;
}
