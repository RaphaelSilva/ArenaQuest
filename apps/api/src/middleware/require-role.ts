import type { MiddlewareHandler } from 'hono';
import type { RoleName } from '@arenaquest/shared/constants/roles';
import '@api/types/hono-env';

export const requireRole = (...roles: RoleName[]): MiddlewareHandler =>
  async (c, next) => {
    const user = c.get('user');
    const hasRole = roles.some((r) => user.roles.includes(r));
    if (!hasRole) return c.json({ error: 'Forbidden' }, 403);
    await next();
  };
