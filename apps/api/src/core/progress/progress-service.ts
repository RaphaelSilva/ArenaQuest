import type {
  IProgressRepository,
  IEnrollmentRepository,
  TopicProgressRecord,
  TaskProgressRecord,
  TaskStageProgressRecord,
} from '@arenaquest/shared/ports';
import type {
  ITaskRepository,
  ITaskStageRepository,
  ITaskLinkingRepository,
  ITopicNodeRepository,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '@api/core/result';

export type CheckInResult = {
  checkIn: TaskStageProgressRecord;
  taskProgress: TaskProgressRecord;
  changed: boolean;
};

export type TopicProgressResult = {
  topicProgress: TopicProgressRecord;
  changed: boolean;
};

export type ProgressSummary = {
  topics: {
    total: number;
    completed: number;
    inProgress: number;
    percentage: number;
  };
  tasks: {
    total: number;
    completed: number;
    inProgress: number;
    percentage: number;
  };
  lastActivityAt: string | null;
};

export class ProgressService {
  constructor(
    private readonly progress: IProgressRepository,
    private readonly enrollment: IEnrollmentRepository,
    private readonly tasks: ITaskRepository,
    private readonly stages: ITaskStageRepository,
    private readonly links: ITaskLinkingRepository,
    private readonly topics: ITopicNodeRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Stage check-in
  // ---------------------------------------------------------------------------

  async stageCheckIn(
    userId: string,
    taskId: string,
    stageId: string,
  ): Promise<ControllerResult<CheckInResult>> {
    // 1. Verify task exists and is published
    const task = await this.tasks.findById(taskId);
    if (!task || task.status !== Entities.Config.TaskStatus.PUBLISHED) {
      return { ok: false, status: 404, error: 'NotFound' };
    }

    // 2. Verify stage belongs to this task
    const stage = await this.stages.findById(stageId);
    if (!stage || stage.taskId !== taskId) {
      return { ok: false, status: 404, error: 'NotFound' };
    }

    // 3. Enrollment gate — check task's topics are all accessible
    const [effectiveIds, taskTopicIds] = await Promise.all([
      this.enrollment.getEffectiveAccessTopicIds(userId),
      this.links.listTaskTopics(taskId),
    ]);
    const effectiveSet = new Set(effectiveIds);
    const allAccessible = taskTopicIds.length === 0 || taskTopicIds.every((id) => effectiveSet.has(id));
    if (!allAccessible) {
      return { ok: false, status: 403, error: 'NOT_ENROLLED' };
    }

    // 4. Idempotency — already checked in?
    const existing = await this.progress.findStageCheckIn(userId, stageId);
    if (existing) {
      const taskProgress = await this.progress.findTaskProgress(userId, taskId);
      return {
        ok: true,
        data: {
          checkIn: existing,
          taskProgress: taskProgress!,
          changed: false,
        },
      };
    }

    // 5. Ordering enforcement
    const [allStages, completedCheckIns] = await Promise.all([
      this.stages.listByTask(taskId),
      this.progress.listStageCheckIns(userId, taskId),
    ]);

    // Stages are ordered by sort_order ascending
    const orderedStages = [...allStages].sort((a, b) => a.order - b.order);
    const checkedInIds = new Set(completedCheckIns.map((c) => c.stageId));

    // Find the first unchecked stage — that is the next expected stage
    const nextExpected = orderedStages.find((s) => !checkedInIds.has(s.id));
    if (nextExpected && nextExpected.id !== stageId) {
      return {
        ok: false,
        status: 409,
        error: 'OUT_OF_ORDER',
        meta: { expectedStageId: nextExpected.id, requestedStageId: stageId },
      };
    }

    // 6. Determine task status after this check-in
    const isLastStage =
      orderedStages.length > 0 && orderedStages[orderedStages.length - 1].id === stageId;
    const taskStatus = isLastStage
      ? Entities.Config.ProgressStatus.COMPLETED
      : Entities.Config.ProgressStatus.IN_PROGRESS;

    // Next current stage pointer: the stage after this one (or null if last)
    const currentIndex = orderedStages.findIndex((s) => s.id === stageId);
    const nextStage = orderedStages[currentIndex + 1] ?? null;

    // 7. Topics linked to this stage (to mark as completed)
    const stageTopicIds = await this.links.listStageTopics(stageId);

    // 8. Atomic write
    const checkIn = await this.progress.atomicCheckIn({
      userId,
      taskId,
      stageId,
      stageTopicIds,
      taskStatus,
      currentStageId: nextStage?.id ?? null,
    });

    const taskProgress = await this.progress.findTaskProgress(userId, taskId);
    return {
      ok: true,
      data: { checkIn, taskProgress: taskProgress!, changed: true },
    };
  }

  // ---------------------------------------------------------------------------
  // Topic visit / complete
  // ---------------------------------------------------------------------------

  async visitTopic(
    userId: string,
    topicId: string,
  ): Promise<ControllerResult<TopicProgressResult>> {
    const topic = await this.topics.findById(topicId);
    if (!topic || topic.status !== Entities.Config.TopicNodeStatus.PUBLISHED || topic.archived) {
      return { ok: false, status: 404, error: 'NotFound' };
    }

    const effectiveIds = await this.enrollment.getEffectiveAccessTopicIds(userId);
    if (!effectiveIds.includes(topicId)) {
      return { ok: false, status: 403, error: 'NOT_ENROLLED' };
    }

    const existing = await this.progress.findTopicProgress(userId, topicId);

    // Monotonic: never demote from completed
    if (existing?.status === Entities.Config.ProgressStatus.COMPLETED) {
      return { ok: true, data: { topicProgress: existing, changed: false } };
    }

    const topicProgress = await this.progress.upsertTopicProgress(
      userId,
      topicId,
      Entities.Config.ProgressStatus.IN_PROGRESS,
    );
    const changed = existing?.status !== Entities.Config.ProgressStatus.IN_PROGRESS;
    return { ok: true, data: { topicProgress, changed } };
  }

  async completeTopic(
    userId: string,
    topicId: string,
  ): Promise<ControllerResult<TopicProgressResult>> {
    const topic = await this.topics.findById(topicId);
    if (!topic || topic.status !== Entities.Config.TopicNodeStatus.PUBLISHED || topic.archived) {
      return { ok: false, status: 404, error: 'NotFound' };
    }

    const effectiveIds = await this.enrollment.getEffectiveAccessTopicIds(userId);
    if (!effectiveIds.includes(topicId)) {
      return { ok: false, status: 403, error: 'NOT_ENROLLED' };
    }

    const existing = await this.progress.findTopicProgress(userId, topicId);
    const alreadyCompleted = existing?.status === Entities.Config.ProgressStatus.COMPLETED;

    const topicProgress = await this.progress.upsertTopicProgress(
      userId,
      topicId,
      Entities.Config.ProgressStatus.COMPLETED,
    );
    return { ok: true, data: { topicProgress, changed: !alreadyCompleted } };
  }

  // ---------------------------------------------------------------------------
  // Progress summary & lists (Task 06)
  // ---------------------------------------------------------------------------

  async getProgressSummary(userId: string): Promise<ControllerResult<ProgressSummary>> {
    const effectiveTopicIds = await this.enrollment.getEffectiveAccessTopicIds(userId);
    const effectiveSet = new Set(effectiveTopicIds);

    // Accessible published topics
    const allTopics = await this.topics.listAll();
    const accessibleTopics = allTopics.filter(
      (t) =>
        effectiveSet.has(t.id) &&
        t.status === Entities.Config.TopicNodeStatus.PUBLISHED &&
        !t.archived,
    );

    // Accessible published tasks (all linked topics must be in effective set)
    const allTasks = await this.tasks.list({ status: Entities.Config.TaskStatus.PUBLISHED });
    const taskTopicSets = await Promise.all(allTasks.map((t) => this.links.listTaskTopics(t.id)));
    const accessibleTasks = allTasks.filter((_t, i) =>
      taskTopicSets[i].every((tid) => effectiveSet.has(tid)),
    );

    const topicIds = accessibleTopics.map((t) => t.id);
    const taskIds = accessibleTasks.map((t) => t.id);

    const [
      completedTopics,
      inProgressTopics,
      completedTasks,
      inProgressTasks,
      lastActivityAt,
    ] = await Promise.all([
      this.progress.countCompletedTopics(userId, topicIds),
      this.progress.countInProgressTopics(userId, topicIds),
      this.progress.countCompletedTasks(userId, taskIds),
      this.progress.countInProgressTasks(userId, taskIds),
      this.progress.getLastActivityAt(userId),
    ]);

    const topicTotal = topicIds.length;
    const taskTotal = taskIds.length;

    return {
      ok: true,
      data: {
        topics: {
          total: topicTotal,
          completed: completedTopics,
          inProgress: inProgressTopics,
          percentage: topicTotal === 0 ? 0 : Math.round((completedTopics / topicTotal) * 100),
        },
        tasks: {
          total: taskTotal,
          completed: completedTasks,
          inProgress: inProgressTasks,
          percentage: taskTotal === 0 ? 0 : Math.round((completedTasks / taskTotal) * 100),
        },
        lastActivityAt,
      },
    };
  }

  async listAccessibleTopicProgress(
    userId: string,
  ): Promise<ControllerResult<TopicProgressRecord[]>> {
    const effectiveTopicIds = await this.enrollment.getEffectiveAccessTopicIds(userId);
    if (effectiveTopicIds.length === 0) return { ok: true, data: [] };

    const records = await this.progress.listTopicProgress(userId, effectiveTopicIds);
    return { ok: true, data: records };
  }

  async listAccessibleTaskProgress(
    userId: string,
  ): Promise<ControllerResult<TaskProgressRecord[]>> {
    const effectiveTopicIds = await this.enrollment.getEffectiveAccessTopicIds(userId);
    const effectiveSet = new Set(effectiveTopicIds);

    const allTasks = await this.tasks.list({ status: Entities.Config.TaskStatus.PUBLISHED });
    const taskTopicSets = await Promise.all(allTasks.map((t) => this.links.listTaskTopics(t.id)));
    const accessibleTaskIds = allTasks
      .filter((_t, i) => taskTopicSets[i].every((tid) => effectiveSet.has(tid)))
      .map((t) => t.id);

    if (accessibleTaskIds.length === 0) return { ok: true, data: [] };

    const records = await this.progress.listTaskProgress(userId, accessibleTaskIds);
    return { ok: true, data: records };
  }
}
