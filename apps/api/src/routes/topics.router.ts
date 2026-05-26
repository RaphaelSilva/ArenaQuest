import { Hono } from 'hono';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { TopicsController } from '@api/controllers/topics.controller';
import type { ContentContext, ProgressContext, GamificationContext } from '@api/container';

export function buildTopicsRouter(slice: {
  content: ContentContext;
  progress: ProgressContext;
  gamification: GamificationContext;
}): Hono {
  const { topics, media, storage } = slice.content;
  const { enrollmentRepo: enrollment } = slice.progress;
  const { xpEngine, streakEngine, questEvaluator, badgeEngine } = slice.gamification;

  const router = new Hono();
  const controller = new TopicsController(topics, media, storage, enrollment);

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

    if (badgeEngine) {
      try {
        await badgeEngine.evaluate(user.sub, new Date());
      } catch (err) {
        console.error('[badge] video_watched evaluate failed:', err);
      }
    }

    return c.json({ xpAwarded });
  });

  return router;
}
