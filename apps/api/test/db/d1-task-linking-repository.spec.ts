import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { D1TaskRepository } from '@api/adapters/db/d1-task-repository';
import { D1TaskStageRepository } from '@api/adapters/db/d1-task-stage-repository';
import { D1TaskLinkingRepository } from '@api/adapters/db/d1-task-linking-repository';
import { StageTopicNotInTaskError } from '@arenaquest/shared/ports';

const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id    TEXT NOT NULL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS topic_nodes (
    id                TEXT    NOT NULL PRIMARY KEY,
    parent_id         TEXT    REFERENCES topic_nodes(id) ON DELETE RESTRICT,
    title             TEXT    NOT NULL,
    content           TEXT    NOT NULL DEFAULT '',
    status            TEXT    NOT NULL DEFAULT 'draft',
    sort_order        INTEGER NOT NULL DEFAULT 0,
    estimated_minutes INTEGER NOT NULL DEFAULT 0,
    archived          INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT NOT NULL PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'draft',
    created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS task_stages (
    id         TEXT    NOT NULL PRIMARY KEY,
    task_id    TEXT    NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label      TEXT    NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_task_stages_task_order
    ON task_stages(task_id, sort_order)`,
  `CREATE TABLE IF NOT EXISTS task_topic_links (
    task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    topic_node_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE RESTRICT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (task_id, topic_node_id)
  )`,
  `CREATE TABLE IF NOT EXISTS task_stage_topic_links (
    stage_id      TEXT NOT NULL REFERENCES task_stages(id) ON DELETE CASCADE,
    topic_node_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE RESTRICT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (stage_id, topic_node_id)
  )`,
];

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
    await env.DB.batch(MIGRATION_STATEMENTS.map(sql => env.DB.prepare(sql)));
    // Foreign keys must be on for ON DELETE RESTRICT to fire in the local SQLite.
    await env.DB.exec('PRAGMA foreign_keys = ON');

    userId = crypto.randomUUID();
    await env.DB
      .prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)')
      .bind(userId, `${userId}@example.com`)
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
