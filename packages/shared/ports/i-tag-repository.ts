import type { Entities } from '../types/entities';

export interface UpsertTagInput {
  name: string;
  slug: string;
}

export interface ITagRepository {
  list(opts?: { limit?: number; offset?: number }): Promise<Entities.Content.Tag[]>;
  findBySlug(slug: string): Promise<Entities.Content.Tag | null>;
  upsertMany(tags: UpsertTagInput[]): Promise<Entities.Content.Tag[]>;
}
