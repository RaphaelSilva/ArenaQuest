import { describe, it, expect, vi } from 'vitest';
import { AdminTagsController } from '@api/controllers/admin-tags.controller';
import type { ITagRepository } from '@arenaquest/shared/ports';

function makeTagsRepo(): ITagRepository {
  return {
    list: vi.fn(async () => []),
    findBySlug: vi.fn(async () => null),
    findByIds: vi.fn(async () => []),
    upsertMany: vi.fn(async () => []),
  };
}

describe('AdminTagsController.list', () => {
  it('slugifies q before handing it to the repository', async () => {
    const repo = makeTagsRepo();
    await new AdminTagsController(repo).list({ q: '  Chū ', limit: 5 });
    expect(repo.list).toHaveBeenCalledWith({ q: 'chu', limit: 5 });
  });

  it('defaults limit to 20 and q to an empty prefix', async () => {
    const repo = makeTagsRepo();
    const result = await new AdminTagsController(repo).list({});
    expect(result.ok).toBe(true);
    expect(repo.list).toHaveBeenCalledWith({ q: '', limit: 20 });
  });
});
