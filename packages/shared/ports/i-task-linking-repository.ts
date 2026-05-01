/** Thrown when a stage link would reference a topic not present in the parent task's link set. */
export class StageTopicNotInTaskError extends Error {
  readonly code = 'STAGE_TOPIC_NOT_IN_TASK';
  constructor(public readonly stageId: string, public readonly missingTopicIds: string[]) {
    super(
      `Stage ${stageId} cannot link to topics not present in the parent task: ${missingTopicIds.join(', ')}`,
    );
    this.name = 'StageTopicNotInTaskError';
  }
}

export interface TaskLinkHydration {
  taskTopicIds: string[];
  stages: { stageId: string; topicIds: string[] }[];
}

export interface ITaskLinkingRepository {
  setTaskTopics(taskId: string, topicIds: string[]): Promise<void>;
  listTaskTopics(taskId: string): Promise<string[]>;
  /**
   * Replaces the topic link set for a stage. Throws StageTopicNotInTaskError if
   * any of the provided topicIds is not present in the parent task's link set.
   */
  setStageTopics(stageId: string, topicIds: string[]): Promise<void>;
  listStageTopics(stageId: string): Promise<string[]>;
  /** Returns task-level + every stage-level topic link set for a single task. */
  hydrate(taskId: string): Promise<TaskLinkHydration>;
}
