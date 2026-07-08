import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { D1ProgressRepository } from '@api/adapters/db/d1-progress-repository';
import { Entities } from '@arenaquest/shared/types/entities';
import { applyMigrations } from '../helpers/apply-migrations';

describe('D1ProgressRepository', () => {
  let repo: D1ProgressRepository;
  let userId: string;
  let topicId: string;
  let taskId: string;
  let stageId: string;

  beforeAll(async () => {
    await applyMigrations(env.DB);
    repo = new D1ProgressRepository(env.DB);
  });

  beforeEach(async () => {
    userId = crypto.randomUUID();
    topicId = crypto.randomUUID();
    taskId = crypto.randomUUID();
    stageId = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)').bind(userId, 'test', `${userId}@t.com`, 'hash'),
      env.DB.prepare("INSERT INTO topic_nodes (id, title, status) VALUES (?, 'T', 'published')").bind(topicId),
      env.DB.prepare("INSERT INTO tasks (id, title, created_by) VALUES (?, 'T', ?)").bind(taskId, userId),
      env.DB.prepare('INSERT INTO task_stages (id, task_id, label) VALUES (?, ?, ?)').bind(stageId, taskId, 'S1'),
    ]);
  });

  // ---------------------------------------------------------------------------
  // Topic progress
  // ---------------------------------------------------------------------------

  describe('topic progress', () => {
    it('findTopicProgress returns null when no record', async () => {
      expect(await repo.findTopicProgress(userId, topicId)).toBeNull();
    });

    it('upsertTopicProgress creates and returns record', async () => {
      const rec = await repo.upsertTopicProgress(userId, topicId, Entities.Config.ProgressStatus.IN_PROGRESS);
      expect(rec.userId).toBe(userId);
      expect(rec.topicNodeId).toBe(topicId);
      expect(rec.status).toBe('in_progress');
      expect(rec.completedAt).toBeNull();
    });

    it('upsertTopicProgress sets completedAt when status is completed', async () => {
      const rec = await repo.upsertTopicProgress(userId, topicId, Entities.Config.ProgressStatus.COMPLETED);
      expect(rec.status).toBe('completed');
      expect(rec.completedAt).not.toBeNull();
    });

    it('upsertTopicProgress is idempotent (overwrites status)', async () => {
      await repo.upsertTopicProgress(userId, topicId, Entities.Config.ProgressStatus.IN_PROGRESS);
      const rec = await repo.upsertTopicProgress(userId, topicId, Entities.Config.ProgressStatus.COMPLETED);
      expect(rec.status).toBe('completed');
    });

    it('listTopicProgress filtered by topicIds', async () => {
      const t2 = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO topic_nodes (id, title) VALUES (?, 'T2')").bind(t2).run();
      await repo.upsertTopicProgress(userId, topicId, Entities.Config.ProgressStatus.IN_PROGRESS);
      await repo.upsertTopicProgress(userId, t2, Entities.Config.ProgressStatus.COMPLETED);

      const filtered = await repo.listTopicProgress(userId, [topicId]);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].topicNodeId).toBe(topicId);
    });

    it('countCompletedTopics counts correctly', async () => {
      const t2 = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO topic_nodes (id, title) VALUES (?, 'T2')").bind(t2).run();
      await repo.upsertTopicProgress(userId, topicId, Entities.Config.ProgressStatus.COMPLETED);
      await repo.upsertTopicProgress(userId, t2, Entities.Config.ProgressStatus.IN_PROGRESS);

      expect(await repo.countCompletedTopics(userId, [topicId, t2])).toBe(1);
    });

    it('countCompletedTopics returns 0 for empty list', async () => {
      expect(await repo.countCompletedTopics(userId, [])).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Task progress
  // ---------------------------------------------------------------------------

  describe('task progress', () => {
    it('upsertTaskProgress creates record', async () => {
      const rec = await repo.upsertTaskProgress(userId, taskId, {
        status: Entities.Config.ProgressStatus.IN_PROGRESS,
        currentStageId: stageId,
      });
      expect(rec.status).toBe('in_progress');
      expect(rec.currentStageId).toBe(stageId);
      expect(rec.completedAt).toBeNull();
    });

    it('upsertTaskProgress sets completedAt on completion', async () => {
      const rec = await repo.upsertTaskProgress(userId, taskId, {
        status: Entities.Config.ProgressStatus.COMPLETED,
        currentStageId: null,
      });
      expect(rec.status).toBe('completed');
      expect(rec.completedAt).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Stage check-ins
  // ---------------------------------------------------------------------------

  describe('stage check-ins', () => {
    it('findStageCheckIn returns null before check-in', async () => {
      expect(await repo.findStageCheckIn(userId, stageId)).toBeNull();
    });

    it('atomicCheckIn creates check-in and task progress', async () => {
      const checkIn = await repo.atomicCheckIn({
        userId,
        taskId,
        stageId,
        stageTopicIds: [topicId],
        taskStatus: Entities.Config.ProgressStatus.IN_PROGRESS,
        currentStageId: null,
      });

      expect(checkIn.stageId).toBe(stageId);
      expect(checkIn.userId).toBe(userId);

      const taskP = await repo.findTaskProgress(userId, taskId);
      expect(taskP?.status).toBe('in_progress');

      const topicP = await repo.findTopicProgress(userId, topicId);
      expect(topicP?.status).toBe('completed');
    });

    it('atomicCheckIn is idempotent (INSERT OR IGNORE)', async () => {
      await repo.atomicCheckIn({
        userId,
        taskId,
        stageId,
        stageTopicIds: [],
        taskStatus: Entities.Config.ProgressStatus.IN_PROGRESS,
        currentStageId: null,
      });
      // Second call must not throw
      const checkIn = await repo.atomicCheckIn({
        userId,
        taskId,
        stageId,
        stageTopicIds: [],
        taskStatus: Entities.Config.ProgressStatus.COMPLETED,
        currentStageId: null,
      });
      expect(checkIn.stageId).toBe(stageId);

      const checkIns = await repo.listStageCheckIns(userId, taskId);
      expect(checkIns).toHaveLength(1);
    });

    it('getLastActivityAt returns non-null after activity', async () => {
      await repo.upsertTopicProgress(userId, topicId, Entities.Config.ProgressStatus.IN_PROGRESS);
      const ts = await repo.getLastActivityAt(userId);
      expect(ts).not.toBeNull();
    });

    it('getLastActivityAt returns null with no activity', async () => {
      const newUser = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)').bind(newUser, 'test', `${newUser}@t.com`, 'hash').run();
      expect(await repo.getLastActivityAt(newUser)).toBeNull();
    });
  });
});
