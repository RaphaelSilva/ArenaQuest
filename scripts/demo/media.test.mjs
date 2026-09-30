/**
 * Unit tests for scripts/demo/media.mjs and the media step of seed-demo.mjs —
 * key shape, cache hit/miss, checksum mismatch, validation refusal and "no SQL
 * when an upload fails". Wrangler and fetch are stubbed: no network, no wrangler.
 * Run with: node --test scripts/demo/media.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDataset } from './dataset.mjs';
import { demoId, demoMediaKey } from './ids.mjs';
import {
  assertValidMedia,
  buildMediaPlan,
  cachePath,
  createR2,
  defaultLocalPersistTo,
  ensureCached,
  formatMediaPlan,
  localBucketName,
  materialiseMedia,
  mediaStorageKey,
  mediaTarget,
  openLocalR2,
  resolveMediaPlan,
  sanitizeFileName,
} from './media.mjs';
import { main } from './seed-demo.mjs';
import { mediaSection } from './sql.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ctx = { label: 'budo', id: (entity, key) => demoId('budo', entity, key) };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const scratch = () => mkdtempSync(join(tmpdir(), 'demo-media-'));

/** A manifest entry backed by `bytes`. */
function fileOf(key, fileName, type, bytes) {
  return { key, fileName, type, sizeBytes: bytes.length, url: `https://example.test/${fileName}`, sha256: sha(bytes), license: 'CC0', source: 'test' };
}

/** In-memory bucket behind the `createR2` interface; `failPut(key)` makes a put throw. */
function memoryR2({ failPut = () => false } = {}) {
  const objects = new Map();
  const calls = { get: 0, put: [] };
  return {
    objects,
    calls,
    async get(key) {
      calls.get += 1;
      return objects.get(key) ?? null;
    },
    async put(key, file, contentType) {
      if (failPut(key)) throw new Error(`wrangler r2 object put ${key} failed (status 1)`);
      calls.put.push({ key, contentType });
      objects.set(key, readFileSync(file));
    },
  };
}

function stubFetch(table) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const bytes = table[url];
    if (!bytes) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
  };
  return { fetchImpl, calls };
}

const IMAGE = Buffer.from('fake-jpeg-bytes');
const PDF = Buffer.from('%PDF-1.4 fake');
const VIDEO = Buffer.from('fake-mp4-bytes-0123456789');

/** The real budo dataset with its three files swapped for small synthetic ones. */
function syntheticDataset() {
  const dataset = structuredClone(loadDataset('budo'));
  const bytes = { 'sample-image': IMAGE, 'sample-pdf': PDF, 'sample-video': VIDEO };
  dataset.media.manifest = dataset.media.manifest.map((file) => fileOf(file.key, file.fileName, file.type, bytes[file.key]));
  return { dataset, fetchTable: Object.fromEntries(dataset.media.manifest.map((file) => [file.url, bytes[file.key]])) };
}

// ── keys ────────────────────────────────────────────────────────────────────

test('sanitizeFileName matches the API controller (parity with the TS source)', async () => {
  const source = readFileSync(join(ROOT, 'apps', 'api', 'src', 'controllers', 'admin-media.controller.ts'), 'utf8');
  const match = source.match(/export function sanitizeFileName\(name: string\): string \{[\s\S]*?\n\}/);
  assert.ok(match, 'sanitizeFileName(name: string): string not found in admin-media.controller.ts');
  const js = match[0].replace('(name: string): string', '(name)');
  const api = (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)).sanitizeFileName;
  for (const name of ['Apollo 17 — Blue Marble.JPG', '--a--b--', '', '!!!', 'x'.repeat(150) + '.pdf', 'Chūdan Kata.mp4', 'a..b__c.PNG']) {
    assert.equal(sanitizeFileName(name), api(name), name);
  }
});

test('every key is topics/<topicId>/<mediaId>-<name>, with deterministic ids', () => {
  const dataset = loadDataset('budo');
  const plan = buildMediaPlan(dataset, ctx);
  assert.equal(plan.length, Object.values(dataset.media.assign).reduce((n, keys) => n + keys.length, 0));
  assert.equal(new Set(plan.map((entry) => entry.topicKey)).size, 21);
  assert.equal(new Set(plan.map((entry) => entry.key)).size, plan.length);
  for (const entry of plan) {
    const topicId = demoId('budo', 'topic', entry.topicKey);
    const mediaId = demoId('budo', 'media', demoMediaKey(entry.topicKey, entry.manifestKey));
    assert.equal(entry.topicId, topicId);
    assert.equal(entry.id, mediaId);
    assert.equal(entry.key, `topics/${topicId}/${mediaId}-${sanitizeFileName(entry.file.fileName)}`);
    assert.match(entry.key, /^topics\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[a-z0-9._-]+$/);
    assert.equal(entry.uploadedBy, demoId('budo', 'user', 'creator'));
  }
  assert.equal(mediaStorageKey('t', 'm', 'My File.PDF'), 'topics/t/m-my-file.pdf');
});

test('media rows are ready, owned by the demo creator and keyed like the plan', () => {
  const dataset = loadDataset('budo');
  const { statements, counts } = mediaSection.build(dataset, ctx);
  const plan = buildMediaPlan(dataset, ctx);
  assert.equal(counts.media, plan.length);
  statements.forEach((statement, at) => {
    assert.match(statement, /^INSERT INTO media \(/);
    assert.ok(statement.includes(`'${plan[at].id}'`));
    assert.ok(statement.includes(`'${plan[at].key}'`));
    assert.ok(statement.includes(`'${demoId('budo', 'user', 'creator')}'`));
    assert.ok(statement.includes("'ready'"));
    assert.ok(statement.includes(`${plan[at].file.sizeBytes}`));
    assert.match(statement, /ON CONFLICT\(id\) DO UPDATE/);
  });
});

test('the local bucket is the top-level R2 binding; staging needs its profile bucket', () => {
  assert.equal(localBucketName(), 'arenaquest-media');
  assert.deepEqual(mediaTarget({ remote: false }), { bucket: 'arenaquest-media', args: ['--local'], concurrency: 4, local: true, persistTo: null });
  assert.deepEqual(mediaTarget({ remote: false, persistTo: '/tmp/state' }), {
    bucket: 'arenaquest-media',
    args: ['--local', '--persist-to', '/tmp/state'],
    concurrency: 4,
    local: true,
    persistTo: '/tmp/state',
  });
  assert.deepEqual(mediaTarget({ remote: true, env: 'staging', bucket: 'budo-media-staging' }), {
    bucket: 'budo-media-staging',
    args: ['--remote'],
    concurrency: 4,
    local: false,
  });
  assert.throws(() => mediaTarget({ remote: true, env: 'staging' }), /no R2 bucket/);
});

test('createR2 maps "no such key" to null, other failures to an error, and passes the content type', async () => {
  const seen = [];
  const run = async (argv) => {
    seen.push(argv);
    if (argv[3] === 'b/missing') return { status: 1, stdout: Buffer.alloc(0), stderr: 'ERROR The specified key does not exist.' };
    if (argv[3] === 'b/broken') return { status: 1, stdout: Buffer.alloc(0), stderr: 'Authentication error' };
    return { status: 0, stdout: Buffer.from('x'), stderr: '' };
  };
  const r2 = createR2({ bucket: 'b', args: ['--local'] }, run);
  assert.equal(await r2.get('missing'), null);
  await assert.rejects(() => r2.get('broken'), /Authentication error/);
  assert.deepEqual(await r2.get('ok'), Buffer.from('x'));
  await r2.put('k', '/tmp/f', 'image/jpeg');
  assert.deepEqual(seen.at(-1), ['r2', 'object', 'put', 'b/k', '--local', '--file', '/tmp/f', '--content-type', 'image/jpeg']);
});

/** A stand-in for wrangler's `getPlatformProxy`: records its options, serves an in-memory `R2`. */
function fakePlatformProxy() {
  const objects = new Map();
  const seen = { options: null, disposed: 0 };
  const R2 = {
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) } : null;
    },
    async put(key, value, options) {
      objects.set(key, Buffer.from(value));
      seen.lastPut = { key, contentType: options?.httpMetadata?.contentType };
    },
  };
  const getPlatformProxy = async (options) => {
    seen.options = options;
    return { env: { R2 }, dispose: async () => void (seen.disposed += 1) };
  };
  return { getPlatformProxy, objects, seen };
}

test('openLocalR2 serves the local bucket in-process over <persistTo>/v3, and only that bucket', async () => {
  const dir = scratch();
  const file = join(dir, 'a.jpg');
  writeFileSync(file, IMAGE);
  const { getPlatformProxy, seen } = fakePlatformProxy();
  const r2 = await openLocalR2({ bucket: 'arenaquest-media', persistTo: join(dir, 'state'), getPlatformProxy });
  assert.equal(seen.options.persist.path, join(dir, 'state', 'v3'), 'the layout `wrangler --persist-to` uses');
  assert.equal(seen.options.remoteBindings, false);
  assert.equal(seen.options.configPath, join(ROOT, 'apps', 'api', 'wrangler.jsonc'));
  assert.equal(await r2.get('topics/t/m-a.jpg'), null);
  await r2.put('topics/t/m-a.jpg', file, 'image/jpeg');
  assert.deepEqual(seen.lastPut, { key: 'topics/t/m-a.jpg', contentType: 'image/jpeg' });
  assert.deepEqual(await r2.get('topics/t/m-a.jpg'), IMAGE);
  await r2.dispose();
  assert.equal(seen.disposed, 1);

  await assert.rejects(() => openLocalR2({ bucket: 'budo-media-staging', getPlatformProxy }), /local bucket is "arenaquest-media"/);
  rmSync(dir, { recursive: true, force: true });
});

test('without --persist-to the local proxy uses the store wrangler --local defaults to', async () => {
  const { getPlatformProxy, seen } = fakePlatformProxy();
  const r2 = await openLocalR2({ bucket: 'arenaquest-media', getPlatformProxy });
  assert.equal(seen.options.persist.path, join(defaultLocalPersistTo(), 'v3'));
  assert.equal(defaultLocalPersistTo(), join(ROOT, 'apps', 'api', '.wrangler', 'state'));
  await r2.dispose();
});

// ── validation ──────────────────────────────────────────────────────────────

test('validateMediaFile refuses a disallowed or oversized file, naming the entry', () => {
  assert.throws(() => assertValidMedia(fileOf('bad-type', 'clip.mov', 'video/quicktime', Buffer.from('x'))), /media\.manifest\["bad-type"\].*validateMediaFile.*unsupported extension/);
  const huge = { ...fileOf('huge', 'big.jpg', 'image/jpeg', Buffer.from('x')), sizeBytes: 6 * 1024 * 1024 };
  assert.throws(() => assertValidMedia(huge), /media\.manifest\["huge"\].*exceeds the API limit/);
  assert.throws(() => assertValidMedia(fileOf('mismatch', 'a.pdf', 'image/png', Buffer.from('x'))), /declared type image\/png/);
  assert.equal(assertValidMedia(fileOf('ok', 'a.pdf', 'application/pdf', PDF)), 'application/pdf');
});

test('resolveMediaPlan refuses an invalid manifest before touching the bucket', async () => {
  const { dataset } = syntheticDataset();
  dataset.media.manifest[0] = { ...dataset.media.manifest[0], sizeBytes: 50 * 1024 * 1024 };
  const r2 = memoryR2();
  await assert.rejects(() => resolveMediaPlan(buildMediaPlan(dataset, ctx), { r2, cacheDir: scratch() }), /sample-image.*exceeds/);
  assert.equal(r2.calls.get, 0);
});

// ── cache and download ──────────────────────────────────────────────────────

test('cache miss downloads, verifies and caches; a hit does not fetch', async () => {
  const cacheDir = scratch();
  const file = fileOf('sample-pdf', 'a.pdf', 'application/pdf', PDF);
  const { fetchImpl, calls } = stubFetch({ [file.url]: PDF });
  const path = await ensureCached(file, { cacheDir, fetchImpl });
  assert.equal(path, cachePath(cacheDir, file.sha256));
  assert.deepEqual(readFileSync(path), PDF);
  assert.equal(calls.length, 1);
  await ensureCached(file, { cacheDir, fetchImpl });
  assert.equal(calls.length, 1);
  // A corrupt cache entry is not trusted: it is fetched again.
  writeFileSync(path, 'corrupt');
  await ensureCached(file, { cacheDir, fetchImpl });
  assert.equal(calls.length, 2);
  rmSync(cacheDir, { recursive: true, force: true });
});

test('a SHA-256 mismatch aborts naming the entry, and nothing is cached', async () => {
  const cacheDir = scratch();
  const file = fileOf('sample-pdf', 'a.pdf', 'application/pdf', PDF);
  const { fetchImpl } = stubFetch({ [file.url]: Buffer.from('tampered') });
  await assert.rejects(() => ensureCached(file, { cacheDir, fetchImpl }), /media\.manifest\["sample-pdf"\]: SHA-256 mismatch/);
  assert.equal(existsSync(cachePath(cacheDir, file.sha256)), false);
  await assert.rejects(() => ensureCached({ ...file, url: 'https://example.test/404' }, { cacheDir, fetchImpl }), /HTTP 404/);
  rmSync(cacheDir, { recursive: true, force: true });
});

test('the plan says exists / stale / cached / download without writing anything', async () => {
  const cacheDir = scratch();
  const { dataset } = syntheticDataset();
  const plan = buildMediaPlan(dataset, ctx);
  const r2 = memoryR2();
  const image = plan.find((entry) => entry.manifestKey === 'sample-image');
  const pdf = plan.find((entry) => entry.manifestKey === 'sample-pdf');
  r2.objects.set(image.key, IMAGE);
  r2.objects.set(pdf.key, Buffer.from('old bytes'));
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cachePath(cacheDir, sha(VIDEO)), VIDEO);

  const resolved = await resolveMediaPlan(plan, { r2, cacheDir });
  const byKey = new Map(resolved.map((entry) => [entry.key, entry]));
  assert.equal(byKey.get(image.key).state, 'exists');
  assert.deepEqual([byKey.get(pdf.key).state, byKey.get(pdf.key).source], ['stale', 'download']);
  for (const entry of resolved.filter((e) => e.manifestKey === 'sample-video')) assert.equal(entry.source, 'cached');
  assert.equal(r2.calls.put.length, 0);
  assert.match(formatMediaPlan(resolved).join('\n'), /^exists .*sample-image/m);
  assert.match(formatMediaPlan(resolved).join('\n'), /^stale→download .*sample-pdf/m);
  rmSync(cacheDir, { recursive: true, force: true });
});

// ── upload ──────────────────────────────────────────────────────────────────

test('materialise uploads what is missing with its content type; a second pass uploads nothing', async () => {
  const cacheDir = scratch();
  const { dataset, fetchTable } = syntheticDataset();
  const plan = buildMediaPlan(dataset, ctx);
  const r2 = memoryR2();
  const { fetchImpl, calls } = stubFetch(fetchTable);
  const first = await materialiseMedia(await resolveMediaPlan(plan, { r2, cacheDir }), { r2, cacheDir, fetchImpl });
  assert.deepEqual(first, { uploaded: plan.length, skipped: 0 });
  assert.equal(calls.length, 3, 'each manifest file is downloaded once');
  for (const entry of plan) assert.equal(sha(r2.objects.get(entry.key)), entry.file.sha256);
  assert.ok(r2.calls.put.every(({ key, contentType }) => contentType === plan.find((e) => e.key === key).file.type));

  const again = await resolveMediaPlan(plan, { r2, cacheDir });
  assert.ok(again.every((entry) => entry.state === 'exists'));
  assert.deepEqual(await materialiseMedia(again, { r2, cacheDir, fetchImpl }), { uploaded: 0, skipped: plan.length });
  assert.equal(r2.calls.put.length, plan.length);
  rmSync(cacheDir, { recursive: true, force: true });
});

test('a declared size that is not the real byte count is refused', async () => {
  const cacheDir = scratch();
  const file = { ...fileOf('sample-pdf', 'a.pdf', 'application/pdf', PDF), sizeBytes: PDF.length + 1 };
  const entry = { key: 'topics/t/m-a.pdf', manifestKey: 'sample-pdf', topicKey: 't', file, state: 'missing', source: 'download' };
  const { fetchImpl } = stubFetch({ [file.url]: PDF });
  await assert.rejects(() => materialiseMedia([entry], { r2: memoryR2(), cacheDir, fetchImpl }), /sizeBytes is/);
  rmSync(cacheDir, { recursive: true, force: true });
});

// ── the CLI: the SQL runs only after every object is confirmed ─────────────────

async function runMain({ failPut = () => false, fetchTable, r2 = memoryR2({ failPut }) } = {}) {
  const dir = scratch();
  const { dataset, fetchTable: table } = syntheticDataset();
  const executed = [];
  let disposed = 0;
  let disposedBeforeSql = null;
  const deps = {
    // The local target's bucket, in memory (the real one is openLocalR2).
    openLocalR2: async (bucket) => {
      assert.equal(bucket.local, true);
      return { get: r2.get, put: r2.put, dispose: async () => void (disposed += 1) };
    },
    fetchImpl: stubFetch(fetchTable ?? table).fetchImpl,
    executeSql: (command) => {
      if (command.includes('--command')) {
        // The read-only user_xp check after the seed: answer "consistent" for every id asked.
        const ids = command[command.indexOf('--command') + 1].match(/[0-9a-f]{8}-[0-9a-f-]{27}/g) ?? [];
        const results = ids.map((id) => ({ user_id: id, total_xp: 0, ledger_xp: 0 }));
        return { status: 0, stdout: JSON.stringify([{ results, success: true }]), stderr: '' };
      }
      executed.push(command);
      disposedBeforeSql = disposed;
      return { status: 0, stdout: '', stderr: '' };
    },
    cacheDir: join(dir, 'cache'),
    sqlFile: join(dir, 'seed.sql'),
    dataset,
  };
  try {
    const code = await main(['--label', 'budo', '-e', 'local'], { AQ_DEMO_PASSWORD: 'throwaway' }, deps);
    return { code, executed, r2, dir, disposed, disposedBeforeSql };
  } catch (error) {
    return { error, executed, r2, dir, disposed };
  }
}

test('main: an upload failure aborts before the SQL runs', async () => {
  let puts = 0;
  const result = await runMain({ failPut: () => ++puts === 5 });
  assert.match(result.error?.message ?? '', /put .* failed/);
  assert.equal(result.executed.length, 0, 'no media row may be written without its object');
  assert.equal(result.disposed, 1, 'the local store is closed on failure too');
  rmSync(result.dir, { recursive: true, force: true });
});

test('main: a checksum mismatch aborts before any upload and before the SQL', async () => {
  const { fetchTable } = syntheticDataset();
  const tampered = Object.fromEntries(Object.entries(fetchTable).map(([url, bytes]) => [url, url.endsWith('.pdf') ? Buffer.from('evil') : bytes]));
  const result = await runMain({ fetchTable: tampered });
  assert.match(result.error?.message ?? '', /sample-pdf.*SHA-256 mismatch/);
  assert.equal(result.r2.calls.put.length, 0);
  assert.equal(result.executed.length, 0);
  rmSync(result.dir, { recursive: true, force: true });
});

test('main: objects first, then one d1 execute; a re-run uploads nothing', async () => {
  const first = await runMain();
  assert.equal(first.code, 0, first.error?.message);
  assert.equal(first.executed.length, 1);
  assert.equal(first.disposedBeforeSql, 1, 'the local store is closed before wrangler runs the SQL');
  assert.match(readFileSync(join(first.dir, 'seed.sql'), 'utf8'), /INSERT INTO media/);
  const uploads = first.r2.calls.put.length;
  assert.ok(uploads > 0);
  const second = await runMain({ r2: first.r2 });
  assert.equal(second.code, 0, second.error?.message);
  assert.equal(first.r2.calls.put.length, uploads, 'second run uploaded nothing');
  rmSync(first.dir, { recursive: true, force: true });
  rmSync(second.dir, { recursive: true, force: true });
});
