/**
 * D1SubmissionRepository — `topic_submissions` over D1 (RFC 0020 sections 1, 5, 6, 7, 11).
 *
 * The two concurrency-sensitive writes are single conditional statements read
 * through `meta.changes`, never read-then-write:
 *  - `createPending` — the per-topic count and per-student bytes are checked in
 *    the same `INSERT … SELECT … WHERE` that inserts the row;
 *  - `move` — one guarded `UPDATE` per id, sent in request order as one
 *    `db.batch` (sequential, one transaction), so each guard sees the counts the
 *    previous one left.
 * Pending rows count against both quotas; removed rows (tombstones) never do.
 *
 * Listings use keyset pagination on (`sort_key` DESC, `id` DESC). Each scope's
 * WHERE is fixed here; the cursor only moves the position within it.
 *
 * No business rules: access checks, moderation blocks and the sharing switch's
 * meaning belong to the controller. `sharingEnabled` is honoured by `class`
 * only because the port says a disabled label lists nothing there.
 */
import type {
  AuthoredSubmissionRecord,
  CreatePendingSubmission,
  CursorPage,
  NoteCursorKey,
  ISubmissionRepository,
  ListSubmissionsByAuthorOptions,
  ListSubmissionsByTopicOptions,
  MoveRefusal,
  MoveResult,
  Paged,
  SubmissionMetaPatch,
  SubmissionQuota,
  SubmissionRecord,
  SubmissionUsage,
  TopicSubmissionSummary,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

type SubmissionRow = {
  id: string;
  topic_node_id: string;
  author_id: string;
  author_name: string | null;
  title: string;
  description: string;
  storage_key: string | null;
  original_name: string;
  content_type: string;
  size_bytes: number;
  status: string;
  visibility: string;
  shared_at: string | null;
  moderated_at: string | null;
  moderated_by: string | null;
  removed_at: string | null;
  removed_by: string | null;
  removed_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type ListedRow = SubmissionRow & { sort_key: string };
type AuthoredRow = ListedRow & { topic_title: string | null };

const MAX_PAGE = 100;

const JOINS = `
    FROM topic_submissions s
    LEFT JOIN users u ON u.id = s.author_id
    LEFT JOIN users r ON r.id = s.removed_by`;

const PROJECTION = `SELECT s.*, u.name AS author_name, r.name AS removed_by_name ${JOINS}`;

/** `listByAuthor` adds the topic title. */
const TOPIC_TITLE = {
  select: ', t.title AS topic_title',
  join: ' LEFT JOIN topic_nodes t ON t.id = s.topic_node_id',
};

function rowToRecord(row: SubmissionRow): SubmissionRecord {
  return {
    id: row.id,
    topicNodeId: row.topic_node_id,
    authorId: row.author_id,
    authorName: row.author_name ?? '',
    title: row.title,
    description: row.description,
    storageKey: row.storage_key,
    originalName: row.original_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    status: row.status as Entities.Config.SubmissionStatus,
    visibility: row.visibility as Entities.Config.ShareVisibility,
    sharedAt: row.shared_at,
    moderatedAt: row.moderated_at,
    moderatedBy: row.moderated_by,
    removedAt: row.removed_at,
    removedBy: row.removed_by,
    removedByName: row.removed_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 1;
  return Math.min(MAX_PAGE, Math.max(1, Math.floor(limit)));
}

export class D1SubmissionRepository implements ISubmissionRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: string): Promise<SubmissionRecord | null> {
    const row = await this.db
      .prepare(`${PROJECTION} WHERE s.id = ?`)
      .bind(id)
      .first<SubmissionRow>();
    return row ? rowToRecord(row) : null;
  }

  async createPending(
    p: CreatePendingSubmission,
    q: SubmissionQuota,
  ): Promise<SubmissionRecord | null> {
    const result = await this.db
      .prepare(
        `INSERT INTO topic_submissions
           (id, topic_node_id, author_id, title, description, storage_key,
            original_name, content_type, size_bytes, visibility, shared_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                CASE WHEN ?10 = 'shared' THEN datetime('now') ELSE NULL END
          WHERE (SELECT COUNT(*) FROM topic_submissions
                  WHERE author_id = ?3 AND topic_node_id = ?2 AND status <> 'removed') < ?11
            AND (SELECT COALESCE(SUM(size_bytes), 0) FROM topic_submissions
                  WHERE author_id = ?3 AND status <> 'removed') + ?9 <= ?12`,
      )
      .bind(
        p.id,
        p.topicNodeId,
        p.authorId,
        p.title,
        p.description,
        p.storageKey,
        p.originalName,
        p.contentType,
        p.sizeBytes,
        p.visibility,
        q.perTopicMax,
        q.storagePerStudentBytes,
      )
      .run();

    if (result.meta.changes === 0) return null;
    return this.mustFind(p.id, 'createPending');
  }

  async usage(authorId: string, topicNodeId?: string): Promise<SubmissionUsage> {
    const row = await this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN topic_node_id = ?2 THEN 1 ELSE 0 END), 0) AS topic_count,
                COALESCE(SUM(size_bytes), 0) AS bytes
           FROM topic_submissions
          WHERE author_id = ?1 AND status <> 'removed'`,
      )
      .bind(authorId, topicNodeId ?? null)
      .first<{ topic_count: number; bytes: number }>();
    return { topicCount: row?.topic_count ?? 0, bytes: row?.bytes ?? 0 };
  }

  async markReady(id: string): Promise<SubmissionRecord> {
    await this.db
      .prepare(
        `UPDATE topic_submissions SET status = 'ready', updated_at = datetime('now')
          WHERE id = ? AND status = 'pending'`,
      )
      .bind(id)
      .run();
    return this.mustFind(id, 'markReady');
  }

  async updateMeta(id: string, patch: SubmissionMetaPatch): Promise<SubmissionRecord> {
    const sets = ["updated_at = datetime('now')"];
    const values: unknown[] = [];

    if (patch.title !== undefined) {
      sets.push('title = ?');
      values.push(patch.title);
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      values.push(patch.description);
    }
    if (patch.visibility !== undefined) {
      if (patch.visibility === Entities.Config.ShareVisibility.SHARED) {
        // Re-sharing an already shared row keeps its original timestamp (and its place in `class`).
        sets.push("shared_at = CASE WHEN visibility = 'shared' THEN shared_at ELSE datetime('now') END");
      } else {
        sets.push('shared_at = NULL');
      }
      sets.push('visibility = ?');
      values.push(patch.visibility);
    }

    values.push(id);
    await this.db
      .prepare(`UPDATE topic_submissions SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
    return this.mustFind(id, 'updateMeta');
  }

  async move(
    authorId: string,
    ids: string[],
    targetTopicId: string,
    perTopicMax: number,
  ): Promise<MoveResult> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return { moved: [], refused: [] };

    const guarded = this.db.prepare(
      `UPDATE topic_submissions
          SET topic_node_id = ?1, visibility = 'private', shared_at = NULL,
              updated_at = datetime('now')
        WHERE id = ?2 AND author_id = ?3 AND status = 'ready' AND topic_node_id <> ?1
          AND (SELECT COUNT(*) FROM topic_submissions
                WHERE author_id = ?3 AND topic_node_id = ?1 AND status <> 'removed') < ?4`,
    );
    const results = await this.db.batch(
      unique.map(id => guarded.bind(targetTopicId, id, authorId, perTopicMax)),
    );

    const movedIds: string[] = [];
    const refusedIds: string[] = [];
    unique.forEach((id, i) => {
      if ((results[i]?.meta.changes ?? 0) > 0) movedIds.push(id);
      else refusedIds.push(id);
    });

    // The decision was made by the guarded statements above; this read only
    // names the reason, from rows the batch left unchanged.
    const refused: MoveRefusal[] = [];
    if (refusedIds.length > 0) {
      const { results: rows } = await this.db
        .prepare(
          `SELECT id, author_id, status, topic_node_id FROM topic_submissions
            WHERE id IN (${refusedIds.map(() => '?').join(', ')})`,
        )
        .bind(...refusedIds)
        .all<{ id: string; author_id: string; status: string; topic_node_id: string }>();
      const byId = new Map(rows.map(r => [r.id, r]));
      for (const id of refusedIds) {
        const row = byId.get(id);
        if (!row || row.author_id !== authorId) refused.push({ id, reason: 'not_found' });
        else if (row.status !== Entities.Config.SubmissionStatus.READY) refused.push({ id, reason: 'not_ready' });
        else if (row.topic_node_id === targetTopicId) refused.push({ id, reason: 'same_topic' });
        else refused.push({ id, reason: 'quota' });
      }
    }

    let moved: SubmissionRecord[] = [];
    if (movedIds.length > 0) {
      const { results: rows } = await this.db
        .prepare(`${PROJECTION} WHERE s.id IN (${movedIds.map(() => '?').join(', ')})`)
        .bind(...movedIds)
        .all<SubmissionRow>();
      const byId = new Map(rows.map(r => [r.id, rowToRecord(r)]));
      moved = movedIds.flatMap(id => byId.get(id) ?? []);
    }

    return { moved, refused };
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM topic_submissions WHERE id = ?').bind(id).run();
  }

  async markRemoved(id: string, adminId: string): Promise<SubmissionRecord> {
    await this.db
      .prepare(
        `UPDATE topic_submissions
            SET status = 'removed', removed_at = datetime('now'), removed_by = ?,
                storage_key = NULL, description = '', visibility = 'private',
                shared_at = NULL, updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(adminId, id)
      .run();
    return this.mustFind(id, 'markRemoved');
  }

  async listByTopic(
    topicNodeId: string,
    opts: ListSubmissionsByTopicOptions,
  ): Promise<Paged<SubmissionRecord>> {
    let where: string;
    let sortKey = 's.created_at';
    const values: unknown[] = [topicNodeId];

    switch (opts.scope) {
      case 'mine':
        where = 's.topic_node_id = ? AND s.author_id = ?';
        values.push(opts.viewerId);
        break;
      case 'class':
        if (!opts.sharingEnabled) return { data: [], nextCursor: null };
        where = "s.topic_node_id = ? AND s.status = 'ready' AND s.visibility = 'shared'";
        sortKey = 'COALESCE(s.shared_at, s.created_at)';
        break;
      case 'all':
        where = "s.topic_node_id = ? AND s.status IN ('ready', 'removed')";
        break;
      default:
        // Unknown scope: return nothing rather than widen.
        return { data: [], nextCursor: null };
    }

    const page = await this.listPage<ListedRow>(sortKey, where, values, opts.page);
    return { data: page.rows.map(rowToRecord), nextCursor: page.nextCursor };
  }

  async topicSummary(topicNodeId: string, viewerId: string): Promise<TopicSubmissionSummary> {
    const row = await this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN author_id = ?2 AND status <> 'removed' THEN 1 ELSE 0 END), 0) AS mine,
           COALESCE(SUM(CASE WHEN status = 'ready' AND visibility = 'shared' THEN 1 ELSE 0 END), 0) AS class_count,
           COALESCE(SUM(CASE WHEN status IN ('ready', 'removed') THEN 1 ELSE 0 END), 0) AS total
           FROM topic_submissions
          WHERE topic_node_id = ?1`,
      )
      .bind(topicNodeId, viewerId)
      .first<{ mine: number; class_count: number; total: number }>();
    return { mine: row?.mine ?? 0, class: row?.class_count ?? 0, total: row?.total ?? 0 };
  }

  async listByAuthor(
    authorId: string,
    opts: ListSubmissionsByAuthorOptions,
  ): Promise<Paged<AuthoredSubmissionRecord>> {
    let where: string;
    switch (opts.scope) {
      case 'self':
        where = 's.author_id = ?';
        break;
      case 'staff':
        where = "s.author_id = ? AND s.status IN ('ready', 'removed')";
        break;
      default:
        return { data: [], nextCursor: null };
    }

    const page = await this.listPage<AuthoredRow>('s.created_at', where, [authorId], opts.page, TOPIC_TITLE);
    return {
      data: page.rows.map(r => ({ ...rowToRecord(r), topicTitle: r.topic_title ?? '' })),
      nextCursor: page.nextCursor,
    };
  }

  async setModeration(id: string, staffId: string | null): Promise<SubmissionRecord | null> {
    const stmt =
      staffId === null
        ? this.db
            .prepare(
              `UPDATE topic_submissions
                  SET moderated_at = NULL, moderated_by = NULL, updated_at = datetime('now')
                WHERE id = ?`,
            )
            .bind(id)
        : this.db
            .prepare(
              `UPDATE topic_submissions
                  SET moderated_at = datetime('now'), moderated_by = ?,
                      visibility = 'private', shared_at = NULL, updated_at = datetime('now')
                WHERE id = ?`,
            )
            .bind(staffId, id);
    await stmt.run();
    return this.findById(id);
  }

  async listStalePending(olderThanHours: number, limit: number): Promise<SubmissionRecord[]> {
    const { results } = await this.db
      .prepare(
        `${PROJECTION}
          WHERE s.status = 'pending' AND s.created_at < datetime('now', ?)
          ORDER BY s.created_at ASC, s.id ASC
          LIMIT ?`,
      )
      .bind(`-${Math.max(0, olderThanHours)} hours`, clampLimit(limit))
      .all<SubmissionRow>();
    return results.map(rowToRecord);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * One keyset page: rows of `where`, newest `sortKeyExpr` first, ties broken by
   * id, strictly after `page.cursor`. Fetches one extra row to know whether a
   * next page exists.
   */
  private async listPage<R extends ListedRow>(
    sortKeyExpr: string,
    where: string,
    values: unknown[],
    page: CursorPage,
    extra: { select: string; join: string } = { select: '', join: '' },
  ): Promise<{ rows: R[]; nextCursor: NoteCursorKey | null }> {
    const limit = clampLimit(page.limit);
    const binds = [...values];
    let keyset = '';
    if (page.cursor) {
      keyset = ` AND (${sortKeyExpr} < ? OR (${sortKeyExpr} = ? AND s.id < ?))`;
      binds.push(page.cursor.sortKey, page.cursor.sortKey, page.cursor.id);
    }
    binds.push(limit + 1);

    const { results } = await this.db
      .prepare(
        `SELECT s.*, ${sortKeyExpr} AS sort_key,
                u.name AS author_name, r.name AS removed_by_name${extra.select}
           ${JOINS}${extra.join}
          WHERE ${where}${keyset}
          ORDER BY sort_key DESC, s.id DESC
          LIMIT ?`,
      )
      .bind(...binds)
      .all<R>();

    const rows = results.slice(0, limit);
    const last = rows[rows.length - 1];
    const next = results.length > limit && last ? { sortKey: last.sort_key, id: last.id } : null;
    return { rows, nextCursor: next };
  }

  private async mustFind(id: string, op: string): Promise<SubmissionRecord> {
    const record = await this.findById(id);
    if (!record) throw new Error(`D1SubmissionRepository: row not found after ${op} (id=${id})`);
    return record;
  }
}
