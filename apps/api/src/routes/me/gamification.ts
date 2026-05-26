import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { MeGamificationController } from '@api/controllers/me-gamification.controller';
import { MeQuestsController } from '@api/controllers/me-quests.controller';
import { MeMissionsController } from '@api/controllers/me-missions.controller';
import { MeDashboardController } from '@api/controllers/me-dashboard.controller';
import { respondWith } from '@api/routes/_shared/envelope';
import type { GamificationContext } from '@api/container';

const CACHE_CONTROL = 'private, max-age=15';

export const xpRoute = createRoute({
  method: 'get',
  path: '/xp',
  summary: 'Get XP details',
  description: 'Retrieves the authenticated user\'s total XP, level, and rank title.',
  tags: ['me:gamification'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved XP details (or null if empty)',
      content: {
        'application/json': {
          schema: z.object({
            totalXp: z.number().int(),
            level: z.number().int(),
            rankTitle: z.string(),
          }).nullable(),
        },
      },
    },
  },
});

export const streakRoute = createRoute({
  method: 'get',
  path: '/streak',
  summary: 'Get Streak details',
  description: 'Retrieves the authenticated user\'s login streak information.',
  tags: ['me:gamification'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved streak details (or null if empty)',
      content: {
        'application/json': {
          schema: z.object({
            currentStreak: z.number().int(),
            longestStreak: z.number().int(),
            lastActivityDate: z.string().nullable(),
          }).nullable(),
        },
      },
    },
  },
});

export const badgesRoute = createRoute({
  method: 'get',
  path: '/badges',
  summary: 'Get Badges list',
  description: 'Retrieves the authenticated user\'s awarded badges.',
  tags: ['me:gamification'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved badges (or null if empty)',
      content: {
        'application/json': {
          schema: z.array(z.any()).nullable(),
        },
      },
    },
  },
});

export const dailyQuestsRoute = createRoute({
  method: 'get',
  path: '/quests/daily',
  summary: 'Get Daily Quests',
  description: 'Retrieves the daily quests and current progress for the authenticated user.',
  tags: ['me:gamification'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved daily quests',
      content: {
        'application/json': {
          schema: z.array(z.any()),
        },
      },
    },
  },
});

export const weeklyQuestsRoute = createRoute({
  method: 'get',
  path: '/quests/weekly',
  summary: 'Get Weekly Quests',
  description: 'Retrieves the weekly quests and current progress for the authenticated user.',
  tags: ['me:gamification'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved weekly quests',
      content: {
        'application/json': {
          schema: z.array(z.any()),
        },
      },
    },
  },
});

export const missionsRoute = createRoute({
  method: 'get',
  path: '/missions',
  summary: 'Get Missions',
  description: 'Retrieves the active missions and current progress for the authenticated user.',
  tags: ['me:gamification'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved missions (or null if empty)',
      content: {
        'application/json': {
          schema: z.array(z.any()).nullable(),
        },
      },
    },
  },
});

export const dashboardRoute = createRoute({
  method: 'get',
  path: '/dashboard',
  summary: 'Get Dashboard Summary',
  description: 'Retrieves a aggregated summary of the user\'s gamification state (XP, streak, quests, missions, badges).',
  tags: ['me:gamification'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successfully retrieved dashboard summary',
      content: {
        'application/json': {
          schema: z.object({
            xp: z.any().nullable(),
            streak: z.any().nullable(),
            questsDaily: z.array(z.any()),
            questsWeekly: z.array(z.any()),
            missions: z.any().nullable(),
            badges: z.any().nullable(),
          }),
        },
      },
    },
  },
});

export function buildMeGamificationRouter(slice: {
  gamification: GamificationContext;
}) {
  const { gamificationRepo, questRepo, badgeRepo, missionRepo } = slice.gamification;

  const gamificationCtrl = new MeGamificationController(gamificationRepo, badgeRepo);
  const questsCtrl = new MeQuestsController(questRepo);
  const missionsCtrl = new MeMissionsController(missionRepo);
  const dashboardCtrl = new MeDashboardController(gamificationCtrl, questsCtrl, missionsCtrl);

  const router = new OpenAPIHono();

  router.openapi(xpRoute, async (c) => {
    const userId = c.get('user').sub;
    const result = await gamificationCtrl.getXp(userId);
    if (!result.ok) return respondWith(c, result);
    c.header('Cache-Control', CACHE_CONTROL);
    return respondWith(c, result);
  });

  router.openapi(streakRoute, async (c) => {
    const userId = c.get('user').sub;
    const result = await gamificationCtrl.getStreak(userId);
    if (!result.ok) return respondWith(c, result);
    c.header('Cache-Control', CACHE_CONTROL);
    return respondWith(c, result);
  });

  router.openapi(badgesRoute, async (c) => {
    const userId = c.get('user').sub;
    const result = await gamificationCtrl.getBadges(userId);
    if (!result.ok) return respondWith(c, result);
    c.header('Cache-Control', CACHE_CONTROL);
    return respondWith(c, result);
  });

  router.openapi(dailyQuestsRoute, async (c) => {
    const userId = c.get('user').sub;
    const result = await questsCtrl.getDailyQuests(userId, new Date());
    if (!result.ok) return respondWith(c, result);
    c.header('Cache-Control', CACHE_CONTROL);
    return respondWith(c, result);
  });

  router.openapi(weeklyQuestsRoute, async (c) => {
    const userId = c.get('user').sub;
    const result = await questsCtrl.getWeeklyQuests(userId, new Date());
    if (!result.ok) return respondWith(c, result);
    c.header('Cache-Control', CACHE_CONTROL);
    return respondWith(c, result);
  });

  router.openapi(missionsRoute, async (c) => {
    const userId = c.get('user').sub;
    const result = await missionsCtrl.getMissions(userId, new Date());
    if (!result.ok) return respondWith(c, result);
    c.header('Cache-Control', CACHE_CONTROL);
    return respondWith(c, result);
  });

  router.openapi(dashboardRoute, async (c) => {
    const userId = c.get('user').sub;
    const result = await dashboardCtrl.getDashboard(userId, new Date());
    if (!result.ok) return respondWith(c, result);
    c.header('Cache-Control', CACHE_CONTROL);
    return respondWith(c, result);
  });

  return router;
}
