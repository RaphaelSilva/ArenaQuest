import type { MiddlewareHandler } from 'hono';
import '@api/types/hono-env';

export const authGuard: MiddlewareHandler = async (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = await c.get('auth').verifyAccessToken(token);
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  c.set('user', payload);
  await next();
};
