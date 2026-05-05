import type {
  ITaskRepository,
  TaskRecord,
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksOptions,
} from '@arenaquest/shared/ports';
import type { Entities } from '@arenaquest/shared/types/entities';

type TaskRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

function rowToRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as Entities.Config.TaskStatus,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class D1TaskRepository implements ITaskRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: string): Promise<TaskRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .bind(id)
      .first<TaskRow>();
    return row ? rowToRecord(row) : null;
  }

  async list(opts: ListTasksOptions = {}): Promise<TaskRecord[]> {
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;

    const { results } = opts.status !== undefined
      ? await this.db
          .prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
          .bind(opts.status, limit, offset)
          .all<TaskRow>()
      : await this.db
          .prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ? OFFSET ?')
          .bind(limit, offset)
          .all<TaskRow>();

    return results.map(rowToRecord);
  }

  async create(data: CreateTaskInput): Promise<TaskRecord> {
    const id = crypto.randomUUID();
    const status = data.status ?? 'draft';
    const description = data.description ?? '';

    await this.db
      .prepare(
        'INSERT INTO tasks (id, title, description, status, created_by) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(id, data.title, description, status, data.createdBy)
      .run();

    const row = await this.findById(id);
    if (!row) throw new Error(`D1TaskRepository: failed to fetch task after create (id=${id})`);
    return row;
  }

  async update(id: string, data: UpdateTaskInput): Promise<TaskRecord> {
    const setClauses: string[] = ["updated_at = datetime('now')"];
    const values: unknown[] = [];

    if (data.title !== undefined) { setClauses.push('title = ?'); values.push(data.title); }
    if (data.description !== undefined) { setClauses.push('description = ?'); values.push(data.description); }
    if (data.status !== undefined) { setClauses.push('status = ?'); values.push(data.status); }

    values.push(id);
    await this.db
      .prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    const row = await this.findById(id);
    if (!row) throw new Error(`D1TaskRepository: task not found (id=${id})`);
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  }
}
