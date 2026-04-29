import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { D1MediaRepository } from '@api/adapters/db/d1-media-repository';
import { Entities } from '@arenaquest/shared/types/entities';

const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id            TEXT NOT NULL PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS topic_nodes (
    id                TEXT    NOT NULL PRIMARY KEY,
    parent_id         TEXT    REFERENCES topic_nodes(id) ON DELETE RESTRICT,
    title             TEXT    NOT NULL,
    content           TEXT    NOT NULL DEFAULT '',
    status            TEXT    NOT NULL DEFAULT 'draft',
    sort_order        INTEGER NOT NULL DEFAULT 0,
    estimated_minutes INTEGER NOT NULL DEFAULT 0,
    archived          INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS media (
    id            TEXT    NOT NULL PRIMARY KEY,
    topic_node_id TEXT    NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
    uploaded_by   TEXT    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    storage_key   TEXT    NOT NULL,
    original_name TEXT    NOT NULL,
    type          TEXT    NOT NULL,
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    status        TEXT    NOT NULL DEFAULT 'pending',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
];

describe('D1MediaRepository', () => {
  let repo: D1MediaRepository;
  let topicNodeId: string;
  let uploadedById: string;

  beforeAll(async () => {
    await env.DB.batch(MIGRATION_STATEMENTS.map(sql => env.DB.prepare(sql)));
    repo = new D1MediaRepository(env.DB);

    // Seed a user and topic node to satisfy FK constraints
    uploadedById = crypto.randomUUID();
    await env.DB
      .prepare("INSERT INTO users (id, name, email, password_hash) VALUES (?, 'Uploader', 'uploader@test.com', 'hash')")
      .bind(uploadedById)
      .run();

    topicNodeId = crypto.randomUUID();
    await env.DB
      .prepare("INSERT INTO topic_nodes (id, title) VALUES (?, 'Test Topic')")
      .bind(topicNodeId)
      .run();
  });

  const makeInput = (overrides?: Partial<{ storageKey: string; originalName: string; type: string; sizeBytes: number }>) => ({
    topicNodeId,
    uploadedById,
    storageKey: overrides?.storageKey ?? 'uploads/test.mp4',
    originalName: overrides?.originalName ?? 'test.mp4',
    type: overrides?.type ?? 'video/mp4',
    sizeBytes: overrides?.sizeBytes ?? 1024,
  });

  it('create always inserts with status = pending', async () => {
    const m = await repo.create(makeInput());

    expect(m.id).toBeTypeOf('string');
    expect(m.status).toBe(Entities.Config.MediaStatus.PENDING);
    expect(m.topicNodeId).toBe(topicNodeId);
    expect(m.uploadedById).toBe(uploadedById);
    expect(m.storageKey).toBe('uploads/test.mp4');
    expect(m.sizeBytes).toBe(1024);
  });

  it('findById returns null for unknown id', async () => {
    expect(await repo.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('markReady transitions PENDING → READY', async () => {
    const m = await repo.create(makeInput({ storageKey: 'uploads/ready.mp4' }));
    expect(m.status).toBe(Entities.Config.MediaStatus.PENDING);

    const ready = await repo.markReady(m.id);
    expect(ready.status).toBe(Entities.Config.MediaStatus.READY);

    const fetched = await repo.findById(m.id);
    expect(fetched!.status).toBe(Entities.Config.MediaStatus.READY);
  });

  it('listByTopic excludes PENDING and DELETED rows by default', async () => {
    const pending = await repo.create(makeInput({ storageKey: 'uploads/pending.mp4' }));
    const ready = await repo.create(makeInput({ storageKey: 'uploads/ready2.mp4' }));
    await repo.markReady(ready.id);
    const toDelete = await repo.create(makeInput({ storageKey: 'uploads/deleted.mp4' }));
    await repo.markReady(toDelete.id);
    await repo.softDelete(toDelete.id);

    const list = await repo.listByTopic(topicNodeId);
    const ids = list.map(m => m.id);

    expect(ids).not.toContain(pending.id);
    expect(ids).not.toContain(toDelete.id);
    expect(ids).toContain(ready.id);
    expect(list.every(m => m.status === Entities.Config.MediaStatus.READY)).toBe(true);
  });

  it('listByTopic with includePending=true returns PENDING and READY but not DELETED', async () => {
    const pending = await repo.create(makeInput({ storageKey: 'uploads/pending2.mp4' }));
    const ready = await repo.create(makeInput({ storageKey: 'uploads/ready3.mp4' }));
    await repo.markReady(ready.id);
    const deleted = await repo.create(makeInput({ storageKey: 'uploads/deleted2.mp4' }));
    await repo.softDelete(deleted.id);

    const list = await repo.listByTopic(topicNodeId, { includePending: true });
    const ids = list.map(m => m.id);

    expect(ids).toContain(pending.id);
    expect(ids).toContain(ready.id);
    expect(ids).not.toContain(deleted.id);
  });

  it('softDelete hides row from listByTopic but keeps it in the database', async () => {
    const m = await repo.create(makeInput({ storageKey: 'uploads/soft.mp4' }));
    await repo.markReady(m.id);
    await repo.softDelete(m.id);

    const list = await repo.listByTopic(topicNodeId);
    expect(list.map(r => r.id)).not.toContain(m.id);

    const fetched = await repo.findById(m.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.status).toBe(Entities.Config.MediaStatus.DELETED);
  });

  it('hardDelete removes the row entirely', async () => {
    const m = await repo.create(makeInput({ storageKey: 'uploads/hard.mp4' }));
    await repo.hardDelete(m.id);

    expect(await repo.findById(m.id)).toBeNull();
  });
});
