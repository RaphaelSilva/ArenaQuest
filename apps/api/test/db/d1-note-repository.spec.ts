import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { D1NoteRepository } from '@api/adapters/db/d1-note-repository';
import type { NoteCursorKey, NoteRecord } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { applyMigrations } from '../helpers/apply-migrations';

/**
 * The conditional save is the heart of this suite: every write path must be a
 * single statement keyed on `revision`, so two saves racing on the same
 * `baseRevision` resolve to exactly one write and one stale outcome.
 */

const PRIVATE = Entities.Config.NoteVisibility.PRIVATE;
const SHARED = Entities.Config.NoteVisibility.SHARED;

async function insertUser(id: string, name = 'Student'): Promise<void> {
  await env.DB
    .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .bind(id, name, `u-${id}@example.com`, 'hash')
    .run();
}

async function insertTopic(id: string, title = 'Topic', archived = 0): Promise<void> {
  await env.DB
    .prepare(`INSERT INTO topic_nodes (id, title, status, archived) VALUES (?, ?, 'published', ?)`)
    .bind(id, title, archived)
    .run();
}

async function storedRow(id: string): Promise<Record<string, unknown> | null> {
  return env.DB.prepare('SELECT * FROM topic_notes WHERE id = ?').bind(id).first();
}

describe('D1NoteRepository', () => {
  let repo: D1NoteRepository;
  let authorId: string;
  let otherId: string;
  let adminId: string;
  let topicId: string;

  beforeAll(async () => {
    await applyMigrations(env.DB);
    // Foreign keys are off by default in the Miniflare D1; the cascade test
    // below would pass vacuously without this.
    await env.DB.exec('PRAGMA foreign_keys = ON');
    repo = new D1NoteRepository(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM topic_notes').run();
    authorId = crypto.randomUUID();
    otherId = crypto.randomUUID();
    adminId = crypto.randomUUID();
    topicId = crypto.randomUUID();
    await insertUser(authorId, 'Author');
    await insertUser(otherId, 'Other');
    await insertUser(adminId, 'Admin');
    await insertTopic(topicId, 'Kata basics');
  });

  async function create(
    body = 'first',
    visibility = PRIVATE,
    author = authorId,
    topic = topicId,
  ): Promise<NoteRecord> {
    const outcome = await repo.saveMine({
      topicNodeId: topic,
      authorId: author,
      body,
      visibility,
      baseRevision: 0,
    });
    if (!outcome.ok) throw new Error('expected create to land');
    return outcome.note;
  }

  describe('schema (migration 0028)', () => {
    it('defaults visibility to private and revision to 1', async () => {
      const id = crypto.randomUUID();
      await env.DB
        .prepare('INSERT INTO topic_notes (id, topic_node_id, author_id, body) VALUES (?, ?, ?, ?)')
        .bind(id, topicId, authorId, 'x')
        .run();
      const row = await storedRow(id);
      expect(row?.visibility).toBe('private');
      expect(row?.revision).toBe(1);
    });

    it('rejects a visibility outside private/shared', async () => {
      await expect(
        env.DB
          .prepare(
            `INSERT INTO topic_notes (id, topic_node_id, author_id, body, visibility)
             VALUES (?, ?, ?, 'x', 'public')`,
          )
          .bind(crypto.randomUUID(), topicId, authorId)
          .run(),
      ).rejects.toThrow();
    });

    it('rejects a second row for the same (topic, author)', async () => {
      await create();
      await expect(
        env.DB
          .prepare('INSERT INTO topic_notes (id, topic_node_id, author_id, body) VALUES (?, ?, ?, ?)')
          .bind(crypto.randomUUID(), topicId, authorId, 'dup')
          .run(),
      ).rejects.toThrow();
    });

    it('creates both indexes', async () => {
      const { results } = await env.DB
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'topic_notes'`)
        .all<{ name: string }>();
      const names = results.map(r => r.name);
      expect(names).toContain('idx_topic_notes_author');
      expect(names).toContain('idx_topic_notes_topic');
    });
  });

  describe('saveMine - create', () => {
    it('creates a private note at revision 1 with the author name joined', async () => {
      const outcome = await repo.saveMine({
        topicNodeId: topicId,
        authorId,
        body: 'hello',
        visibility: PRIVATE,
        baseRevision: 0,
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.created).toBe(true);
      expect(outcome.note).toMatchObject({
        topicNodeId: topicId,
        authorId,
        authorName: 'Author',
        body: 'hello',
        visibility: PRIVATE,
        revision: 1,
        sharedAt: null,
        moderated: false,
        moderatedAt: null,
        moderatedBy: null,
      });
      expect(await repo.findMine(topicId, authorId)).toEqual(outcome.note);
      expect(await repo.findById(outcome.note.id)).toEqual(outcome.note);
    });

    it('stamps shared_at when created as shared', async () => {
      const note = await create('hi', SHARED);
      expect(note.visibility).toBe(SHARED);
      expect(note.sharedAt).not.toBeNull();
    });

    it('is stale, carrying the existing row, when a note already exists', async () => {
      const first = await create('first');
      const outcome = await repo.saveMine({
        topicNodeId: topicId,
        authorId,
        body: 'second',
        visibility: SHARED,
        baseRevision: 0,
      });
      expect(outcome).toEqual({ ok: false, stale: first });
      expect(await repo.findMine(topicId, authorId)).toEqual(first);
    });

    it('two concurrent creates yield one write and one stale', async () => {
      const [a, b] = await Promise.all([
        repo.saveMine({ topicNodeId: topicId, authorId, body: 'tab A', visibility: PRIVATE, baseRevision: 0 }),
        repo.saveMine({ topicNodeId: topicId, authorId, body: 'tab B', visibility: PRIVATE, baseRevision: 0 }),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      const stored = await repo.findMine(topicId, authorId);
      const winner = a.ok ? a.note : b.ok ? b.note : null;
      expect(stored).toEqual(winner);
    });
  });

  describe('saveMine - update', () => {
    it('writes at the right revision and increments it', async () => {
      const first = await create('v1');
      const outcome = await repo.saveMine({
        topicNodeId: topicId,
        authorId,
        body: 'v2',
        visibility: PRIVATE,
        baseRevision: first.revision,
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.created).toBe(false);
      expect(outcome.note.id).toBe(first.id);
      expect(outcome.note.body).toBe('v2');
      expect(outcome.note.revision).toBe(2);
    });

    it('is stale at an old revision, returning the current row unchanged', async () => {
      const first = await create('v1');
      const second = await repo.saveMine({
        topicNodeId: topicId, authorId, body: 'v2', visibility: PRIVATE, baseRevision: 1,
      });
      if (!second.ok) throw new Error('expected second save to land');
      const before = await storedRow(first.id);

      const outcome = await repo.saveMine({
        topicNodeId: topicId, authorId, body: 'v3', visibility: SHARED, baseRevision: 1,
      });
      expect(outcome).toEqual({ ok: false, stale: second.note });
      expect(await storedRow(first.id)).toEqual(before);
    });

    it('two saves with the same baseRevision back to back: one written, one stale, body is the first', async () => {
      const first = await create('base');
      const a = await repo.saveMine({
        topicNodeId: topicId, authorId, body: 'tab A', visibility: PRIVATE, baseRevision: first.revision,
      });
      const b = await repo.saveMine({
        topicNodeId: topicId, authorId, body: 'tab B', visibility: PRIVATE, baseRevision: first.revision,
      });
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(false);
      if (b.ok || !a.ok) return;
      expect(b.stale).toEqual(a.note);
      const stored = await repo.findMine(topicId, authorId);
      expect(stored?.body).toBe('tab A');
      expect(stored?.revision).toBe(2);
    });

    it('two saves with the same baseRevision in parallel: exactly one written', async () => {
      const first = await create('base');
      const outcomes = await Promise.all(
        ['tab A', 'tab B'].map(body =>
          repo.saveMine({ topicNodeId: topicId, authorId, body, visibility: PRIVATE, baseRevision: first.revision }),
        ),
      );
      const written = outcomes.filter(o => o.ok);
      const stale = outcomes.filter(o => !o.ok);
      expect(written).toHaveLength(1);
      expect(stale).toHaveLength(1);
      const stored = await repo.findMine(topicId, authorId);
      expect(stored?.revision).toBe(2);
      const winner = written[0];
      if (!winner.ok) throw new Error('unreachable');
      expect(stored).toEqual(winner.note);
    });

    it('is stale with null after the note was deleted', async () => {
      const first = await create('v1');
      expect(await repo.deleteMine(topicId, authorId)).toBe(true);
      const outcome = await repo.saveMine({
        topicNodeId: topicId, authorId, body: 'v2', visibility: PRIVATE, baseRevision: first.revision,
      });
      expect(outcome).toEqual({ ok: false, stale: null });
      expect(await repo.findMine(topicId, authorId)).toBeNull();
    });

    it('stamps shared_at on private-to-shared and keeps it on shared-to-shared', async () => {
      const first = await create('v1');
      expect(first.sharedAt).toBeNull();
      const shared = await repo.saveMine({
        topicNodeId: topicId, authorId, body: 'v2', visibility: SHARED, baseRevision: 1,
      });
      if (!shared.ok) throw new Error('expected share to land');
      expect(shared.note.sharedAt).not.toBeNull();

      // Back-date to prove a shared→shared edit does not re-stamp.
      await env.DB
        .prepare(`UPDATE topic_notes SET shared_at = '2020-01-01 00:00:00' WHERE id = ?`)
        .bind(first.id)
        .run();
      const edited = await repo.saveMine({
        topicNodeId: topicId, authorId, body: 'v3', visibility: SHARED, baseRevision: 2,
      });
      if (!edited.ok) throw new Error('expected edit to land');
      expect(edited.note.sharedAt).toBe('2020-01-01 00:00:00');
    });
  });

  describe('deleteMine', () => {
    it('hard-deletes and reports whether a row existed', async () => {
      const note = await create();
      expect(await repo.deleteMine(topicId, authorId)).toBe(true);
      expect(await storedRow(note.id)).toBeNull();
      expect(await repo.deleteMine(topicId, authorId)).toBe(false);
    });
  });

  describe('setModeration', () => {
    it('forces private, bumps revision, stamps the flag and leaves body byte-identical', async () => {
      const body = 'Línea 1\n\n**bold** — “quotes”   trailing  ';
      const note = await create(body, SHARED);
      const moderated = await repo.setModeration(note.id, adminId);
      expect(moderated).not.toBeNull();
      expect(moderated?.visibility).toBe(PRIVATE);
      expect(moderated?.revision).toBe(note.revision + 1);
      expect(moderated?.moderated).toBe(true);
      expect(moderated?.moderatedBy).toBe(adminId);
      expect(moderated?.moderatedAt).not.toBeNull();
      expect(moderated?.body).toBe(body);
      expect((await storedRow(note.id))?.body).toBe(body);
    });

    it('makes an open editor stale on its next save', async () => {
      const note = await create('v1', SHARED);
      await repo.setModeration(note.id, adminId);
      const outcome = await repo.saveMine({
        topicNodeId: topicId, authorId, body: 'v2', visibility: SHARED, baseRevision: note.revision,
      });
      expect(outcome.ok).toBe(false);
    });

    it('clearing moderation touches only the flag: revision, visibility and body kept', async () => {
      const note = await create('v1', SHARED);
      const moderated = await repo.setModeration(note.id, adminId);
      const cleared = await repo.setModeration(note.id, null);
      expect(cleared).toMatchObject({
        moderated: false,
        moderatedAt: null,
        moderatedBy: null,
        visibility: PRIVATE,
        revision: moderated?.revision,
        body: 'v1',
        updatedAt: moderated?.updatedAt,
      });
    });

    it('returns null for an unknown note', async () => {
      expect(await repo.setModeration(crypto.randomUUID(), adminId)).toBeNull();
      expect(await repo.setModeration(crypto.randomUUID(), null)).toBeNull();
    });
  });

  describe('listByTopic', () => {
    async function seedAuthors(count: number): Promise<string[]> {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const id = crypto.randomUUID();
        await insertUser(id, `S${i}`);
        ids.push(id);
      }
      return ids;
    }

    it('excludes private rows unless includePrivate', async () => {
      await create('mine private', PRIVATE, authorId);
      await create('other shared', SHARED, otherId);

      const students = await repo.listByTopic(topicId, {
        includePrivate: false, viewerId: otherId, page: { cursor: null, limit: 20 },
      });
      expect(students.data.map(n => n.body)).toEqual(['other shared']);
      expect(students.nextCursor).toBeNull();

      const staff = await repo.listByTopic(topicId, {
        includePrivate: true, viewerId: adminId, page: { cursor: null, limit: 20 },
      });
      expect(staff.data.map(n => n.body).sort()).toEqual(['mine private', 'other shared']);
    });

    it('never yields a private row, even with a cursor from an includePrivate listing', async () => {
      const authors = await seedAuthors(6);
      for (const [i, id] of authors.entries()) {
        await create(`n${i}`, i % 2 === 0 ? PRIVATE : SHARED, id);
      }
      const staffPage = await repo.listByTopic(topicId, {
        includePrivate: true, viewerId: adminId, page: { cursor: null, limit: 2 },
      });
      expect(staffPage.nextCursor).not.toBeNull();

      // Also a cursor that sits on a private row, and one far in the future.
      const privateRow = staffPage.data.find(n => n.visibility === PRIVATE) ?? staffPage.data[0];
      const cursors: NoteCursorKey[] = [
        staffPage.nextCursor as NoteCursorKey,
        { sortKey: privateRow.updatedAt, id: privateRow.id },
        { sortKey: '9999-12-31 23:59:59', id: 'ffffffff' },
      ];
      for (const cursor of cursors) {
        const page = await repo.listByTopic(topicId, {
          includePrivate: false, viewerId: otherId, page: { cursor, limit: 20 },
        });
        expect(page.data.every(n => n.visibility === SHARED)).toBe(true);
      }
    });

    it('orders shared notes by shared_at desc, id desc', async () => {
      const authors = await seedAuthors(3);
      const notes = [];
      for (const id of authors) notes.push(await create('x', SHARED, id));
      const stamps = ['2026-01-01 00:00:00', '2026-03-01 00:00:00', '2026-02-01 00:00:00'];
      for (const [i, n] of notes.entries()) {
        await env.DB.prepare('UPDATE topic_notes SET shared_at = ? WHERE id = ?').bind(stamps[i], n.id).run();
      }
      const page = await repo.listByTopic(topicId, {
        includePrivate: false, viewerId: otherId, page: { cursor: null, limit: 20 },
      });
      expect(page.data.map(n => n.id)).toEqual([notes[1].id, notes[2].id, notes[0].id]);
    });

    it.each([false, true])('paginates 25 rows as 20 + 5 with no dupes or gaps, ties included (includePrivate=%s)', async includePrivate => {
      const authors = await seedAuthors(25);
      const ids: string[] = [];
      for (const [i, id] of authors.entries()) {
        const note = await create(`n${i}`, SHARED, id);
        ids.push(note.id);
      }
      // Force ties on the sort key: groups of five share one timestamp.
      for (const [i, id] of ids.entries()) {
        const stamp = `2026-01-0${1 + Math.floor(i / 5)} 00:00:00`;
        await env.DB
          .prepare('UPDATE topic_notes SET shared_at = ?, updated_at = ? WHERE id = ?')
          .bind(stamp, stamp, id)
          .run();
      }

      const first = await repo.listByTopic(topicId, {
        includePrivate, viewerId: adminId, page: { cursor: null, limit: 20 },
      });
      expect(first.data).toHaveLength(20);
      expect(first.nextCursor).not.toBeNull();
      const second = await repo.listByTopic(topicId, {
        includePrivate, viewerId: adminId, page: { cursor: first.nextCursor, limit: 20 },
      });
      expect(second.data).toHaveLength(5);
      expect(second.nextCursor).toBeNull();

      const seen = [...first.data, ...second.data].map(n => n.id);
      expect(new Set(seen).size).toBe(25);
      expect([...seen].sort()).toEqual([...ids].sort());
    });

    it('scopes to the topic', async () => {
      const otherTopic = crypto.randomUUID();
      await insertTopic(otherTopic);
      await create('elsewhere', SHARED, authorId, otherTopic);
      const page = await repo.listByTopic(topicId, {
        includePrivate: true, viewerId: adminId, page: { cursor: null, limit: 20 },
      });
      expect(page.data).toHaveLength(0);
    });
  });

  describe('listByAuthor', () => {
    it('lists every note by the author, private included, with topic fields', async () => {
      const archivedTopic = crypto.randomUUID();
      await insertTopic(archivedTopic, 'Old topic', 1);
      await create('private', PRIVATE, authorId, topicId);
      await create('shared', SHARED, authorId, archivedTopic);
      await create('someone else', SHARED, otherId, topicId);

      const page = await repo.listByAuthor(authorId, { cursor: null, limit: 20 });
      expect(page.data).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
      const byTopic = Object.fromEntries(page.data.map(n => [n.topicNodeId, n]));
      expect(byTopic[topicId]).toMatchObject({
        body: 'private', topicTitle: 'Kata basics', topicStatus: 'published', topicArchived: false,
      });
      expect(byTopic[archivedTopic]).toMatchObject({
        body: 'shared', topicTitle: 'Old topic', topicArchived: true,
      });
    });

    it('orders by updated_at desc and paginates 20 + 5 with ties', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 25; i++) {
        const t = crypto.randomUUID();
        await insertTopic(t, `T${i}`);
        ids.push((await create(`n${i}`, PRIVATE, authorId, t)).id);
      }
      for (const [i, id] of ids.entries()) {
        const stamp = `2026-01-0${1 + Math.floor(i / 5)} 00:00:00`;
        await env.DB.prepare('UPDATE topic_notes SET updated_at = ? WHERE id = ?').bind(stamp, id).run();
      }
      const first = await repo.listByAuthor(authorId, { cursor: null, limit: 20 });
      const second = await repo.listByAuthor(authorId, { cursor: first.nextCursor, limit: 20 });
      expect(first.data).toHaveLength(20);
      expect(second.data).toHaveLength(5);
      expect(second.nextCursor).toBeNull();

      const all = [...first.data, ...second.data];
      expect(new Set(all.map(n => n.id)).size).toBe(25);
      const keys = all.map(n => `${n.updatedAt}|${n.id}`);
      expect(keys).toEqual([...keys].sort().reverse());
    });
  });

  describe('user deletion', () => {
    it('cascades to the author\'s notes', async () => {
      const note = await create('bye', SHARED);
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(authorId).run();
      expect(await storedRow(note.id)).toBeNull();
    });
  });
});
