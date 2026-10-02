import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { R2StorageAdapter } from '@api/adapters/storage/r2-storage-adapter';

function makeAdapter(): R2StorageAdapter {
  return new R2StorageAdapter({
    bucket: env.R2,
    s3Endpoint: 'http://localhost:4566',
    bucketName: 'test-bucket',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
  });
}

async function listAll(adapter: R2StorageAdapter, prefix: string, limit: number) {
  const keys: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await adapter.listObjects(prefix, { cursor, limit });
    keys.push(...page.objects.map(o => o.key));
    cursor = page.nextCursor;
    pages++;
  } while (cursor && pages < 100);
  return { keys, pages };
}

describe('R2StorageAdapter.listObjects (miniflare R2)', () => {
  it('groups topic folders into prefixes when a delimiter is passed', async () => {
    const adapter = makeAdapter();
    await adapter.putObject('topics/t-one/a.pdf', 'a', { metadata: { contentType: 'application/pdf' } });
    await adapter.putObject('topics/t-one/b.mp4', 'b', { metadata: { contentType: 'video/mp4' } });
    await adapter.putObject('topics/t-two/c.png', 'c', { metadata: { contentType: 'image/png' } });

    const folders = await adapter.listObjects('topics/', { delimiter: '/' });
    expect(folders.prefixes.sort()).toEqual(['topics/t-one/', 'topics/t-two/']);
    expect(folders.objects).toEqual([]);
    expect(folders.nextCursor).toBeUndefined();

    const flat = await adapter.listObjects('topics/');
    expect(flat.prefixes).toEqual([]);
    expect(flat.objects.map(o => o.key).sort()).toEqual([
      'topics/t-one/a.pdf',
      'topics/t-one/b.mp4',
      'topics/t-two/c.png',
    ]);
  });

  it('returns objects and prefixes side by side at one level', async () => {
    const adapter = makeAdapter();
    await adapter.putObject('mixed/root.txt', 'r');
    await adapter.putObject('mixed/sub/child.txt', 'c');

    const result = await adapter.listObjects('mixed/', { delimiter: '/' });
    expect(result.prefixes).toEqual(['mixed/sub/']);
    expect(result.objects.map(o => o.key)).toEqual(['mixed/root.txt']);
  });

  it('reaches every key by following nextCursor until it is absent', async () => {
    const adapter = makeAdapter();
    const expected: string[] = [];
    for (let i = 0; i < 7; i++) {
      const key = `paged/item-${String(i).padStart(2, '0')}.txt`;
      expected.push(key);
      await adapter.putObject(key, String(i));
    }

    const { keys, pages } = await listAll(adapter, 'paged/', 3);
    expect(keys.sort()).toEqual(expected);
    expect(pages).toBeGreaterThanOrEqual(3);
  });

  it('carries the contentType each object was put with', async () => {
    const adapter = makeAdapter();
    await adapter.putObject('ctype/doc.pdf', 'x', { metadata: { contentType: 'application/pdf' } });
    await adapter.putObject('ctype/pic.webp', 'y', { metadata: { contentType: 'image/webp' } });

    const result = await adapter.listObjects('ctype/');
    const byKey = Object.fromEntries(result.objects.map(o => [o.key, o.contentType]));
    expect(byKey).toEqual({ 'ctype/doc.pdf': 'application/pdf', 'ctype/pic.webp': 'image/webp' });

    const head = await adapter.headObject('ctype/doc.pdf');
    expect(head?.contentType).toBe('application/pdf');
  });

  it('clamps an out-of-range limit instead of failing', async () => {
    const adapter = makeAdapter();
    await adapter.putObject('clamp/a.txt', 'a');
    await adapter.putObject('clamp/b.txt', 'b');

    const zero = await adapter.listObjects('clamp/', { limit: 0 });
    expect(zero.objects).toHaveLength(1);
    expect(zero.nextCursor).toBeDefined();

    const huge = await adapter.listObjects('clamp/', { limit: 5000 });
    expect(huge.objects).toHaveLength(2);
  });
});
