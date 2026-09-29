import type { Entities } from '../types/entities';

export interface UpsertTagInput {
  name: string;
  slug: string;
}

export interface ITagRepository {
  /**
   * Tags ordered by slug. `q`, when non-empty, is a slug prefix — the caller
   * slugifies it first, so it compares against stored slugs directly.
   */
  list(opts?: { limit?: number; offset?: number; q?: string }): Promise<Entities.Content.Tag[]>;
  findBySlug(slug: string): Promise<Entities.Content.Tag | null>;
  /** The tags among `ids` that exist; unknown IDs are simply absent. */
  findByIds(ids: string[]): Promise<Entities.Content.Tag[]>;
  /**
   * Inserts the tags whose slug is new and returns every requested tag.
   * First spelling wins: an existing slug keeps its ID and stored name.
   */
  upsertMany(tags: UpsertTagInput[]): Promise<Entities.Content.Tag[]>;
}
