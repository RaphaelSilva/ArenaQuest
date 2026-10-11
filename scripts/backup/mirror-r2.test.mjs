/**
 * Unit tests for scripts/backup/mirror-r2.mjs — arguments, the production-only
 * refusals and the credential check (asserted to happen before any S3 call),
 * the pure plan, and the mirror pipeline against an in-memory S3 stub and
 * manifest store: no network, no Cloudflare credentials. Every stubbed call is
 * recorded so the tests can assert that no mutating command ever targets the
 * source bucket. Run with: node --test scripts/backup/mirror-r2.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CREDENTIAL_VARS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_SECONDS,
  emptyIndex,
  main,
  mirrorKey,
  parseArgs,
  parseIndex,
  planMirror,
  quietLog,
  resolveCredentials,
  resolveMirrorTarget,
  runMirror,
  serializeIndex,
} from './mirror-r2.mjs';
import { emptyManifest, parseManifest, serializeManifest, setR2LastRun, validateR2Run } from './manifest.mjs';
import { createS3 } from './s3.mjs';

const ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
const production = (overrides = {}) => ({
  d1: { name: 'budo-db' },
  r2: { bucket: 'budo-media', s3Endpoint: ENDPOINT },
  backup: { bucket: 'budo-backups', retention: { dailyDays: 35, monthlyMonths: 12, tombstoneDays: 90 } },
  ...overrides,
});
const staging = { d1: { name: 'budo-db-staging' }, r2: { bucket: 'budo-media-staging', s3Endpoint: ENDPOINT } };
const profile = (prod, stg = staging) => ({ label: 'budo', environments: { staging: stg, production: prod } });
const PROFILES = { budo: profile(production()) };
const NOW = new Date('2026-10-11T06:30:00.000Z');
const SOURCE = 'budo-media';
const DEST = 'budo-backups';
const PREFIX = 'r2/production/';
const INDEX_KEY = 'r2/production/index.json';
const MANIFEST_KEY = 'd1/production/manifest.json';
const CREDS = { R2_ACCESS_KEY_ID: 'AKIA-test', R2_SECRET_ACCESS_KEY: 'secret-test' };
const MUTATING = new Set(['CopyObjectCommand', 'DeleteObjectCommand', 'PutObjectCommand']);

const daysAgo = (days, from = NOW) => new Date(from.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
const decodeKey = (encoded) => encoded.split('/').map(decodeURIComponent).join('/');

/**
 * An in-memory S3: `buckets` maps a bucket name to a Map of key →
 * `{ etag, size, body? }`. ListObjectsV2 pages `pageSize` at a time; CopyObject
 * copies between buckets by (decoded) CopySource; Get/Put carry text bodies.
 * `failCopy` names source keys whose copy throws; `failDelete` names mirror keys.
 */
function fakeS3({ source = new Map(), dest = new Map(), pageSize = 2, failCopy = [], failDelete = [] } = {}) {
  const buckets = new Map([
    [SOURCE, source],
    ['budo-media-staging', new Map()],
    [DEST, dest],
  ]);
  const calls = [];
  const send = async (command) => {
    const name = command.constructor.name;
    const input = command.input;
    calls.push({ name, bucket: input.Bucket, key: input.Key, input });
    const bucket = buckets.get(input.Bucket);
    if (!bucket) throw Object.assign(new Error(`NoSuchBucket ${input.Bucket}`), { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } });
    switch (name) {
      case 'ListObjectsV2Command': {
        const keys = [...bucket.keys()].filter((key) => key.startsWith(input.Prefix ?? '')).sort();
        const start = input.ContinuationToken ? Number(input.ContinuationToken) : 0;
        const page = keys.slice(start, start + pageSize);
        const truncated = start + pageSize < keys.length;
        return {
          IsTruncated: truncated,
          NextContinuationToken: truncated ? String(start + pageSize) : undefined,
          Contents: page.map((key) => ({ Key: key, ETag: `"${bucket.get(key).etag}"`, Size: bucket.get(key).size })),
        };
      }
      case 'CopyObjectCommand': {
        const [, fromBucket, ...rest] = input.CopySource.split('/');
        const fromKey = decodeKey(rest.join('/'));
        if (failCopy.includes(fromKey)) throw new Error(`InternalError copying ${fromKey}`);
        const object = buckets.get(fromBucket)?.get(fromKey);
        if (!object) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
        bucket.set(input.Key, { ...object });
        return { CopyObjectResult: { ETag: `"${object.etag}"` } };
      }
      case 'DeleteObjectCommand':
        if (failDelete.includes(input.Key)) throw new Error(`InternalError deleting ${input.Key}`);
        bucket.delete(input.Key);
        return {};
      case 'GetObjectCommand': {
        const object = bucket.get(input.Key);
        if (!object) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
        return { Body: { transformToString: async () => object.body } };
      }
      case 'PutObjectCommand':
        bucket.set(input.Key, { etag: `etag-${calls.length}`, size: Buffer.byteLength(input.Body), body: input.Body });
        return {};
      case 'HeadObjectCommand': {
        const object = bucket.get(input.Key);
        if (!object) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
        return { ETag: `"${object.etag}"`, ContentLength: object.size };
      }
      default:
        throw new Error(`unexpected command ${name}`);
    }
  };
  const s3 = createS3({ send, readOnlyBuckets: [SOURCE, 'budo-media-staging'] });
  const mutatingOn = (bucketName) => calls.filter((call) => MUTATING.has(call.name) && call.bucket === bucketName);
  const index = () => {
    const stored = dest.get(INDEX_KEY);
    return stored ? JSON.parse(stored.body) : null;
  };
  return { s3, send, calls, buckets, source, dest, mutatingOn, index };
}

/** The manifest store (Task 02's shape): `getText` / `putFile`, in memory. */
function fakeStore(initial = {}) {
  const texts = new Map(Object.entries(initial));
  const puts = [];
  return {
    texts,
    puts,
    getText: (key) => texts.get(key) ?? null,
    putFile(key, path, contentType) {
      puts.push({ key, contentType });
      texts.set(key, readFileSync(path, 'utf8'));
    },
    manifest: () => (texts.has(MANIFEST_KEY) ? parseManifest(texts.get(MANIFEST_KEY)) : null),
  };
}

const seedSource = (entries) => new Map(entries.map(([key, etag, size]) => [key, { etag, size }]));
const target = (overrides = {}) => resolveMirrorTarget({ label: 'budo', env: 'production', profiles: PROFILES, ...overrides });
const run = (fake, store, options = {}) => runMirror(target(), { s3: fake.s3, store, now: NOW, log: quietLog, ...options });

/** Every mutating call of the run must target the backup bucket, never the source. */
function assertSourceUntouched(fake) {
  assert.equal(fake.mutatingOn(SOURCE).length, 0, 'no mutating call on the source bucket');
  assert.equal(fake.mutatingOn('budo-media-staging').length, 0, 'no mutating call on the staging media bucket');
  for (const call of fake.calls.filter((c) => MUTATING.has(c.name))) assert.equal(call.bucket, DEST, `${call.name} targets ${DEST}`);
}

// ── arguments ────────────────────────────────────────────────────────────────

test('parseArgs: label + env required, budget flags parsed with defaults, unknown option refused', () => {
  assert.deepEqual(parseArgs(['--label', 'budo', '-e', 'production']), {
    label: 'budo',
    env: 'production',
    dryRun: false,
    yes: false,
    scratch: false,
    maxBytes: DEFAULT_MAX_BYTES,
    maxSeconds: DEFAULT_MAX_SECONDS,
  });
  const full = parseArgs(['--label', 'budo', '-e', 'staging', '--scratch', '--dry-run', '--yes', '--max-bytes', '1024', '--max-seconds', '60']);
  assert.deepEqual(full, { label: 'budo', env: 'staging', dryRun: true, yes: true, scratch: true, maxBytes: 1024, maxSeconds: 60 });
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.throws(() => parseArgs(['-e', 'production']), /--label/);
  assert.throws(() => parseArgs(['--label', 'Budo', '-e', 'production']), /--label/);
  assert.throws(() => parseArgs(['--label', 'budo']), /-e\/--env/);
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'production', '--max-bytes', '0']), /--max-bytes must be a positive integer/);
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'production', '--max-seconds', 'x']), /--max-seconds must be a positive integer/);
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'production', '--force']), /invalid arguments/);
});

// ── target ───────────────────────────────────────────────────────────────────

test('resolveMirrorTarget: production of a complete profile', () => {
  assert.deepEqual(target(), {
    label: 'budo',
    env: 'production',
    scratch: false,
    source: SOURCE,
    dest: DEST,
    prefix: PREFIX,
    indexKey: INDEX_KEY,
    manifestKey: MANIFEST_KEY,
    endpoint: ENDPOINT,
    tombstoneDays: 90,
  });
});

test('resolveMirrorTarget: refuses staging, local and unknown environments without --scratch', () => {
  assert.throws(() => target({ env: 'staging' }), /refusing -e staging/);
  assert.throws(() => target({ env: 'local' }), /refusing -e local/);
  assert.throws(() => target({ env: 'prod' }), /unknown environment "prod"/);
});

test('resolveMirrorTarget: --scratch mirrors staging into the backup bucket under scratch/, never production', () => {
  assert.deepEqual(target({ env: 'staging', scratch: true }), {
    label: 'budo',
    env: 'staging',
    scratch: true,
    source: 'budo-media-staging',
    dest: DEST,
    prefix: 'scratch/staging/',
    indexKey: 'scratch/staging/index.json',
    manifestKey: null,
    endpoint: ENDPOINT,
    tombstoneDays: 90,
  });
  assert.throws(() => target({ env: 'production', scratch: true }), /refusing --scratch with -e production/);
  assert.throws(() => target({ env: 'local', scratch: true }), /refusing -e local/);
});

test('resolveMirrorTarget: refuses a missing profile, media bucket, endpoint, backup block or tombstone window', () => {
  assert.throws(() => target({ label: 'nope' }), /profile not found/);
  assert.throws(() => target({ profiles: { budo: profile(production({ r2: { s3Endpoint: ENDPOINT } })) } }), /no environments.production.r2.bucket/);
  assert.throws(() => target({ profiles: { budo: profile(production({ r2: { bucket: SOURCE } })) } }), /no environments.production.r2.s3Endpoint/);
  assert.throws(() => target({ profiles: { budo: profile(production({ backup: undefined })) } }), /no environments.production.backup.bucket/);
  assert.throws(
    () => target({ profiles: { budo: profile(production({ backup: { bucket: DEST, retention: { dailyDays: 35 } } })) } }),
    /tombstoneDays must be a positive integer/,
  );
});

test('resolveMirrorTarget: refuses a backup bucket that is a media bucket of any profile, its own included', () => {
  assert.throws(
    () => target({ profiles: { budo: profile(production({ backup: { bucket: SOURCE, retention: { tombstoneDays: 90 } } })) } }),
    /is its own production media bucket/,
  );
  const other = { label: 'spaziord', environments: { staging: { r2: { bucket: DEST } } } };
  assert.throws(() => target({ profiles: { budo: PROFILES.budo, spaziord: other } }), /is the staging media bucket of "spaziord"/);
});

test('resolveCredentials: names every missing variable, never a value', () => {
  assert.deepEqual(resolveCredentials(CREDS), { accessKeyId: 'AKIA-test', secretAccessKey: 'secret-test' });
  assert.throws(() => resolveCredentials({}), /missing R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY/);
  assert.throws(() => resolveCredentials({ R2_ACCESS_KEY_ID: 'AKIA-test' }), /^Error: missing R2_SECRET_ACCESS_KEY in the environment/);
  assert.throws(() => resolveCredentials({ R2_ACCESS_KEY_ID: 'AKIA-test', R2_SECRET_ACCESS_KEY: '  ' }), /missing R2_SECRET_ACCESS_KEY/);
  try {
    resolveCredentials({ R2_ACCESS_KEY_ID: 'AKIA-test' });
  } catch (error) {
    assert.ok(!error.message.includes('AKIA-test'), 'the message carries no credential value');
  }
  assert.deepEqual(CREDENTIAL_VARS, ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']);
});

// ── index + plan (pure) ──────────────────────────────────────────────────────

test('parseIndex: round-trips, refuses empty/invalid/foreign/other-version text', () => {
  const index = emptyIndex('budo', 'production');
  index.objects['a.mp4'] = { etag: 'e1', size: 1, mirroredAt: NOW.toISOString() };
  assert.deepEqual(parseIndex(serializeIndex(index), { label: 'budo', env: 'production' }), index);
  assert.throws(() => parseIndex('', { label: 'budo', env: 'production' }), /is empty/);
  assert.throws(() => parseIndex('{ nope', { label: 'budo', env: 'production' }), /not valid JSON/);
  assert.throws(() => parseIndex('[]', { label: 'budo', env: 'production' }), /not a JSON object/);
  assert.throws(() => parseIndex(JSON.stringify({ ...index, indexVersion: 2 }), { label: 'budo', env: 'production' }), /indexVersion 2/);
  assert.throws(() => parseIndex(serializeIndex(index), { label: 'spaziord', env: 'production' }), /belongs to "budo"\/"production"/);
  assert.throws(() => parseIndex(JSON.stringify({ ...index, tombstones: [] }), { label: 'budo', env: 'production' }), /tombstones must be an object/);
  assert.equal(serializeIndex({ ...index, objects: { b: 1, a: 2 } }), serializeIndex({ ...index, objects: { a: 2, b: 1 } }));
  assert.equal(mirrorKey(PREFIX, 'topics/x.mp4'), 'r2/production/topics/x.mp4');
});

test('planMirror: new, changed, restored, unchanged, tombstone and prune, with the window injected', () => {
  const index = emptyIndex('budo', 'production');
  index.objects['same.mp4'] = { etag: 'e1', size: 10, mirroredAt: daysAgo(5) };
  index.objects['changed.pdf'] = { etag: 'old', size: 20, mirroredAt: daysAgo(5) };
  index.objects['gone.png'] = { etag: 'e3', size: 30, mirroredAt: daysAgo(5) };
  index.tombstones['back.mp4'] = { etag: 'e4', size: 40, removedAt: daysAgo(10) };
  index.tombstones['fresh-tomb.mp4'] = { etag: 'e5', size: 50, removedAt: daysAgo(89) };
  index.tombstones['old-tomb.mp4'] = { etag: 'e6', size: 60, removedAt: daysAgo(90) };
  const sourceObjects = [
    { key: 'same.mp4', etag: 'e1', size: 10 },
    { key: 'changed.pdf', etag: 'new', size: 21 },
    { key: 'new.mp4', etag: 'e7', size: 70 },
    { key: 'back.mp4', etag: 'e4', size: 40 },
  ];
  const plan = planMirror({ sourceObjects, index, now: NOW, tombstoneDays: 90 });
  assert.deepEqual(plan, {
    toCopy: [
      { key: 'changed.pdf', etag: 'new', size: 21, reason: 'changed' },
      { key: 'new.mp4', etag: 'e7', size: 70, reason: 'new' },
      { key: 'back.mp4', etag: 'e4', size: 40, reason: 'restored' },
    ],
    toTombstone: ['gone.png'],
    toPrune: ['old-tomb.mp4'],
    unchanged: 1,
  });
  // The day before the window closes, nothing is pruned.
  const earlier = planMirror({ sourceObjects, index, now: new Date(NOW.getTime() - 1), tombstoneDays: 90 });
  assert.deepEqual(earlier.toPrune, []);
});

test('manifest r2 section: setR2LastRun validates the run shape and never mutates its input', () => {
  const run = {
    at: NOW.toISOString(),
    durationMs: 10,
    copied: { objects: 1, bytes: 2 },
    pending: { objects: 0, bytes: 0 },
    failed: 0,
    tombstoned: 0,
    pruned: 0,
    unchanged: 0,
    sourceObjects: 1,
    stoppedBy: null,
  };
  const base = emptyManifest('budo');
  const next = setR2LastRun(base, run);
  assert.equal(base.r2, null, 'input untouched');
  assert.deepEqual(next.r2, { lastRun: run });
  assert.deepEqual(parseManifest(serializeManifest(next)), next);
  assert.throws(() => validateR2Run({ ...run, at: 'yesterday' }), /at must be an ISO timestamp/);
  assert.throws(() => validateR2Run({ ...run, copied: { objects: -1, bytes: 0 } }), /copied.objects/);
  assert.throws(() => validateR2Run({ ...run, pending: null }), /pending must be/);
  assert.throws(() => validateR2Run({ ...run, pruned: 1.5 }), /pruned must be/);
  assert.throws(() => validateR2Run({ ...run, stoppedBy: 'ctrl-c' }), /stoppedBy must be one of/);
  assert.throws(() => parseManifest(JSON.stringify({ ...base, r2: [] })), /r2 must be null or \{ lastRun \}/);
  assert.throws(() => parseManifest(JSON.stringify({ ...base, r2: {} })), /r2 must be null or \{ lastRun \}/);
});

// ── refusals through main, before any call ───────────────────────────────────

test('main: -e staging/local without --scratch and --scratch -e production exit before any S3 call', async () => {
  for (const argv of [
    ['--label', 'budo', '-e', 'staging', '--yes'],
    ['--label', 'budo', '-e', 'local', '--yes'],
    ['--label', 'budo', '-e', 'production', '--scratch', '--yes'],
  ]) {
    const fake = fakeS3();
    await assert.rejects(main(argv, { profiles: PROFILES, envVars: CREDS, s3: fake.s3 }), /refusing/);
    assert.equal(fake.calls.length, 0, `${argv.join(' ')}: no S3 call`);
  }
});

test('main: missing credentials exit before any call, naming the variables — a dry run included', async () => {
  const fake = fakeS3();
  await assert.rejects(main(['--label', 'budo', '-e', 'production', '--dry-run'], { profiles: PROFILES, envVars: {}, s3: fake.s3 }), /missing R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY/);
  await assert.rejects(main(['--label', 'budo', '-e', 'production', '--yes'], { profiles: PROFILES, envVars: {}, s3: fake.s3 }), /missing R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY/);
  assert.equal(fake.calls.length, 0);
});

test('main: a real run without --yes is refused before any call', async () => {
  const fake = fakeS3();
  await assert.rejects(main(['--label', 'budo', '-e', 'production'], { profiles: PROFILES, envVars: CREDS, s3: fake.s3 }), /needs --yes/);
  assert.equal(fake.calls.length, 0);
});

test('main --dry-run: lists the source and reads the index, issues no mutating call', async () => {
  const fake = fakeS3({ source: seedSource([['a.mp4', 'e1', 10], ['b.pdf', 'e2', 20], ['c.png', 'e3', 30]]) });
  const store = fakeStore();
  const code = await main(['--label', 'budo', '-e', 'production', '--dry-run'], { profiles: PROFILES, envVars: CREDS, s3: fake.s3, store });
  assert.equal(code, 0);
  assert.ok(fake.calls.length > 0, 'the source was listed');
  assert.deepEqual([...new Set(fake.calls.map((c) => c.name))].sort(), ['GetObjectCommand', 'ListObjectsV2Command']);
  assert.equal(fake.calls.filter((c) => MUTATING.has(c.name)).length, 0);
  assert.equal(store.puts.length, 0);
  assert.equal(fake.index(), null);
});

// ── pipeline ─────────────────────────────────────────────────────────────────

test('first run copies every source object (paginated listing); a second run copies nothing', async () => {
  const fake = fakeS3({ source: seedSource([['topics/a.mp4', 'e1', 100], ['topics/Chūdan Jō.mp4', 'e2', 200], ['submissions/u1/s.mp4', 'e3', 300]]) });
  const store = fakeStore();

  const first = await run(fake, store);
  assert.equal(fake.calls.filter((c) => c.name === 'ListObjectsV2Command').length, 2, 'two pages were listed');
  assert.deepEqual(first.lastRun, {
    at: NOW.toISOString(),
    durationMs: first.lastRun.durationMs,
    copied: { objects: 3, bytes: 600 },
    pending: { objects: 0, bytes: 0 },
    failed: 0,
    tombstoned: 0,
    pruned: 0,
    unchanged: 0,
    sourceObjects: 3,
    stoppedBy: null,
  });
  for (const key of ['topics/a.mp4', 'topics/Chūdan Jō.mp4', 'submissions/u1/s.mp4']) {
    assert.ok(fake.dest.has(mirrorKey(PREFIX, key)), `${key} mirrored under the prefix`);
  }
  assert.deepEqual(Object.keys(fake.index().objects).sort(), ['submissions/u1/s.mp4', 'topics/Chūdan Jō.mp4', 'topics/a.mp4']);
  assert.equal(fake.index().objects['topics/a.mp4'].mirroredAt, NOW.toISOString());
  assertSourceUntouched(fake);

  const manifest = store.manifest();
  assert.equal(manifest.manifestVersion, 1);
  assert.deepEqual(manifest.r2.lastRun.copied, { objects: 3, bytes: 600 });
  assert.deepEqual(manifest.r2.lastRun.pending, { objects: 0, bytes: 0 });
  assert.equal(store.puts[0].contentType, 'application/json');

  const copiesBefore = fake.calls.filter((c) => c.name === 'CopyObjectCommand').length;
  const second = await run(fake, store, { now: new Date(NOW.getTime() + 60_000) });
  assert.equal(fake.calls.filter((c) => c.name === 'CopyObjectCommand').length, copiesBefore, 'no copy on the second run');
  assert.deepEqual(second.lastRun.copied, { objects: 0, bytes: 0 });
  assert.equal(second.lastRun.unchanged, 3);
  assert.equal(store.manifest().r2.lastRun.unchanged, 3);
  assertSourceUntouched(fake);
});

test('a changed ETag copies only that object', async () => {
  const fake = fakeS3({ source: seedSource([['a.mp4', 'e1', 10], ['b.pdf', 'e2', 20], ['c.png', 'e3', 30]]) });
  const store = fakeStore();
  await run(fake, store);
  fake.source.set('b.pdf', { etag: 'e2-rewritten', size: 25 });

  const copiesBefore = fake.calls.filter((c) => c.name === 'CopyObjectCommand').length;
  const result = await run(fake, store);
  const copies = fake.calls.filter((c) => c.name === 'CopyObjectCommand').slice(copiesBefore);
  assert.deepEqual(copies.map((c) => c.key), [mirrorKey(PREFIX, 'b.pdf')]);
  assert.deepEqual(result.plan.toCopy, [{ key: 'b.pdf', etag: 'e2-rewritten', size: 25, reason: 'changed' }]);
  assert.deepEqual(result.lastRun.copied, { objects: 1, bytes: 25 });
  assert.equal(result.lastRun.unchanged, 2);
  assert.equal(fake.index().objects['b.pdf'].etag, 'e2-rewritten');
  assert.equal(fake.dest.get(mirrorKey(PREFIX, 'b.pdf')).etag, 'e2-rewritten');
  assertSourceUntouched(fake);
});

test('a source deletion keeps the object in the mirror with a removal date; prune only after the window, on the dest only', async () => {
  const fake = fakeS3({ source: seedSource([['keep.mp4', 'e1', 10], ['gone.mp4', 'e2', 20]]) });
  const store = fakeStore();
  await run(fake, store);
  fake.source.delete('gone.mp4');

  // Pass that notices the removal: tombstone, no delete.
  const noticed = await run(fake, store, { now: new Date(NOW.getTime() + 1000) });
  assert.equal(noticed.lastRun.tombstoned, 1);
  assert.equal(noticed.lastRun.pruned, 0);
  assert.ok(fake.dest.has(mirrorKey(PREFIX, 'gone.mp4')), 'the mirror object survives the pass that notices the removal');
  assert.deepEqual(fake.index().tombstones['gone.mp4'], { etag: 'e2', size: 20, removedAt: new Date(NOW.getTime() + 1000).toISOString() });
  assert.equal(fake.index().objects['gone.mp4'], undefined);
  assert.equal(store.manifest().r2.lastRun.tombstoned, 1);
  assert.equal(fake.calls.filter((c) => c.name === 'DeleteObjectCommand').length, 0);

  // 89 days later: still kept.
  const removedAt = new Date(NOW.getTime() + 1000);
  const day89 = new Date(removedAt.getTime() + 89 * 24 * 60 * 60 * 1000);
  const early = await run(fake, store, { now: day89 });
  assert.equal(early.lastRun.pruned, 0);
  assert.ok(fake.dest.has(mirrorKey(PREFIX, 'gone.mp4')));

  // 90 days later: pruned from the backup bucket, the count reported.
  const day90 = new Date(removedAt.getTime() + 90 * 24 * 60 * 60 * 1000);
  const late = await run(fake, store, { now: day90 });
  assert.equal(late.lastRun.pruned, 1);
  assert.ok(!fake.dest.has(mirrorKey(PREFIX, 'gone.mp4')));
  assert.equal(fake.index().tombstones['gone.mp4'], undefined);
  const deletes = fake.calls.filter((c) => c.name === 'DeleteObjectCommand');
  assert.deepEqual(deletes.map((c) => [c.bucket, c.key]), [[DEST, mirrorKey(PREFIX, 'gone.mp4')]]);
  assert.equal(store.manifest().r2.lastRun.pruned, 1);
  assert.ok(fake.source.has('keep.mp4'), 'the source still holds what it held');
  assertSourceUntouched(fake);
});

test('a tombstoned object that reappears in the source is copied again and its tombstone cleared', async () => {
  const fake = fakeS3({ source: seedSource([['a.mp4', 'e1', 10]]) });
  const store = fakeStore();
  await run(fake, store);
  fake.source.delete('a.mp4');
  await run(fake, store, { now: new Date(NOW.getTime() + 1000) });
  assert.ok(fake.index().tombstones['a.mp4']);
  fake.source.set('a.mp4', { etag: 'e1', size: 10 });
  const back = await run(fake, store, { now: new Date(NOW.getTime() + 2000) });
  assert.deepEqual(back.plan.toCopy, [{ key: 'a.mp4', etag: 'e1', size: 10, reason: 'restored' }]);
  assert.equal(fake.index().tombstones['a.mp4'], undefined);
  assert.ok(fake.index().objects['a.mp4']);
  assertSourceUntouched(fake);
});

test('a failed prune keeps its tombstone so the next run retries', async () => {
  const fake = fakeS3({ source: seedSource([['a.mp4', 'e1', 10]]), failDelete: [mirrorKey(PREFIX, 'a.mp4')] });
  const store = fakeStore();
  await run(fake, store);
  fake.source.delete('a.mp4');
  await run(fake, store, { now: new Date(NOW.getTime() + 1000) });
  const later = await run(fake, store, { now: new Date(NOW.getTime() + 1000 + 91 * 24 * 60 * 60 * 1000) });
  assert.equal(later.lastRun.pruned, 0);
  assert.ok(fake.index().tombstones['a.mp4'], 'tombstone kept after the failed delete');
  assert.ok(fake.dest.has(mirrorKey(PREFIX, 'a.mp4')));
});

test('byte budget: stops cleanly with pending + stoppedBy, the index is persisted, and the next run resumes', async () => {
  const fake = fakeS3({ source: seedSource([['a.mp4', 'e1', 100], ['b.mp4', 'e2', 100], ['c.mp4', 'e3', 100], ['d.mp4', 'e4', 100]]) });
  const store = fakeStore();

  const first = await run(fake, store, { budget: { maxBytes: 250 } });
  assert.deepEqual(first.lastRun.copied, { objects: 2, bytes: 200 });
  assert.deepEqual(first.lastRun.pending, { objects: 2, bytes: 200 });
  assert.equal(first.lastRun.stoppedBy, 'maxBytes');
  assert.equal(first.lastRun.failed, 0);
  assert.deepEqual(Object.keys(fake.index().objects).sort(), ['a.mp4', 'b.mp4']);
  assert.deepEqual(store.manifest().r2.lastRun.pending, { objects: 2, bytes: 200 });
  assert.equal(store.manifest().r2.lastRun.stoppedBy, 'maxBytes');

  const second = await run(fake, store, { budget: { maxBytes: 250 }, now: new Date(NOW.getTime() + 1000) });
  assert.deepEqual(second.lastRun.copied, { objects: 2, bytes: 200 });
  assert.deepEqual(second.lastRun.pending, { objects: 0, bytes: 0 });
  assert.equal(second.lastRun.stoppedBy, null);
  assert.equal(second.lastRun.unchanged, 2);
  assert.deepEqual(Object.keys(fake.index().objects).sort(), ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4']);
  assertSourceUntouched(fake);
});

test('time budget: the injected clock stops the run with stoppedBy maxSeconds', async () => {
  const fake = fakeS3({ source: seedSource([['a.mp4', 'e1', 1], ['b.mp4', 'e2', 1], ['c.mp4', 'e3', 1]]) });
  const store = fakeStore();
  let ticks = 0;
  const clock = () => {
    ticks += 1;
    return ticks * 2000; // every read of the clock is 2 s later
  };
  const result = await run(fake, store, { budget: { maxSeconds: 3 }, clock });
  assert.equal(result.lastRun.stoppedBy, 'maxSeconds');
  assert.deepEqual(result.lastRun.copied, { objects: 1, bytes: 1 });
  assert.deepEqual(result.lastRun.pending, { objects: 2, bytes: 2 });
  assert.ok(result.lastRun.durationMs > 0);
});

test('index checkpoints every N copies, then once at the end', async () => {
  const fake = fakeS3({ source: seedSource([['a', 'e1', 1], ['b', 'e2', 1], ['c', 'e3', 1], ['d', 'e4', 1], ['e', 'e5', 1]]) });
  const store = fakeStore();
  await run(fake, store, { checkpointEvery: 2 });
  const indexPuts = fake.calls.filter((c) => c.name === 'PutObjectCommand' && c.key === INDEX_KEY);
  assert.equal(indexPuts.length, 3, 'two checkpoints (after 2 and 4 copies) + the final write');
});

test('a failed copy is counted as pending, the run continues, and main exits 1', async () => {
  const fake = fakeS3({ source: seedSource([['a.mp4', 'e1', 10], ['bad.mp4', 'e2', 20], ['c.mp4', 'e3', 30]]), failCopy: ['bad.mp4'] });
  const store = fakeStore();
  const result = await run(fake, store);
  assert.deepEqual(result.lastRun.copied, { objects: 2, bytes: 40 });
  assert.deepEqual(result.lastRun.pending, { objects: 1, bytes: 20 });
  assert.equal(result.lastRun.failed, 1);
  assert.equal(result.lastRun.stoppedBy, null);
  assert.deepEqual(result.failures.map((item) => item.key), ['bad.mp4']);
  assert.equal(fake.index().objects['bad.mp4'], undefined);
  assert.ok(fake.index().objects['c.mp4'], 'the object after the failure was still copied');

  const code = await main(['--label', 'budo', '-e', 'production', '--yes'], { profiles: PROFILES, envVars: CREDS, s3: fake.s3, store, now: NOW });
  assert.equal(code, 1);
  assertSourceUntouched(fake);
});

test('a corrupt index aborts before any copy; a corrupt manifest aborts after the index, before the manifest put', async () => {
  const fake = fakeS3({ source: seedSource([['a.mp4', 'e1', 10]]) });
  fake.dest.set(INDEX_KEY, { etag: 'x', size: 5, body: '{ not' });
  const store = fakeStore();
  await assert.rejects(run(fake, store), /index.json is not valid JSON/);
  assert.equal(fake.calls.filter((c) => MUTATING.has(c.name)).length, 0);

  fake.dest.delete(INDEX_KEY);
  const broken = fakeStore({ [MANIFEST_KEY]: '{ broken' });
  await assert.rejects(run(fake, broken), /manifest.json is not valid JSON/);
  assert.equal(broken.puts.length, 0);
  assert.ok(fake.index(), 'the index was still written (the copies happened)');

  const foreign = fakeStore({ [MANIFEST_KEY]: serializeManifest(emptyManifest('spaziord')) });
  await assert.rejects(run(fake, foreign), /belongs to label "spaziord"/);
  assert.equal(foreign.puts.length, 0);
});

test('the manifest keeps its d1 section and gains r2.lastRun; a second run replaces it', async () => {
  const fake = fakeS3({ source: seedSource([['a.mp4', 'e1', 10]]) });
  const existing = emptyManifest('budo');
  existing.d1.monthly.push({ month: '2026-10', key: 'd1/production/monthly/2026/10/x.sql.gz', ts: NOW.toISOString() });
  const store = fakeStore({ [MANIFEST_KEY]: serializeManifest(existing) });
  await run(fake, store);
  const manifest = store.manifest();
  assert.deepEqual(manifest.d1, existing.d1);
  assert.equal(manifest.r2.lastRun.at, NOW.toISOString());
  const later = new Date(NOW.getTime() + 5000);
  await run(fake, store, { now: later });
  assert.equal(store.manifest().r2.lastRun.at, later.toISOString());
  assert.equal(store.puts.length, 2);
});

test('--scratch: staging source → backup bucket under scratch/staging/, no production manifest write', async () => {
  const fake = fakeS3();
  fake.buckets.get('budo-media-staging').set('topics/s.mp4', { etag: 's1', size: 7 });
  const store = fakeStore({ [MANIFEST_KEY]: serializeManifest(emptyManifest('budo')) });
  const before = store.texts.get(MANIFEST_KEY);
  const code = await main(['--label', 'budo', '-e', 'staging', '--scratch', '--yes'], { profiles: PROFILES, envVars: CREDS, s3: fake.s3, store, now: NOW });
  assert.equal(code, 0);
  assert.ok(fake.dest.has('scratch/staging/topics/s.mp4'));
  assert.ok(fake.dest.has('scratch/staging/index.json'));
  assert.ok(!fake.dest.has(INDEX_KEY), 'the production index is untouched');
  assert.equal(store.puts.length, 0, 'the production manifest is never written by a scratch run');
  assert.equal(store.texts.get(MANIFEST_KEY), before);
  assert.equal(fake.mutatingOn('budo-media-staging').length, 0);
  assert.equal(fake.mutatingOn(SOURCE).length, 0);
});

test('main: a real run with --yes drives runMirror and honours the budget flags', async () => {
  const fake = fakeS3({ source: seedSource([['a.mp4', 'e1', 100], ['b.mp4', 'e2', 100]]) });
  const store = fakeStore();
  const code = await main(['--label', 'budo', '-e', 'production', '--yes', '--max-bytes', '150'], {
    profiles: PROFILES,
    envVars: CREDS,
    s3: fake.s3,
    store,
    now: NOW,
  });
  assert.equal(code, 0);
  assert.equal(store.manifest().r2.lastRun.stoppedBy, 'maxBytes');
  assert.deepEqual(store.manifest().r2.lastRun.copied, { objects: 1, bytes: 100 });
  assertSourceUntouched(fake);
});
