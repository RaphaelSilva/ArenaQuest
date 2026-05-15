import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { D1QuestRepository } from '@api/adapters/db/d1-quest-repository';
import { QuestKind } from '@arenaquest/shared/domain/quest';

const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id            TEXT NOT NULL PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS quest_definitions (
    id               TEXT    NOT NULL PRIMARY KEY,
    kind             TEXT    NOT NULL,
    title            TEXT    NOT NULL,
    description      TEXT    NOT NULL,
    predicate_kind   TEXT    NOT NULL,
    predicate_params TEXT    NOT NULL,
    xp_reward        INTEGER NOT NULL,
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS quest_progress (
    user_id       TEXT    NOT NULL,
    quest_id      TEXT    NOT NULL,
    period_key    TEXT    NOT NULL,
    current_value INTEGER NOT NULL DEFAULT 0,
    target_value  INTEGER NOT NULL,
    completed     INTEGER NOT NULL DEFAULT 0,
    completed_at  TEXT,
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, quest_id, period_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (quest_id) REFERENCES quest_definitions(id) ON DELETE CASCADE
  )`
];

describe('D1QuestRepository', () => {
  let repo: D1QuestRepository;
  const userId = 'user-123';

  beforeAll(async () => {
    await env.DB.batch(MIGRATION_STATEMENTS.map(sql => env.DB.prepare(sql)));
    repo = new D1QuestRepository(env.DB);

    // Seed definitions
    await env.DB.prepare(`
      INSERT INTO quest_definitions (id, kind, title, description, predicate_kind, predicate_params, xp_reward, active)
      VALUES 
      ('d1', 'daily', 'Daily 1', 'Desc 1', 'watch', '{}', 10, 1),
      ('d2', 'daily', 'Daily 2', 'Desc 2', 'watch', '{}', 10, 0),
      ('w1', 'weekly', 'Weekly 1', 'Desc 3', 'complete', '{}', 50, 1)
    `).run();

    // Seed user
    await env.DB.prepare(`
      INSERT INTO users (id, name, email, password_hash)
      VALUES (?, 'User', 'user@example.com', 'hash')
    `).bind(userId).run();
  });

  it('listActiveDefinitions filters by kind and active status', async () => {
    const dailies = await repo.listActiveDefinitions(QuestKind.DAILY);
    expect(dailies).toHaveLength(1);
    expect(dailies[0].id).toBe('d1');

    const weeklies = await repo.listActiveDefinitions(QuestKind.WEEKLY);
    expect(weeklies).toHaveLength(1);
    expect(weeklies[0].id).toBe('w1');
  });

  it('upsertProgress is idempotent and handles completion', async () => {
    const period = '2026-05-14';
    
    // First upsert
    const p1 = await repo.upsertProgress({
      userId,
      questId: 'd1',
      periodKey: period,
      incrementBy: 1,
      targetValue: 2
    });
    expect(p1.currentValue).toBe(1);
    expect(p1.completed).toBe(false);

    // Second upsert (same params)
    const p2 = await repo.upsertProgress({
      userId,
      questId: 'd1',
      periodKey: period,
      incrementBy: 1,
      targetValue: 2
    });
    expect(p2.currentValue).toBe(2);
    expect(p2.completed).toBe(true);
    expect(p2.completedAt).not.toBeNull();

    // Third upsert (already completed)
    const p3 = await repo.upsertProgress({
      userId,
      questId: 'd1',
      periodKey: period,
      incrementBy: 1,
      targetValue: 2
    });
    expect(p3.currentValue).toBe(3);
    expect(p3.completed).toBe(true);
  });

  it('listActiveQuestsForUser returns definitions with progress', async () => {
    const period = '2026-05-15';
    
    // No progress yet
    const quests1 = await repo.listActiveQuestsForUser(userId, QuestKind.DAILY, period);
    expect(quests1).toHaveLength(1);
    expect(quests1[0].id).toBe('d1');
    expect(quests1[0].progress).toBeNull();

    // Add some progress
    await repo.upsertProgress({
      userId,
      questId: 'd1',
      periodKey: period,
      incrementBy: 5,
      targetValue: 10
    });

    const quests2 = await repo.listActiveQuestsForUser(userId, QuestKind.DAILY, period);
    expect(quests2[0].progress).not.toBeNull();
    expect(quests2[0].progress!.currentValue).toBe(5);
  });

  it('markCompleted sets completed status manually', async () => {
    const period = '2026-05-16';
    
    // Create initial progress
    await repo.upsertProgress({
      userId,
      questId: 'd1',
      periodKey: period,
      incrementBy: 0,
      targetValue: 10
    });

    const completed = await repo.markCompleted(userId, 'd1', period);
    expect(completed.completed).toBe(true);
    expect(completed.completedAt).not.toBeNull();
  });
});
