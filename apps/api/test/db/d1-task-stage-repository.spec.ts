import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { D1TaskRepository } from '@api/adapters/db/d1-task-repository';
import { D1TaskStageRepository } from '@api/adapters/db/d1-task-stage-repository';

const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id    TEXT NOT NULL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE
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
];

describe('D1TaskStageRepository', () => {
  let tasks: D1TaskRepository;
  let stages: D1TaskStageRepository;
  let userId: string;

  beforeAll(async () => {
    await env.DB.batch(MIGRATION_STATEMENTS.map(sql => env.DB.prepare(sql)));
    userId = crypto.randomUUID();
    await env.DB
      .prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)')
      .bind(userId, `${userId}@example.com`)
      .run();
    tasks = new D1TaskRepository(env.DB);
    stages = new D1TaskStageRepository(env.DB);
  });

  it('create assigns next sort_order automatically', async () => {
    const task = await tasks.create({ title: 'T1', createdBy: userId });
    const s1 = await stages.create({ taskId: task.id, label: 'Reading' });
    const s2 = await stages.create({ taskId: task.id, label: 'Practice' });
    const s3 = await stages.create({ taskId: task.id, label: 'Review' });

    expect(s1.order).toBe(0);
    expect(s2.order).toBe(1);
    expect(s3.order).toBe(2);
  });

  it('listByTask returns stages ordered by sort_order', async () => {
    const task = await tasks.create({ title: 'T2', createdBy: userId });
    await stages.create({ taskId: task.id, label: 'A', order: 2 });
    await stages.create({ taskId: task.id, label: 'B', order: 0 });
    await stages.create({ taskId: task.id, label: 'C', order: 1 });

    const list = await stages.listByTask(task.id);
    expect(list.map(s => s.label)).toEqual(['B', 'C', 'A']);
  });

  it('update modifies label', async () => {
    const task = await tasks.create({ title: 'T3', createdBy: userId });
    const s = await stages.create({ taskId: task.id, label: 'Old' });

    const updated = await stages.update(s.id, { label: 'New' });
    expect(updated.label).toBe('New');
  });

  it('delete removes the stage', async () => {
    const task = await tasks.create({ title: 'T4', createdBy: userId });
    const s = await stages.create({ taskId: task.id, label: 'X' });

    await stages.delete(s.id);
    expect(await stages.findById(s.id)).toBeNull();
  });

  it('reorder atomically rewrites sort_order without violating uniqueness', async () => {
    const task = await tasks.create({ title: 'T5', createdBy: userId });
    const a = await stages.create({ taskId: task.id, label: 'A' });
    const b = await stages.create({ taskId: task.id, label: 'B' });
    const c = await stages.create({ taskId: task.id, label: 'C' });

    await stages.reorder(task.id, [c.id, a.id, b.id]);

    const list = await stages.listByTask(task.id);
    expect(list.map(s => s.id)).toEqual([c.id, a.id, b.id]);
    expect(list.map(s => s.order)).toEqual([0, 1, 2]);
  });

  it('cascades stage deletion when parent task is deleted', async () => {
    const task = await tasks.create({ title: 'T6', createdBy: userId });
    const s = await stages.create({ taskId: task.id, label: 'Doomed' });

    await tasks.delete(task.id);
    expect(await stages.findById(s.id)).toBeNull();
  });
});
