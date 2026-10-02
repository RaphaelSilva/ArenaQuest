import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  D1StorageReferenceRepository,
  InvalidStorageReferenceCursorError,
} from '@api/adapters/db/d1-storage-reference-repository';
import type { StorageReference } from '@arenaquest/shared/ports';
import { applyMigrations } from '../helpers/apply-migrations';

/**
 * Runs against a migrated local D1. Storage is isolated per test, so every
 * test seeds the rows it reads beyond the user and topic created in beforeAll.
 */

const userId = crypto.randomUUID();
const topicId = crypto.randomUUID();
const goneTopicId = crypto.randomUUID();

async function insertMedia(opts: {
  key: string;
  status?: 'pending' | 'ready' | 'deleted';
  topic?: string;
  id?: string;
  name?: string;
}): Promise<string> {
  const id = opts.id ?? crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO media (id, topic_node_id, uploaded_by, storage_key, original_name, type, size_bytes, status)
       VALUES (?, ?, ?, ?, ?, 'application/pdf', 42, ?)`,
    )
    .bind(id, opts.topic ?? topicId, userId, opts.key, opts.name ?? 'file.pdf', opts.status ?? 'ready')
    .run();
  return id;
}

async function insertEvent(opts: {
  slug: string;
  title: string;
  flyerStatus?: 'none' | 'pending' | 'ready';
  flyerKey?: string | null;
  replacedKey?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO events (id, slug, title, starts_at, flyer_status, flyer_key, flyer_name, flyer_replaced_key, created_by)
       VALUES (?, ?, ?, '2026-10-01 10:00:00', ?, ?, 'flyer.png', ?, ?)`,
    )
    .bind(id, opts.slug, opts.title, opts.flyerStatus ?? 'ready', opts.flyerKey ?? null, opts.replacedKey ?? null, userId)
    .run();
  return id;
}

async function insertSubmission(opts: {
  key: string | null;
  status?: 'pending' | 'ready' | 'removed';
  title?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO topic_submissions
         (id, topic_node_id, author_id, title, storage_key, original_name, content_type, size_bytes, status)
       VALUES (?, ?, ?, ?, ?, 'IMG_0042.MOV', 'video/quicktime', 2048, ?)`,
    )
    .bind(id, topicId, userId, opts.title ?? 'Kata, 2nd attempt', opts.key, opts.status ?? 'ready')
    .run();
  return id;
}

async function walkAll(repo: D1StorageReferenceRepository, limit: number) {
  const items: StorageReference[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await repo.listReferencedKeys({ cursor, limit });
    expect(page.items.length).toBeLessThanOrEqual(limit);
    items.push(...page.items);
    cursor = page.nextCursor;
    pages++;
  } while (cursor && pages < 1000);
  return { items, pages };
}

describe('D1StorageReferenceRepository', () => {
  let repo: D1StorageReferenceRepository;

  beforeAll(async () => {
    await applyMigrations(env.DB);
    await env.DB
      .prepare("INSERT INTO users (id, name, email, password_hash) VALUES (?, 'Ada Uploader', 'ada@test.com', 'hash')")
      .bind(userId)
      .run();
    await env.DB
      .prepare("INSERT INTO topic_nodes (id, title, status) VALUES (?, 'Kata Basics', 'published')")
      .bind(topicId)
      .run();
    repo = new D1StorageReferenceRepository(env.DB);
  });

  describe('resolveKeys', () => {
    it('resolves 91 keys across the chunk boundary with one batch per 90-key chunk', async () => {
      const keys = Array.from({ length: 91 }, (_, i) => `topics/${topicId}/chunk-${i}.pdf`);
      for (const key of keys) await insertMedia({ key });

      const batchSpy = vi.spyOn(env.DB, 'batch');
      try {
        const refs = await repo.resolveKeys(keys);
        expect(batchSpy).toHaveBeenCalledTimes(2);
        expect(refs.size).toBe(91);
        for (const key of keys) {
          const list = refs.get(key)!;
          expect(list).toHaveLength(1);
          expect(list[0]).toMatchObject({ kind: 'media', key, status: 'ready' });
        }
      } finally {
        batchSpy.mockRestore();
      }
    });

    it('reads every registered owner, submissions included, in the one batch per chunk', async () => {
      const keys = Array.from({ length: 91 }, (_, i) => `submissions/${userId}/chunk-${i}.mp4`);
      for (const key of keys) await insertSubmission({ key });

      const batchSpy = vi.spyOn(env.DB, 'batch');
      try {
        const refs = await repo.resolveKeys(keys);
        expect(batchSpy).toHaveBeenCalledTimes(2);
        // media + flyer_key + flyer_replaced_key + topic_submissions
        for (const call of batchSpy.mock.calls) expect(call[0]).toHaveLength(4);
        expect(refs.size).toBe(91);
        for (const key of keys) {
          expect(refs.get(key)).toEqual([expect.objectContaining({ kind: 'submission', key, status: 'ready' })]);
        }
      } finally {
        batchSpy.mockRestore();
      }
    });

    it('resolves a submission key with its author name and topic title', async () => {
      const key = `submissions/${userId}/${crypto.randomUUID()}-img_0042.mov`;
      const submissionId = await insertSubmission({ key, status: 'pending', title: 'Kata, 2nd attempt' });

      const [ref] = (await repo.resolveKeys([key])).get(key)!;
      expect(ref).toMatchObject({
        kind: 'submission',
        key,
        submissionId,
        status: 'pending',
        title: 'Kata, 2nd attempt',
        originalName: 'IMG_0042.MOV',
        contentType: 'video/quicktime',
        sizeBytes: 2048,
        authorId: userId,
        author: { id: userId, name: 'Ada Uploader' },
        topicId,
        topic: { id: topicId, title: 'Kata Basics', status: 'published' },
      });
      expect(ref.kind === 'submission' && Number.isNaN(ref.createdAt.getTime())).toBe(false);
    });

    it('issues no batch for an empty key list', async () => {
      const batchSpy = vi.spyOn(env.DB, 'batch');
      try {
        expect((await repo.resolveKeys([])).size).toBe(0);
        expect(batchSpy).not.toHaveBeenCalled();
      } finally {
        batchSpy.mockRestore();
      }
    });

    it('resolves a media key with its topic title and uploader name', async () => {
      const key = `topics/${topicId}/lesson.pdf`;
      const mediaId = await insertMedia({ key, name: 'Lesson One.pdf' });

      const [ref] = (await repo.resolveKeys([key])).get(key)!;
      expect(ref).toMatchObject({
        kind: 'media',
        key,
        mediaId,
        status: 'ready',
        originalName: 'Lesson One.pdf',
        type: 'application/pdf',
        sizeBytes: 42,
        uploaderId: userId,
        uploader: { id: userId, name: 'Ada Uploader' },
        topicId,
        topic: { id: topicId, title: 'Kata Basics', status: 'published' },
      });
      expect(ref.kind === 'media' && ref.createdAt).toBeInstanceOf(Date);
      expect(ref.kind === 'media' && Number.isNaN(ref.createdAt.getTime())).toBe(false);
    });

    it('leaves a key with no reference out of the result', async () => {
      const refs = await repo.resolveKeys(['topics/nobody/owns-this.pdf']);
      expect(refs.has('topics/nobody/owns-this.pdf')).toBe(false);
    });

    it('returns both references for a key held by a deleted and a ready media row', async () => {
      const key = `topics/${topicId}/shared.pdf`;
      const deletedId = await insertMedia({ key, status: 'deleted' });
      const readyId = await insertMedia({ key, status: 'ready' });

      const list = (await repo.resolveKeys([key])).get(key)!;
      expect(list).toHaveLength(2);
      expect(list.map((r) => r.kind === 'media' && [r.mediaId, r.status]).sort()).toEqual(
        [[deletedId, 'deleted'], [readyId, 'ready']].sort(),
      );
    });

    it('tags flyer_key as event-flyer and flyer_replaced_key as event-flyer-displaced', async () => {
      const liveKey = 'events/e1/flyer-live.png';
      const oldKey = 'events/e1/flyer-old.png';
      const eventId = await insertEvent({
        slug: 'spring-seminar',
        title: 'Spring Seminar',
        flyerStatus: 'pending',
        flyerKey: liveKey,
        replacedKey: oldKey,
      });

      const refs = await repo.resolveKeys([liveKey, oldKey]);
      expect(refs.get(liveKey)).toEqual([
        {
          kind: 'event-flyer',
          key: liveKey,
          eventId,
          title: 'Spring Seminar',
          slug: 'spring-seminar',
          flyerStatus: 'pending',
          flyerName: 'flyer.png',
        },
      ]);
      expect(refs.get(oldKey)).toEqual([
        {
          kind: 'event-flyer-displaced',
          key: oldKey,
          eventId,
          title: 'Spring Seminar',
          slug: 'spring-seminar',
          flyerStatus: 'pending',
          flyerName: 'flyer.png',
        },
      ]);
    });
  });

  describe('existingOwners', () => {
    it('returns only the ids that exist, with their titles', async () => {
      const eventId = await insertEvent({ slug: 'grading-day', title: 'Grading Day', flyerKey: null, flyerStatus: 'none' });
      const missingEvent = crypto.randomUUID();

      const owners = await repo.existingOwners({
        topicIds: [topicId, goneTopicId],
        eventIds: [eventId, missingEvent],
      });
      expect([...owners.topics]).toEqual([[topicId, 'Kata Basics']]);
      expect([...owners.events]).toEqual([[eventId, 'Grading Day']]);
    });

    it('chunks large id sets and handles empty input', async () => {
      const ids = Array.from({ length: 95 }, () => crypto.randomUUID());
      const owners = await repo.existingOwners({ topicIds: [...ids, topicId] });
      expect([...owners.topics.keys()]).toEqual([topicId]);
      expect(owners.events.size).toBe(0);

      const empty = await repo.existingOwners({});
      expect(empty.topics.size).toBe(0);
      expect(empty.events.size).toBe(0);
    });
  });

  describe('listReferencedKeys', () => {
    it('walks every ready/pending media key and non-null flyer key exactly once, omitting deleted media', async () => {
      for (let i = 0; i < 12; i++) await insertMedia({ key: `topics/${topicId}/walk-${i}.pdf`, status: i % 2 ? 'ready' : 'pending' });
      const deletedId = await insertMedia({ key: `topics/${topicId}/walk-deleted.pdf`, status: 'deleted' });
      await insertMedia({ key: `topics/${topicId}/walk-deleted.pdf`, status: 'ready' });
      await insertEvent({ slug: 'walk-a', title: 'Walk A', flyerKey: 'events/a/flyer-1.png' });
      await insertEvent({ slug: 'walk-b', title: 'Walk B', flyerStatus: 'pending', flyerKey: 'events/b/flyer-2.png', replacedKey: 'events/b/flyer-1.png' });
      await insertEvent({ slug: 'walk-c', title: 'Walk C', flyerStatus: 'none' });

      const all = await env.DB
        .prepare(
          `SELECT 'media:' || id || ':' || storage_key AS ref FROM media WHERE status IN ('ready','pending')
           UNION ALL SELECT 'flyer:' || id || ':' || flyer_key FROM events WHERE flyer_key IS NOT NULL
           UNION ALL SELECT 'displaced:' || id || ':' || flyer_replaced_key FROM events WHERE flyer_replaced_key IS NOT NULL`,
        )
        .all<{ ref: string }>();
      const expected = all.results.map((r) => r.ref).sort();
      expect(expected).toHaveLength(13 + 3);

      const { items, pages } = await walkAll(repo, 5);
      const seen = items.map((r) =>
        r.kind === 'media'
          ? `media:${r.mediaId}:${r.key}`
          : `${r.kind === 'event-flyer' ? 'flyer' : 'displaced'}:${r.eventId}:${r.key}`,
      ).sort();

      expect(pages).toBeGreaterThan(1);
      expect(seen).toEqual(expected);
      expect(new Set(seen).size).toBe(seen.length);
      expect(items.some((r) => r.kind === 'media' && r.mediaId === deletedId)).toBe(false);
    });

    it('walks ready/pending submission keys exactly once and skips removed tombstones', async () => {
      const live: string[] = [];
      for (let i = 0; i < 7; i++) {
        live.push(await insertSubmission({
          key: `submissions/${userId}/walk-${i}.mp4`,
          status: i % 2 ? 'ready' : 'pending',
        }));
      }
      const removedId = await insertSubmission({ key: null, status: 'removed' });
      await insertMedia({ key: `topics/${topicId}/walk-with-submissions.pdf` });

      const { items, pages } = await walkAll(repo, 3);
      const submissions = items.filter((r) => r.kind === 'submission');

      expect(pages).toBeGreaterThan(1);
      expect(items).toHaveLength(8);
      expect(submissions.map((r) => r.kind === 'submission' && r.submissionId).sort()).toEqual([...live].sort());
      expect(submissions.some((r) => r.kind === 'submission' && r.submissionId === removedId)).toBe(false);
    });

    it('returns an empty last page without a cursor when nothing is referenced', async () => {
      await expect(repo.listReferencedKeys({ limit: 10 })).resolves.toEqual({ items: [] });
    });

    it('rejects a malformed cursor', async () => {
      await expect(repo.listReferencedKeys({ cursor: 'not-a-cursor', limit: 5 }))
        .rejects.toBeInstanceOf(InvalidStorageReferenceCursorError);
    });
  });

  describe('topic drift', () => {
    it('resolves with topic: null when the topic row is gone, keeping the topic id', async () => {
      // D1 always enforces foreign keys, so a media row whose topic is gone
      // (legacy data written before enforcement, or a manual repair) cannot be
      // inserted against the migrated schema. Rebuild `media` without its FK
      // for this test only — storage isolation discards the change afterwards.
      await env.DB.batch([
        env.DB.prepare('DROP TABLE media'),
        env.DB.prepare(
          `CREATE TABLE media (
             id TEXT NOT NULL PRIMARY KEY, topic_node_id TEXT NOT NULL, uploaded_by TEXT NOT NULL,
             storage_key TEXT NOT NULL, original_name TEXT NOT NULL, type TEXT NOT NULL,
             size_bytes INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
             created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
        ),
      ]);
      const key = `topics/${goneTopicId}/stranded.pdf`;
      await insertMedia({ key, topic: goneTopicId });

      const [ref] = (await repo.resolveKeys([key])).get(key)!;
      expect(ref).toMatchObject({ kind: 'media', topicId: goneTopicId, topic: null });
    });
  });
});
