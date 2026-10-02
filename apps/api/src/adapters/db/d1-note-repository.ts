import { D1Database } from '@cloudflare/workers-types';
import type {
  INoteRepository,
  NoteRecord,
  AuthoredNoteRecord,
  NoteCursorKey,
  CursorPage,
  Paged,
  SaveNoteParams,
  SaveNoteOutcome,
  ListNotesByTopicOptions,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

type NoteRow = {
  id: string;
  topic_node_id: string;
  author_id: string;
  author_name: string | null; // LEFT JOIN: null if the author row is missing
  body: string;
  visibility: string;
  revision: number;
  shared_at: string | null;
  moderated_at: string | null;
  moderated_by: string | null;
  created_at: string;
  updated_at: string;
};

/** A listed row also carries the value it was sorted on, so the cursor is exact. */
type SortedNoteRow = NoteRow & { sort_key: string };

type AuthoredNoteRow = SortedNoteRow & {
  topic_title: string;
  topic_status: string;
  topic_archived: number;
};

const SELECT_NOTE = `
  SELECT tn.*, u.name AS author_name
  FROM topic_notes tn
  LEFT JOIN users u ON u.id = tn.author_id`;

function rowToNote(row: NoteRow): NoteRecord {
  return {
    id: row.id,
    topicNodeId: row.topic_node_id,
    authorId: row.author_id,
    authorName: row.author_name ?? '',
    body: row.body,
    visibility: row.visibility as Entities.Config.NoteVisibility,
    revision: row.revision,
    sharedAt: row.shared_at,
    moderated: row.moderated_at !== null,
    moderatedAt: row.moderated_at,
    moderatedBy: row.moderated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAuthoredNote(row: AuthoredNoteRow): AuthoredNoteRecord {
  return {
    ...rowToNote(row),
    topicTitle: row.topic_title,
    topicStatus: row.topic_status as Entities.Config.TopicNodeStatus,
    topicArchived: row.topic_archived === 1,
  };
}

/**
 * Keyset predicate for a `(sortKey DESC, id DESC)` ordering: rows strictly after
 * the cursor. Spelled out rather than as a row-value comparison so it reads the
 * same on any SQL engine.
 */
function afterCursorSql(sortExpr: string): string {
  return `AND (${sortExpr} < ? OR (${sortExpr} = ? AND tn.id < ?))`;
}

function cursorBinds(cursor: NoteCursorKey): string[] {
  return [cursor.sortKey, cursor.sortKey, cursor.id];
}

/**
 * Turns a `limit + 1` fetch into one page: the extra row only signals that a
 * further page exists, and the cursor is the last row actually returned.
 */
function toPage<R extends SortedNoteRow, T>(
  rows: R[],
  limit: number,
  map: (row: R) => T,
): Paged<T> {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  return {
    data: pageRows.map(map),
    nextCursor: hasMore && last ? { sortKey: last.sort_key, id: last.id } : null,
  };
}

/**
 * D1 implementation of {@link INoteRepository} (RFC 0016 sections 1, 4 and 6).
 *
 * Every write that is conditional on `revision` is a single statement, so SQLite
 * applies the version test and the write atomically; `meta.changes` tells a
 * landed write (1) from a stale one (0). Rows are re-read only after the write
 * has been decided.
 */
export class D1NoteRepository implements INoteRepository {
  constructor(private readonly db: D1Database) {}

  async findMine(topicNodeId: string, authorId: string): Promise<NoteRecord | null> {
    const row = await this.db
      .prepare(`${SELECT_NOTE} WHERE tn.topic_node_id = ? AND tn.author_id = ?`)
      .bind(topicNodeId, authorId)
      .first<NoteRow>();
    return row ? rowToNote(row) : null;
  }

  async findById(id: string): Promise<NoteRecord | null> {
    const row = await this.db
      .prepare(`${SELECT_NOTE} WHERE tn.id = ?`)
      .bind(id)
      .first<NoteRow>();
    return row ? rowToNote(row) : null;
  }

  async saveMine(params: SaveNoteParams): Promise<SaveNoteOutcome> {
    const { topicNodeId, authorId, body, visibility, baseRevision } = params;

    const result =
      baseRevision === 0
        ? await this.db
            .prepare(
              `INSERT INTO topic_notes (id, topic_node_id, author_id, body, visibility, shared_at)
               VALUES (?1, ?2, ?3, ?4, ?5, CASE WHEN ?5 = 'shared' THEN datetime('now') ELSE NULL END)
               ON CONFLICT (topic_node_id, author_id) DO NOTHING`,
            )
            .bind(crypto.randomUUID(), topicNodeId, authorId, body, visibility)
            .run()
        : await this.db
            .prepare(
              `UPDATE topic_notes
                  SET body = ?1,
                      visibility = ?2,
                      revision = revision + 1,
                      updated_at = datetime('now'),
                      shared_at = CASE WHEN ?2 = 'shared' AND visibility = 'private'
                                       THEN datetime('now') ELSE shared_at END
                WHERE topic_node_id = ?3 AND author_id = ?4 AND revision = ?5`,
            )
            .bind(body, visibility, topicNodeId, authorId, baseRevision)
            .run();

    const current = await this.findMine(topicNodeId, authorId);
    if (result.meta.changes === 1 && current) {
      return { ok: true, note: current, created: baseRevision === 0 };
    }
    return { ok: false, stale: current };
  }

  async deleteMine(topicNodeId: string, authorId: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM topic_notes WHERE topic_node_id = ? AND author_id = ?')
      .bind(topicNodeId, authorId)
      .run();
    return result.meta.changes > 0;
  }

  /**
   * With `includePrivate` (staff) every note is listed, ordered by when it was
   * last shared, falling back to its last edit for a never-shared note. Without
   * it the statement carries a literal `visibility = 'shared'` filter, so no
   * cursor, whatever listing it came from, can surface a private row.
   */
  async listByTopic(
    topicNodeId: string,
    opts: ListNotesByTopicOptions,
  ): Promise<Paged<NoteRecord>> {
    const { includePrivate, page } = opts;
    const sortExpr = includePrivate ? 'COALESCE(tn.shared_at, tn.updated_at)' : 'tn.shared_at';
    const visibilityFilter = includePrivate ? '' : `AND tn.visibility = 'shared'`;
    const cursorFilter = page.cursor ? afterCursorSql(sortExpr) : '';

    const { results } = await this.db
      .prepare(
        `SELECT tn.*, u.name AS author_name, ${sortExpr} AS sort_key
         FROM topic_notes tn
         LEFT JOIN users u ON u.id = tn.author_id
         WHERE tn.topic_node_id = ?
           ${visibilityFilter}
           ${cursorFilter}
         ORDER BY ${sortExpr} DESC, tn.id DESC
         LIMIT ?`,
      )
      .bind(topicNodeId, ...(page.cursor ? cursorBinds(page.cursor) : []), page.limit + 1)
      .all<SortedNoteRow>();

    return toPage(results, page.limit, rowToNote);
  }

  /**
   * `topicArchived` is the topic row's own `archived` flag — the same check the
   * catalog gate applies to a single topic.
   */
  async listByAuthor(authorId: string, page: CursorPage): Promise<Paged<AuthoredNoteRecord>> {
    const sortExpr = 'tn.updated_at';
    const cursorFilter = page.cursor ? afterCursorSql(sortExpr) : '';

    const { results } = await this.db
      .prepare(
        `SELECT tn.*,
                u.name        AS author_name,
                ${sortExpr}   AS sort_key,
                t.title       AS topic_title,
                t.status      AS topic_status,
                t.archived    AS topic_archived
         FROM topic_notes tn
         JOIN topic_nodes t ON t.id = tn.topic_node_id
         LEFT JOIN users u ON u.id = tn.author_id
         WHERE tn.author_id = ?
           ${cursorFilter}
         ORDER BY ${sortExpr} DESC, tn.id DESC
         LIMIT ?`,
      )
      .bind(authorId, ...(page.cursor ? cursorBinds(page.cursor) : []), page.limit + 1)
      .all<AuthoredNoteRow>();

    return toPage(results, page.limit, rowToAuthoredNote);
  }

  /**
   * Setting moderation force-unshares: `visibility` becomes `private`, the flag
   * pair is stamped and `revision` is bumped so an open editor tab sees `409` on
   * its next autosave. Clearing touches only the flag pair — the note stays
   * private and its revision is kept. Neither path touches `body`.
   */
  async setModeration(id: string, adminId: string | null): Promise<NoteRecord | null> {
    const statement =
      adminId !== null
        ? this.db
            .prepare(
              `UPDATE topic_notes
                  SET visibility = 'private',
                      moderated_at = datetime('now'),
                      moderated_by = ?,
                      revision = revision + 1,
                      updated_at = datetime('now')
                WHERE id = ?`,
            )
            .bind(adminId, id)
        : this.db
            .prepare(
              `UPDATE topic_notes
                  SET moderated_at = NULL,
                      moderated_by = NULL
                WHERE id = ?`,
            )
            .bind(id);

    await statement.run();
    return this.findById(id);
  }
}
