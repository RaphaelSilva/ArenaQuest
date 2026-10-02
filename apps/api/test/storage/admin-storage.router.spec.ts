import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { buildContainer } from '@api/container';
import { AdminStorageController } from '@api/controllers/admin-storage.controller';
import { ORPHAN_GRACE_MS } from '@arenaquest/shared/domain/storage';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

/**
 * `/v1/admin/storage` over HTTP, against miniflare D1 and R2.
 *
 * Covers what only the full stack can: the admin-only role matrix on every
 * route, query validation, and the resolver + classification wired end to
 * end. The 24 h `stale` flag needs a back-dated object and is covered in the
 * controller spec. A miniflare R2 object cannot be back-dated either, so the
 * `DELETE /object` success path runs the controller over the real D1 + R2
 * adapters with a clock moved 25 h ahead instead.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const ADMIN_ID = 'storage-admin';
const TOPIC = crypto.randomUUID();
const GONE_TOPIC = crypto.randomUUID();
const EVENT = crypto.randomUUID();

const key = {
  linked: `topics/${TOPIC}/${crypto.randomUUID()}-lesson.pdf`,
  pending: `topics/${TOPIC}/${crypto.randomUUID()}-draft.pdf`,
  deletedRow: `topics/${TOPIC}/${crypto.randomUUID()}-old.pdf`,
  rowGone: `topics/${TOPIC}/${crypto.randomUUID()}-stray.pdf`,
  topicGone: `topics/${GONE_TOPIC}/${crypto.randomUUID()}-lost.pdf`,
  flyer: `events/${EVENT}/flyer-${crypto.randomUUID()}-poster.png`,
  displaced: `events/${EVENT}/flyer-${crypto.randomUUID()}-old-poster.png`,
  unknown: 'misc/notes.txt',
  /** Referenced by a `ready` row but never put. */
  missing: `topics/${TOPIC}/${crypto.randomUUID()}-ghost.pdf`,
};

const ROUTES = [
  '/browse?prefix=',
  `/object?key=${encodeURIComponent(key.linked)}`,
  '/audit',
  '/audit/missing',
];

let adminToken: string;
let creatorToken: string;
let studentToken: string;

async function insertMedia(storageKey: string, status: 'pending' | 'ready' | 'deleted', name: string) {
  await env.DB
    .prepare(
      `INSERT INTO media (id, topic_node_id, uploaded_by, storage_key, original_name, type, size_bytes, status)
       VALUES (?, ?, ?, ?, ?, 'application/pdf', 4, ?)`,
    )
    .bind(crypto.randomUUID(), TOPIC, ADMIN_ID, storageKey, name, status)
    .run();
}

beforeAll(async () => {
  await applyMigrations(env.DB);
  await env.DB
    .prepare("INSERT INTO users (id, name, email, password_hash) VALUES (?, 'Storage Admin', 'sa@storage.test', 'hash')")
    .bind(ADMIN_ID)
    .run();
  await env.DB
    .prepare("INSERT INTO topic_nodes (id, title, status) VALUES (?, 'Kata Basics', 'published')")
    .bind(TOPIC)
    .run();
  await env.DB
    .prepare(
      `INSERT INTO events (id, slug, title, starts_at, flyer_status, flyer_key, flyer_name, flyer_replaced_key, created_by)
       VALUES (?, 'summer', 'Summer Seminar', '2026-10-01 10:00:00', 'ready', ?, 'poster.png', ?, ?)`,
    )
    .bind(EVENT, key.flyer, key.displaced, ADMIN_ID)
    .run();

  await insertMedia(key.linked, 'ready', 'Lesson One.pdf');
  await insertMedia(key.pending, 'pending', 'Draft.pdf');
  await insertMedia(key.deletedRow, 'deleted', 'Old.pdf');
  await insertMedia(key.missing, 'ready', 'Ghost.pdf');

  for (const [name, k] of Object.entries(key)) {
    if (name === 'missing') continue;
    await env.R2.put(k, 'data', { httpMetadata: { contentType: 'application/pdf' } });
  }

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [adminToken, creatorToken, studentToken] = await Promise.all([
    adapter.signAccessToken({ sub: ADMIN_ID, email: 'sa@storage.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: 'cc', email: 'cc@storage.test', roles: ['content_creator'] }),
    adapter.signAccessToken({ sub: 'st', email: 'st@storage.test', roles: ['student'] }),
  ]);
});

async function send(method: 'GET' | 'DELETE', path: string, token: string | null = adminToken): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const request = new IncomingRequest(`http://example.com${v1(`/admin/storage${path}`)}`, { method, headers });
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const get = (path: string, token: string | null = adminToken) => send('GET', path, token);
const del = (path: string, token: string | null = adminToken) => send('DELETE', path, token);

async function jsonOf<T>(res: Response, expected = 200): Promise<T> {
  if (res.status !== expected) throw new Error(`expected ${expected}, got ${res.status}: ${await res.text()}`);
  return res.json<T>();
}

type Obj = { key: string; status: string; stale: boolean; hint: string | null; references: { kind: string }[] };
type Folder = { prefix: string; owner: { kind: string; title: string } | null; ownerGone: boolean };
type Browse = { prefix: string; folders: Folder[]; objects: Obj[]; nextCursor?: string };

describe('/v1/admin/storage — role matrix', () => {
  it.each(ROUTES)('%s → 401 without a token', async (path) => {
    expect((await get(path, null)).status).toBe(401);
  });

  it.each(ROUTES)('%s → 403 for content_creator', async (path) => {
    expect((await get(path, creatorToken)).status).toBe(403);
  });

  it.each(ROUTES)('%s → 403 for student', async (path) => {
    expect((await get(path, studentToken)).status).toBe(403);
  });

  it.each(ROUTES)('%s → 200 for admin', async (path) => {
    expect((await get(path)).status).toBe(200);
  });
});

describe('GET /browse', () => {
  it('labels one folder per topic and flags a deleted topic as gone', async () => {
    const body = await jsonOf<Browse>(await get('/browse?prefix=topics/'));
    expect(body.objects).toEqual([]);
    const byPrefix = new Map(body.folders.map((f) => [f.prefix, f]));
    expect(byPrefix.get(`topics/${TOPIC}/`)).toMatchObject({ owner: { kind: 'topic', title: 'Kata Basics' }, ownerGone: false });
    expect(byPrefix.get(`topics/${GONE_TOPIC}/`)).toMatchObject({ owner: null, ownerGone: true });
    expect(body.folders).toHaveLength(2);
  });

  it('classifies each object in a topic folder', async () => {
    const body = await jsonOf<Browse>(await get(`/browse?prefix=${encodeURIComponent(`topics/${TOPIC}/`)}`));
    const status = Object.fromEntries(body.objects.map((o) => [o.key, [o.status, o.hint, o.stale]]));
    expect(status).toEqual({
      [key.linked]: ['linked', null, false],
      [key.pending]: ['pending', null, false],
      [key.deletedRow]: ['deleted-row', null, false],
      [key.rowGone]: ['orphan', 'row-gone', false],
    });
  });

  it('classifies flyers and the remaining orphan hints', async () => {
    const events = await jsonOf<Browse>(await get(`/browse?prefix=${encodeURIComponent(`events/${EVENT}/`)}`));
    expect(Object.fromEntries(events.objects.map((o) => [o.key, o.status]))).toEqual({
      [key.flyer]: 'linked',
      [key.displaced]: 'displaced',
    });
    const gone = await jsonOf<Browse>(await get(`/browse?prefix=${encodeURIComponent(`topics/${GONE_TOPIC}/`)}`));
    expect(gone.objects).toMatchObject([{ key: key.topicGone, status: 'orphan', hint: 'owner-topic-gone' }]);
    const misc = await jsonOf<Browse>(await get('/browse?prefix=misc/'));
    expect(misc.objects).toMatchObject([{ key: key.unknown, status: 'orphan', hint: 'unknown-shape' }]);
  });

  it('defaults to the bucket root', async () => {
    const body = await jsonOf<Browse>(await get('/browse'));
    expect(body.prefix).toBe('');
    expect(body.folders.map((f) => f.prefix).sort()).toEqual(['events/', 'misc/', 'topics/']);
  });

  it('rejects a prefix without a trailing slash and an out-of-range limit', async () => {
    expect((await get('/browse?prefix=topics')).status).toBe(400);
    expect((await get('/browse?prefix=topics/&limit=0')).status).toBe(400);
    expect((await get('/browse?prefix=topics/&limit=1001')).status).toBe(400);
  });
});

describe('GET /object', () => {
  it('returns references, classification and a presigned URL for a known key', async () => {
    const body = await jsonOf<Obj & { downloadUrl: string; downloadUrlExpiresAt: string }>(
      await get(`/object?key=${encodeURIComponent(key.linked)}`),
    );
    expect(body).toMatchObject({ key: key.linked, status: 'linked', hint: null });
    expect(body.references).toMatchObject([{ kind: 'media', originalName: 'Lesson One.pdf', topic: { title: 'Kata Basics' } }]);
    expect(body.downloadUrl).toContain('X-Amz-Expires=300');
    expect(Date.parse(body.downloadUrlExpiresAt)).toBeGreaterThan(Date.now());
  });

  it('returns 404 for an unknown key and 400 without a key', async () => {
    expect((await get(`/object?key=${encodeURIComponent('topics/nope/x.pdf')}`)).status).toBe(404);
    expect((await get('/object')).status).toBe(400);
  });
});

describe('GET /audit', () => {
  it('returns every non-linked object, none of the linked ones, and pages to the end', async () => {
    const seen: string[] = [];
    let scanned = 0;
    let cursor: string | undefined;
    let pages = 0;
    do {
      const qs = cursor ? `?limit=3&cursor=${encodeURIComponent(cursor)}` : '?limit=3';
      const body = await jsonOf<{ objects: Obj[]; scanned: number; nextCursor?: string }>(await get(`/audit${qs}`));
      scanned += body.scanned;
      seen.push(...body.objects.map((o) => o.key));
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 20);

    expect(scanned).toBe(Object.keys(key).length - 1);
    expect(seen.sort()).toEqual(
      [key.pending, key.deletedRow, key.rowGone, key.topicGone, key.displaced, key.unknown].sort(),
    );
  });

  it('rejects a limit above 1000', async () => {
    expect((await get('/audit?limit=1001')).status).toBe(400);
  });
});

describe('GET /audit/missing', () => {
  it('returns exactly the ready row whose object was never put', async () => {
    const body = await jsonOf<{ items: { key: string; status: string; reference: { kind: string } }[]; nextCursor?: string }>(
      await get('/audit/missing'),
    );
    expect(body.items).toMatchObject([{ key: key.missing, status: 'missing-object', reference: { kind: 'media' } }]);
    expect(body.nextCursor).toBeUndefined();
  });

  it('rejects a malformed cursor with 400 and a limit above 50', async () => {
    expect((await get('/audit/missing?cursor=not-a-cursor')).status).toBe(400);
    expect((await get('/audit/missing?limit=51')).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /object (Task 06)
// ---------------------------------------------------------------------------

/** Every row of every table an object key can point at — compared around each delete. */
async function dbSnapshot() {
  const tables = ['media', 'events', 'topic_nodes', 'users'] as const;
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    out[t] = (await env.DB.prepare(`SELECT * FROM ${t} ORDER BY id`).all()).results;
  }
  return out;
}

/** DELETE through the full worker and assert no D1 row changed. */
async function delUnchanged(path: string, token: string | null = adminToken): Promise<Response> {
  const before = await dbSnapshot();
  const res = await del(path, token);
  expect(await dbSnapshot()).toEqual(before);
  return res;
}

const objectPath = (k: string) => `/object?key=${encodeURIComponent(k)}`;

describe('DELETE /object - role matrix', () => {
  it('401 without a token, 403 for content_creator and student; the object stays', async () => {
    expect((await delUnchanged(objectPath(key.rowGone), null)).status).toBe(401);
    expect((await delUnchanged(objectPath(key.rowGone), creatorToken)).status).toBe(403);
    expect((await delUnchanged(objectPath(key.rowGone), studentToken)).status).toBe(403);
    expect(await env.R2.head(key.rowGone)).not.toBeNull();
  });
});

describe('DELETE /object', () => {
  type Conflict = { error: string; reason: string; object: Obj };

  it.each([
    ['linked media', 'linked', 'linked', 'not-deletable-status'],
    ['linked flyer', 'flyer', 'linked', 'not-deletable-status'],
    ['pending upload', 'pending', 'pending', 'not-deletable-status'],
    ['displaced flyer', 'displaced', 'displaced', 'not-deletable-status'],
    ['fresh orphan', 'rowGone', 'orphan', 'within-grace-window'],
    ['fresh deleted-row', 'deletedRow', 'deleted-row', 'within-grace-window'],
  ] as const)('409 for a %s, with the current classification; object and rows unchanged', async (_, name, status, reason) => {
    const body = await jsonOf<Conflict>(await delUnchanged(objectPath(key[name])), 409);
    expect(body).toMatchObject({ error: 'StorageObjectNotDeletable', reason, object: { key: key[name], status } });
    expect(await env.R2.head(key[name])).not.toBeNull();
  });

  it('404 for an absent key, 400 without a key', async () => {
    const body = await jsonOf<{ error: string }>(await delUnchanged(objectPath('topics/nope/x.pdf')), 404);
    expect(body).toEqual({ error: 'NotFound' });
    expect((await delUnchanged('/object')).status).toBe(400);
  });
});

describe('AdminStorageController.deleteObject over real D1 + R2, 25 h later', () => {
  const HOUR = 60 * 60 * 1000;
  const oldOrphan = `topics/${TOPIC}/${crypto.randomUUID()}-old-stray.pdf`;
  const oldDeletedRow = `topics/${TOPIC}/${crypto.randomUUID()}-old-removed.pdf`;
  let controller: AdminStorageController;

  beforeAll(async () => {
    await insertMedia(oldDeletedRow, 'deleted', 'Old Removed.pdf');
    await env.R2.put(oldOrphan, 'stray-bytes');
    await env.R2.put(oldDeletedRow, 'removed');
    const container = buildContainer(env as AppEnv);
    controller = new AdminStorageController(
      container.content.storage,
      container.content.storageReferences,
      () => Date.now() + ORPHAN_GRACE_MS + HOUR,
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('removes an old orphan, logs one audit line, changes no row', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const before = await dbSnapshot();

    const res = await controller.deleteObject(oldOrphan, ADMIN_ID);

    expect(res).toEqual({ ok: true, data: { deleted: true, key: oldOrphan, size: 11, status: 'orphan' } });
    expect(await env.R2.head(oldOrphan)).toBeNull();
    expect(await dbSnapshot()).toEqual(before);
    const lines = info.mock.calls.map(([l]) => JSON.parse(String(l)));
    expect(lines).toMatchObject([{ event: 'storage.orphan.deleted', actor: ADMIN_ID, key: oldOrphan, size: 11 }]);
  });

  it('removes an old deleted-row object and leaves its media row deleted', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const before = await dbSnapshot();

    const res = await controller.deleteObject(oldDeletedRow, ADMIN_ID);

    expect(res).toMatchObject({ ok: true, data: { key: oldDeletedRow, status: 'deleted-row' } });
    expect(await env.R2.head(oldDeletedRow)).toBeNull();
    expect(await dbSnapshot()).toEqual(before);
    const row = await env.DB.prepare('SELECT status FROM media WHERE storage_key = ?').bind(oldDeletedRow).first();
    expect(row).toEqual({ status: 'deleted' });
  });

  it('still refuses a linked object 25 h later', async () => {
    expect(await controller.deleteObject(key.linked, ADMIN_ID)).toMatchObject({
      ok: false,
      status: 409,
      meta: { reason: 'not-deletable-status' },
    });
    expect(await env.R2.head(key.linked)).not.toBeNull();
  });
});
