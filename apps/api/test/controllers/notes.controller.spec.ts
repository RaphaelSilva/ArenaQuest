import { describe, it, expect, vi } from 'vitest';
import { NotesController, NOTES_PAGE_SIZE, type NoteCaller } from '@api/controllers/notes.controller';
import type {
  INoteRepository,
  ITopicNodeRepository,
  IEnrollmentRepository,
  NoteRecord,
  AuthoredNoteRecord,
  TopicNodeRecord,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { NOTE_BODY_MAX } from '@arenaquest/shared/domain/notes/limits';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PUBLISHED: TopicNodeRecord = {
  id: 'topic-pub',
  parentId: null,
  title: 'Published',
  content: '',
  status: Entities.Config.TopicNodeStatus.PUBLISHED,
  tags: [],
  order: 0,
  estimatedMinutes: 0,
  prerequisiteIds: [],
  archived: false,
  visibility: Entities.Config.TopicVisibility.RESTRICTED,
};
const DRAFT: TopicNodeRecord = { ...PUBLISHED, id: 'topic-draft', status: Entities.Config.TopicNodeStatus.DRAFT };
const ARCHIVED: TopicNodeRecord = { ...PUBLISHED, id: 'topic-archived', archived: true };
const OUTSIDE: TopicNodeRecord = { ...PUBLISHED, id: 'topic-outside' };
const TOPICS = [PUBLISHED, DRAFT, ARCHIVED, OUTSIDE];

const STUDENT: NoteCaller = { userId: 'student-1', roles: ['student'] };
const TUTOR: NoteCaller = { userId: 'tutor-1', roles: ['tutor'] };
const ADMIN: NoteCaller = { userId: 'admin-1', roles: ['admin'] };
const CREATOR: NoteCaller = { userId: 'creator-1', roles: ['content_creator'] };

function note(overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: 'note-1',
    topicNodeId: PUBLISHED.id,
    authorId: STUDENT.userId,
    authorName: 'Student',
    body: 'hello',
    visibility: Entities.Config.NoteVisibility.PRIVATE,
    revision: 1,
    sharedAt: null,
    moderated: false,
    moderatedAt: null,
    moderatedBy: null,
    createdAt: '2026-09-28 10:00:00',
    updatedAt: '2026-09-28 10:00:00',
    ...overrides,
  };
}

function makeNotes(overrides: Partial<INoteRepository> = {}): INoteRepository {
  return {
    findMine: vi.fn(async () => null),
    findById: vi.fn(async () => null),
    saveMine: vi.fn(async (p) => ({
      ok: true as const,
      note: note({ body: p.body, visibility: p.visibility, revision: p.baseRevision + 1 }),
      created: p.baseRevision === 0,
    })),
    deleteMine: vi.fn(async () => true),
    listByTopic: vi.fn(async () => ({ data: [], nextCursor: null })),
    listByAuthor: vi.fn(async () => ({ data: [], nextCursor: null })),
    setModeration: vi.fn(async () => null),
    ...overrides,
  };
}

function makeTopics(): ITopicNodeRepository {
  return {
    findById: vi.fn(async (id: string) => TOPICS.find((t) => t.id === id) ?? null),
  } as unknown as ITopicNodeRepository;
}

/** Every caller's effective access set: all topics but `topic-outside`. */
function makeEnrollment(): IEnrollmentRepository {
  return {
    getEffectiveAccessTopicIds: vi.fn(async () => [PUBLISHED.id, DRAFT.id, ARCHIVED.id]),
  } as unknown as IEnrollmentRepository;
}

function build(notes = makeNotes()) {
  const enrollment = makeEnrollment();
  return { controller: new NotesController(notes, makeTopics(), enrollment), notes, enrollment };
}

// ---------------------------------------------------------------------------
// The topic gate
// ---------------------------------------------------------------------------

describe('NotesController — topic gate', () => {
  for (const [label, topicId] of [
    ['missing', 'nope'],
    ['draft', DRAFT.id],
    ['archived', ARCHIVED.id],
    ['out-of-access', OUTSIDE.id],
  ] as const) {
    it(`answers 404 NotFound to a student on a ${label} topic (get, save, list)`, async () => {
      const { controller, notes } = build();
      const get = await controller.getMine(topicId, STUDENT);
      const save = await controller.saveMine(topicId, STUDENT, { body: 'x', baseRevision: 0 });
      const list = await controller.listByTopic(topicId, STUDENT, null);
      for (const r of [get, save, list]) {
        expect(r).toEqual({ ok: false, status: 404, error: 'NotFound' });
      }
      expect(notes.saveMine).not.toHaveBeenCalled();
    });
  }

  it('lets staff bypass the effective-access set only', async () => {
    const { controller, enrollment } = build();
    for (const staff of [ADMIN, CREATOR]) {
      expect((await controller.getMine(OUTSIDE.id, staff)).ok).toBe(true);
      expect((await controller.getMine(DRAFT.id, staff)).ok).toBe(false);
      expect((await controller.getMine(ARCHIVED.id, staff)).ok).toBe(false);
    }
    expect(enrollment.getEffectiveAccessTopicIds).not.toHaveBeenCalled();
  });

  it('treats a tutor as a student', async () => {
    const { controller } = build();
    expect(await controller.getMine(OUTSIDE.id, TUTOR)).toEqual({ ok: false, status: 404, error: 'NotFound' });
  });
});

// ---------------------------------------------------------------------------
// getMine
// ---------------------------------------------------------------------------

describe('NotesController.getMine', () => {
  it('returns null when the caller has no note', async () => {
    const { controller } = build();
    expect(await controller.getMine(PUBLISHED.id, STUDENT)).toEqual({ ok: true, data: null });
  });

  it('returns the note without moderation provenance', async () => {
    const stored = note({ moderated: true, moderatedAt: '2026-09-28 11:00:00', moderatedBy: ADMIN.userId });
    const { controller } = build(makeNotes({ findMine: vi.fn(async () => stored) }));
    const result = await controller.getMine(PUBLISHED.id, STUDENT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ id: 'note-1', moderated: true });
    expect(result.data).not.toHaveProperty('moderatedAt');
    expect(result.data).not.toHaveProperty('moderatedBy');
  });
});

// ---------------------------------------------------------------------------
// saveMine
// ---------------------------------------------------------------------------

describe('NotesController.saveMine', () => {
  it('creates with created: true and private visibility by default', async () => {
    const { controller, notes } = build();
    const result = await controller.saveMine(PUBLISHED.id, STUDENT, { body: '  hi  ', baseRevision: 0 });
    expect(result).toMatchObject({ ok: true, data: { created: true, note: { body: 'hi', revision: 1 } } });
    expect(notes.saveMine).toHaveBeenCalledWith({
      topicNodeId: PUBLISHED.id,
      authorId: STUDENT.userId,
      body: 'hi',
      visibility: 'private',
      baseRevision: 0,
    });
  });

  it('keeps the existing visibility when it is omitted', async () => {
    const { controller, notes } = build(
      makeNotes({ findMine: vi.fn(async () => note({ visibility: Entities.Config.NoteVisibility.SHARED })) }),
    );
    await controller.saveMine(PUBLISHED.id, STUDENT, { body: 'edit', baseRevision: 1 });
    expect(notes.saveMine).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'shared' }));
  });

  it('strips a <script> before storage', async () => {
    const { controller, notes } = build();
    await controller.saveMine(PUBLISHED.id, STUDENT, {
      body: 'safe <script>alert(1)</script> text',
      baseRevision: 0,
    });
    expect(notes.saveMine).toHaveBeenCalledWith(expect.objectContaining({ body: 'safe  text' }));
  });

  it('answers 400 NOTE_BODY_EMPTY on a body that is empty after sanitisation and trim', async () => {
    const { controller, notes } = build();
    for (const body of ['', '   \n ', '<script>x</script>']) {
      expect(await controller.saveMine(PUBLISHED.id, STUDENT, { body, baseRevision: 0 })).toEqual({
        ok: false,
        status: 400,
        error: 'NOTE_BODY_EMPTY',
      });
    }
    expect(notes.saveMine).not.toHaveBeenCalled();
  });

  it('accepts exactly NOTE_BODY_MAX and answers 400 NOTE_BODY_TOO_LONG one above', async () => {
    const { controller } = build();
    const ok = await controller.saveMine(PUBLISHED.id, STUDENT, { body: 'a'.repeat(NOTE_BODY_MAX), baseRevision: 0 });
    expect(ok.ok).toBe(true);
    const tooLong = await controller.saveMine(PUBLISHED.id, STUDENT, {
      body: 'a'.repeat(NOTE_BODY_MAX + 1),
      baseRevision: 0,
    });
    expect(tooLong).toEqual({ ok: false, status: 400, error: 'NOTE_BODY_TOO_LONG', meta: { max: NOTE_BODY_MAX } });
  });

  it('counts the length after sanitisation', async () => {
    const { controller } = build();
    const body = 'a'.repeat(NOTE_BODY_MAX) + '<script>strip me</script>';
    expect((await controller.saveMine(PUBLISHED.id, STUDENT, { body, baseRevision: 0 })).ok).toBe(true);
  });

  it('answers 409 NOTE_MODERATED when sharing a moderated note, writing nothing', async () => {
    const { controller, notes } = build(makeNotes({ findMine: vi.fn(async () => note({ moderated: true })) }));
    const result = await controller.saveMine(PUBLISHED.id, STUDENT, {
      body: 'x',
      visibility: Entities.Config.NoteVisibility.SHARED,
      baseRevision: 1,
    });
    expect(result).toEqual({ ok: false, status: 409, error: 'NOTE_MODERATED' });
    expect(notes.saveMine).not.toHaveBeenCalled();
  });

  it('still lets a moderated note be edited privately', async () => {
    const { controller } = build(makeNotes({ findMine: vi.fn(async () => note({ moderated: true })) }));
    const result = await controller.saveMine(PUBLISHED.id, STUDENT, { body: 'private edit', baseRevision: 1 });
    expect(result.ok).toBe(true);
  });

  it('answers 409 NOTE_STALE with meta.current on a stale revision', async () => {
    const current = note({ revision: 4, moderatedBy: 'x', moderatedAt: 'y', moderated: true });
    const { controller } = build(
      makeNotes({ saveMine: vi.fn(async () => ({ ok: false as const, stale: current })) }),
    );
    const result = await controller.saveMine(PUBLISHED.id, STUDENT, { body: 'x', baseRevision: 3 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toBe('NOTE_STALE');
    expect(result.meta?.current).toMatchObject({ id: 'note-1', revision: 4 });
    expect(result.meta?.current).not.toHaveProperty('moderatedBy');
  });

  it('answers 409 NOTE_STALE with meta.current = null when the note is gone', async () => {
    const { controller } = build(makeNotes({ saveMine: vi.fn(async () => ({ ok: false as const, stale: null })) }));
    expect(await controller.saveMine(PUBLISHED.id, STUDENT, { body: 'x', baseRevision: 2 })).toEqual({
      ok: false,
      status: 409,
      error: 'NOTE_STALE',
      meta: { current: null },
    });
  });
});

// ---------------------------------------------------------------------------
// deleteMine
// ---------------------------------------------------------------------------

describe('NotesController.deleteMine', () => {
  it('deletes the caller\'s own note, even on an inaccessible topic', async () => {
    const { controller, notes } = build();
    expect(await controller.deleteMine(OUTSIDE.id, STUDENT)).toEqual({ ok: true, data: null });
    expect(notes.deleteMine).toHaveBeenCalledWith(OUTSIDE.id, STUDENT.userId);
  });

  it('answers 404 when the caller has no note there', async () => {
    const { controller } = build(makeNotes({ deleteMine: vi.fn(async () => false) }));
    expect(await controller.deleteMine(PUBLISHED.id, STUDENT)).toEqual({ ok: false, status: 404, error: 'NotFound' });
  });
});

// ---------------------------------------------------------------------------
// listByTopic
// ---------------------------------------------------------------------------

describe('NotesController.listByTopic', () => {
  it('derives includePrivate from roles only: false for student and tutor', async () => {
    for (const caller of [STUDENT, TUTOR]) {
      const { controller, notes } = build();
      await controller.listByTopic(PUBLISHED.id, caller, { sortKey: 'k', id: 'i' });
      expect(notes.listByTopic).toHaveBeenCalledWith(PUBLISHED.id, {
        includePrivate: false,
        viewerId: caller.userId,
        page: { cursor: { sortKey: 'k', id: 'i' }, limit: NOTES_PAGE_SIZE },
      });
    }
  });

  it('derives includePrivate from roles only: true for admin and content creator', async () => {
    for (const caller of [ADMIN, CREATOR]) {
      const { controller, notes } = build();
      await controller.listByTopic(OUTSIDE.id, caller, null);
      expect(notes.listByTopic).toHaveBeenCalledWith(OUTSIDE.id, expect.objectContaining({ includePrivate: true }));
    }
  });

  it('flags the caller\'s own notes isMine and passes the next cursor through', async () => {
    const mine = note({ id: 'mine', visibility: Entities.Config.NoteVisibility.SHARED });
    const theirs = note({ id: 'theirs', authorId: 'other', visibility: Entities.Config.NoteVisibility.SHARED });
    const { controller } = build(
      makeNotes({
        listByTopic: vi.fn(async () => ({ data: [mine, theirs], nextCursor: { sortKey: 's', id: 'theirs' } })),
      }),
    );
    const result = await controller.listByTopic(PUBLISHED.id, STUDENT, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.data.map((n) => [n.id, n.isMine])).toEqual([['mine', true], ['theirs', false]]);
    expect(result.data.nextCursor).toEqual({ sortKey: 's', id: 'theirs' });
  });
});

// ---------------------------------------------------------------------------
// listMine
// ---------------------------------------------------------------------------

describe('NotesController.listMine', () => {
  function authored(topic: TopicNodeRecord): AuthoredNoteRecord {
    return {
      ...note({ id: `n-${topic.id}`, topicNodeId: topic.id }),
      topicTitle: topic.title,
      topicStatus: topic.status,
      topicArchived: topic.archived,
    };
  }

  const rows = [authored(PUBLISHED), authored(DRAFT), authored(ARCHIVED), authored(OUTSIDE)];

  it('flags topicAccessible with the gate\'s rule for a student', async () => {
    const { controller, notes } = build(makeNotes({ listByAuthor: vi.fn(async () => ({ data: rows, nextCursor: null })) }));
    const result = await controller.listMine(STUDENT, null);
    expect(notes.listByAuthor).toHaveBeenCalledWith(STUDENT.userId, { cursor: null, limit: NOTES_PAGE_SIZE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.data.map((n) => [n.topicNodeId, n.topicAccessible, n.topicTitle])).toEqual([
      [PUBLISHED.id, true, 'Published'],
      [DRAFT.id, false, 'Published'],
      [ARCHIVED.id, false, 'Published'],
      [OUTSIDE.id, false, 'Published'],
    ]);
    expect(result.data.data[0]).not.toHaveProperty('moderatedBy');
  });

  it('lets staff bypass the access set, not the status', async () => {
    const { controller, enrollment } = build(makeNotes({ listByAuthor: vi.fn(async () => ({ data: rows, nextCursor: null })) }));
    const result = await controller.listMine(ADMIN, null);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.data.map((n) => n.topicAccessible)).toEqual([true, false, false, true]);
    expect(enrollment.getEffectiveAccessTopicIds).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Staff (Task 04)
// ---------------------------------------------------------------------------

describe('NotesController.listByAuthorForStaff', () => {
  it('returns every note with topic title and moderation provenance, passing the cursor through', async () => {
    const row: AuthoredNoteRecord = {
      ...note({ moderated: true, moderatedAt: '2026-09-28 11:00:00', moderatedBy: ADMIN.userId }),
      topicTitle: 'Published',
      topicStatus: Entities.Config.TopicNodeStatus.PUBLISHED,
      topicArchived: false,
    };
    const next = { sortKey: '2026-09-28 10:00:00', id: 'note-1' };
    const { controller, notes, enrollment } = build(
      makeNotes({ listByAuthor: vi.fn(async () => ({ data: [row], nextCursor: next })) }),
    );
    const cursor = { sortKey: '2026-09-29 00:00:00', id: 'z' };
    const result = await controller.listByAuthorForStaff(STUDENT.userId, cursor);
    expect(notes.listByAuthor).toHaveBeenCalledWith(STUDENT.userId, { cursor, limit: NOTES_PAGE_SIZE });
    expect(enrollment.getEffectiveAccessTopicIds).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      data: {
        data: [
          {
            ...note({ moderated: true }),
            moderatedAt: '2026-09-28 11:00:00',
            moderatedBy: ADMIN.userId,
            topicTitle: 'Published',
          },
        ],
        nextCursor: next,
      },
    });
    if (result.ok) expect(result.data.data[0]).not.toHaveProperty('topicStatus');
  });

  it('answers an empty page for an unknown user', async () => {
    const { controller } = build();
    expect(await controller.listByAuthorForStaff('nobody', null)).toEqual({
      ok: true,
      data: { data: [], nextCursor: null },
    });
  });
});

describe('NotesController.unshare', () => {
  it('sets moderation with the staff id and returns the note with provenance', async () => {
    const moderated = note({
      revision: 3,
      moderated: true,
      moderatedAt: '2026-09-28 11:00:00',
      moderatedBy: CREATOR.userId,
    });
    const { controller, notes } = build(makeNotes({ setModeration: vi.fn(async () => moderated) }));
    const result = await controller.unshare('note-1', CREATOR.userId);
    expect(notes.setModeration).toHaveBeenCalledWith('note-1', CREATOR.userId);
    expect(result).toEqual({
      ok: true,
      data: { ...note({ revision: 3, moderated: true }), moderatedAt: '2026-09-28 11:00:00', moderatedBy: CREATOR.userId },
    });
  });

  it('answers 404 NotFound on an unknown id', async () => {
    const { controller } = build();
    expect(await controller.unshare('missing', ADMIN.userId)).toEqual({ ok: false, status: 404, error: 'NotFound' });
  });
});

describe('NotesController.clearModeration', () => {
  it('clears moderation (adminId null) and returns no content', async () => {
    const { controller, notes } = build(makeNotes({ setModeration: vi.fn(async () => note()) }));
    expect(await controller.clearModeration('note-1')).toEqual({ ok: true, data: null });
    expect(notes.setModeration).toHaveBeenCalledWith('note-1', null);
    expect(notes.saveMine).not.toHaveBeenCalled();
  });

  it('answers 404 NotFound on an unknown id', async () => {
    const { controller } = build();
    expect(await controller.clearModeration('missing')).toEqual({ ok: false, status: 404, error: 'NotFound' });
  });
});
