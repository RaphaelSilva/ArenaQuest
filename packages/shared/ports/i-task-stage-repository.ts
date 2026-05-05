export interface TaskStageRecord {
  id: string;
  taskId: string;
  label: string;
  order: number;
  createdAt: string;
}

export interface CreateTaskStageInput {
  taskId: string;
  label: string;
  order?: number;
}

export interface UpdateTaskStageInput {
  label?: string;
  order?: number;
}

export interface ITaskStageRepository {
  findById(id: string): Promise<TaskStageRecord | null>;
  listByTask(taskId: string): Promise<TaskStageRecord[]>;
  create(data: CreateTaskStageInput): Promise<TaskStageRecord>;
  update(id: string, data: UpdateTaskStageInput): Promise<TaskStageRecord>;
  delete(id: string): Promise<void>;
  /** Atomically rewrites stage order for the given task using the provided id sequence. */
  reorder(taskId: string, orderedIds: string[]): Promise<void>;
}
