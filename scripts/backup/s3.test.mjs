/**
 * Unit tests for scripts/backup/s3.mjs — the list paging, the 404 → null
 * head/getText, the CopySource encoding and the read-only bucket guard, with
 * `send` stubbed: no network, no credentials, no real S3Client.
 * Run with: node --test scripts/backup/s3.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { copySourceOf, createS3, unquoteEtag } from './s3.mjs';

/** A `send` stub that records every command and answers from `responses` by command name. */
function fakeSend(responses = {}) {
  const calls = [];
  const send = async (command) => {
    const name = command.constructor.name;
    calls.push({ name, input: command.input });
    const answer = responses[name];
    const value = typeof answer === 'function' ? answer(command.input, calls.length) : answer;
    if (value instanceof Error) throw value;
    return value ?? {};
  };
  return { send, calls };
}

const notFound = () => Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });

test('unquoteEtag strips the quotes S3 adds; copySourceOf encodes per segment', () => {
  assert.equal(unquoteEtag('"abc123"'), 'abc123');
  assert.equal(unquoteEtag('abc123'), 'abc123');
  assert.equal(unquoteEtag(undefined), null);
  assert.equal(copySourceOf('budo-media', 'topics/Chūdan Jō.mp4'), '/budo-media/topics/Ch%C5%ABdan%20J%C5%8D.mp4');
  assert.equal(copySourceOf('b', 'a b/c+d.pdf'), '/b/a%20b/c%2Bd.pdf');
  assert.throws(() => copySourceOf('', 'k'), /bucket is required/);
  assert.throws(() => copySourceOf('b', ''), /key is required/);
});

test('createS3: without an injected send, endpoint and credentials are required', () => {
  assert.throws(() => createS3({}), /endpoint is required/);
  assert.throws(() => createS3({ endpoint: 'https://x.r2.cloudflarestorage.com' }), /accessKeyId and secretAccessKey/);
  assert.throws(() => createS3({ send: async () => ({}), readOnlyBuckets: [''] }), /readOnlyBuckets/);
});

test('list: follows ContinuationToken over two pages and unquotes ETags', async () => {
  const { send, calls } = fakeSend({
    ListObjectsV2Command: (input) =>
      input.ContinuationToken === undefined
        ? {
            IsTruncated: true,
            NextContinuationToken: 'page-2',
            Contents: [{ Key: 'a.mp4', ETag: '"e1"', Size: 10, LastModified: new Date('2026-10-01T00:00:00Z') }],
          }
        : { IsTruncated: false, Contents: [{ Key: 'b.pdf', ETag: '"e2"', Size: 20 }] },
  });
  const s3 = createS3({ send });
  const items = [];
  for await (const item of s3.list('budo-media', 'topics/')) items.push(item);
  assert.deepEqual(items, [
    { key: 'a.mp4', etag: 'e1', size: 10, lastModified: '2026-10-01T00:00:00.000Z' },
    { key: 'b.pdf', etag: 'e2', size: 20, lastModified: null },
  ]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].input, { Bucket: 'budo-media', Prefix: 'topics/', ContinuationToken: undefined });
  assert.equal(calls[1].input.ContinuationToken, 'page-2');
});

test('head and getText: 404 → null, any other failure throws', async () => {
  const { send } = fakeSend({ HeadObjectCommand: notFound(), GetObjectCommand: notFound() });
  const s3 = createS3({ send });
  assert.equal(await s3.head('b', 'missing'), null);
  assert.equal(await s3.getText('b', 'missing'), null);

  const boom = Object.assign(new Error('AccessDenied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
  const other = createS3({ send: fakeSend({ HeadObjectCommand: boom, GetObjectCommand: boom }).send });
  await assert.rejects(other.head('b', 'k'), /AccessDenied/);
  await assert.rejects(other.getText('b', 'k'), /AccessDenied/);
});

test('head returns etag/size/contentType; getText reads a transformToString body', async () => {
  const { send } = fakeSend({
    HeadObjectCommand: { ETag: '"e9"', ContentLength: 42, ContentType: 'video/mp4' },
    GetObjectCommand: { Body: { transformToString: async () => '{"indexVersion":1}' } },
  });
  const s3 = createS3({ send });
  assert.deepEqual(await s3.head('b', 'k'), { etag: 'e9', size: 42, contentType: 'video/mp4' });
  assert.equal(await s3.getText('b', 'k'), '{"indexVersion":1}');
});

test('copy: CopyObject with an encoded CopySource and MetadataDirective COPY', async () => {
  const { send, calls } = fakeSend();
  const s3 = createS3({ send });
  await s3.copy('budo-media', 'topics/Chūdan Jō.mp4', 'budo-backups', 'r2/production/topics/Chūdan Jō.mp4');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'CopyObjectCommand');
  assert.deepEqual(calls[0].input, {
    Bucket: 'budo-backups',
    Key: 'r2/production/topics/Chūdan Jō.mp4',
    CopySource: '/budo-media/topics/Ch%C5%ABdan%20J%C5%8D.mp4',
    MetadataDirective: 'COPY',
  });
});

test('del and putText issue one command each', async () => {
  const { send, calls } = fakeSend();
  const s3 = createS3({ send });
  await s3.del('budo-backups', 'r2/production/old.mp4');
  await s3.putText('budo-backups', 'r2/production/index.json', '{}');
  assert.deepEqual(
    calls.map((call) => [call.name, call.input.Bucket, call.input.Key]),
    [
      ['DeleteObjectCommand', 'budo-backups', 'r2/production/old.mp4'],
      ['PutObjectCommand', 'budo-backups', 'r2/production/index.json'],
    ],
  );
  assert.equal(calls[1].input.ContentType, 'application/json');
});

test('read-only bucket guard: copy, del and putText targeting the source throw before any send', async () => {
  const { send, calls } = fakeSend();
  const s3 = createS3({ send, readOnlyBuckets: ['budo-media'] });
  await assert.rejects(s3.copy('budo-backups', 'k', 'budo-media', 'k'), /read-only bucket "budo-media"/);
  await assert.rejects(s3.del('budo-media', 'k'), /read-only bucket "budo-media"/);
  await assert.rejects(s3.putText('budo-media', 'k', '{}'), /read-only bucket "budo-media"/);
  assert.equal(calls.length, 0, 'no command was sent');

  // Reading the read-only bucket and copying OUT of it are fine.
  await s3.head('budo-media', 'k');
  await s3.copy('budo-media', 'k', 'budo-backups', 'k');
  assert.deepEqual(calls.map((call) => call.name), ['HeadObjectCommand', 'CopyObjectCommand']);
});
