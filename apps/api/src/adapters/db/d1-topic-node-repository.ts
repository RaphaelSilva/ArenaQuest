import type {
  ITopicNodeRepository,
  TopicNodeRecord,
  CreateTopicNodeInput,
  UpdateTopicNodeInput,
} from '@arenaquest/shared/ports';
import type { Entities } from '@arenaquest/shared/types/entities';

type TopicNodeRow = {
  id: string;
  parent_id: string | null;
  title: string;
  content: string;
  status: string;
  sort_order: number;
  estimated_minutes: number;
  archived: number;
  created_at: string;
  updated_at: string;
};

type TagRow = {
  id: string;
  name: string;
  slug: string;
};

export class D1TopicNodeRepository implements ITopicNodeRepository {
  constructor(private readonly db: D1Database) {}

  private async fetchTags(nodeId: string): Promise<Entities.Content.Tag[]> {
    const { results } = await this.db
      .prepare(
        `SELECT t.id, t.name, t.slug
         FROM tags t
         INNER JOIN topic_node_tags tnt ON t.id = tnt.tag_id
         WHERE tnt.topic_node_id = ?`,
      )
      .bind(nodeId)
      .all<TagRow>();

    return results.map(r => ({ id: r.id, name: r.name, slug: r.slug }));
  }

  private async fetchPrerequisiteIds(nodeId: string): Promise<string[]> {
    const { results } = await this.db
      .prepare('SELECT prerequisite_id FROM topic_node_prerequisites WHERE topic_node_id = ?')
      .bind(nodeId)
      .all<{ prerequisite_id: string }>();

    return results.map(r => r.prerequisite_id);
  }

  private async rowToRecord(row: TopicNodeRow): Promise<TopicNodeRecord> {
    const [tags, prerequisiteIds] = await Promise.all([
      this.fetchTags(row.id),
      this.fetchPrerequisiteIds(row.id),
    ]);

    return {
      id: row.id,
      parentId: row.parent_id,
      title: row.title,
      content: row.content,
      status: row.status as Entities.Config.TopicNodeStatus,
      tags,
      order: row.sort_order,
      estimatedMinutes: row.estimated_minutes,
      prerequisiteIds,
      archived: row.archived === 1,
    };
  }

  private async replaceTagAssociations(nodeId: string, tagIds: string[]): Promise<void> {
    const stmts = [
      this.db.prepare('DELETE FROM topic_node_tags WHERE topic_node_id = ?').bind(nodeId),
      ...tagIds.map(tagId =>
        this.db
          .prepare('INSERT OR IGNORE INTO topic_node_tags (topic_node_id, tag_id) VALUES (?, ?)')
          .bind(nodeId, tagId),
      ),
    ];
    await this.db.batch(stmts);
  }

  private async replacePrerequisiteAssociations(nodeId: string, prerequisiteIds: string[]): Promise<void> {
    const stmts = [
      this.db.prepare('DELETE FROM topic_node_prerequisites WHERE topic_node_id = ?').bind(nodeId),
      ...prerequisiteIds.map(prereqId =>
        this.db
          .prepare('INSERT OR IGNORE INTO topic_node_prerequisites (topic_node_id, prerequisite_id) VALUES (?, ?)')
          .bind(nodeId, prereqId),
      ),
    ];
    await this.db.batch(stmts);
  }

  async findById(id: string): Promise<TopicNodeRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM topic_nodes WHERE id = ?')
      .bind(id)
      .first<TopicNodeRow>();

    if (!row) return null;
    return this.rowToRecord(row);
  }

  async listChildren(
    parentId: string | null,
    opts?: { limit?: number; offset?: number },
  ): Promise<TopicNodeRecord[]> {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;

    const { results } = parentId === null
      ? await this.db
          .prepare('SELECT * FROM topic_nodes WHERE parent_id IS NULL ORDER BY sort_order ASC LIMIT ? OFFSET ?')
          .bind(limit, offset)
          .all<TopicNodeRow>()
      : await this.db
          .prepare('SELECT * FROM topic_nodes WHERE parent_id = ? ORDER BY sort_order ASC LIMIT ? OFFSET ?')
          .bind(parentId, limit, offset)
          .all<TopicNodeRow>();

    return Promise.all(results.map(row => this.rowToRecord(row)));
  }

  async listAll(opts?: { limit?: number; offset?: number }): Promise<TopicNodeRecord[]> {
    const limit = opts?.limit ?? 1000;
    const offset = opts?.offset ?? 0;

    const { results: rows } = await this.db
      .prepare('SELECT * FROM topic_nodes ORDER BY parent_id ASC, sort_order ASC LIMIT ? OFFSET ?')
      .bind(limit, offset)
      .all<TopicNodeRow>();

    if (rows.length === 0) return [];

    // Fetch all tag and prerequisite associations in two bulk queries — avoids N+1.
    const [allTagRows, allPrereqRows] = await Promise.all([
      this.db
        .prepare(
          'SELECT tnt.topic_node_id, t.id, t.name, t.slug FROM topic_node_tags tnt JOIN tags t ON t.id = tnt.tag_id',
        )
        .all<{ topic_node_id: string; id: string; name: string; slug: string }>(),
      this.db
        .prepare('SELECT topic_node_id, prerequisite_id FROM topic_node_prerequisites')
        .all<{ topic_node_id: string; prerequisite_id: string }>(),
    ]);

    const tagsMap = new Map<string, Entities.Content.Tag[]>();
    for (const r of allTagRows.results) {
      const list = tagsMap.get(r.topic_node_id) ?? [];
      list.push({ id: r.id, name: r.name, slug: r.slug });
      tagsMap.set(r.topic_node_id, list);
    }

    const prereqsMap = new Map<string, string[]>();
    for (const r of allPrereqRows.results) {
      const list = prereqsMap.get(r.topic_node_id) ?? [];
      list.push(r.prerequisite_id);
      prereqsMap.set(r.topic_node_id, list);
    }

    return rows.map(row => ({
      id: row.id,
      parentId: row.parent_id,
      title: row.title,
      content: row.content,
      status: row.status as Entities.Config.TopicNodeStatus,
      tags: tagsMap.get(row.id) ?? [],
      order: row.sort_order,
      estimatedMinutes: row.estimated_minutes,
      prerequisiteIds: prereqsMap.get(row.id) ?? [],
      archived: row.archived === 1,
    }));
  }

  async create(data: CreateTopicNodeInput): Promise<TopicNodeRecord> {
    const id = crypto.randomUUID();
    const parentId = data.parentId ?? null;
    const status = data.status ?? 'draft';
    const content = data.content ?? '';
    const estimatedMinutes = data.estimatedMinutes ?? 0;

    let sortOrder: number;
    if (data.order !== undefined) {
      sortOrder = data.order;
    } else {
      const maxRow = parentId === null
        ? await this.db
            .prepare('SELECT COALESCE(MAX(sort_order), -1) AS mx FROM topic_nodes WHERE parent_id IS NULL')
            .first<{ mx: number }>()
        : await this.db
            .prepare('SELECT COALESCE(MAX(sort_order), -1) AS mx FROM topic_nodes WHERE parent_id = ?')
            .bind(parentId)
            .first<{ mx: number }>();
      sortOrder = (maxRow?.mx ?? -1) + 1;
    }

    const stmts = [
      this.db
        .prepare(
          'INSERT INTO topic_nodes (id, parent_id, title, content, status, sort_order, estimated_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(id, parentId, data.title, content, status, sortOrder, estimatedMinutes),
      ...(data.tagIds ?? []).map(tagId =>
        this.db
          .prepare('INSERT OR IGNORE INTO topic_node_tags (topic_node_id, tag_id) VALUES (?, ?)')
          .bind(id, tagId),
      ),
      ...(data.prerequisiteIds ?? []).map(prereqId =>
        this.db
          .prepare('INSERT OR IGNORE INTO topic_node_prerequisites (topic_node_id, prerequisite_id) VALUES (?, ?)')
          .bind(id, prereqId),
      ),
    ];

    await this.db.batch(stmts);

    const node = await this.findById(id);
    if (!node) throw new Error(`D1TopicNodeRepository: failed to fetch node after create (id=${id})`);
    return node;
  }

  async update(id: string, data: UpdateTopicNodeInput): Promise<TopicNodeRecord> {
    const setClauses = ["updated_at = datetime('now')"];
    const values: unknown[] = [];

    if (data.title !== undefined) { setClauses.push('title = ?'); values.push(data.title); }
    if (data.content !== undefined) { setClauses.push('content = ?'); values.push(data.content); }
    if (data.status !== undefined) { 
      setClauses.push('status = ?'); 
      values.push(data.status); 
      if (data.status === 'archived') {
        setClauses.push('archived = 1');
      }
    }
    if (data.estimatedMinutes !== undefined) { setClauses.push('estimated_minutes = ?'); values.push(data.estimatedMinutes); }

    values.push(id);
    await this.db
      .prepare(`UPDATE topic_nodes SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    if (data.tagIds !== undefined) {
      await this.replaceTagAssociations(id, data.tagIds);
    }

    if (data.prerequisiteIds !== undefined) {
      await this.replacePrerequisiteAssociations(id, data.prerequisiteIds);
    }

    const node = await this.findById(id);
    if (!node) throw new Error(`D1TopicNodeRepository: node not found (id=${id})`);
    return node;
  }

  async move(id: string, newParentId: string | null, newSortOrder?: number): Promise<TopicNodeRecord> {
    if (newParentId !== null) {
      const cycle = await this.wouldCreateCycle(id, newParentId);
      if (cycle) throw new Error('D1TopicNodeRepository: move would create a cycle in the topic tree');
    }

    // Determine the old parent so we can renumber that group after the node leaves
    const currentRow = await this.db
      .prepare('SELECT parent_id FROM topic_nodes WHERE id = ?')
      .bind(id)
      .first<{ parent_id: string | null }>();
    const oldParentId = currentRow?.parent_id ?? null;
    const sameParent = oldParentId === newParentId;

    // Get current siblings in the destination group (excluding the moving node)
    const { results: destSiblings } = newParentId === null
      ? await this.db
          .prepare('SELECT id FROM topic_nodes WHERE parent_id IS NULL AND id != ? ORDER BY sort_order ASC, id ASC')
          .bind(id)
          .all<{ id: string }>()
      : await this.db
          .prepare('SELECT id FROM topic_nodes WHERE parent_id = ? AND id != ? ORDER BY sort_order ASC, id ASC')
          .bind(newParentId, id)
          .all<{ id: string }>();

    // Build the final gapless order for the destination group
    const finalDestOrder = destSiblings.map(s => s.id);
    const insertAt = newSortOrder !== undefined
      ? Math.min(newSortOrder, finalDestOrder.length)
      : finalDestOrder.length;
    finalDestOrder.splice(insertAt, 0, id);

    // Get siblings in the old parent group for renumbering (only needed when changing parents)
    let oldSiblingIds: string[] = [];
    if (!sameParent) {
      const { results: oldSiblings } = oldParentId === null
        ? await this.db
            .prepare('SELECT id FROM topic_nodes WHERE parent_id IS NULL AND id != ? ORDER BY sort_order ASC, id ASC')
            .bind(id)
            .all<{ id: string }>()
        : await this.db
            .prepare('SELECT id FROM topic_nodes WHERE parent_id = ? AND id != ? ORDER BY sort_order ASC, id ASC')
            .bind(oldParentId, id)
            .all<{ id: string }>();
      oldSiblingIds = oldSiblings.map(s => s.id);
    }

    // Batch: update parent + renumber destination + renumber old source (all atomic)
    const parentUpdate = this.db
      .prepare("UPDATE topic_nodes SET parent_id = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(newParentId, id);

    const renumberDestStmts = finalDestOrder.map((nodeId, i) =>
      this.db.prepare('UPDATE topic_nodes SET sort_order = ? WHERE id = ?').bind(i, nodeId),
    );

    const renumberOldStmts = oldSiblingIds.map((nodeId, i) =>
      this.db.prepare('UPDATE topic_nodes SET sort_order = ? WHERE id = ?').bind(i, nodeId),
    );

    await this.db.batch([parentUpdate, ...renumberDestStmts, ...renumberOldStmts]);

    const node = await this.findById(id);
    if (!node) throw new Error(`D1TopicNodeRepository: node not found after move (id=${id})`);
    return node;
  }

  async archive(id: string): Promise<void> {
    // Recursive CTE cascades archived status to all descendants
    await this.db
      .prepare(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM topic_nodes WHERE id = ?
           UNION ALL
           SELECT tn.id FROM topic_nodes tn JOIN descendants d ON tn.parent_id = d.id
         )
         UPDATE topic_nodes SET archived = 1, status = 'archived', updated_at = datetime('now')
         WHERE id IN (SELECT id FROM descendants)`,
      )
      .bind(id)
      .run();
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM topic_nodes WHERE id = ?').bind(id).run();
  }

  async wouldCreateCycle(nodeId: string, proposedParentId: string): Promise<boolean> {
    let currentId: string | null = proposedParentId;
    while (currentId !== null) {
      if (currentId === nodeId) return true;
      const row: { parent_id: string | null } | null = await this.db
        .prepare('SELECT parent_id FROM topic_nodes WHERE id = ?')
        .bind(currentId)
        .first<{ parent_id: string | null }>();
      if (!row) return false;
      currentId = row.parent_id;
    }
    return false;
  }
}
