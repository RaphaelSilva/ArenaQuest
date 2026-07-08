import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { D1QuestRepository } from '@api/adapters/db/d1-quest-repository';
import { QuestKind } from '@arenaquest/shared/domain/quest';
import { applyMigrations } from '../helpers/apply-migrations';


describe('D1QuestRepository', () => {
  let repo: D1QuestRepository;
  const userId = 'user-123';

  beforeAll(async () => {
    await applyMigrations(env.DB);
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
    const d1 = dailies.find(q => q.id === 'd1');
    expect(d1).toBeDefined();
    expect(d1?.id).toBe('d1');
    expect(dailies.every(q => q.kind === QuestKind.DAILY && q.active)).toBe(true);

    const weeklies = await repo.listActiveDefinitions(QuestKind.WEEKLY);
    const w1 = weeklies.find(q => q.id === 'w1');
    expect(w1).toBeDefined();
    expect(w1?.id).toBe('w1');
    expect(weeklies.every(q => q.kind === QuestKind.WEEKLY && q.active)).toBe(true);
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
    const d1Quest1 = quests1.find(q => q.id === 'd1');
    expect(d1Quest1).toBeDefined();
    expect(d1Quest1!.progress).toBeNull();

    // Add some progress
    await repo.upsertProgress({
      userId,
      questId: 'd1',
      periodKey: period,
      incrementBy: 5,
      targetValue: 10
    });

    const quests2 = await repo.listActiveQuestsForUser(userId, QuestKind.DAILY, period);
    const d1Quest2 = quests2.find(q => q.id === 'd1');
    expect(d1Quest2!.progress).not.toBeNull();
    expect(d1Quest2!.progress!.currentValue).toBe(5);
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
