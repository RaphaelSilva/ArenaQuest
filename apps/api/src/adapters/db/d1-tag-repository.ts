import type { ITagRepository, UpsertTagInput } from '@arenaquest/shared/ports';
import type { Entities } from '@arenaquest/shared/types/entities';

type TagRow = {
  id: string;
  name: string;
  slug: string;
};

export class D1TagRepository implements ITagRepository {
  constructor(private readonly db: D1Database) {}

  async list(opts?: { limit?: number; offset?: number }): Promise<Entities.Content.Tag[]> {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;

    const { results } = await this.db
      .prepare('SELECT id, name, slug FROM tags ORDER BY slug ASC LIMIT ? OFFSET ?')
      .bind(limit, offset)
      .all<TagRow>();

    return results.map(r => ({ id: r.id, name: r.name, slug: r.slug }));
  }

  async findBySlug(slug: string): Promise<Entities.Content.Tag | null> {
    const row = await this.db
      .prepare('SELECT id, name, slug FROM tags WHERE slug = ?')
      .bind(slug)
      .first<TagRow>();

    if (!row) return null;
    return { id: row.id, name: row.name, slug: row.slug };
  }

  async upsertMany(tags: UpsertTagInput[]): Promise<Entities.Content.Tag[]> {
    if (tags.length === 0) return [];

    // Batch insert: ON CONFLICT(slug) updates the name, preserving the existing ID
    const stmts = tags.map(tag =>
      this.db
        .prepare(
          'INSERT INTO tags (id, name, slug) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET name = excluded.name',
        )
        .bind(crypto.randomUUID(), tag.name, tag.slug),
    );
    await this.db.batch(stmts);

    // Fetch all upserted tags by slug to return stable IDs
    const slugs = tags.map(t => t.slug);
    const placeholders = slugs.map(() => '?').join(', ');
    const { results } = await this.db
      .prepare(`SELECT id, name, slug FROM tags WHERE slug IN (${placeholders})`)
      .bind(...slugs)
      .all<TagRow>();

    return results.map(r => ({ id: r.id, name: r.name, slug: r.slug }));
  }
}
