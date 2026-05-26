import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { CookieSameSite } from './auth.router';
import type { ControllersContext, InfraContext } from '@api/container';

const COOKIE_NAME = 'refresh_token';
const COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60;

export function buildOAuthRouter(slice: {
  controllers: ControllersContext;
  infra: InfraContext;
}): Hono {
  const { googleOAuthController: controller } = slice.controllers;
  const cookieSameSite: CookieSameSite = slice.infra.cookies.sameSite;

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
