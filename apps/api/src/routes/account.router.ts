import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { authGuard } from '@api/middleware/auth-guard';
import type { AccountController } from '@api/controllers/account.controller';

const COOKIE_NAME = 'refresh_token';

export function buildAccountRouter(controller: AccountController): Hono {
  const router = new Hono();

  router.post('/change-password', authGuard, async (c) => {
    const userId = c.get('user').sub;
    const currentRefreshToken = getCookie(c, COOKIE_NAME);

    let body: unknown = null;
    try {
      body = await c.req.json();
    } catch {
      body = null;
    }

    const result = await controller.changePassword(userId, currentRefreshToken, body);

    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400 | 401);
    }

    return c.body(null, 200);
  });

  return router;
}
