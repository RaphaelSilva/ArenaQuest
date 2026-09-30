import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { D1TagRepository } from '@api/adapters/db/d1-tag-repository';
import { applyMigrations } from '../helpers/apply-migrations';


describe('D1TagRepository', () => {
  let repo: D1TagRepository;

  beforeAll(async () => {
    await applyMigrations(env.DB);
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

  it('upsertMany keeps the first spelling on slug conflict (DO NOTHING)', async () => {
    const [original] = await repo.upsertMany([{ name: 'React', slug: 'react' }]);
    const [again] = await repo.upsertMany([{ name: 'React.js', slug: 'react' }]);

    expect(again.id).toBe(original.id);
    expect(again.name).toBe('React');
    expect(again.slug).toBe('react');
  });

  it('upsertMany reuses an existing slug without adding a row', async () => {
    await repo.upsertMany([{ name: 'Chūdan', slug: 'chudan' }]);
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM tags').first<{ n: number }>();

    const [tag] = await repo.upsertMany([{ name: 'CHUDAN', slug: 'chudan' }]);
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM tags').first<{ n: number }>();

    expect(tag.name).toBe('Chūdan');
    expect(after!.n).toBe(before!.n);
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

  it('list with q returns only tags whose slug starts with q', async () => {
    await repo.upsertMany([
      { name: 'Chūdan', slug: 'chudan' },
      { name: 'Chūdan Tsuki', slug: 'chudan-tsuki' },
      { name: 'Jōdan', slug: 'jodan' },
    ]);

    const hits = await repo.list({ q: 'chu' });
    expect(hits.map(t => t.slug)).toEqual(['chudan', 'chudan-tsuki']);

    const limited = await repo.list({ q: 'chu', limit: 1 });
    expect(limited.map(t => t.slug)).toEqual(['chudan']);

    expect(await repo.list({ q: 'zzz-none' })).toEqual([]);
  });

  it('findByIds returns only the existing tags', async () => {
    const [a, b] = await repo.upsertMany([
      { name: 'Ids A', slug: 'ids-a' },
      { name: 'Ids B', slug: 'ids-b' },
    ]);

    const found = await repo.findByIds([a.id, 'missing-id', b.id]);
    expect(found.map(t => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(await repo.findByIds([])).toEqual([]);
  });
});
