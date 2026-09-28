import type { Entities } from '../types/entities';

/**
 * Student notes persistence contract (RFC 0016 section 6).
 *
 * This file **describes**; it names no store, no SQL and no provider type. The
 * implementation lives in `apps/api/src/adapters/db/`.
 *
 * Rules the implementation owes this contract:
 *
 * - **Staleness is an outcome, never an exception.** {@link INoteRepository.saveMine}
 *   is a conditional write keyed on `revision`; a write that does not land returns
 *   `{ ok: false, stale }` rather than throwing.
 * - **Access is decided by the caller.** `includePrivate` is set by the controller
 *   from the caller's roles, never taken from the request.
 * - **Cursors are decoded keys here.** The opaque wire encoding belongs to the HTTP
 *   layer; the port only sees `{ sortKey, id }`.
 */

/** The persisted shape of a note, as the repository reads it back. */
export interface NoteRecord {
  id: string;
  topicNodeId: string;
  authorId: string;
  /** Display name of the author, joined from the user record. */
  authorName: string;
  body: string;
  visibility: Entities.Config.NoteVisibility;
  /** Concurrency token; +1 on every write, by anyone. */
  revision: number;
  sharedAt: string | null;
  /** Derived from `moderatedAt !== null`. */
  moderated: boolean;
  /** When a staff member force-unshared the note; `null` when not moderated. */
  moderatedAt: string | null;
  /** The staff member who force-unshared the note; `null` when not moderated. */
  moderatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A note listed by its author — "My notes" or the staff per-student list — carrying
 * enough of its topic for the controller to compute `topicAccessible`.
 */
export interface AuthoredNoteRecord extends NoteRecord {
  topicTitle: string;
  /** The topic's publication status (`draft` · `published` · `archived`). */
  topicStatus: Entities.Config.TopicNodeStatus;
  /** `true` when the topic is archived — the topic row's own archived flag, as the catalog gate checks. */
  topicArchived: boolean;
}

/** A decoded pagination key: the sort column's value and the row id as tie-breaker. */
export interface NoteCursorKey {
  sortKey: string;
  id: string;
}

/** One page request. `cursor: null` asks for the first page. */
export interface CursorPage {
  cursor: NoteCursorKey | null;
  limit: number;
}

/** One page of results. `nextCursor: null` means there is no further page. */
export interface Paged<T> {
  data: T[];
  nextCursor: NoteCursorKey | null;
}

/** Input of the conditional save of RFC 0016 section 4. */
export interface SaveNoteParams {
  topicNodeId: string;
  authorId: string;
  /** Already sanitised and length-checked by the caller. */
  body: string;
  visibility: Entities.Config.NoteVisibility;
  /**
   * The `revision` the client last received; `0` when it believes no note exists
   * yet (a create).
   */
  baseRevision: number;
}

/**
 * Result of {@link INoteRepository.saveMine}.
 *
 * - `ok: true` — the write landed; `created` tells a create from an update.
 * - `ok: false` — nothing was written because the stored note was not at
 *   `baseRevision`; `stale` is the current note, or `null` when none exists.
 */
export type SaveNoteOutcome =
  | { ok: true; note: NoteRecord; created: boolean }
  | { ok: false; stale: NoteRecord | null };

/** Options of {@link INoteRepository.listByTopic}. */
export interface ListNotesByTopicOptions {
  /** Staff only — decided by the controller from roles, never from the request. */
  includePrivate: boolean;
  viewerId: string;
  page: CursorPage;
}

export interface INoteRepository {
  /** The author's note on a topic, or `null`. */
  findMine(topicNodeId: string, authorId: string): Promise<NoteRecord | null>;

  findById(id: string): Promise<NoteRecord | null>;

  /**
   * Conditional create-or-update of the author's note on a topic.
   *
   * The revision check and the write are one atomic operation: the note is
   * written only if the stored row is at `baseRevision` (or, for
   * `baseRevision = 0`, only if no row exists), and `revision` is incremented.
   * A write that does not land is reported as `{ ok: false, stale }` carrying
   * the current note (or `null`) — staleness is **never** signalled by throwing.
   */
  saveMine(params: SaveNoteParams): Promise<SaveNoteOutcome>;

  /** Hard-deletes the author's note on a topic; `false` when there was none. */
  deleteMine(topicNodeId: string, authorId: string): Promise<boolean>;

  /**
   * A topic's notes, newest first. Shared notes only unless `includePrivate`,
   * which the controller sets from the caller's roles.
   */
  listByTopic(topicNodeId: string, opts: ListNotesByTopicOptions): Promise<Paged<NoteRecord>>;

  /**
   * Every note by one author, private included, newest `updatedAt` first. Serves
   * both "My notes" (the author) and the staff per-student list.
   */
  listByAuthor(authorId: string, page: CursorPage): Promise<Paged<AuthoredNoteRecord>>;

  /**
   * Sets moderation (`adminId` given: force-unshare, marks moderated) or clears it
   * (`adminId: null`). Setting forces `private` and increments `revision`, so an open
   * editor notices on its next save; clearing touches only the moderation flag. The
   * body is never touched. Returns the updated note, or `null` when it does not exist.
   */
  setModeration(id: string, adminId: string | null): Promise<NoteRecord | null>;
}
