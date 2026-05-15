import { describe, it, expect, vi } from 'vitest';
import { QuestEvaluator } from '@arenaquest/shared/domain/gamification/quest-evaluator';
import { QuestKind } from '@arenaquest/shared/domain/quest';
import type { IQuestRepository, UpsertQuestProgressInput } from '@arenaquest/shared/ports';
import type { IMissionRepository } from '@arenaquest/shared/ports';
import type { XpEngine, XpAwardParams } from '@arenaquest/shared/domain/gamification/xp-engine';
import type { QuestDefinition, QuestProgress } from '@arenaquest/shared/domain/quest';
import type { Mission, MissionProgress } from '@arenaquest/shared/domain/mission';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeQuestDef(overrides: Partial<QuestDefinition> = {}): QuestDefinition {
  return {
    id: 'quest-1',
    kind: QuestKind.DAILY,
    title: 'Complete a topic',
    description: '',
    predicateKind: 'complete_topic',
    predicateParams: '{"target":1}',
    xpReward: 50,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeQuestProgress(overrides: Partial<QuestProgress> = {}): QuestProgress {
  return {
    userId: 'user-1',
    questId: 'quest-1',
    periodKey: '2024-01-15',
    currentValue: 0,
    targetValue: 1,
    completed: false,
    completedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission-1',
    title: 'Watch 3 videos',
    description: '',
    startAt: '2024-01-01T00:00:00Z',
    endAt: '2024-12-31T23:59:59Z',
    predicateKind: 'watch_video',
    predicateParams: '{"target":3}',
    xpReward: 100,
    badgeId: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMissionProgress(overrides: Partial<MissionProgress> = {}): MissionProgress {
  return {
    userId: 'user-1',
    missionId: 'mission-1',
    currentValue: 0,
    targetValue: 3,
    completed: false,
    completedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeQuestRepo(overrides: Partial<IQuestRepository> = {}): IQuestRepository {
  return {
    listActiveDefinitions: vi.fn(async () => []),
    listActiveQuestsForUser: vi.fn(async () => []),
    findProgress: vi.fn(async () => null),
    upsertProgress: vi.fn(async (input: UpsertQuestProgressInput) =>
      makeQuestProgress({ questId: input.questId, periodKey: input.periodKey }),
    ),
    markCompleted: vi.fn(async () => makeQuestProgress({ completed: true })),
    ...overrides,
  };
}

function makeMissionRepo(overrides: Partial<IMissionRepository> = {}): IMissionRepository {
  return {
    listActiveMissions: vi.fn(async () => []),
    findProgress: vi.fn(async () => null),
    upsertProgress: vi.fn(async () => makeMissionProgress()),
    markCompleted: vi.fn(async () => makeMissionProgress({ completed: true })),
    ...overrides,
  };
}

function makeXpEngine(): XpEngine {
  return { award: vi.fn(async () => null) } as unknown as XpEngine;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';
const NOW = new Date('2024-01-15T10:00:00Z');

describe('QuestEvaluator', () => {
  describe('quest evaluation', () => {
    it('increments daily quest matching the sourceKind', async () => {
      const def = makeQuestDef({ predicateKind: 'complete_topic' });
      const questRepo = makeQuestRepo({
        listActiveDefinitions: vi.fn(async (kind) => kind === QuestKind.DAILY ? [def] : []),
        findProgress: vi.fn(async () => null),
        upsertProgress: vi.fn(async () => makeQuestProgress({ currentValue: 1, completed: true })),
      });
      const missionRepo = makeMissionRepo();
      const xpEngine = makeXpEngine();
      const evaluator = new QuestEvaluator(questRepo, missionRepo, xpEngine);

      await evaluator.evaluate(USER_ID, 'topic', NOW);

      expect(questRepo.upsertProgress).toHaveBeenCalledOnce();
      const call = (questRepo.upsertProgress as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.userId).toBe(USER_ID);
      expect(call.questId).toBe('quest-1');
      expect(call.periodKey).toBe('2024-01-15');
    });

    it('awards reward XP when quest completes for the first time', async () => {
      const def = makeQuestDef({ predicateKind: 'complete_topic', xpReward: 50 });
      const questRepo = makeQuestRepo({
        listActiveDefinitions: vi.fn(async (kind) => kind === QuestKind.DAILY ? [def] : []),
        findProgress: vi.fn(async () => null),
        upsertProgress: vi.fn(async () => makeQuestProgress({ currentValue: 1, targetValue: 1, completed: true })),
      });
      const missionRepo = makeMissionRepo();
      const xpEngine = makeXpEngine();
      const evaluator = new QuestEvaluator(questRepo, missionRepo, xpEngine);

      await evaluator.evaluate(USER_ID, 'topic', NOW);

      expect(xpEngine.award).toHaveBeenCalledOnce();
      const awardCall = (xpEngine.award as ReturnType<typeof vi.fn>).mock.calls[0][0] as XpAwardParams;
      expect(awardCall.customPoints).toBe(50);
      expect(awardCall.sourceKind).toBe('quest_reward');
    });

    it('does not call upsertProgress when quest is already completed', async () => {
      const def = makeQuestDef({ predicateKind: 'complete_topic' });
      const questRepo = makeQuestRepo({
        listActiveDefinitions: vi.fn(async (kind) => kind === QuestKind.DAILY ? [def] : []),
        findProgress: vi.fn(async () => makeQuestProgress({ completed: true })),
      });
      const missionRepo = makeMissionRepo();
      const xpEngine = makeXpEngine();
      const evaluator = new QuestEvaluator(questRepo, missionRepo, xpEngine);

      await evaluator.evaluate(USER_ID, 'topic', NOW);

      expect(questRepo.upsertProgress).not.toHaveBeenCalled();
      expect(xpEngine.award).not.toHaveBeenCalled();
    });

    it('does not call upsertProgress when sourceKind does not match any quest', async () => {
      const def = makeQuestDef({ predicateKind: 'complete_topic' });
      const questRepo = makeQuestRepo({
        listActiveDefinitions: vi.fn(async (kind) => kind === QuestKind.DAILY ? [def] : []),
        findProgress: vi.fn(async () => null),
      });
      const missionRepo = makeMissionRepo();
      const xpEngine = makeXpEngine();
      const evaluator = new QuestEvaluator(questRepo, missionRepo, xpEngine);

      await evaluator.evaluate(USER_ID, 'video', NOW); // topic quest, video event

      expect(questRepo.upsertProgress).not.toHaveBeenCalled();
    });

    it('crossing midnight reopens quest: new period key yields null progress', async () => {
      const def = makeQuestDef({ predicateKind: 'complete_topic' });
      const questRepo = makeQuestRepo({
        listActiveDefinitions: vi.fn(async (kind) => kind === QuestKind.DAILY ? [def] : []),
        findProgress: vi.fn(async () => null), // new day = no prior progress
        upsertProgress: vi.fn(async () => makeQuestProgress({ currentValue: 1, targetValue: 1, completed: true })),
      });
      const missionRepo = makeMissionRepo();
      const xpEngine = makeXpEngine();
      const evaluator = new QuestEvaluator(questRepo, missionRepo, xpEngine);

      const nextDay = new Date('2024-01-16T08:00:00Z');
      await evaluator.evaluate(USER_ID, 'topic', nextDay);

      const call = (questRepo.upsertProgress as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.periodKey).toBe('2024-01-16'); // new period key
    });

    it('reward XP is recorded exactly once — calling evaluate twice on same completed quest', async () => {
      const def = makeQuestDef({ predicateKind: 'complete_topic', xpReward: 50 });
      // Second call: progress is already completed
      const findProgressFn = vi.fn()
        .mockResolvedValueOnce(null)                               // first evaluate: no prior progress
        .mockResolvedValueOnce(makeQuestProgress({ completed: true })); // second evaluate: already done

      const questRepo = makeQuestRepo({
        listActiveDefinitions: vi.fn(async (kind) => kind === QuestKind.DAILY ? [def] : []),
        findProgress: findProgressFn,
        upsertProgress: vi.fn(async () => makeQuestProgress({ currentValue: 1, targetValue: 1, completed: true })),
      });
      const missionRepo = makeMissionRepo();
      const xpEngine = makeXpEngine();
      const evaluator = new QuestEvaluator(questRepo, missionRepo, xpEngine);

      await evaluator.evaluate(USER_ID, 'topic', NOW);
      await evaluator.evaluate(USER_ID, 'topic', NOW);

      expect(xpEngine.award).toHaveBeenCalledOnce();
    });
  });

  describe('mission evaluation', () => {
    it('does not progress a mission when listActiveMissions returns empty (expired or none)', async () => {
      const questRepo = makeQuestRepo();
      const missionRepo = makeMissionRepo({
        listActiveMissions: vi.fn(async () => []), // expired missions filtered out
      });
      const xpEngine = makeXpEngine();
      const evaluator = new QuestEvaluator(questRepo, missionRepo, xpEngine);

      await evaluator.evaluate(USER_ID, 'video', NOW);

      expect(missionRepo.upsertProgress).not.toHaveBeenCalled();
    });

    it('increments an active mission matching the sourceKind', async () => {
      const mission = makeMission({ predicateKind: 'watch_video' });
      const questRepo = makeQuestRepo();
      const missionRepo = makeMissionRepo({
        listActiveMissions: vi.fn(async () => [mission]),
        findProgress: vi.fn(async () => null),
        upsertProgress: vi.fn(async () => makeMissionProgress({ currentValue: 1, completed: false })),
      });
      const xpEngine = makeXpEngine();
      const evaluator = new QuestEvaluator(questRepo, missionRepo, xpEngine);

      await evaluator.evaluate(USER_ID, 'video', NOW);

      expect(missionRepo.upsertProgress).toHaveBeenCalledOnce();
    });

    it('awards mission reward XP on mission completion', async () => {
      const mission = makeMission({ predicateKind: 'watch_video', xpReward: 100 });
      const questRepo = makeQuestRepo();
      const missionRepo = makeMissionRepo({
        listActiveMissions: vi.fn(async () => [mission]),
        findProgress: vi.fn(async () => null),
        upsertProgress: vi.fn(async () => makeMissionProgress({ currentValue: 3, targetValue: 3, completed: true })),
      });
      const xpEngine = makeXpEngine();
      const evaluator = new QuestEvaluator(questRepo, missionRepo, xpEngine);

      await evaluator.evaluate(USER_ID, 'video', NOW);

      expect(xpEngine.award).toHaveBeenCalledOnce();
      const awardCall = (xpEngine.award as ReturnType<typeof vi.fn>).mock.calls[0][0] as XpAwardParams;
      expect(awardCall.customPoints).toBe(100);
      expect(awardCall.action).toBe('mission_reward');
    });
  });

  describe('weekly quest period key', () => {
    it('uses a YYYY-Wnn period key for weekly quests', async () => {
      const def = makeQuestDef({ predicateKind: 'complete_topic', kind: QuestKind.WEEKLY });
      const questRepo = makeQuestRepo({
        listActiveDefinitions: vi.fn(async (kind) => kind === QuestKind.WEEKLY ? [def] : []),
        findProgress: vi.fn(async () => null),
        upsertProgress: vi.fn(async (input) => makeQuestProgress({ periodKey: input.periodKey, completed: false })),
      });
      const missionRepo = makeMissionRepo();
      const xpEngine = makeXpEngine();
      const evaluator = new QuestEvaluator(questRepo, missionRepo, xpEngine);

      // 2024-01-15 is in ISO week 2024-W03
      await evaluator.evaluate(USER_ID, 'topic', new Date('2024-01-15T10:00:00Z'));

      const call = (questRepo.upsertProgress as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.periodKey).toMatch(/^\d{4}-W\d{2}$/);
    });
  });
});
