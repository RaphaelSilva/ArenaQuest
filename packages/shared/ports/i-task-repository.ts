import type { Entities } from '../types/entities';

export interface TaskRecord {
  id: string;
  title: string;
  description: string;
  status: Entities.Config.TaskStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: Entities.Config.TaskStatus;
  createdBy: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: Entities.Config.TaskStatus;
}

export interface ListTasksOptions {
  status?: Entities.Config.TaskStatus;
  limit?: number;
  offset?: number;
}

export interface ITaskRepository {
  findById(id: string): Promise<TaskRecord | null>;
  list(opts?: ListTasksOptions): Promise<TaskRecord[]>;
  create(data: CreateTaskInput): Promise<TaskRecord>;
  update(id: string, data: UpdateTaskInput): Promise<TaskRecord>;
  delete(id: string): Promise<void>;
}
