import type { IMediaRepository, CreateMediaInput } from '@arenaquest/shared/ports';
import type { Entities } from '@arenaquest/shared/types/entities';

type MediaRow = {
  id: string;
  topic_node_id: string;
  uploaded_by: string;
  storage_key: string;
  original_name: string;
  type: string;
  size_bytes: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export class D1MediaRepository implements IMediaRepository {
  constructor(private readonly db: D1Database) {}

  private rowToMedia(row: MediaRow): Entities.Content.Media {
    return {
      id: row.id,
      topicNodeId: row.topic_node_id,
      url: '',
      type: row.type,
      storageKey: row.storage_key,
      sizeBytes: row.size_bytes,
      originalName: row.original_name,
      uploadedById: row.uploaded_by,
      status: row.status as Entities.Config.MediaStatus,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  async findById(id: string): Promise<Entities.Content.Media | null> {
    const row = await this.db
      .prepare('SELECT * FROM media WHERE id = ?')
      .bind(id)
      .first<MediaRow>();

    if (!row) return null;
    return this.rowToMedia(row);
  }

  async listByTopic(
    topicNodeId: string,
    opts?: { includePending?: boolean },
  ): Promise<Entities.Content.Media[]> {
    const includePending = opts?.includePending ?? false;

    const bindings: unknown[] = [topicNodeId];
    let sql = "SELECT * FROM media WHERE topic_node_id = ? AND status != 'deleted'";

    if (!includePending) {
      sql += " AND status != 'pending'";
    }

    sql += ' ORDER BY created_at ASC';

    const { results } = await this.db.prepare(sql).bind(...bindings).all<MediaRow>();
    return results.map(row => this.rowToMedia(row));
  }

  async create(data: CreateMediaInput): Promise<Entities.Content.Media> {
    const id = data.id ?? crypto.randomUUID();

    await this.db
      .prepare(
        "INSERT INTO media (id, topic_node_id, uploaded_by, storage_key, original_name, type, size_bytes, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
      )
      .bind(id, data.topicNodeId, data.uploadedById, data.storageKey, data.originalName, data.type, data.sizeBytes)
      .run();

    const media = await this.findById(id);
    if (!media) throw new Error(`D1MediaRepository: failed to fetch media after create (id=${id})`);
    return media;
  }

  async markReady(id: string): Promise<Entities.Content.Media> {
    await this.db
      .prepare("UPDATE media SET status = 'ready', updated_at = datetime('now') WHERE id = ?")
      .bind(id)
      .run();

    const media = await this.findById(id);
    if (!media) throw new Error(`D1MediaRepository: media not found (id=${id})`);
    return media;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .prepare("UPDATE media SET status = 'deleted', updated_at = datetime('now') WHERE id = ?")
      .bind(id)
      .run();
  }

  async hardDelete(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM media WHERE id = ?').bind(id).run();
  }
}
