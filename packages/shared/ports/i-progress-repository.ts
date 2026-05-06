import type { Entities } from '../types/entities';

export interface TopicProgressRecord {
  id: string;
  userId: string;
  topicNodeId: string;
  status: Entities.Config.ProgressStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskProgressRecord {
  id: string;
  userId: string;
  taskId: string;
  status: Entities.Config.ProgressStatus;
  currentStageId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskStageProgressRecord {
  id: string;
  userId: string;
  taskId: string;
  stageId: string;
  checkedInAt: string;
}

export interface AtomicCheckInParams {
  userId: string;
  taskId: string;
  stageId: string;
  /** Topics linked to the checked-in stage that should be marked completed. */
  stageTopicIds: string[];
  taskStatus: Entities.Config.ProgressStatus;
  currentStageId: string | null;
}

export interface IProgressRepository {
  // Topic progress
  findTopicProgress(userId: string, topicNodeId: string): Promise<TopicProgressRecord | null>;
  listTopicProgress(userId: string, topicIds?: string[]): Promise<TopicProgressRecord[]>;
  upsertTopicProgress(
    userId: string,
    topicNodeId: string,
    status: Entities.Config.ProgressStatus,
  ): Promise<TopicProgressRecord>;

  // Task progress
  findTaskProgress(userId: string, taskId: string): Promise<TaskProgressRecord | null>;
  listTaskProgress(userId: string, taskIds?: string[]): Promise<TaskProgressRecord[]>;
  upsertTaskProgress(
    userId: string,
    taskId: string,
    data: {
      status: Entities.Config.ProgressStatus;
      currentStageId?: string | null;
      completedAt?: string | null;
    },
  ): Promise<TaskProgressRecord>;

  // Stage check-ins
  findStageCheckIn(userId: string, stageId: string): Promise<TaskStageProgressRecord | null>;
  listStageCheckIns(userId: string, taskId: string): Promise<TaskStageProgressRecord[]>;

  /**
   * Atomically:
   *  1. Inserts a stage check-in record.
   *  2. Upserts task_progress (status + currentStageId).
   *  3. Marks each topic in stageTopicIds as 'completed' in topic_progress.
   *
   * All writes are issued as a single D1 batch to prevent partial state.
   */
  atomicCheckIn(params: AtomicCheckInParams): Promise<TaskStageProgressRecord>;

  // Aggregates (scoped to a provided ID list)
  countCompletedTopics(userId: string, topicIds: string[]): Promise<number>;
  countInProgressTopics(userId: string, topicIds: string[]): Promise<number>;
  countCompletedTasks(userId: string, taskIds: string[]): Promise<number>;
  countInProgressTasks(userId: string, taskIds: string[]): Promise<number>;
  getLastActivityAt(userId: string): Promise<string | null>;
}
