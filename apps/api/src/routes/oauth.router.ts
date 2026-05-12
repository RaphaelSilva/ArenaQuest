import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { GoogleOAuthController } from '@api/controllers/google-oauth.controller';
import type { CookieSameSite } from './auth.router';

const COOKIE_NAME = 'refresh_token';
const COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60;

export function buildOAuthRouter(
  controller: GoogleOAuthController,
  cookieSameSite: CookieSameSite,
): Hono {
  const router = new Hono();

  router.get('/google', async (c) => {
    const { redirectUrl } = await controller.initiateFlow();
    return c.redirect(redirectUrl, 302);
  });

  router.get('/google/callback', async (c) => {
    const state = c.req.query('state') ?? null;
    const code = c.req.query('code') ?? null;

    const result = await controller.handleCallback(state, code);

    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400);
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
