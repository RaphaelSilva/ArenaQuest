import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { D1TagRepository } from '@api/adapters/db/d1-tag-repository';

const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS tags (
    id         TEXT NOT NULL PRIMARY KEY,
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

describe('D1TagRepository', () => {
  let repo: D1TagRepository;

  beforeAll(async () => {
    await env.DB.batch(MIGRATION_STATEMENTS.map(sql => env.DB.prepare(sql)));
    repo = new D1TagRepository(env.DB);
  });

  it('upsertMany inserts new tags and returns them', async () => {
    const tags = await repo.upsertMany([
      { name: 'JavaScript', slug: 'javascript' },
      { name: 'TypeScript', slug: 'typescript' },
    ]);

    expect(tags).toHaveLength(2);
    expect(tags.map(t => t.slug).sort()).toEqual(['javascript', 'typescript']);
    expect(tags.every(t => typeof t.id === 'string')).toBe(true);
  });

  it('upsertMany updates name on slug conflict without changing id', async () => {
    const [original] = await repo.upsertMany([{ name: 'React', slug: 'react' }]);
    const [updated] = await repo.upsertMany([{ name: 'React.js', slug: 'react' }]);

    expect(updated.id).toBe(original.id);
    expect(updated.name).toBe('React.js');
    expect(updated.slug).toBe('react');
  });

  it('upsertMany with empty array returns empty array', async () => {
    const result = await repo.upsertMany([]);
    expect(result).toEqual([]);
  });

  it('findBySlug returns a tag', async () => {
    await repo.upsertMany([{ name: 'CSS', slug: 'css' }]);

    const tag = await repo.findBySlug('css');
    expect(tag).not.toBeNull();
    expect(tag!.name).toBe('CSS');
    expect(tag!.slug).toBe('css');
  });

  it('findBySlug returns null for unknown slug', async () => {
    const result = await repo.findBySlug('does-not-exist');
    expect(result).toBeNull();
  });

  it('list returns paginated tags ordered by slug', async () => {
    await repo.upsertMany([
      { name: 'Alpha', slug: 'alpha' },
      { name: 'Beta', slug: 'beta' },
      { name: 'Gamma', slug: 'gamma' },
    ]);

    const page = await repo.list({ limit: 2, offset: 0 });
    expect(page.length).toBe(2);

    const all = await repo.list({ limit: 100, offset: 0 });
    expect(all.length).toBeGreaterThanOrEqual(3);

    // Verify ascending slug order
    for (let i = 1; i < all.length; i++) {
      expect(all[i].slug >= all[i - 1].slug).toBe(true);
    }
  });
});
