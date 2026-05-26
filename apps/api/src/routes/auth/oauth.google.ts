import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { setCookie } from 'hono/cookie';
import type { GoogleOAuthController } from '@api/controllers/google-oauth.controller';
import type { CookieSameSite } from '@api/routes/auth/login';
import { respondWith } from '@api/routes/_shared/envelope';

const COOKIE_NAME = 'refresh_token';
const COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60;

export const initiateGoogleOAuthRoute = createRoute({
  method: 'get',
  path: '/google',
  summary: 'Initiate Google OAuth Flow',
  description: 'Redirects the user to Google\'s OAuth consent screen.',
  tags: ['auth'],
  responses: {
    302: {
      description: 'Redirecting to Google OAuth Screen',
    },
  },
});

export const googleOAuthCallbackRoute = createRoute({
  method: 'get',
  path: '/google/callback',
  summary: 'Google OAuth Callback Handler',
  description: 'Processes Google\'s auth code, creates or logs in the user, and sets a session cookie.',
  tags: ['auth'],
  request: {
    query: z.object({
      state: z.string().openapi({ description: 'OAuth state nonce' }),
      code: z.string().openapi({ description: 'OAuth authorization code' }),
    }),
  },
  responses: {
    302: {
      description: 'Successfully authenticated, redirecting back to the web application',
    },
    400: {
      description: 'OAuth State Mismatch / Code verification failure',
    },
  },
});

export function buildOAuthRouter(deps: {
  controller: GoogleOAuthController;
  cookieSameSite: CookieSameSite;
}) {
  const { controller, cookieSameSite } = deps;
  const router = new OpenAPIHono();

  router.openapi(initiateGoogleOAuthRoute, async (c) => {
    const { redirectUrl } = await controller.initiateFlow();
    return c.redirect(redirectUrl, 302);
  });

  router.openapi(googleOAuthCallbackRoute, async (c) => {
    const { state, code } = c.req.valid('query');

    const result = await controller.handleCallback(state, code);

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

    return c.redirect(result.data.redirectUrl, 302);
  });

  return router;
}
