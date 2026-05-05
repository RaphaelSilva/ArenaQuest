import type {
  ITaskStageRepository,
  TaskStageRecord,
  CreateTaskStageInput,
  UpdateTaskStageInput,
} from '@arenaquest/shared/ports';

type TaskStageRow = {
  id: string;
  task_id: string;
  label: string;
  sort_order: number;
  created_at: string;
};

function rowToRecord(row: TaskStageRow): TaskStageRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    label: row.label,
    order: row.sort_order,
    createdAt: row.created_at,
  };
}

export class D1TaskStageRepository implements ITaskStageRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: string): Promise<TaskStageRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM task_stages WHERE id = ?')
      .bind(id)
      .first<TaskStageRow>();
    return row ? rowToRecord(row) : null;
  }

  async listByTask(taskId: string): Promise<TaskStageRecord[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM task_stages WHERE task_id = ? ORDER BY sort_order ASC')
      .bind(taskId)
      .all<TaskStageRow>();
    return results.map(rowToRecord);
  }

  async create(data: CreateTaskStageInput): Promise<TaskStageRecord> {
    const id = crypto.randomUUID();

    let order: number;
    if (data.order !== undefined) {
      order = data.order;
    } else {
      const max = await this.db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS mx FROM task_stages WHERE task_id = ?')
        .bind(data.taskId)
        .first<{ mx: number }>();
      order = (max?.mx ?? -1) + 1;
    }

    await this.db
      .prepare('INSERT INTO task_stages (id, task_id, label, sort_order) VALUES (?, ?, ?, ?)')
      .bind(id, data.taskId, data.label, order)
      .run();

    const row = await this.findById(id);
    if (!row) throw new Error(`D1TaskStageRepository: failed to fetch stage after create (id=${id})`);
    return row;
  }

  async update(id: string, data: UpdateTaskStageInput): Promise<TaskStageRecord> {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (data.label !== undefined) { setClauses.push('label = ?'); values.push(data.label); }
    if (data.order !== undefined) { setClauses.push('sort_order = ?'); values.push(data.order); }

    if (setClauses.length === 0) {
      const existing = await this.findById(id);
      if (!existing) throw new Error(`D1TaskStageRepository: stage not found (id=${id})`);
      return existing;
    }

    values.push(id);
    await this.db
      .prepare(`UPDATE task_stages SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    const row = await this.findById(id);
    if (!row) throw new Error(`D1TaskStageRepository: stage not found (id=${id})`);
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM task_stages WHERE id = ?').bind(id).run();
  }

  async reorder(taskId: string, orderedIds: string[]): Promise<void> {
    if (orderedIds.length === 0) return;

    // Two-pass renumber to avoid colliding with the unique (task_id, sort_order) index.
    // Pass 1: shift to a high range guaranteed to not collide with the final values.
    const offset = 1_000_000;
    const shiftStmts = orderedIds.map((id, i) =>
      this.db
        .prepare('UPDATE task_stages SET sort_order = ? WHERE id = ? AND task_id = ?')
        .bind(offset + i, id, taskId),
    );
    const finalStmts = orderedIds.map((id, i) =>
      this.db
        .prepare('UPDATE task_stages SET sort_order = ? WHERE id = ? AND task_id = ?')
        .bind(i, id, taskId),
    );

    await this.db.batch([...shiftStmts, ...finalStmts]);
  }
}
