import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { D1TaskRepository } from '@api/adapters/db/d1-task-repository';
import { D1TaskStageRepository } from '@api/adapters/db/d1-task-stage-repository';
import { D1TaskLinkingRepository } from '@api/adapters/db/d1-task-linking-repository';
import { StageTopicNotInTaskError } from '@arenaquest/shared/ports';
import { applyMigrations } from '../helpers/apply-migrations';

async function seedTopic(title: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB
    .prepare('INSERT INTO topic_nodes (id, title) VALUES (?, ?)')
    .bind(id, title)
    .run();
  return id;
}

describe('D1TaskLinkingRepository', () => {
  let tasks: D1TaskRepository;
  let stages: D1TaskStageRepository;
  let links: D1TaskLinkingRepository;
  let userId: string;

  beforeAll(async () => {
    await applyMigrations(env.DB);
    // Foreign keys must be on for ON DELETE RESTRICT to fire in the local SQLite.
    await env.DB.exec('PRAGMA foreign_keys = ON');

    userId = crypto.randomUUID();
    await env.DB
      .prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(userId, 'test', `${userId}@example.com`, 'hash')
      .run();
    tasks = new D1TaskRepository(env.DB);
    stages = new D1TaskStageRepository(env.DB);
    links = new D1TaskLinkingRepository(env.DB);
  });

  it('setTaskTopics + listTaskTopics replace the link set atomically', async () => {
    const task = await tasks.create({ title: 'L1', createdBy: userId });
    const t1 = await seedTopic('T1');
    const t2 = await seedTopic('T2');

    await links.setTaskTopics(task.id, [t1, t2]);
    expect((await links.listTaskTopics(task.id)).sort()).toEqual([t1, t2].sort());

    await links.setTaskTopics(task.id, [t1]);
    expect(await links.listTaskTopics(task.id)).toEqual([t1]);
  });

  it('setStageTopics enforces narrowing invariant', async () => {
    const task = await tasks.create({ title: 'L2', createdBy: userId });
    const stage = await stages.create({ taskId: task.id, label: 'S' });
    const inSet = await seedTopic('In');
    const outSet = await seedTopic('Out');

    await links.setTaskTopics(task.id, [inSet]);

    await expect(links.setStageTopics(stage.id, [inSet, outSet])).rejects.toBeInstanceOf(
      StageTopicNotInTaskError,
    );

    await links.setStageTopics(stage.id, [inSet]);
    expect(await links.listStageTopics(stage.id)).toEqual([inSet]);
  });

  it('cascades stage links when stage is deleted', async () => {
    const task = await tasks.create({ title: 'L3', createdBy: userId });
    const stage = await stages.create({ taskId: task.id, label: 'S' });
    const t = await seedTopic('TC');

    await links.setTaskTopics(task.id, [t]);
    await links.setStageTopics(stage.id, [t]);

    await stages.delete(stage.id);
    expect(await links.listStageTopics(stage.id)).toEqual([]);
  });

  it('refuses to delete a topic that is still linked', async () => {
    const task = await tasks.create({ title: 'L4', createdBy: userId });
    const t = await seedTopic('Locked');

    await links.setTaskTopics(task.id, [t]);

    await expect(
      env.DB.prepare('DELETE FROM topic_nodes WHERE id = ?').bind(t).run(),
    ).rejects.toThrow();
  });

  it('hydrate returns task-level and stage-level link sets', async () => {
    const task = await tasks.create({ title: 'L5', createdBy: userId });
    const s1 = await stages.create({ taskId: task.id, label: 'S1' });
    const s2 = await stages.create({ taskId: task.id, label: 'S2' });
    const t1 = await seedTopic('H1');
    const t2 = await seedTopic('H2');

    await links.setTaskTopics(task.id, [t1, t2]);
    await links.setStageTopics(s1.id, [t1]);
    await links.setStageTopics(s2.id, [t2]);

    const hydrated = await links.hydrate(task.id);
    expect(hydrated.taskTopicIds.sort()).toEqual([t1, t2].sort());
    expect(hydrated.stages).toHaveLength(2);
    const map = new Map(hydrated.stages.map(s => [s.stageId, s.topicIds]));
    expect(map.get(s1.id)).toEqual([t1]);
    expect(map.get(s2.id)).toEqual([t2]);
  });
});
