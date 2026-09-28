import type {
  INoteRepository,
  ITopicNodeRepository,
  IEnrollmentRepository,
  NoteRecord,
  AuthoredNoteRecord,
  NoteCursorKey,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { NOTE_BODY_MAX } from '@arenaquest/shared/domain/notes/limits';
import { sanitizeMarkdown } from '@arenaquest/shared/utils/sanitize-markdown';
import type { ControllerResult } from '@api/core/result';

/** Page size of every note listing (RFC 0016 §5). */
export const NOTES_PAGE_SIZE = 20;

/**
 * The authenticated caller, as the route hands it over. Roles are resolved into
 * an audience **here**, never taken from the request.
 */
export interface NoteCaller {
  userId: string;
  roles: readonly string[];
}

/** A note as a student-facing payload: moderation provenance stays server-side. */
export type Note = Entities.Engagement.Note;

/** A note in a topic's class listing. */
export type ClassNote = Note & { isMine: boolean };

/** A note in the author's "My notes" listing. */
export type AuthoredNote = Note & { topicTitle: string; topicAccessible: boolean };

export interface NotePage<T> {
  data: T[];
  /** Decoded key of the next page; the route encodes it. `null` on the last page. */
  nextCursor: NoteCursorKey | null;
}

export interface SaveNoteInput {
  body: string;
  visibility?: Entities.Config.NoteVisibility;
  baseRevision: number;
}

export interface SavedNote {
  note: Note;
  /** `true` when the write created the note — the route answers `201`. */
  created: boolean;
}

const NOT_FOUND = { ok: false, status: 404, error: 'NotFound' } as const;

/**
 * "Staff" for notes = `admin` or `content_creator`. A `tutor` is a student here
 * (RFC 0016 §3, decided 2026-09-27).
 */
function isStaff(caller: NoteCaller): boolean {
  return caller.roles.includes(ROLES.ADMIN) || caller.roles.includes(ROLES.CONTENT_CREATOR);
}

/** Drops `moderatedAt` / `moderatedBy`; the `moderated` flag is what a reader needs. */
export function toNote(record: NoteRecord): Note {
  return {
    id: record.id,
    topicNodeId: record.topicNodeId,
    authorId: record.authorId,
    authorName: record.authorName,
    body: record.body,
    visibility: record.visibility,
    revision: record.revision,
    sharedAt: record.sharedAt,
    moderated: record.moderated,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Student notes (RFC 0016 §3–§5). Every access rule of the RFC's table lives in
 * this class; routes only parse the request, hand over the caller and shape the
 * response.
 *
 * Topic-scoped reads and writes apply the **catalog's** gate — the topic exists,
 * is published and not archived, and (for non-staff) is in the caller's
 * effective access set — and answer `404` on any miss, so a topic the caller may
 * not see and a topic that does not exist are indistinguishable.
 */
export class NotesController {
  constructor(
    private readonly notes: INoteRepository,
    private readonly topics: ITopicNodeRepository,
    private readonly enrollment: IEnrollmentRepository,
  ) {}

  /**
   * The catalog gate. Staff bypass only the effective-access set; a draft or
   * archived topic is unreadable for everyone, as in `TopicsController`.
   */
  private async isTopicReadable(topicId: string, caller: NoteCaller): Promise<boolean> {
    const topic = await this.topics.findById(topicId);
    if (!topic || topic.status !== Entities.Config.TopicNodeStatus.PUBLISHED || topic.archived) {
      return false;
    }
    if (isStaff(caller)) return true;
    const effectiveIds = await this.enrollment.getEffectiveAccessTopicIds(caller.userId);
    return effectiveIds.includes(topicId);
  }

  /** `GET /topics/{id}/notes/me` — the caller's note, or `null` when none. */
  async getMine(topicId: string, caller: NoteCaller): Promise<ControllerResult<Note | null>> {
    if (!(await this.isTopicReadable(topicId, caller))) return NOT_FOUND;
    const record = await this.notes.findMine(topicId, caller.userId);
    return { ok: true, data: record ? toNote(record) : null };
  }

  /**
   * `PUT /topics/{id}/notes/me` — conditional create-or-update (RFC 0016 §4).
   *
   * The gate doubles as the read-only rule for a topic the caller lost access
   * to: such a note can be read in "My notes" and deleted, but any save — edit
   * or share — is refused here with `404`.
   */
  async saveMine(
    topicId: string,
    caller: NoteCaller,
    input: SaveNoteInput,
  ): Promise<ControllerResult<SavedNote>> {
    if (!(await this.isTopicReadable(topicId, caller))) return NOT_FOUND;

    const body = sanitizeMarkdown(input.body).trim();
    if (body.length === 0) {
      return { ok: false, status: 400, error: 'NOTE_BODY_EMPTY' };
    }
    if (body.length > NOTE_BODY_MAX) {
      return { ok: false, status: 400, error: 'NOTE_BODY_TOO_LONG', meta: { max: NOTE_BODY_MAX } };
    }

    const existing = await this.notes.findMine(topicId, caller.userId);

    // Read-before-write, but still safe under a race: a staff force-unshare
    // bumps `revision`, so a share racing a moderation lands on a stale
    // `baseRevision` and the conditional save answers NOTE_STALE instead.
    if (input.visibility === Entities.Config.NoteVisibility.SHARED && existing?.moderated) {
      return { ok: false, status: 409, error: 'NOTE_MODERATED' };
    }

    // An omitted visibility keeps what the note already has (`private` on create).
    const visibility =
      input.visibility ?? existing?.visibility ?? Entities.Config.NoteVisibility.PRIVATE;

    const outcome = await this.notes.saveMine({
      topicNodeId: topicId,
      authorId: caller.userId,
      body,
      visibility,
      baseRevision: input.baseRevision,
    });

    if (!outcome.ok) {
      return {
        ok: false,
        status: 409,
        error: 'NOTE_STALE',
        meta: { current: outcome.stale ? toNote(outcome.stale) : null },
      };
    }
    return { ok: true, data: { note: toNote(outcome.note), created: outcome.created } };
  }

  /**
   * `DELETE /topics/{id}/notes/me` — hard-deletes the caller's own note.
   *
   * Deliberately **not** behind the topic gate: a note on a topic the caller can
   * no longer read (lost access, archived, back to draft) can still be deleted
   * (RFC 0016 §3). It acts on the caller's own row only, so the only miss is
   * "you have no note there" → `404`.
   */
  async deleteMine(topicId: string, caller: NoteCaller): Promise<ControllerResult<null>> {
    const deleted = await this.notes.deleteMine(topicId, caller.userId);
    if (!deleted) return NOT_FOUND;
    return { ok: true, data: null };
  }

  /**
   * `GET /topics/{id}/notes` — the class listing. The audience is decided from
   * the caller's roles alone: staff see every note, anyone else sees shared
   * notes only (their own flagged `isMine`). No request parameter reaches
   * `includePrivate`.
   */
  async listByTopic(
    topicId: string,
    caller: NoteCaller,
    cursor: NoteCursorKey | null,
  ): Promise<ControllerResult<NotePage<ClassNote>>> {
    if (!(await this.isTopicReadable(topicId, caller))) return NOT_FOUND;

    const page = await this.notes.listByTopic(topicId, {
      includePrivate: isStaff(caller),
      viewerId: caller.userId,
      page: { cursor, limit: NOTES_PAGE_SIZE },
    });

    return {
      ok: true,
      data: {
        data: page.data.map((record) => ({
          ...toNote(record),
          isMine: record.authorId === caller.userId,
        })),
        nextCursor: page.nextCursor,
      },
    };
  }

  /**
   * `GET /me/notes` — every note the caller wrote, across topics, each flagged
   * `topicAccessible` with the same rule as the topic gate. An inaccessible
   * topic's note is still returned: losing access does not take the words away.
   */
  async listMine(
    caller: NoteCaller,
    cursor: NoteCursorKey | null,
  ): Promise<ControllerResult<NotePage<AuthoredNote>>> {
    const page = await this.notes.listByAuthor(caller.userId, { cursor, limit: NOTES_PAGE_SIZE });

    const staff = isStaff(caller);
    const effectiveIds =
      staff || page.data.length === 0
        ? null
        : new Set(await this.enrollment.getEffectiveAccessTopicIds(caller.userId));

    const accessible = (record: AuthoredNoteRecord): boolean =>
      record.topicStatus === Entities.Config.TopicNodeStatus.PUBLISHED &&
      !record.topicArchived &&
      (staff || (effectiveIds?.has(record.topicNodeId) ?? false));

    return {
      ok: true,
      data: {
        data: page.data.map((record) => ({
          ...toNote(record),
          topicTitle: record.topicTitle,
          topicAccessible: accessible(record),
        })),
        nextCursor: page.nextCursor,
      },
    };
  }
}
