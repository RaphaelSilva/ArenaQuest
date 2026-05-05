import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { D1TaskRepository } from '@api/adapters/db/d1-task-repository';
import { Entities } from '@arenaquest/shared/types/entities';

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
];

describe('D1TaskRepository', () => {
  let repo: D1TaskRepository;
  let userId: string;

  beforeAll(async () => {
    await env.DB.batch(MIGRATION_STATEMENTS.map(sql => env.DB.prepare(sql)));
    userId = crypto.randomUUID();
    await env.DB
      .prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)')
      .bind(userId, `${userId}@example.com`)
      .run();
    repo = new D1TaskRepository(env.DB);
  });

  it('create + findById round-trip', async () => {
    const task = await repo.create({ title: 'Passe de bola', createdBy: userId });

    expect(task.id).toBeTypeOf('string');
    expect(task.title).toBe('Passe de bola');
    expect(task.description).toBe('');
    expect(task.status).toBe(Entities.Config.TaskStatus.DRAFT);
    expect(task.createdBy).toBe(userId);

    const fetched = await repo.findById(task.id);
    expect(fetched?.id).toBe(task.id);
  });

  it('findById returns null for unknown id', async () => {
    expect(await repo.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('list filters by status', async () => {
    const draft = await repo.create({ title: 'Draft One', createdBy: userId });
    const pub = await repo.create({
      title: 'Published One',
      createdBy: userId,
      status: Entities.Config.TaskStatus.PUBLISHED,
    });

    const draftList = await repo.list({ status: Entities.Config.TaskStatus.DRAFT });
    expect(draftList.map(t => t.id)).toContain(draft.id);
    expect(draftList.map(t => t.id)).not.toContain(pub.id);

    const pubList = await repo.list({ status: Entities.Config.TaskStatus.PUBLISHED });
    expect(pubList.map(t => t.id)).toContain(pub.id);
  });

  it('update modifies fields and bumps updated_at', async () => {
    const task = await repo.create({ title: 'Old', createdBy: userId });
    const updated = await repo.update(task.id, {
      title: 'New',
      description: 'Body',
      status: Entities.Config.TaskStatus.PUBLISHED,
    });

    expect(updated.title).toBe('New');
    expect(updated.description).toBe('Body');
    expect(updated.status).toBe(Entities.Config.TaskStatus.PUBLISHED);
  });

  it('delete removes the task', async () => {
    const task = await repo.create({ title: 'To Delete', createdBy: userId });
    await repo.delete(task.id);
    expect(await repo.findById(task.id)).toBeNull();
  });
});
