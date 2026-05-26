import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { LeaderboardController, LeaderboardQuerySchema } from '../../controllers/leaderboard.controller';
import { respondWith } from '../_shared/envelope';
import { authGuard } from '../../middleware/auth-guard';
import type { GamificationContext, IdentityContext } from '../../container';

export const LeaderboardRowSchema = z.object({
  userId: z.string().uuid().openapi({
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  }),
  totalXp: z.number().int().openapi({ example: 1250 }),
  level: z.number().int().openapi({ example: 5 }),
  rankTitle: z.string().openapi({ example: 'Bronze' }),
  lastXpEventAt: z.string().nullable().openapi({ example: '2023-01-01T12:00:00Z' }),
});

export const UserRankRecordSchema = z.object({
  rank: z.number().int().openapi({ example: 3 }),
  totalXp: z.number().int().openapi({ example: 1250 }),
  level: z.number().int().openapi({ example: 5 }),
  rankTitle: z.string().openapi({ example: 'Bronze' }),
});

export const LeaderboardResponseSchema = z.object({
  rows: z.array(LeaderboardRowSchema),
  me: UserRankRecordSchema,
  total: z.number().int().openapi({ example: 100 }),
  limit: z.number().int().openapi({ example: 50 }),
  offset: z.number().int().openapi({ example: 0 }),
});

export const leaderboardRoute = createRoute({
  method: 'get',
  path: '/leaderboard',
  summary: 'Retrieve global leaderboard',
  description: 'Returns a list of users with their XP and rank.',
  tags: ['public:leaderboard'],
  request: {
    query: LeaderboardQuerySchema,
  },
  responses: {
    200: {
      description: 'Successfully retrieved leaderboard',
      content: {
        'application/json': {
          schema: LeaderboardResponseSchema,
        },
      },
    },
  },
});

export function buildLeaderboardRouter(slice: {
  gamification: GamificationContext;
  identity: IdentityContext;
}): OpenAPIHono {
  const { gamificationRepo } = slice.gamification;
  const { users: userRepo } = slice.identity;

  const controller = new LeaderboardController(gamificationRepo);
  const router = new OpenAPIHono();

  router.use('/leaderboard', authGuard);
  router.use('/leaderboard/*', authGuard);

  router.openapi(leaderboardRoute, async (c) => {
    const userId = c.get('user').sub;
    const parsedQuery = c.req.valid('query');

    const user = await userRepo.findById(userId);
    const timezone = user?.timezone ?? null;

    const result = await controller.getLeaderboard(userId, parsedQuery, timezone);

    return respondWith(c, result);
  });

  return router;
}

