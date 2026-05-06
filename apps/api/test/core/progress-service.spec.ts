import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProgressService } from '@api/core/progress/progress-service';
import { Entities } from '@arenaquest/shared/types/entities';
import type {
  IProgressRepository,
  IEnrollmentRepository,
  ITaskRepository,
  ITaskStageRepository,
  ITaskLinkingRepository,
  ITopicNodeRepository,
  TaskRecord,
  TaskStageRecord,
  TopicNodeRecord,
  TopicProgressRecord,
  TaskProgressRecord,
  TaskStageProgressRecord,
} from '@arenaquest/shared/ports';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    title: 'T',
    description: '',
    status: Entities.Config.TaskStatus.PUBLISHED,
    createdBy: 'user',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeStage(id: string, order: number, taskId = 'task-1'): TaskStageRecord {
  return { id, taskId, label: `S${order}`, order, createdAt: '' };
}

function makeTopic(id: string): TopicNodeRecord {
  return {
    id,
    parentId: null,
    title: `Topic ${id}`,
    content: '',
    status: Entities.Config.TopicNodeStatus.PUBLISHED,
    tags: [],
    order: 0,
    estimatedMinutes: 0,
    prerequisiteIds: [],
    archived: false,
  };
}

function makeTopicProgress(userId: string, topicId: string, status: Entities.Config.ProgressStatus): TopicProgressRecord {
  return {
    id: crypto.randomUUID(),
    userId,
    topicNodeId: topicId,
    status,
    completedAt: status === 'completed' ? '2026-01-01T00:00:00Z' : null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeCheckIn(userId: string, taskId: string, stageId: string): TaskStageProgressRecord {
  return {
    id: crypto.randomUUID(),
    userId,
    taskId,
    stageId,
    checkedInAt: '2026-01-01T00:00:00Z',
  };
}

function makeTaskProgress(userId: string, taskId: string, status: Entities.Config.ProgressStatus): TaskProgressRecord {
  return {
    id: crypto.randomUUID(),
    userId,
    taskId,
    status,
    currentStageId: null,
    completedAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

// ---------------------------------------------------------------------------
// Mock builders
// ---------------------------------------------------------------------------

function makeRepos() {
  const enrollment: IEnrollmentRepository = {
    getEffectiveAccessTopicIds: vi.fn(async () => ['topic-1', 'topic-2', 'topic-3']),
    listUserGrants: vi.fn(async () => []),
    grantUser: vi.fn(),
    revokeUser: vi.fn(),
    listGroupGrants: vi.fn(async () => []),
    grantGroup: vi.fn(),
    revokeGroup: vi.fn(),
  };

  const progress: IProgressRepository = {
    findTopicProgress: vi.fn(async () => null),
    listTopicProgress: vi.fn(async () => []),
    upsertTopicProgress: vi.fn(async (userId, topicId, status) =>
      makeTopicProgress(userId, topicId, status),
    ),
    findTaskProgress: vi.fn(async () => null),
    listTaskProgress: vi.fn(async () => []),
    upsertTaskProgress: vi.fn(async (userId, taskId, data) =>
      makeTaskProgress(userId, taskId, data.status),
    ),
    findStageCheckIn: vi.fn(async () => null),
    listStageCheckIns: vi.fn(async () => []),
    atomicCheckIn: vi.fn(async (params) => makeCheckIn(params.userId, params.taskId, params.stageId)),
    countCompletedTopics: vi.fn(async () => 0),
    countInProgressTopics: vi.fn(async () => 0),
    countCompletedTasks: vi.fn(async () => 0),
    countInProgressTasks: vi.fn(async () => 0),
    getLastActivityAt: vi.fn(async () => null),
  };

  const taskStore = new Map<string, TaskRecord>([['task-1', makeTask()]]);
  const stageStore = new Map<string, TaskStageRecord[]>([
    ['task-1', [makeStage('stage-1', 1), makeStage('stage-2', 2), makeStage('stage-3', 3)]],
  ]);

  const tasks: ITaskRepository = {
    findById: vi.fn(async (id) => taskStore.get(id) ?? null),
    list: vi.fn(async () => [...taskStore.values()]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const stages: ITaskStageRepository = {
    findById: vi.fn(async (id) => {
      for (const list of stageStore.values()) {
        const s = list.find((s) => s.id === id);
        if (s) return s;
      }
      return null;
    }),
    listByTask: vi.fn(async (taskId) => stageStore.get(taskId) ?? []),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    reorder: vi.fn(),
  };

  const links: ITaskLinkingRepository = {
    setTaskTopics: vi.fn(),
    listTaskTopics: vi.fn(async () => ['topic-1']),
    setStageTopics: vi.fn(),
    listStageTopics: vi.fn(async () => ['topic-1']),
    hydrate: vi.fn(async () => ({ taskTopicIds: [], stages: [] })),
  };

  const topicStore = new Map<string, TopicNodeRecord>([['topic-1', makeTopic('topic-1')]]);
  const topics: ITopicNodeRepository = {
    findById: vi.fn(async (id) => topicStore.get(id) ?? null),
    listChildren: vi.fn(async () => []),
    listAll: vi.fn(async () => [...topicStore.values()]),
    create: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    archive: vi.fn(),
    delete: vi.fn(),
    wouldCreateCycle: vi.fn(async () => false),
  };

  return { enrollment, progress, tasks, stages, links, topics };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProgressService', () => {
  let repos: ReturnType<typeof makeRepos>;
  let service: ProgressService;

  beforeEach(() => {
    repos = makeRepos();
    service = new ProgressService(
      repos.progress,
      repos.enrollment,
      repos.tasks,
      repos.stages,
      repos.links,
      repos.topics,
    );
  });

  // -------------------------------------------------------------------------
  // stageCheckIn
  // -------------------------------------------------------------------------

  describe('stageCheckIn', () => {
    it('returns 404 when task not found', async () => {
      vi.mocked(repos.tasks.findById).mockResolvedValueOnce(null);
      const r = await service.stageCheckIn('u', 'task-1', 'stage-1');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(404);
    });

    it('returns 404 when stage does not belong to task', async () => {
      vi.mocked(repos.stages.findById).mockResolvedValueOnce(makeStage('stage-X', 1, 'other-task'));
      const r = await service.stageCheckIn('u', 'task-1', 'stage-X');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(404);
    });

    it('returns 403 NOT_ENROLLED when topic not accessible', async () => {
      vi.mocked(repos.enrollment.getEffectiveAccessTopicIds).mockResolvedValueOnce([]);
      const r = await service.stageCheckIn('u', 'task-1', 'stage-1');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(403);
        expect(r.error).toBe('NOT_ENROLLED');
      }
    });

    it('returns 200 with changed=false on idempotent re-check-in', async () => {
      const existingCheckIn = makeCheckIn('u', 'task-1', 'stage-1');
      vi.mocked(repos.progress.findStageCheckIn).mockResolvedValueOnce(existingCheckIn);
      vi.mocked(repos.progress.findTaskProgress).mockResolvedValueOnce(
        makeTaskProgress('u', 'task-1', Entities.Config.ProgressStatus.IN_PROGRESS),
      );

      const r = await service.stageCheckIn('u', 'task-1', 'stage-1');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.changed).toBe(false);
        expect(r.data.checkIn.stageId).toBe('stage-1');
      }
    });

    it('returns 409 OUT_OF_ORDER when skipping a stage', async () => {
      // stage-1 not checked in, attempting stage-2
      vi.mocked(repos.progress.listStageCheckIns).mockResolvedValueOnce([]);
      const r = await service.stageCheckIn('u', 'task-1', 'stage-2');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(409);
        expect(r.error).toBe('OUT_OF_ORDER');
        expect(r.meta?.expectedStageId).toBe('stage-1');
      }
    });

    it('calls atomicCheckIn on happy path with correct status', async () => {
      // Check in stage-1 (first stage, two remain → in_progress)
      const r = await service.stageCheckIn('u', 'task-1', 'stage-1');
      expect(r.ok).toBe(true);
      expect(vi.mocked(repos.progress.atomicCheckIn)).toHaveBeenCalledWith(
        expect.objectContaining({
          stageId: 'stage-1',
          taskStatus: Entities.Config.ProgressStatus.IN_PROGRESS,
          currentStageId: 'stage-2',
        }),
      );
    });

    it('marks task as completed when checking in the final stage', async () => {
      // Simulate stages 1 and 2 already done; checking in stage-3 (last)
      vi.mocked(repos.progress.listStageCheckIns).mockResolvedValueOnce([
        makeCheckIn('u', 'task-1', 'stage-1'),
        makeCheckIn('u', 'task-1', 'stage-2'),
      ]);
      vi.mocked(repos.stages.findById).mockResolvedValueOnce(makeStage('stage-3', 3));
      const r = await service.stageCheckIn('u', 'task-1', 'stage-3');
      expect(r.ok).toBe(true);
      expect(vi.mocked(repos.progress.atomicCheckIn)).toHaveBeenCalledWith(
        expect.objectContaining({
          taskStatus: Entities.Config.ProgressStatus.COMPLETED,
          currentStageId: null,
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // visitTopic
  // -------------------------------------------------------------------------

  describe('visitTopic', () => {
    it('returns 404 for non-published topic', async () => {
      vi.mocked(repos.topics.findById).mockResolvedValueOnce(null);
      const r = await service.visitTopic('u', 'topic-1');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(404);
    });

    it('returns 403 for unenrolled topic', async () => {
      vi.mocked(repos.enrollment.getEffectiveAccessTopicIds).mockResolvedValueOnce([]);
      const r = await service.visitTopic('u', 'topic-1');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(403);
        expect(r.error).toBe('NOT_ENROLLED');
      }
    });

    it('transitions from not_started to in_progress', async () => {
      const r = await service.visitTopic('u', 'topic-1');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.topicProgress.status).toBe('in_progress');
        expect(r.data.changed).toBe(true);
      }
    });

    it('does NOT demote completed to in_progress (monotonic)', async () => {
      vi.mocked(repos.progress.findTopicProgress).mockResolvedValueOnce(
        makeTopicProgress('u', 'topic-1', Entities.Config.ProgressStatus.COMPLETED),
      );
      const r = await service.visitTopic('u', 'topic-1');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.topicProgress.status).toBe('completed');
        expect(r.data.changed).toBe(false);
        expect(vi.mocked(repos.progress.upsertTopicProgress)).not.toHaveBeenCalled();
      }
    });
  });

  // -------------------------------------------------------------------------
  // completeTopic
  // -------------------------------------------------------------------------

  describe('completeTopic', () => {
    it('marks topic as completed regardless of prior state', async () => {
      const r = await service.completeTopic('u', 'topic-1');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.topicProgress.status).toBe('completed');
    });

    it('changed=false when already completed', async () => {
      vi.mocked(repos.progress.findTopicProgress).mockResolvedValueOnce(
        makeTopicProgress('u', 'topic-1', Entities.Config.ProgressStatus.COMPLETED),
      );
      const r = await service.completeTopic('u', 'topic-1');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.changed).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getProgressSummary
  // -------------------------------------------------------------------------

  describe('getProgressSummary', () => {
    it('returns zeroed percentages when no completed items', async () => {
      const r = await service.getProgressSummary('u');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.topics.percentage).toBe(0);
        expect(r.data.tasks.percentage).toBe(0);
      }
    });

    it('handles zero-total gracefully (no NaN)', async () => {
      vi.mocked(repos.enrollment.getEffectiveAccessTopicIds).mockResolvedValueOnce([]);
      const r = await service.getProgressSummary('u');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(Number.isNaN(r.data.topics.percentage)).toBe(false);
        expect(r.data.topics.percentage).toBe(0);
      }
    });

    it('calculates percentage correctly', async () => {
      const t2 = makeTopic('topic-2');
      vi.mocked(repos.topics.listAll).mockResolvedValueOnce([
        makeTopic('topic-1'),
        { ...t2, status: Entities.Config.TopicNodeStatus.PUBLISHED },
      ]);
      vi.mocked(repos.enrollment.getEffectiveAccessTopicIds).mockResolvedValueOnce(['topic-1', 'topic-2']);
      vi.mocked(repos.progress.countCompletedTopics).mockResolvedValueOnce(1);

      const r = await service.getProgressSummary('u');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.topics.total).toBe(2);
        expect(r.data.topics.completed).toBe(1);
        expect(r.data.topics.percentage).toBe(50);
      }
    });
  });
});
