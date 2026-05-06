import type {
  IProgressRepository,
  TopicProgressRecord,
  TaskProgressRecord,
  TaskStageProgressRecord,
  AtomicCheckInParams,
} from '@arenaquest/shared/ports';
import type { Entities } from '@arenaquest/shared/types/entities';

type TopicProgressRow = {
  id: string;
  user_id: string;
  topic_node_id: string;
  status: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type TaskProgressRow = {
  id: string;
  user_id: string;
  task_id: string;
  status: string;
  current_stage_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type StageProgressRow = {
  id: string;
  user_id: string;
  task_id: string;
  stage_id: string;
  checked_in_at: string;
};

function rowToTopicProgress(row: TopicProgressRow): TopicProgressRecord {
  return {
    id: row.id,
    userId: row.user_id,
    topicNodeId: row.topic_node_id,
    status: row.status as Entities.Config.ProgressStatus,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTaskProgress(row: TaskProgressRow): TaskProgressRecord {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    status: row.status as Entities.Config.ProgressStatus,
    currentStageId: row.current_stage_id,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToStageProgress(row: StageProgressRow): TaskStageProgressRecord {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    stageId: row.stage_id,
    checkedInAt: row.checked_in_at,
  };
}

export class D1ProgressRepository implements IProgressRepository {
  constructor(private readonly db: D1Database) {}

  // ---------------------------------------------------------------------------
  // Topic progress
  // ---------------------------------------------------------------------------

  async findTopicProgress(userId: string, topicNodeId: string): Promise<TopicProgressRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM topic_progress WHERE user_id = ? AND topic_node_id = ?')
      .bind(userId, topicNodeId)
      .first<TopicProgressRow>();
    return row ? rowToTopicProgress(row) : null;
  }

  async listTopicProgress(userId: string, topicIds?: string[]): Promise<TopicProgressRecord[]> {
    if (topicIds !== undefined && topicIds.length === 0) return [];

    if (!topicIds) {
      const { results } = await this.db
        .prepare('SELECT * FROM topic_progress WHERE user_id = ? ORDER BY updated_at DESC')
        .bind(userId)
        .all<TopicProgressRow>();
      return results.map(rowToTopicProgress);
    }

    // SQLite does not support array binding; chunk into IN clause
    const placeholders = topicIds.map(() => '?').join(', ');
    const { results } = await this.db
      .prepare(
        `SELECT * FROM topic_progress WHERE user_id = ? AND topic_node_id IN (${placeholders}) ORDER BY updated_at DESC`,
      )
      .bind(userId, ...topicIds)
      .all<TopicProgressRow>();
    return results.map(rowToTopicProgress);
  }

  async upsertTopicProgress(
    userId: string,
    topicNodeId: string,
    status: Entities.Config.ProgressStatus,
  ): Promise<TopicProgressRecord> {
    const id = crypto.randomUUID();
    const completedAt = status === 'completed' ? "datetime('now')" : 'NULL';

    await this.db
      .prepare(
        `INSERT INTO topic_progress (id, user_id, topic_node_id, status, completed_at)
         VALUES (?, ?, ?, ?, ${completedAt})
         ON CONFLICT(user_id, topic_node_id) DO UPDATE SET
           status = excluded.status,
           completed_at = CASE WHEN excluded.status = 'completed' THEN datetime('now') ELSE topic_progress.completed_at END,
           updated_at = datetime('now')`,
      )
      .bind(id, userId, topicNodeId, status)
      .run();

    const row = await this.findTopicProgress(userId, topicNodeId);
    if (!row) throw new Error(`D1ProgressRepository: topic progress not found after upsert`);
    return row;
  }

  // ---------------------------------------------------------------------------
  // Task progress
  // ---------------------------------------------------------------------------

  async findTaskProgress(userId: string, taskId: string): Promise<TaskProgressRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM task_progress WHERE user_id = ? AND task_id = ?')
      .bind(userId, taskId)
      .first<TaskProgressRow>();
    return row ? rowToTaskProgress(row) : null;
  }

  async listTaskProgress(userId: string, taskIds?: string[]): Promise<TaskProgressRecord[]> {
    if (taskIds !== undefined && taskIds.length === 0) return [];

    if (!taskIds) {
      const { results } = await this.db
        .prepare('SELECT * FROM task_progress WHERE user_id = ? ORDER BY updated_at DESC')
        .bind(userId)
        .all<TaskProgressRow>();
      return results.map(rowToTaskProgress);
    }

    const placeholders = taskIds.map(() => '?').join(', ');
    const { results } = await this.db
      .prepare(
        `SELECT * FROM task_progress WHERE user_id = ? AND task_id IN (${placeholders}) ORDER BY updated_at DESC`,
      )
      .bind(userId, ...taskIds)
      .all<TaskProgressRow>();
    return results.map(rowToTaskProgress);
  }

  async upsertTaskProgress(
    userId: string,
    taskId: string,
    data: {
      status: Entities.Config.ProgressStatus;
      currentStageId?: string | null;
      completedAt?: string | null;
    },
  ): Promise<TaskProgressRecord> {
    const id = crypto.randomUUID();
    const currentStageId = data.currentStageId !== undefined ? data.currentStageId : null;
    const completedAt = data.status === 'completed' ? "datetime('now')" : 'NULL';

    await this.db
      .prepare(
        `INSERT INTO task_progress (id, user_id, task_id, status, current_stage_id, completed_at)
         VALUES (?, ?, ?, ?, ?, ${completedAt})
         ON CONFLICT(user_id, task_id) DO UPDATE SET
           status = excluded.status,
           current_stage_id = excluded.current_stage_id,
           completed_at = CASE WHEN excluded.status = 'completed' THEN datetime('now') ELSE task_progress.completed_at END,
           updated_at = datetime('now')`,
      )
      .bind(id, userId, taskId, data.status, currentStageId)
      .run();

    const row = await this.findTaskProgress(userId, taskId);
    if (!row) throw new Error(`D1ProgressRepository: task progress not found after upsert`);
    return row;
  }

  // ---------------------------------------------------------------------------
  // Stage check-ins
  // ---------------------------------------------------------------------------

  async findStageCheckIn(userId: string, stageId: string): Promise<TaskStageProgressRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM task_stage_progress WHERE user_id = ? AND stage_id = ?')
      .bind(userId, stageId)
      .first<StageProgressRow>();
    return row ? rowToStageProgress(row) : null;
  }

  async listStageCheckIns(userId: string, taskId: string): Promise<TaskStageProgressRecord[]> {
    const { results } = await this.db
      .prepare(
        'SELECT * FROM task_stage_progress WHERE user_id = ? AND task_id = ? ORDER BY checked_in_at ASC',
      )
      .bind(userId, taskId)
      .all<StageProgressRow>();
    return results.map(rowToStageProgress);
  }

  async atomicCheckIn(params: AtomicCheckInParams): Promise<TaskStageProgressRecord> {
    const { userId, taskId, stageId, stageTopicIds, taskStatus, currentStageId } = params;
    const checkInId = crypto.randomUUID();
    const taskProgressId = crypto.randomUUID();

    const completedAtExpr =
      taskStatus === 'completed' ? "datetime('now')" : 'task_progress.completed_at';

    const stmts = [
      // 1. Stage check-in (append-only)
      this.db
        .prepare(
          'INSERT OR IGNORE INTO task_stage_progress (id, user_id, task_id, stage_id) VALUES (?, ?, ?, ?)',
        )
        .bind(checkInId, userId, taskId, stageId),

      // 2. Task progress upsert
      this.db
        .prepare(
          `INSERT INTO task_progress (id, user_id, task_id, status, current_stage_id, completed_at)
           VALUES (?, ?, ?, ?, ?, ${taskStatus === 'completed' ? "datetime('now')" : 'NULL'})
           ON CONFLICT(user_id, task_id) DO UPDATE SET
             status = excluded.status,
             current_stage_id = excluded.current_stage_id,
             completed_at = ${completedAtExpr},
             updated_at = datetime('now')`,
        )
        .bind(taskProgressId, userId, taskId, taskStatus, currentStageId),

      // 3. Mark each stage-linked topic as completed
      ...stageTopicIds.map((topicId) => {
        const tpId = crypto.randomUUID();
        return this.db
          .prepare(
            `INSERT INTO topic_progress (id, user_id, topic_node_id, status, completed_at)
             VALUES (?, ?, ?, 'completed', datetime('now'))
             ON CONFLICT(user_id, topic_node_id) DO UPDATE SET
               status = 'completed',
               completed_at = COALESCE(topic_progress.completed_at, datetime('now')),
               updated_at = datetime('now')`,
          )
          .bind(tpId, userId, topicId);
      }),
    ];

    await this.db.batch(stmts);

    const row = await this.findStageCheckIn(userId, stageId);
    if (!row) throw new Error(`D1ProgressRepository: stage check-in not found after atomic insert`);
    return row;
  }

  // ---------------------------------------------------------------------------
  // Aggregates
  // ---------------------------------------------------------------------------

  async countCompletedTopics(userId: string, topicIds: string[]): Promise<number> {
    if (topicIds.length === 0) return 0;
    const placeholders = topicIds.map(() => '?').join(', ');
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM topic_progress WHERE user_id = ? AND status = 'completed' AND topic_node_id IN (${placeholders})`,
      )
      .bind(userId, ...topicIds)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async countInProgressTopics(userId: string, topicIds: string[]): Promise<number> {
    if (topicIds.length === 0) return 0;
    const placeholders = topicIds.map(() => '?').join(', ');
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM topic_progress WHERE user_id = ? AND status = 'in_progress' AND topic_node_id IN (${placeholders})`,
      )
      .bind(userId, ...topicIds)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async countCompletedTasks(userId: string, taskIds: string[]): Promise<number> {
    if (taskIds.length === 0) return 0;
    const placeholders = taskIds.map(() => '?').join(', ');
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM task_progress WHERE user_id = ? AND status = 'completed' AND task_id IN (${placeholders})`,
      )
      .bind(userId, ...taskIds)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async countInProgressTasks(userId: string, taskIds: string[]): Promise<number> {
    if (taskIds.length === 0) return 0;
    const placeholders = taskIds.map(() => '?').join(', ');
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM task_progress WHERE user_id = ? AND status = 'in_progress' AND task_id IN (${placeholders})`,
      )
      .bind(userId, ...taskIds)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async getLastActivityAt(userId: string): Promise<string | null> {
    const row = await this.db
      .prepare(
        `SELECT MAX(ts) AS ts FROM (
           SELECT updated_at AS ts FROM topic_progress WHERE user_id = ?
           UNION ALL
           SELECT updated_at AS ts FROM task_progress WHERE user_id = ?
           UNION ALL
           SELECT checked_in_at AS ts FROM task_stage_progress WHERE user_id = ?
         )`,
      )
      .bind(userId, userId, userId)
      .first<{ ts: string | null }>();
    return row?.ts ?? null;
  }
}
