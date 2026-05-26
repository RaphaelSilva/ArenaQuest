import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import { LeaderboardController, LeaderboardQuerySchema } from '@api/controllers/leaderboard.controller';
import type { GamificationContext, IdentityContext } from '@api/container';

export function buildLeaderboardRouter(slice: {
  gamification: GamificationContext;
  identity: IdentityContext;
}): Hono {
  const { gamificationRepo } = slice.gamification;
  const { users: userRepo } = slice.identity;

  const router = new Hono();
  const controller = new LeaderboardController(gamificationRepo);

  router.use('*', authGuard);

  router.get('/', async (c) => {
    const userId = c.get('user').sub;

    const parsed = LeaderboardQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) {
      return c.json({ error: 'BadRequest', meta: { details: parsed.error.flatten() } }, 400);
    }

    const user = await userRepo.findById(userId);
    const timezone = user?.timezone ?? null;

    const result = await controller.getLeaderboard(userId, parsed.data, timezone);
    if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400);
    return c.json(result.data);
  });

  return router;
}
