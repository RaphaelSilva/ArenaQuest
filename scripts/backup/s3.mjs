/**
 * s3.mjs — the minimal S3-compatible client the R2 mirror needs (RFC 0025 §4.2).
 *
 * Signing library: `@aws-sdk/client-s3`, the same pinned client (3.1036.0) as
 * `apps/api`'s `R2StorageAdapter`, declared in the root package.json so the
 * scripts resolve it — no new package enters the store. Construction mirrors
 * the adapter (`region: 'auto'`, `forcePathStyle: true`, endpoint from the
 * profile's `s3Endpoint`).
 *
 * Four operations, each one S3 command, plus two text helpers for the mirror
 * index. `send(command)` is injectable so the tests run every call against a
 * stub and never touch the network; the CLI passes none and gets a real
 * `S3Client.send`.
 *
 * Source safety: `createS3({ readOnlyBuckets })` names the buckets that must
 * never be written. `copy`, `del` and `putText` throw synchronously when their
 * TARGET bucket is one of them, before any command is built. The mirror lists
 * its media bucket as read-only, so a bug that pointed a delete at the source
 * would fail here rather than in production.
 */

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/** `"abc"` → `abc`: S3 quotes ETags; the index stores them bare. */
export function unquoteEtag(etag) {
  if (typeof etag !== 'string') return null;
  return etag.replace(/^"(.*)"$/, '$1');
}

/**
 * The `CopySource` header for a server-side copy: `/<bucket>/<key>` with the
 * key percent-encoded per path segment (so `Chūdan Jō.mp4` and `a b/c.pdf`
 * survive) while `/` separators stay literal.
 */
export function copySourceOf(bucket, key) {
  if (typeof bucket !== 'string' || bucket === '') throw new Error('copySourceOf: bucket is required');
  if (typeof key !== 'string' || key === '') throw new Error('copySourceOf: key is required');
  const encodedKey = key.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `/${bucket}/${encodedKey}`;
}

function isNotFound(error) {
  const status = error?.$metadata?.httpStatusCode;
  return status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey';
}

async function bodyToText(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (typeof body.transformToString === 'function') return body.transformToString('utf8');
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * `{ list, head, copy, del, getText, putText }` over one endpoint.
 * `endpoint`, `accessKeyId` and `secretAccessKey` are required unless `send`
 * is injected (the tests build no real client). Credentials are never logged.
 */
export function createS3({ endpoint, accessKeyId, secretAccessKey, readOnlyBuckets = [], send = null } = {}) {
  if (!Array.isArray(readOnlyBuckets) || readOnlyBuckets.some((bucket) => typeof bucket !== 'string' || bucket === '')) {
    throw new Error('createS3: readOnlyBuckets must be a list of bucket names');
  }
  let dispatch = send;
  if (typeof dispatch !== 'function') {
    if (typeof endpoint !== 'string' || endpoint === '') throw new Error('createS3: endpoint is required');
    if (!accessKeyId || !secretAccessKey) throw new Error('createS3: accessKeyId and secretAccessKey are required');
    const client = new S3Client({
      region: 'auto',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    dispatch = (command) => client.send(command);
  }
  const readOnly = new Set(readOnlyBuckets);

  function assertWritable(bucket, what) {
    if (typeof bucket !== 'string' || bucket === '') throw new Error(`${what}: bucket is required`);
    if (readOnly.has(bucket)) throw new Error(`${what}: refusing to write to read-only bucket "${bucket}"`);
  }

  return {
    /** Every object under `prefix`, page by page: `{ key, etag, size, lastModified }`. */
    async *list(bucket, prefix = '') {
      if (typeof bucket !== 'string' || bucket === '') throw new Error('list: bucket is required');
      let token;
      do {
        const page = await dispatch(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: token }),
        );
        for (const item of page?.Contents ?? []) {
          if (typeof item?.Key !== 'string') continue;
          yield {
            key: item.Key,
            etag: unquoteEtag(item.ETag),
            size: Number.isInteger(item.Size) ? item.Size : Number(item.Size ?? 0),
            lastModified: item.LastModified instanceof Date ? item.LastModified.toISOString() : (item.LastModified ?? null),
          };
        }
        token = page?.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },

    /** `{ etag, size, contentType }`, or null when the object does not exist. */
    async head(bucket, key) {
      try {
        const out = await dispatch(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { etag: unquoteEtag(out?.ETag), size: out?.ContentLength ?? null, contentType: out?.ContentType ?? null };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    /** Server-side copy; the bytes never transit the runner. Throws if `toBucket` is read-only. */
    async copy(fromBucket, fromKey, toBucket, toKey) {
      assertWritable(toBucket, 'copy');
      return dispatch(
        new CopyObjectCommand({
          Bucket: toBucket,
          Key: toKey,
          CopySource: copySourceOf(fromBucket, fromKey),
          MetadataDirective: 'COPY',
        }),
      );
    },

    /** Delete one object. Throws if `bucket` is read-only. */
    async del(bucket, key) {
      assertWritable(bucket, 'del');
      return dispatch(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    /** The object's text, or null when it does not exist. */
    async getText(bucket, key) {
      try {
        const out = await dispatch(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return bodyToText(out?.Body);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    /** Upload `text` under `key`. Throws if `bucket` is read-only. */
    async putText(bucket, key, text, contentType = 'application/json') {
      assertWritable(bucket, 'putText');
      return dispatch(new PutObjectCommand({ Bucket: bucket, Key: key, Body: text, ContentType: contentType }));
    },
  };
}
