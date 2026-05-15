import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import type { IGamificationRepository, IQuestRepository, IBadgeRepository } from '@arenaquest/shared/ports';
import type { IMissionRepository } from '@arenaquest/shared/ports';
import { MeGamificationController } from '@api/controllers/me-gamification.controller';
import { MeQuestsController } from '@api/controllers/me-quests.controller';
import { MeMissionsController } from '@api/controllers/me-missions.controller';
import { MeDashboardController } from '@api/controllers/me-dashboard.controller';

const CACHE_CONTROL = 'private, max-age=15';

export function buildMeGamificationRouter(
  gamificationRepo: IGamificationRepository,
  questRepo: IQuestRepository,
  badgeRepo: IBadgeRepository,
  missionRepo: IMissionRepository,
): Hono {
  const router = new Hono();

  const gamificationCtrl = new MeGamificationController(gamificationRepo, badgeRepo);
  const questsCtrl = new MeQuestsController(questRepo);
  const missionsCtrl = new MeMissionsController(missionRepo);
  const dashboardCtrl = new MeDashboardController(gamificationCtrl, questsCtrl, missionsCtrl);

  router.use('*', authGuard);

  router.get('/xp', async (c) => {
    const userId = c.get('user').sub;
    const result = await gamificationCtrl.getXp(userId);
    if (!result.ok) return c.json({ error: result.error }, result.status as 500);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json(result.data);
  });

  router.get('/streak', async (c) => {
    const userId = c.get('user').sub;
    const result = await gamificationCtrl.getStreak(userId);
    if (!result.ok) return c.json({ error: result.error }, result.status as 500);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json(result.data);
  });

  router.get('/badges', async (c) => {
    const userId = c.get('user').sub;
    const result = await gamificationCtrl.getBadges(userId);
    if (!result.ok) return c.json({ error: result.error }, result.status as 500);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json(result.data);
  });

  router.get('/quests/daily', async (c) => {
    const userId = c.get('user').sub;
    const result = await questsCtrl.getDailyQuests(userId, new Date());
    if (!result.ok) return c.json({ error: result.error }, result.status as 500);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json(result.data);
  });

  router.get('/quests/weekly', async (c) => {
    const userId = c.get('user').sub;
    const result = await questsCtrl.getWeeklyQuests(userId, new Date());
    if (!result.ok) return c.json({ error: result.error }, result.status as 500);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json(result.data);
  });

  router.get('/missions', async (c) => {
    const userId = c.get('user').sub;
    const result = await missionsCtrl.getMissions(userId, new Date());
    if (!result.ok) return c.json({ error: result.error }, result.status as 500);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json(result.data);
  });

  router.get('/dashboard', async (c) => {
    const userId = c.get('user').sub;
    const result = await dashboardCtrl.getDashboard(userId, new Date());
    if (!result.ok) return c.json({ error: result.error }, result.status as 500);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json(result.data);
  });

  return router;
}
