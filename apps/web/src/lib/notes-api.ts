import type { HttpTransport } from './api-client';
import type { components } from './api-types.gen';

/**
 * A student's note on a topic, as `/v1/topics/{id}/notes/me` returns it. The
 * generated schema carries the `.nullable()` of the GET response, hence NonNullable.
 */
export type Note = NonNullable<components['schemas']['Note']>;

export type NoteVisibility = Note['visibility'];

/** A shared note in a topic's *Class notes* list; `isMine` marks the caller's own. */
export type ClassNote = components['schemas']['ClassNote'];

/** One of the caller's notes on `/me/notes`, with the topic it belongs to. */
export type AuthoredNote = components['schemas']['AuthoredNote'];

/** A note as the staff routes return it: the moderation audit fields included. */
export type StaffNote = components['schemas']['StaffNote'];

/** One of a student's notes in the user backoffice, with the topic it belongs to. */
export type StaffAuthoredNote = components['schemas']['StaffAuthoredNote'];

/** A cursor-paginated page; `nextCursor` is `null` on the last page. */
export type NotePage<T> = { data: T[]; nextCursor: string | null };

export type SaveNoteInput = {
  body: string;
  visibility?: NoteVisibility;
  /** The revision this tab last received; `0` creates the note. */
  baseRevision: number;
};

/**
 * Expected outcomes of a save, surfaced as data rather than thrown so the
 * editor can branch on them (RFC 0016 section 4).
 */
export type SaveNoteResult =
  | { kind: 'saved'; note: Note; created: boolean }
  /** `409 NOTE_STALE` — `current` is the stored note, or `null` when it was deleted elsewhere. */
  | { kind: 'stale'; current: Note | null }
  /** `409 NOTE_MODERATED` — the staff made this note private; sharing is blocked. */
  | { kind: 'moderated' }
  /** `400` — the body is empty or too long after sanitisation, or the request is malformed. */
  | { kind: 'invalid'; code: 'NOTE_BODY_EMPTY' | 'NOTE_BODY_TOO_LONG' | 'BadRequest' };

export type NotesApiErrorCode =
  | 'Unauthorized'
  | 'Forbidden'
  | 'NetworkError'
  | 'NotFound'
  | 'InvalidCursor'
  | 'Unknown';

export class NotesApiError extends Error {
  readonly code: NotesApiErrorCode;
  readonly status: number;

  constructor(code: NotesApiErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function send(
  http: HttpTransport,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  try {
    return await http(method, path, body === undefined ? undefined : { body: JSON.stringify(body) });
  } catch {
    throw new NotesApiError('NetworkError', 0, 'Network failure.');
  }
}

function throwForStatus(res: Response, notFoundMessage: string): never {
  if (res.status === 401) throw new NotesApiError('Unauthorized', 401, 'Unauthorized.');
  if (res.status === 403) throw new NotesApiError('Forbidden', 403, 'Forbidden.');
  if (res.status === 404) throw new NotesApiError('NotFound', 404, notFoundMessage);
  throw new NotesApiError('Unknown', res.status, `Failed (${res.status})`);
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function throwForListStatus(res: Response, notFoundMessage: string): never {
  if (res.status === 400) throw new NotesApiError('InvalidCursor', 400, 'Invalid cursor.');
  throwForStatus(res, notFoundMessage);
}

function withCursor(path: string, cursor?: string | null): string {
  return cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
}

export function createNotesApi(http: HttpTransport) {
  return {
    /** A page of the topic's notes as the API returns them (shared, newest first for students). */
    async listForTopic(topicId: string, cursor?: string | null): Promise<NotePage<ClassNote>> {
      const res = await send(http, 'GET', withCursor(`/topics/${topicId}/notes`, cursor));
      if (!res.ok) throwForListStatus(res, 'Topic not found.');
      return (await res.json()) as NotePage<ClassNote>;
    },

    /** A page of every note the caller wrote, last edited first. */
    async listMine(cursor?: string | null): Promise<NotePage<AuthoredNote>> {
      const res = await send(http, 'GET', withCursor('/me/notes', cursor));
      if (!res.ok) throwForListStatus(res, 'Not found.');
      return (await res.json()) as NotePage<AuthoredNote>;
    },

    /** Staff: a page of every note one student wrote, private included (last edited first). */
    async listForUser(userId: string, cursor?: string | null): Promise<NotePage<StaffAuthoredNote>> {
      const res = await send(http, 'GET', withCursor(`/admin/users/${userId}/notes`, cursor));
      if (!res.ok) throwForListStatus(res, 'Not found.');
      return (await res.json()) as NotePage<StaffAuthoredNote>;
    },

    /** Staff: makes a note private and marks it moderated; returns the stored note. */
    async unshare(noteId: string): Promise<StaffNote> {
      const res = await send(http, 'POST', `/admin/notes/${noteId}/unshare`);
      if (!res.ok) throwForStatus(res, 'Note not found.');
      return (await res.json()) as StaffNote;
    },

    /** Staff: clears the moderation flag so the author may share again. Does not re-share. */
    async clearModeration(noteId: string): Promise<void> {
      const res = await send(http, 'DELETE', `/admin/notes/${noteId}/moderation`);
      if (res.status === 204 || res.ok) return;
      throwForStatus(res, 'Note not found.');
    },

    /** The caller's note on the topic, or `null` when there is none. */
    async getMine(topicId: string): Promise<Note | null> {
      const res = await send(http, 'GET', `/topics/${topicId}/notes/me`);
      if (!res.ok) throwForStatus(res, 'Topic not found.');
      const body = (await res.json()) as { data: Note | null };
      return body.data;
    },

    /** Conditional upsert keyed on `baseRevision`; conflicts come back as typed results. */
    async saveMine(topicId: string, input: SaveNoteInput): Promise<SaveNoteResult> {
      const res = await send(http, 'PUT', `/topics/${topicId}/notes/me`, input);
      if (res.status === 200 || res.status === 201) {
        const note = (await res.json()) as Note;
        return { kind: 'saved', note, created: res.status === 201 };
      }
      if (res.status === 409) {
        const body = await readJson(res);
        if (body.error === 'NOTE_STALE') {
          // The API envelope spreads `meta`, so `current` sits at the top level.
          return { kind: 'stale', current: (body.current as Note | null | undefined) ?? null };
        }
        if (body.error === 'NOTE_MODERATED') return { kind: 'moderated' };
        throw new NotesApiError('Unknown', 409, 'Unexpected conflict.');
      }
      if (res.status === 400) {
        const body = await readJson(res);
        const code =
          body.error === 'NOTE_BODY_EMPTY' || body.error === 'NOTE_BODY_TOO_LONG'
            ? body.error
            : 'BadRequest';
        return { kind: 'invalid', code };
      }
      throwForStatus(res, 'Topic not found.');
    },

    /** Hard-deletes the caller's note. */
    async deleteMine(topicId: string): Promise<void> {
      const res = await send(http, 'DELETE', `/topics/${topicId}/notes/me`);
      if (res.status === 204 || res.ok) return;
      throwForStatus(res, 'Note not found.');
    },
  };
}
