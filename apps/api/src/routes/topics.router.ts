import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { TopicsController } from '@api/controllers/topics.controller';
import type {
  ITopicNodeRepository,
  IMediaRepository,
  IStorageAdapter,
  IEnrollmentRepository,
} from '@arenaquest/shared/ports';
import type { XpEngine } from '@arenaquest/shared/domain/gamification/xp-engine';
import type { StreakEngine } from '@arenaquest/shared/domain/gamification/streak-engine';
import type { QuestEvaluator } from '@arenaquest/shared/domain/gamification/quest-evaluator';

const CACHE_CONTROL = 'private, max-age=30';

export function buildTopicsRouter(
  topics: ITopicNodeRepository,
  media: IMediaRepository,
  storage: IStorageAdapter,
  enrollment: IEnrollmentRepository,
  xpEngine?: XpEngine,
  streakEngine?: StreakEngine,
  questEvaluator?: QuestEvaluator,
): Hono {
  const router = new Hono();
  const controller = new TopicsController(topics, media, storage, enrollment);

  router.use('*', authGuard);

  // GET /topics — published catalogue tree
  router.get('/', async (c) => {
    const user = c.get('user');
    const isAdmin = user.roles.includes(ROLES.ADMIN) || user.roles.includes(ROLES.CONTENT_CREATOR);
    const result = await controller.listPublished(isAdmin ? undefined : user.sub);
    if (!result.ok) return c.json({ error: result.error }, result.status as never);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json({ data: result.data });
  });

  // GET /topics/:id — single published topic with published children and ready media
  router.get('/:id', async (c) => {
    const user = c.get('user');
    const isAdmin = user.roles.includes(ROLES.ADMIN) || user.roles.includes(ROLES.CONTENT_CREATOR);
    const result = await controller.getPublishedById(
      c.req.param('id'),
      isAdmin ? undefined : user.sub,
    );
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json(result.data);
  });

  // POST /topics/:id/videos/:videoId/watched — mark video as watched and award XP
  router.post('/:id/videos/:videoId/watched', async (c) => {
    const user = c.get('user');
    const topicId = c.req.param('id');
    const videoId = c.req.param('videoId');
    const isAdmin = user.roles.includes(ROLES.ADMIN) || user.roles.includes(ROLES.CONTENT_CREATOR);

    // Verify topic exists and is accessible
    const topicResult = await controller.getPublishedById(topicId, isAdmin ? undefined : user.sub);
    if (!topicResult.ok) {
      return c.json({ error: topicResult.error }, topicResult.status as 404);
    }

    let xpAwarded: number | null = null;
    if (xpEngine) {
      try {
        const event = await xpEngine.award({
          userId: user.sub,
          action: 'video_watched',
          sourceKind: 'video',
          sourceId: videoId,
        });
        xpAwarded = event?.points ?? null;
      } catch (err) {
        console.error('[XP] video_watched award failed:', err);
      }
    }
    if (streakEngine) {
      try {
        await streakEngine.recordActivity(user.sub, new Date());
      } catch (err) {
        console.error('[streak] video_watched recordActivity failed:', err);
      }
    }
    if (questEvaluator) {
      try {
        await questEvaluator.evaluate(user.sub, 'video', new Date());
      } catch (err) {
        console.error('[quest] video_watched evaluate failed:', err);
      }
    }

    return c.json({ xpAwarded });
  });

  return router;
}
