import { describe, it, expect } from 'vitest';
import { R2StorageAdapter } from '@api/adapters/storage/r2-storage-adapter';

// ── Fake R2Bucket ────────────────────────────────────────────────────────────

type FakeEntry = {
  body: ArrayBuffer;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  uploaded: Date;
};

class FakeR2Bucket implements R2Bucket {
  readonly store = new Map<string, FakeEntry>();

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: R2PutOptions,
  ): Promise<R2Object> {
    let body: ArrayBuffer;
    if (typeof value === 'string') {
      body = new TextEncoder().encode(value).buffer as ArrayBuffer;
    } else if (value instanceof ArrayBuffer) {
      body = value;
    } else if (ArrayBuffer.isView(value)) {
      body = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
    } else {
      body = new ArrayBuffer(0);
    }
    const entry: FakeEntry = {
      body,
      httpMetadata: options?.httpMetadata as { contentType?: string } | undefined,
      customMetadata: options?.customMetadata,
      uploaded: new Date(),
    };
    this.store.set(key, entry);
    return this.makeR2Object(key, entry);
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      ...this.makeR2Object(key, entry),
      arrayBuffer: async () => entry.body,
      text: async () => new TextDecoder().decode(entry.body),
      json: async <T>(): Promise<T> => JSON.parse(new TextDecoder().decode(entry.body)) as T,
      blob: async () => new Blob([entry.body]),
      body: new ReadableStream(),
      bodyUsed: false,
    } as unknown as R2ObjectBody;
  }

  async head(key: string): Promise<R2Object | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return this.makeR2Object(key, entry);
  }

  async delete(keys: string | string[]): Promise<void> {
    if (Array.isArray(keys)) {
      for (const k of keys) this.store.delete(k);
    } else {
      this.store.delete(keys);
    }
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const prefix = options?.prefix ?? '';
    const limit = options?.limit ?? 1000;
    const cursor = options?.cursor ? parseInt(options.cursor, 10) : 0;

    const filtered = [...this.store.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([key, entry]) => this.makeR2Object(key, entry));

    const page = filtered.slice(cursor, cursor + limit);
    const truncated = cursor + limit < filtered.length;

    return {
      objects: page,
      truncated,
      cursor: truncated ? String(cursor + limit) : '',
      delimitedPrefixes: [],
    };
  }

  createMultipartUpload(): never { throw new Error('not implemented'); }
  resumeMultipartUpload(): never { throw new Error('not implemented'); }

  private makeR2Object(key: string, entry: FakeEntry): R2Object {
    return {
      key,
      version: 'v1',
      size: entry.body.byteLength,
      etag: 'fake-etag',
      httpEtag: '"fake-etag"',
      checksums: { toJSON: () => ({}) } as unknown as R2Checksums,
      uploaded: entry.uploaded,
      httpMetadata: (entry.httpMetadata ?? {}) as R2HTTPMetadata,
      customMetadata: entry.customMetadata ?? {},
      range: undefined as unknown as R2Range,
      storageClass: 'Standard',
      writeHttpMetadata: () => {},
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAdapter(overrides?: Partial<ConstructorParameters<typeof R2StorageAdapter>[0]>) {
  const bucket = new FakeR2Bucket();
  const adapter = new R2StorageAdapter({
    bucket,
    s3Endpoint: 'https://fake-account.r2.cloudflarestorage.com',
    bucketName: 'test-bucket',
    accessKeyId: 'fake-access-key-id',
    secretAccessKey: 'fake-secret-access-key',
    publicBase: 'https://cdn.example.com',
    ...overrides,
  });
  return { adapter, bucket };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('R2StorageAdapter', () => {
  describe('construction', () => {
    it('throws when accessKeyId is missing', () => {
      expect(() => makeAdapter({ accessKeyId: '' })).toThrow('accessKeyId');
    });

    it('throws when secretAccessKey is missing', () => {
      expect(() => makeAdapter({ secretAccessKey: '' })).toThrow('secretAccessKey');
    });

    it('throws when s3Endpoint is missing', () => {
      expect(() => makeAdapter({ s3Endpoint: '' })).toThrow('s3Endpoint');
    });
  });

  describe('putObject / getObject / deleteObject round-trip', () => {
    it('stores and retrieves an ArrayBuffer', async () => {
      const { adapter } = makeAdapter();
      const content = new TextEncoder().encode('hello r2').buffer as ArrayBuffer;

      await adapter.putObject('test/hello.txt', content, {
        metadata: { contentType: 'text/plain' },
      });

      const retrieved = await adapter.getObject('test/hello.txt');
      expect(retrieved).not.toBeNull();
      expect(new TextDecoder().decode(retrieved!)).toBe('hello r2');
    });

    it('getObject returns null for a missing key', async () => {
      const { adapter } = makeAdapter();
      expect(await adapter.getObject('does/not/exist')).toBeNull();
    });

    it('deleteObject removes the object', async () => {
      const { adapter } = makeAdapter();
      await adapter.putObject('to-delete.txt', 'bye');
      await adapter.deleteObject('to-delete.txt');
      expect(await adapter.getObject('to-delete.txt')).toBeNull();
    });

    it('deleteObject is silent on missing keys', async () => {
      const { adapter } = makeAdapter();
      await expect(adapter.deleteObject('ghost.txt')).resolves.toBeUndefined();
    });
  });

  describe('deleteObjects', () => {
    it('deletes multiple keys in one call', async () => {
      const { adapter } = makeAdapter();
      await adapter.putObject('a.txt', 'a');
      await adapter.putObject('b.txt', 'b');
      await adapter.deleteObjects(['a.txt', 'b.txt']);
      expect(await adapter.getObject('a.txt')).toBeNull();
      expect(await adapter.getObject('b.txt')).toBeNull();
    });

    it('is a no-op for an empty array', async () => {
      const { adapter } = makeAdapter();
      await expect(adapter.deleteObjects([])).resolves.toBeUndefined();
    });
  });

  describe('headObject / objectExists', () => {
    it('headObject returns metadata for an existing key', async () => {
      const { adapter } = makeAdapter();
      await adapter.putObject('file.pdf', 'pdf-bytes');
      const meta = await adapter.headObject('file.pdf');
      expect(meta).not.toBeNull();
      expect(meta!.key).toBe('file.pdf');
      expect(meta!.size).toBe(new TextEncoder().encode('pdf-bytes').byteLength);
      expect(meta!.lastModified).toBeInstanceOf(Date);
    });

    it('headObject returns null for a missing key', async () => {
      const { adapter } = makeAdapter();
      expect(await adapter.headObject('missing.pdf')).toBeNull();
    });

    it('objectExists returns true for an existing key', async () => {
      const { adapter } = makeAdapter();
      await adapter.putObject('exists.txt', 'yes');
      expect(await adapter.objectExists('exists.txt')).toBe(true);
    });

    it('objectExists returns false for a missing key', async () => {
      const { adapter } = makeAdapter();
      expect(await adapter.objectExists('nope.txt')).toBe(false);
    });
  });

  describe('listObjects', () => {
    it('returns objects matching a prefix', async () => {
      const { adapter } = makeAdapter();
      await adapter.putObject('topics/abc/intro.mp4', 'v1');
      await adapter.putObject('topics/abc/summary.pdf', 'v2');
      await adapter.putObject('topics/xyz/other.mp4', 'v3');

      const result = await adapter.listObjects('topics/abc/');
      expect(result.objects.map(o => o.key).sort()).toEqual([
        'topics/abc/intro.mp4',
        'topics/abc/summary.pdf',
      ]);
      expect(result.nextCursor).toBeUndefined();
    });

    it('paginates results via cursor', async () => {
      const { adapter } = makeAdapter();
      for (let i = 0; i < 5; i++) {
        await adapter.putObject(`page/item-${i}.txt`, String(i));
      }

      const page1 = await adapter.listObjects('page/', undefined, 3);
      expect(page1.objects).toHaveLength(3);
      expect(page1.nextCursor).toBeDefined();

      const page2 = await adapter.listObjects('page/', page1.nextCursor, 3);
      expect(page2.objects).toHaveLength(2);
      expect(page2.nextCursor).toBeUndefined();
    });
  });

  describe('getPublicUrl', () => {
    it('returns a correctly formed public URL', () => {
      const { adapter } = makeAdapter({ publicBase: 'https://cdn.example.com' });
      expect(adapter.getPublicUrl('topics/abc/video.mp4')).toBe(
        'https://cdn.example.com/topics/abc/video.mp4',
      );
    });

    it('strips trailing slash from publicBase', () => {
      const { adapter } = makeAdapter({ publicBase: 'https://cdn.example.com/' });
      expect(adapter.getPublicUrl('file.pdf')).toBe('https://cdn.example.com/file.pdf');
    });

    it('throws when publicBase is not configured', () => {
      const { adapter } = makeAdapter({ publicBase: undefined });
      expect(() => adapter.getPublicUrl('file.pdf')).toThrow('publicBase');
    });
  });

  describe('getPresignedUploadUrl', () => {
    it('returns a URL string containing the key and S3 signature parameters', async () => {
      const { adapter } = makeAdapter();
      const url = await adapter.getPresignedUploadUrl('uploads/video.mp4', {
        expiresInSeconds: 600,
        contentType: 'video/mp4',
        maxSizeBytes: 52_428_800,
      });

      expect(typeof url).toBe('string');
      expect(url).toMatch(/^https:\/\//);
      expect(url).toContain('video.mp4');
      expect(url).toContain('X-Amz-Signature');
      expect(url).toContain('X-Amz-Expires=600');
      // Content-Length is enforced via signed headers (AWS SDK v3 signs content-length for PUT)
      expect(url.toLowerCase()).toContain('content-length');
    });
  });

  describe('getPresignedDownloadUrl', () => {
    it('returns a URL string containing the key and S3 signature parameters', async () => {
      const { adapter } = makeAdapter();
      const url = await adapter.getPresignedDownloadUrl('uploads/doc.pdf', {
        expiresInSeconds: 300,
      });

      expect(typeof url).toBe('string');
      expect(url).toMatch(/^https:\/\//);
      expect(url).toContain('doc.pdf');
      expect(url).toContain('X-Amz-Signature');
      expect(url).toContain('X-Amz-Expires=300');
    });
  });

  describe('@aws-sdk isolation', () => {
    it('confines @aws-sdk/* imports to the storage adapter directory', async () => {
      // import.meta.glob is resolved at bundle time by Vite — no host-fs access needed.
      // All source files are loaded as raw strings at compile time.
      const allSources = import.meta.glob('../../../src/**/*.ts', { query: '?raw', import: 'default', eager: true });

      const violations = Object.entries(allSources)
        .filter(([path]) => !path.includes('/adapters/storage/'))
        .filter(([, content]) => (content as string).includes('@aws-sdk/'));

      expect(
        violations.map(([p]) => p),
        `@aws-sdk/* found outside storage adapter: ${violations.map(([p]) => p).join(', ')}`,
      ).toHaveLength(0);
    });
  });
});
