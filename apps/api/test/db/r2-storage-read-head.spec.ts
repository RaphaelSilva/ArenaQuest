import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { R2StorageAdapter } from '@api/adapters/storage/r2-storage-adapter';

// M23 Task 02 — `readHead` against a real Miniflare R2 object. Lives under
// test/db because that is a workers-pool folder (binding-level spec) and the
// Vitest project config is outside the task's scope.
describe('R2StorageAdapter.readHead (Miniflare R2)', () => {
  const bytes = new Uint8Array(64).map((_, i) => (i * 7 + 3) & 0xff);
  let storage: R2StorageAdapter;

  beforeAll(async () => {
    storage = new R2StorageAdapter({
      bucket: env.R2,
      s3Endpoint: 'http://localhost:4566',
      bucketName: 'test-bucket',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key-at-least-32-chars-long',
    });
    await env.R2.put('submissions/u1/long.bin', bytes);
    await env.R2.put('submissions/u1/short.bin', bytes.slice(0, 10));
  });

  it('returns exactly the requested leading bytes', async () => {
    const head = await storage.readHead('submissions/u1/long.bin', 32);
    expect(head).toBeInstanceOf(Uint8Array);
    expect(Array.from(head!)).toEqual(Array.from(bytes.slice(0, 32)));
  });

  it('returns the whole object when it is shorter than requested', async () => {
    const head = await storage.readHead('submissions/u1/short.bin', 32);
    expect(Array.from(head!)).toEqual(Array.from(bytes.slice(0, 10)));
  });

  it('returns null for a missing key', async () => {
    expect(await storage.readHead('submissions/u1/missing.bin', 32)).toBeNull();
  });

  it('rejects a non-positive byte count', async () => {
    await expect(storage.readHead('submissions/u1/long.bin', 0)).rejects.toThrow(/positive integer/);
  });
});
