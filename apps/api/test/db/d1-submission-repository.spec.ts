import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { D1SubmissionRepository } from '@api/adapters/db/d1-submission-repository';
import { decodeCursor, encodeCursor } from '@api/routes/_shared/cursor';
import type { CreatePendingSubmission, SubmissionQuota, SubmissionRecord } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { applyMigrations } from '../helpers/apply-migrations';

const { PENDING, READY, REMOVED } = Entities.Config.SubmissionStatus;
const { PRIVATE, SHARED } = Entities.Config.ShareVisibility;

const QUOTA: SubmissionQuota = { perTopicMax: 10, storagePerStudentBytes: 1_000_000 };

let repo: D1SubmissionRepository;

async function user(name = 'Student'): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB
    .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .bind(id, name, `${id}@test.local`, 'hash')
    .run();
  return id;
}

async function topic(title = 'Topic'): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO topic_nodes (id, title) VALUES (?, ?)').bind(id, title).run();
  return id;
}

function input(authorId: string, topicNodeId: string, over: Partial<CreatePendingSubmission> = {}): CreatePendingSubmission {
  const id = over.id ?? crypto.randomUUID();
  return {
    id,
    topicNodeId,
    authorId,
    title: 'Kata',
    description: '',
    storageKey: `submissions/${authorId}/${id}-kata.mp4`,
    originalName: 'kata.mp4',
    contentType: 'video/mp4',
    sizeBytes: 100,
    visibility: PRIVATE,
    ...over,
  };
}

async function create(
  authorId: string,
  topicNodeId: string,
  over: Partial<CreatePendingSubmission> = {},
  quota: SubmissionQuota = QUOTA,
): Promise<SubmissionRecord> {
  const r = await repo.createPending(input(authorId, topicNodeId, over), quota);
  if (!r) throw new Error('fixture insert refused by quota');
  return r;
}

async function ready(authorId: string, topicNodeId: string, over: Partial<CreatePendingSubmission> = {}) {
  const r = await create(authorId, topicNodeId, over);
  return repo.markReady(r.id);
}

async function setCreatedAt(id: string, value: string): Promise<void> {
  await env.DB.prepare('UPDATE topic_submissions SET created_at = ? WHERE id = ?').bind(value, id).run();
}

async function countRows(authorId: string): Promise<number> {
  const row = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM topic_submissions WHERE author_id = ?')
    .bind(authorId)
    .first<{ n: number }>();
  return row!.n;
}

describe('D1SubmissionRepository', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    repo = new D1SubmissionRepository(env.DB);
  });

  // ── create / find ──────────────────────────────────────────────────────────

  describe('createPending', () => {
    it('inserts a pending private row with the author name joined', async () => {
      const author = await user('Ana');
      const t = await topic();
      const r = await create(author, t, { title: 'Hello', description: 'desc' });

      expect(r).toMatchObject({
        topicNodeId: t,
        authorId: author,
        authorName: 'Ana',
        title: 'Hello',
        description: 'desc',
        status: PENDING,
        visibility: PRIVATE,
        sharedAt: null,
        moderatedAt: null,
        removedAt: null,
        removedByName: null,
        sizeBytes: 100,
        contentType: 'video/mp4',
      });
      expect(await repo.findById(r.id)).toEqual(r);
    });

    it('stamps sharedAt when created shared', async () => {
      const r = await create(await user(), await topic(), { visibility: SHARED });
      expect(r.visibility).toBe(SHARED);
      expect(r.sharedAt).not.toBeNull();
    });

    it('two concurrent inserts at limit - 1 produce exactly one row', async () => {
      const author = await user();
      const t = await topic();
      const quota = { perTopicMax: 3, storagePerStudentBytes: 1_000_000 };
      await create(author, t, {}, quota);
      await create(author, t, {}, quota);

      const results = await Promise.all([
        repo.createPending(input(author, t), quota),
        repo.createPending(input(author, t), quota),
      ]);

      expect(results.filter(r => r !== null)).toHaveLength(1);
      expect(await countRows(author)).toBe(3);
    });

    it('concurrent inserts crossing the byte quota admit only what fits', async () => {
      const author = await user();
      const quota = { perTopicMax: 100, storagePerStudentBytes: 250 };
      const results = await Promise.all(
        [await topic(), await topic(), await topic()].map(t => repo.createPending(input(author, t), quota)),
      );
      expect(results.filter(r => r !== null)).toHaveLength(2);
      expect((await repo.usage(author)).bytes).toBe(200);
    });

    it('an insert crossing the byte quota inserts nothing; exactly at the limit is accepted', async () => {
      const author = await user();
      const t = await topic();
      const quota = { perTopicMax: 10, storagePerStudentBytes: 300 };
      await create(author, t, { sizeBytes: 200 }, quota);

      expect(await repo.createPending(input(author, await topic(), { sizeBytes: 101 }), quota)).toBeNull();
      expect(await countRows(author)).toBe(1);

      expect(await repo.createPending(input(author, t, { sizeBytes: 100 }), quota)).not.toBeNull();
    });

    it('counts pending rows and ignores removed rows in both guards', async () => {
      const author = await user();
      const admin = await user('Admin');
      const t = await topic();
      const quota = { perTopicMax: 2, storagePerStudentBytes: 250 };

      const a = await create(author, t, {}, quota); // pending, counts
      const b = await create(author, t, {}, quota); // pending, counts
      expect(await repo.createPending(input(author, t, { sizeBytes: 1 }), quota)).toBeNull(); // count
      expect(await repo.createPending(input(author, await topic(), { sizeBytes: 51 }), quota)).toBeNull(); // bytes

      await repo.markRemoved(a.id, admin);
      await repo.markReady(b.id);
      const c = await repo.createPending(input(author, t, { sizeBytes: 150 }), quota);
      expect(c).not.toBeNull(); // removed row freed one slot and 100 bytes
    });

    it('scopes the per-topic count to the author', async () => {
      const t = await topic();
      const quota = { perTopicMax: 1, storagePerStudentBytes: 1_000 };
      await create(await user(), t, {}, quota);
      expect(await repo.createPending(input(await user(), t), quota)).not.toBeNull();
    });
  });

  it('findById returns null for an unknown id', async () => {
    expect(await repo.findById(crypto.randomUUID())).toBeNull();
  });

  it('usage sums pending + ready across topics, counts the given topic, excludes removed', async () => {
    const author = await user();
    const admin = await user();
    const t1 = await topic();
    const t2 = await topic();
    await create(author, t1, { sizeBytes: 10 });
    await ready(author, t1, { sizeBytes: 20 });
    await create(author, t2, { sizeBytes: 40 });
    const gone = await ready(author, t1, { sizeBytes: 1000 });
    await repo.markRemoved(gone.id, admin);

    expect(await repo.usage(author, t1)).toEqual({ topicCount: 2, bytes: 70 });
    expect(await repo.usage(author)).toEqual({ topicCount: 0, bytes: 70 });
    expect(await repo.usage(await user(), t1)).toEqual({ topicCount: 0, bytes: 0 });
  });

  // ── state transitions ─────────────────────────────────────────────────────

  it('markReady moves pending -> ready and is idempotent', async () => {
    const r = await create(await user(), await topic());
    const once = await repo.markReady(r.id);
    expect(once.status).toBe(READY);
    const twice = await repo.markReady(r.id);
    expect(twice.status).toBe(READY);
  });

  it('markReady does not resurrect a removed row', async () => {
    const r = await ready(await user(), await topic());
    await repo.markRemoved(r.id, await user());
    expect((await repo.markReady(r.id)).status).toBe(REMOVED);
  });

  it('markReady throws for an unknown id', async () => {
    await expect(repo.markReady(crypto.randomUUID())).rejects.toThrow(/not found/);
  });

  describe('updateMeta', () => {
    it('updates only the given fields', async () => {
      const r = await ready(await user(), await topic(), { title: 'Old', description: 'keep' });
      const u = await repo.updateMeta(r.id, { title: 'New' });
      expect(u).toMatchObject({ title: 'New', description: 'keep', visibility: PRIVATE });
    });

    it('stamps sharedAt when shared, keeps it on re-share, clears it when private', async () => {
      const r = await ready(await user(), await topic());
      const shared = await repo.updateMeta(r.id, { visibility: SHARED });
      expect(shared.visibility).toBe(SHARED);
      expect(shared.sharedAt).not.toBeNull();

      await env.DB.prepare("UPDATE topic_submissions SET shared_at = '2020-01-01 00:00:00' WHERE id = ?").bind(r.id).run();
      const again = await repo.updateMeta(r.id, { visibility: SHARED, title: 'T2' });
      expect(again.sharedAt).toBe('2020-01-01 00:00:00');

      const priv = await repo.updateMeta(r.id, { visibility: PRIVATE });
      expect(priv).toMatchObject({ visibility: PRIVATE, sharedAt: null });
    });

    it('throws for an unknown id', async () => {
      await expect(repo.updateMeta(crypto.randomUUID(), { title: 'x' })).rejects.toThrow();
    });
  });

  it('delete removes the row', async () => {
    const r = await create(await user(), await topic());
    await repo.delete(r.id);
    expect(await repo.findById(r.id)).toBeNull();
  });

  it('markRemoved turns the row into a tombstone', async () => {
    const admin = await user('Boss');
    const r = await ready(await user(), await topic(), { description: 'secret', visibility: SHARED });
    const t = await repo.markRemoved(r.id, admin);
    expect(t).toMatchObject({
      status: REMOVED,
      storageKey: null,
      description: '',
      visibility: PRIVATE,
      sharedAt: null,
      removedBy: admin,
      removedByName: 'Boss',
      title: r.title,
    });
    expect(t.removedAt).not.toBeNull();
  });

  describe('setModeration', () => {
    it('sets the flag and forces private; null clears it', async () => {
      const staff = await user();
      const r = await ready(await user(), await topic(), { visibility: SHARED });
      const m = await repo.setModeration(r.id, staff);
      expect(m).toMatchObject({ moderatedBy: staff, visibility: PRIVATE, sharedAt: null });
      expect(m!.moderatedAt).not.toBeNull();

      const cleared = await repo.setModeration(r.id, null);
      expect(cleared).toMatchObject({ moderatedAt: null, moderatedBy: null, visibility: PRIVATE });
    });

    it('returns null for an unknown id', async () => {
      expect(await repo.setModeration(crypto.randomUUID(), await user())).toBeNull();
    });
  });

  // ── move ──────────────────────────────────────────────────────────────────

  describe('move', () => {
    it('moves the first two of three into a topic with two free slots and refuses the third with quota', async () => {
      const author = await user();
      const staff = await user();
      const source = await topic();
      const target = await topic();
      await ready(author, target);
      await ready(author, target); // target holds 2 of 4

      const a = await ready(author, source, { visibility: SHARED });
      const b = await ready(author, source);
      const c = await ready(author, source);
      await repo.setModeration(b.id, staff);

      const result = await repo.move(author, [a.id, b.id, c.id], target, 4);

      expect(result.moved.map(m => m.id)).toEqual([a.id, b.id]);
      expect(result.refused).toEqual([{ id: c.id, reason: 'quota' }]);

      const [ma, mb] = result.moved;
      expect(ma).toMatchObject({ topicNodeId: target, visibility: PRIVATE, sharedAt: null, storageKey: a.storageKey });
      expect(mb.moderatedAt).not.toBeNull();
      expect(mb.moderatedBy).toBe(staff);
      expect(mb.storageKey).toBe(b.storageKey);
      expect((await repo.findById(c.id))!.topicNodeId).toBe(source);
    });

    it('refuses pending, removed, foreign, unknown and same-topic ids with their reasons, in order', async () => {
      const author = await user();
      const other = await user();
      const source = await topic();
      const target = await topic();

      const pending = await create(author, source);
      const removed = await ready(author, source);
      await repo.markRemoved(removed.id, other);
      const foreign = await ready(other, source);
      const already = await ready(author, target);
      const unknown = crypto.randomUUID();
      const ok = await ready(author, source);

      const result = await repo.move(
        author,
        [pending.id, removed.id, foreign.id, unknown, already.id, ok.id],
        target,
        10,
      );

      expect(result.moved.map(m => m.id)).toEqual([ok.id]);
      expect(result.refused).toEqual([
        { id: pending.id, reason: 'not_ready' },
        { id: removed.id, reason: 'not_ready' },
        { id: foreign.id, reason: 'not_found' },
        { id: unknown, reason: 'not_found' },
        { id: already.id, reason: 'same_topic' },
      ]);
      expect((await repo.findById(foreign.id))!.topicNodeId).toBe(source);
    });

    it('does not count removed rows on the target', async () => {
      const author = await user();
      const target = await topic();
      const tomb = await ready(author, target);
      await repo.markRemoved(tomb.id, await user());
      const r = await ready(author, await topic());
      const result = await repo.move(author, [r.id], target, 1);
      expect(result.moved.map(m => m.id)).toEqual([r.id]);
    });

    it('collapses duplicate ids and handles an empty list', async () => {
      const author = await user();
      const target = await topic();
      const r = await ready(author, await topic());
      const result = await repo.move(author, [r.id, r.id], target, 10);
      expect(result.moved.map(m => m.id)).toEqual([r.id]);
      expect(result.refused).toEqual([]);
      expect(await repo.move(author, [], target, 10)).toEqual({ moved: [], refused: [] });
    });
  });

  // ── listings ──────────────────────────────────────────────────────────────

  describe('listByTopic', () => {
    const page = { after: null, limit: 20 };

    /** One row per status × visibility for `me`, plus the same for `other`. */
    async function matrix() {
      const me = await user('Me');
      const other = await user('Other');
      const admin = await user('Admin');
      const t = await topic();
      const rows: Record<string, SubmissionRecord> = {};
      for (const [who, owner] of [['me', me], ['other', other]] as const) {
        for (const vis of [PRIVATE, SHARED]) {
          rows[`${who}-pending-${vis}`] = await create(owner, t, { visibility: vis });
          rows[`${who}-ready-${vis}`] = await ready(owner, t, { visibility: vis });
          const rem = await ready(owner, t, { visibility: vis });
          await repo.markRemoved(rem.id, admin);
          // Force the tombstone back to the matrix's visibility to prove the status filter alone excludes it.
          await env.DB.prepare('UPDATE topic_submissions SET visibility = ? WHERE id = ?').bind(vis, rem.id).run();
          rows[`${who}-removed-${vis}`] = rem;
        }
      }
      return { me, other, t, rows };
    }

    it('mine returns every status of the viewer only', async () => {
      const { me, t, rows } = await matrix();
      const { data } = await repo.listByTopic(t, { viewerId: me, scope: 'mine', sharingEnabled: true, page });
      const expected = Object.entries(rows).filter(([k]) => k.startsWith('me-')).map(([, r]) => r.id);
      expect(data.map(r => r.id).sort()).toEqual(expected.sort());
    });

    it('class returns only ready + shared rows, whoever the viewer is', async () => {
      const { me, t, rows } = await matrix();
      const { data } = await repo.listByTopic(t, { viewerId: me, scope: 'class', sharingEnabled: true, page });
      expect(data.map(r => r.id).sort()).toEqual(
        [rows[`me-ready-${SHARED}`].id, rows[`other-ready-${SHARED}`].id].sort(),
      );
      expect(data.every(r => r.status === READY && r.visibility === SHARED)).toBe(true);
    });

    it('class returns nothing when sharing is disabled', async () => {
      const { me, t } = await matrix();
      expect(
        await repo.listByTopic(t, { viewerId: me, scope: 'class', sharingEnabled: false, page }),
      ).toEqual({ data: [], next: null });
    });

    it('all returns ready + removed rows, never pending', async () => {
      const { me, t, rows } = await matrix();
      const { data } = await repo.listByTopic(t, { viewerId: me, scope: 'all', sharingEnabled: true, page });
      const expected = Object.entries(rows).filter(([k]) => !k.includes('-pending-')).map(([, r]) => r.id);
      expect(data.map(r => r.id).sort()).toEqual(expected.sort());
    });

    it('orders newest first and paginates through an opaque cursor without gaps or duplicates', async () => {
      const me = await user();
      const t = await topic();
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) {
        const r = await create(me, t);
        // Two rows share each timestamp so the id tie-breaker is exercised.
        await setCreatedAt(r.id, `2026-01-0${1 + Math.floor(i / 2)} 10:00:00`);
        ids.push(r.id);
      }

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const decoded = decodeCursor(cursor);
        if (!decoded.ok) throw new Error('bad cursor');
        const res = await repo.listByTopic(t, {
          viewerId: me,
          scope: 'mine',
          sharingEnabled: true,
          page: { after: decoded.after, limit: 3 },
        });
        expect(res.data.length).toBeLessThanOrEqual(3);
        seen.push(...res.data.map(r => r.id));
        if (!res.next) break;
        cursor = encodeCursor(res.next);
      }

      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
      const all = await Promise.all(seen.map(id => repo.findById(id)));
      const keys = all.map(r => `${r!.createdAt}|${r!.id}`);
      expect(keys).toEqual([...keys].sort().reverse());
    });

    it('class is ordered by sharedAt, and a crafted cursor cannot widen the scope', async () => {
      const me = await user();
      const other = await user();
      const t = await topic();
      const early = await ready(other, t, { visibility: SHARED });
      const late = await ready(other, t, { visibility: SHARED });
      const hidden = await ready(other, t); // private
      await env.DB.prepare("UPDATE topic_submissions SET shared_at = '2026-01-01 00:00:00' WHERE id = ?").bind(early.id).run();
      await env.DB.prepare("UPDATE topic_submissions SET shared_at = '2026-02-01 00:00:00' WHERE id = ?").bind(late.id).run();

      const first = await repo.listByTopic(t, { viewerId: me, scope: 'class', sharingEnabled: true, page });
      expect(first.data.map(r => r.id)).toEqual([late.id, early.id]);

      const crafted = decodeCursor(encodeCursor({ sortKey: '9999-12-31 23:59:59', id: 'ffffffff' }));
      if (!crafted.ok) throw new Error('crafted cursor should decode');
      const res = await repo.listByTopic(t, {
        viewerId: me,
        scope: 'class',
        sharingEnabled: true,
        page: { after: crafted.after, limit: 50 },
      });
      expect(res.data.map(r => r.id)).not.toContain(hidden.id);
      expect(res.data.map(r => r.id)).toEqual([late.id, early.id]);
    });

    it('is confined to the topic', async () => {
      const me = await user();
      const t1 = await topic();
      await ready(me, await topic());
      const r = await ready(me, t1);
      const { data } = await repo.listByTopic(t1, { viewerId: me, scope: 'mine', sharingEnabled: true, page });
      expect(data.map(x => x.id)).toEqual([r.id]);
    });
  });

  describe('listByAuthor', () => {
    it('self lists every status with the topic title; staff lists ready + removed only', async () => {
      const author = await user();
      const t1 = await topic('Kihon');
      const t2 = await topic('Kata');
      const p = await create(author, t1);
      const r = await ready(author, t2);
      const gone = await ready(author, t1);
      await repo.markRemoved(gone.id, await user());
      await ready(await user(), t1); // someone else's

      const self = await repo.listByAuthor(author, { scope: 'self', page: { after: null, limit: 20 } });
      expect(self.data.map(x => x.id).sort()).toEqual([p.id, r.id, gone.id].sort());
      expect(self.data.find(x => x.id === r.id)!.topicTitle).toBe('Kata');
      expect(self.next).toBeNull();

      const staff = await repo.listByAuthor(author, { scope: 'staff', page: { after: null, limit: 20 } });
      expect(staff.data.map(x => x.id).sort()).toEqual([r.id, gone.id].sort());
    });

    it('paginates', async () => {
      const author = await user();
      const t = await topic();
      for (let i = 0; i < 3; i++) await create(author, t);
      const first = await repo.listByAuthor(author, { scope: 'self', page: { after: null, limit: 2 } });
      expect(first.data).toHaveLength(2);
      expect(first.next).not.toBeNull();
      const second = await repo.listByAuthor(author, { scope: 'self', page: { after: first.next, limit: 2 } });
      expect(second.data).toHaveLength(1);
      expect(second.next).toBeNull();
    });
  });

  it('topicSummary counts mine (non-removed), class (ready + shared) and total (ready + removed)', async () => {
    const me = await user();
    const other = await user();
    const t = await topic();
    await create(me, t); // pending: mine only
    await ready(me, t, { visibility: SHARED }); // mine, class, total
    await ready(other, t, { visibility: SHARED }); // class, total
    await ready(other, t); // total
    const gone = await ready(me, t);
    await repo.markRemoved(gone.id, other); // total

    expect(await repo.topicSummary(t, me)).toEqual({ mine: 2, class: 2, total: 4 });
    expect(await repo.topicSummary(await topic(), me)).toEqual({ mine: 0, class: 0, total: 0 });
  });

  it('listStalePending returns pending rows older than the threshold, oldest first, limited', async () => {
    const author = await user();
    const t = await topic();
    const old1 = await create(author, t);
    const old2 = await create(author, t);
    const fresh = await create(author, t);
    const oldReady = await ready(author, t);
    await env.DB.prepare("UPDATE topic_submissions SET created_at = datetime('now', '-26 hours') WHERE id = ?").bind(old1.id).run();
    await env.DB.prepare("UPDATE topic_submissions SET created_at = datetime('now', '-25 hours') WHERE id = ?").bind(old2.id).run();
    await env.DB.prepare("UPDATE topic_submissions SET created_at = datetime('now', '-1 hours') WHERE id = ?").bind(fresh.id).run();
    await env.DB.prepare("UPDATE topic_submissions SET created_at = datetime('now', '-48 hours') WHERE id = ?").bind(oldReady.id).run();

    const stale = await repo.listStalePending(24, 100);
    const mine = stale.filter(r => r.authorId === author).map(r => r.id);
    expect(mine).toEqual([old1.id, old2.id]);

    const limited = await repo.listStalePending(24, 1);
    expect(limited).toHaveLength(1);
  });
});
