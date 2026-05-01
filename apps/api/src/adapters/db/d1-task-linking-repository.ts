import {
  type ITaskLinkingRepository,
  type TaskLinkHydration,
  StageTopicNotInTaskError,
} from '@arenaquest/shared/ports';

export class D1TaskLinkingRepository implements ITaskLinkingRepository {
  constructor(private readonly db: D1Database) {}

  async setTaskTopics(taskId: string, topicIds: string[]): Promise<void> {
    const unique = Array.from(new Set(topicIds));
    const stmts = [
      this.db.prepare('DELETE FROM task_topic_links WHERE task_id = ?').bind(taskId),
      ...unique.map(topicId =>
        this.db
          .prepare('INSERT OR IGNORE INTO task_topic_links (task_id, topic_node_id) VALUES (?, ?)')
          .bind(taskId, topicId),
      ),
    ];
    await this.db.batch(stmts);
  }

  async listTaskTopics(taskId: string): Promise<string[]> {
    const { results } = await this.db
      .prepare('SELECT topic_node_id FROM task_topic_links WHERE task_id = ? ORDER BY created_at ASC')
      .bind(taskId)
      .all<{ topic_node_id: string }>();
    return results.map(r => r.topic_node_id);
  }

  async setStageTopics(stageId: string, topicIds: string[]): Promise<void> {
    const unique = Array.from(new Set(topicIds));

    // Resolve the parent task to enforce the narrowing invariant.
    const parent = await this.db
      .prepare('SELECT task_id FROM task_stages WHERE id = ?')
      .bind(stageId)
      .first<{ task_id: string }>();
    if (!parent) throw new Error(`D1TaskLinkingRepository: stage not found (id=${stageId})`);

    if (unique.length > 0) {
      const taskTopicIds = new Set(await this.listTaskTopics(parent.task_id));
      const missing = unique.filter(id => !taskTopicIds.has(id));
      if (missing.length > 0) {
        throw new StageTopicNotInTaskError(stageId, missing);
      }
    }

    const stmts = [
      this.db.prepare('DELETE FROM task_stage_topic_links WHERE stage_id = ?').bind(stageId),
      ...unique.map(topicId =>
        this.db
          .prepare(
            'INSERT OR IGNORE INTO task_stage_topic_links (stage_id, topic_node_id) VALUES (?, ?)',
          )
          .bind(stageId, topicId),
      ),
    ];
    await this.db.batch(stmts);
  }

  async listStageTopics(stageId: string): Promise<string[]> {
    const { results } = await this.db
      .prepare(
        'SELECT topic_node_id FROM task_stage_topic_links WHERE stage_id = ? ORDER BY created_at ASC',
      )
      .bind(stageId)
      .all<{ topic_node_id: string }>();
    return results.map(r => r.topic_node_id);
  }

  async hydrate(taskId: string): Promise<TaskLinkHydration> {
    const [taskTopicIds, stageRows] = await Promise.all([
      this.listTaskTopics(taskId),
      this.db
        .prepare(
          `SELECT s.id AS stage_id, l.topic_node_id
           FROM task_stages s
           LEFT JOIN task_stage_topic_links l ON l.stage_id = s.id
           WHERE s.task_id = ?
           ORDER BY s.sort_order ASC, l.created_at ASC`,
        )
        .bind(taskId)
        .all<{ stage_id: string; topic_node_id: string | null }>(),
    ]);

    const stageMap = new Map<string, string[]>();
    for (const row of stageRows.results) {
      const list = stageMap.get(row.stage_id) ?? [];
      if (row.topic_node_id) list.push(row.topic_node_id);
      stageMap.set(row.stage_id, list);
    }

    return {
      taskTopicIds,
      stages: Array.from(stageMap.entries()).map(([stageId, topicIds]) => ({ stageId, topicIds })),
    };
  }
}
