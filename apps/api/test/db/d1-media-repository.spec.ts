import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { D1MediaRepository } from '@api/adapters/db/d1-media-repository';
import { Entities } from '@arenaquest/shared/types/entities';
import { applyMigrations } from '../helpers/apply-migrations';


describe('D1MediaRepository', () => {
  let repo: D1MediaRepository;
  let topicNodeId: string;
  let uploadedById: string;

  beforeAll(async () => {
    await applyMigrations(env.DB);
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

  describe('moveToTopic', () => {
    let targetTopicId: string;

    beforeAll(async () => {
      targetTopicId = crypto.randomUUID();
      await env.DB
        .prepare("INSERT INTO topic_nodes (id, title) VALUES (?, 'Target Topic')")
        .bind(targetTopicId)
        .run();
    });

    /** Backdates a row so an `updated_at` bump is observable within one second. */
    const backdate = (id: string) =>
      env.DB
        .prepare("UPDATE media SET created_at = '2020-01-01 00:00:00', updated_at = '2020-01-01 00:00:00' WHERE id = ?")
        .bind(id)
        .run();

    it('moves a READY row, keeping storage_key and created_at and advancing updated_at', async () => {
      const m = await repo.create(makeInput({ storageKey: 'topics/src/move-ready.mp4' }));
      await repo.markReady(m.id);
      await backdate(m.id);
      const before = (await repo.findById(m.id))!;

      const moved = await repo.moveToTopic(m.id, topicNodeId, targetTopicId);

      expect(moved).not.toBeNull();
      expect(moved!.topicNodeId).toBe(targetTopicId);
      expect(moved!.status).toBe(Entities.Config.MediaStatus.READY);
      expect(moved!.storageKey).toBe(before.storageKey);
      expect(moved!.createdAt.getTime()).toBe(before.createdAt.getTime());
      expect(moved!.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());

      expect((await repo.listByTopic(targetTopicId)).map(r => r.id)).toContain(m.id);
      expect((await repo.listByTopic(topicNodeId)).map(r => r.id)).not.toContain(m.id);
    });

    it('leaves a PENDING row untouched and returns null', async () => {
      const m = await repo.create(makeInput({ storageKey: 'topics/src/move-pending.mp4' }));

      expect(await repo.moveToTopic(m.id, topicNodeId, targetTopicId)).toBeNull();
      expect((await repo.findById(m.id))!.topicNodeId).toBe(topicNodeId);
    });

    it('leaves a DELETED row untouched and returns null', async () => {
      const m = await repo.create(makeInput({ storageKey: 'topics/src/move-deleted.mp4' }));
      await repo.markReady(m.id);
      await repo.softDelete(m.id);

      expect(await repo.moveToTopic(m.id, topicNodeId, targetTopicId)).toBeNull();
      const fetched = (await repo.findById(m.id))!;
      expect(fetched.topicNodeId).toBe(topicNodeId);
      expect(fetched.status).toBe(Entities.Config.MediaStatus.DELETED);
    });

    it('leaves a row that is not on the given source topic untouched and returns null', async () => {
      const m = await repo.create(makeInput({ storageKey: 'topics/src/move-wrong-source.mp4' }));
      await repo.markReady(m.id);

      expect(await repo.moveToTopic(m.id, targetTopicId, targetTopicId)).toBeNull();
      expect((await repo.findById(m.id))!.topicNodeId).toBe(topicNodeId);
    });

    it('returns null for an unknown id', async () => {
      expect(await repo.moveToTopic('00000000-0000-0000-0000-000000000000', topicNodeId, targetTopicId)).toBeNull();
    });
  });
});
