import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AuthService } from '@api/core/auth/auth-service';
import { AuthController } from '@api/controllers/auth.controller';

const COOKIE_NAME = 'refresh_token';
const COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export function buildAuthRouter(authService: AuthService): Hono {
  const controller = new AuthController(authService);
  const router = new Hono();

  router.post('/login', async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();
    const result = await controller.login(body);

    if (!result.ok) return c.json({ error: result.error }, result.status);

    setCookie(c, COOKIE_NAME, result.data.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
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
      sameSite: 'Strict',
      maxAge: COOKIE_TTL_SECONDS,
      path: '/',
    });

    return c.json({ accessToken: result.data.accessToken });
  });

  return router;
}
