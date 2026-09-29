import type { ITagRepository } from '@arenaquest/shared/ports';
import type { Entities } from '@arenaquest/shared/types/entities';
import { slugify } from '@arenaquest/shared/domain/tags/slugify';
import type { ControllerResult } from '@api/core/result';

export const TAG_LIST_DEFAULT_LIMIT = 20;

export class AdminTagsController {
  constructor(private readonly tags: ITagRepository) {}

  /**
   * Tags whose slug starts with `slugify(q)`, ordered by slug. The query goes
   * through the same `slugify` as a tag name on write, so `Chū`, `CHU` and
   * `chu` all find `chudan`. An empty (or unusable) `q` lists from the start.
   */
  async list(opts: { q?: string; limit?: number }): Promise<ControllerResult<Entities.Content.Tag[]>> {
    const tags = await this.tags.list({
      q: slugify(opts.q ?? ''),
      limit: opts.limit ?? TAG_LIST_DEFAULT_LIMIT,
    });
    return { ok: true, data: tags };
  }
}
