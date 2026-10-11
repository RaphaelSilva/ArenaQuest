/**
 * Unit tests for scripts/backup/pull.mjs — arguments, the plan, the refusals
 * (asserted to happen before any wrangler call), the fresh and the resumed
 * pull, the SHA-256 mismatch, a failed object, a missing index, the dry run,
 * and the one invariant that makes the read-only token enough: every call is
 * `r2 object get` on the BACKUP bucket. No network, no credentials; the
 * filesystem is real, in a temp dir.
 * Run with: node --test scripts/backup/pull.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { resolveBackupTarget } from './export-d1.mjs';
import { MANIFEST_KEY, appendD1Entry, emptyManifest, serializeManifest } from './manifest.mjs';
import { emptyIndex, quietLog, serializeIndex } from './mirror-r2.mjs';
import { INDEX_KEY, MIRROR_PREFIX, assertSafeKey, defaultOutDir, localPaths, main, parseArgs, planPull, runPull } from './pull.mjs';
import { parseLedger } from './status.mjs';

const PROFILES = {
  budo: {
    label: 'budo',
    environments: {
      staging: { d1: { name: 'budo-db-staging' }, r2: { bucket: 'budo-media-staging' } },
      production: {
        d1: { name: 'budo-db' },
        r2: { bucket: 'budo-media' },
        backup: { bucket: 'budo-backups', retention: { dailyDays: 35, monthlyMonths: 12, tombstoneDays: 90 } },
      },
    },
  },
};
const NOW = new Date('2026-10-18T09:30:00.000Z');
const DUMP_TS = '2026-10-17T07:30:02.000Z';
const DAILY = 'd1/production/daily/2026/10/17/2026-10-17T07-30-02Z.sql.gz';
const GZ = gzipSync(Buffer.from("CREATE TABLE users (id TEXT);\nINSERT INTO users VALUES ('u1');\n"), { level: 9 });
const ROW_COUNTS = { topic_nodes: 7, users: 3 };
const MEDIA = {
  'topics/t1/media/m1/kata.mp4': Buffer.from('video-bytes-aaaaaaaa'),
  'topics/t1/media/m2/flyer.pdf': Buffer.from('pdf-bytes'),
  'submissions/u1/s1.mp4': Buffer.from('gone-but-mirrored'),
};

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const target = () => resolveBackupTarget({ label: 'budo', env: 'production', profiles: PROFILES });

function manifestWith({ gz = GZ, latest = true } = {}) {
  const base = emptyManifest('budo');
  if (!latest) return base;
  return appendD1Entry(base, { ts: DUMP_TS, key: DAILY, bytes: gz.length, sha256: sha256(gz), rowCounts: ROW_COUNTS, durationMs: 4100 });
}

function indexWith({ tombstone = 'submissions/u1/s1.mp4' } = {}) {
  const index = emptyIndex('budo', 'production');
  for (const [key, bytes] of Object.entries(MEDIA)) {
    const entry = { etag: `"${sha256(bytes).slice(0, 32)}"`, size: bytes.length };
    if (key === tombstone) index.tombstones[key] = { ...entry, removedAt: '2026-10-10T07:30:00.000Z' };
    else index.objects[key] = { ...entry, mirroredAt: '2026-10-11T07:30:00.000Z' };
  }
  return index;
}

/** The backup bucket as a Map of key → bytes, and a wrangler stub that only knows `r2 object get`. */
function fakeBucket({ manifest = manifestWith(), index = indexWith(), gz = GZ, media = MEDIA, failKeys = [] } = {}) {
  const objects = new Map();
  if (manifest) objects.set(MANIFEST_KEY, Buffer.from(serializeManifest(manifest)));
  if (index) objects.set(INDEX_KEY, Buffer.from(serializeIndex(index)));
  if (gz) objects.set(DAILY, Buffer.from(gz));
  for (const [key, bytes] of Object.entries(media)) objects.set(`${MIRROR_PREFIX}${key}`, bytes);
  const calls = [];
  const run = (argv) => {
    calls.push(argv);
    assert.deepEqual(argv.slice(0, 5), ['pnpm', '--filter', 'api', 'exec', 'wrangler']);
    if (argv[5] !== 'r2' || argv[6] !== 'object' || argv[7] !== 'get') return { status: 1, stdout: '', stderr: `unexpected command: ${argv.slice(5).join(' ')}` };
    const [bucket, ...rest] = argv[8].split('/');
    const key = rest.join('/');
    if (bucket !== 'budo-backups') return { status: 1, stdout: '', stderr: `unexpected bucket: ${bucket}` };
    if (failKeys.includes(key)) return { status: 1, stdout: '', stderr: '✘ [ERROR] A network error occurred' };
    if (!objects.has(key)) return { status: 1, stdout: '', stderr: '✘ [ERROR] The specified key does not exist. [code: 10007]' };
    writeFileSync(argv[argv.indexOf('--file') + 1], objects.get(key));
    return { status: 0, stdout: 'Downloaded', stderr: '' };
  };
  return { run, calls, objects };
}

async function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'aq-pull-test-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A pull with the ledger captured in memory; returns `{ result, ledger, calls, out }`. */
async function pull(dir, { bucket = fakeBucket(), concurrency = 2, dryRun = false } = {}) {
  const out = join(dir, 'backups');
  const ledgers = [];
  const result = await runPull(target(), {
    log: quietLog,
    run: bucket.run,
    out,
    concurrency,
    now: NOW,
    dryRun,
    writeLedger: (path, text) => ledgers.push({ path, text }),
    ledgerFile: join(dir, 'ledger.json'),
  });
  return { result, ledgers, calls: bucket.calls, out };
}

// ── arguments ───────────────────────────────────────────────────────────────

test('parseArgs: label + env required, concurrency validated, defaults', () => {
  assert.deepEqual(parseArgs(['--label', 'budo', '-e', 'production']), { label: 'budo', env: 'production', out: null, concurrency: 3, dryRun: false });
  assert.deepEqual(parseArgs(['--label', 'budo', '-e', 'production', '--out', '/tmp/x', '--concurrency', '5', '--dry-run']), {
    label: 'budo',
    env: 'production',
    out: '/tmp/x',
    concurrency: 5,
    dryRun: true,
  });
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.throws(() => parseArgs(['-e', 'production']), /--label/);
  assert.throws(() => parseArgs(['--label', 'budo']), /-e\/--env/);
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'production', '--concurrency', '0']), /--concurrency/);
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'production', '--yes']), /invalid arguments/);
});

test('defaultOutDir and localPaths: .arenaquest/backups/<label>-<env> with d1/ and r2/ below', () => {
  assert.equal(defaultOutDir('budo', 'production', '/repo'), join('/repo', '.arenaquest', 'backups', 'budo-production'));
  const paths = localPaths('/out');
  assert.equal(paths.manifestCopy, join('/out', 'd1', 'manifest.json'));
  assert.equal(paths.indexCopy, join('/out', 'r2', 'index.json'));
  assert.equal(paths.dumpPath(DAILY), join('/out', 'd1', '2026-10-17T07-30-02Z.sql.gz'));
  assert.equal(paths.objectPath('topics/t1/a.mp4'), join('/out', 'r2', 'topics', 't1', 'a.mp4'));
});

test('assertSafeKey: a key from the cloud index cannot climb out of r2/', () => {
  assert.equal(assertSafeKey('topics/t1/a.mp4'), 'topics/t1/a.mp4');
  for (const bad of ['', '/etc/passwd', '../x', 'a/../../x', 'a//b', 'a/./b', 'a\\b']) assert.throws(() => assertSafeKey(bad), /unsafe|empty/);
});

// ── plan ────────────────────────────────────────────────────────────────────

test('planPull: everything needed on an empty disk, tombstoned keys included', () => {
  const plan = planPull({ manifest: manifestWith(), index: indexWith(), local: { dump: null, objects: {} } });
  assert.deepEqual(plan.dump, { key: DAILY, bytes: GZ.length, sha256: sha256(GZ), needed: true });
  assert.equal(plan.objects.length, 3);
  assert.ok(plan.objects.every((item) => item.needed));
  const tomb = plan.objects.find((item) => item.key === 'submissions/u1/s1.mp4');
  assert.equal(tomb.tombstoned, true);
  assert.equal(plan.objects.filter((item) => item.tombstoned).length, 1);
  assert.equal(plan.skipped, 0);
  assert.equal(plan.totalBytes, GZ.length + Object.values(MEDIA).reduce((sum, b) => sum + b.length, 0));
});

test('planPull: absent → needed; size differs → needed; sha differs → dump needed; matching → skipped', () => {
  const index = indexWith();
  const local = {
    dump: { bytes: GZ.length, sha256: sha256(GZ) },
    objects: { 'topics/t1/media/m1/kata.mp4': { size: MEDIA['topics/t1/media/m1/kata.mp4'].length }, 'topics/t1/media/m2/flyer.pdf': { size: 1 } },
  };
  const plan = planPull({ manifest: manifestWith(), index, local });
  assert.equal(plan.dump.needed, false);
  const by = Object.fromEntries(plan.objects.map((item) => [item.key, item.needed]));
  assert.deepEqual(by, { 'submissions/u1/s1.mp4': true, 'topics/t1/media/m1/kata.mp4': false, 'topics/t1/media/m2/flyer.pdf': true });
  assert.equal(plan.skipped, 2);
  assert.equal(plan.totalBytes, MEDIA['topics/t1/media/m2/flyer.pdf'].length + MEDIA['submissions/u1/s1.mp4'].length);

  const shaDiffers = planPull({ manifest: manifestWith(), index: null, local: { dump: { bytes: GZ.length, sha256: 'f'.repeat(64) }, objects: {} } });
  assert.equal(shaDiffers.dump.needed, true);
  assert.deepEqual(shaDiffers.objects, []);
});

test('planPull: no d1.latest → nothing to pull; an unsafe key in the index throws', () => {
  assert.throws(() => planPull({ manifest: manifestWith({ latest: false }), index: null, local: { dump: null, objects: {} } }), /nothing to pull/);
  const index = indexWith();
  index.objects['../escape'] = { etag: '"x"', size: 1 };
  assert.throws(() => planPull({ manifest: manifestWith(), index, local: { dump: null, objects: {} } }), /unsafe object key/);
});

// ── refusals before any call ────────────────────────────────────────────────

test('main: -e staging, -e local and an unknown env are refused before any wrangler call', async () => {
  const run = () => {
    throw new Error('wrangler must not be called');
  };
  await assert.rejects(main(['--label', 'budo', '-e', 'staging'], { log: quietLog, profiles: PROFILES, run }), /refusing -e staging/);
  await assert.rejects(main(['--label', 'budo', '-e', 'local'], { log: quietLog, profiles: PROFILES, run }), /refusing -e local/);
  await assert.rejects(main(['--label', 'budo', '-e', 'prod'], { log: quietLog, profiles: PROFILES, run }), /unknown environment/);
  await assert.rejects(main(['--label', 'nope', '-e', 'production'], { log: quietLog, profiles: PROFILES, run }), /profile not found/);
});

// ── the pull ────────────────────────────────────────────────────────────────

test('fresh pull: dump verified + objects + copies on disk, ledger written, only the backup bucket read', () =>
  withTmp(async (dir) => {
    const { result, ledgers, calls, out } = await pull(dir);
    assert.equal(result.failed, 0);
    assert.equal(result.pulled, 4);
    assert.equal(result.skipped, 0);
    assert.equal(result.bytes, GZ.length + Object.values(MEDIA).reduce((sum, b) => sum + b.length, 0));

    const paths = localPaths(out);
    assert.deepEqual(readFileSync(paths.dumpPath(DAILY)), GZ);
    for (const [key, bytes] of Object.entries(MEDIA)) assert.deepEqual(readFileSync(paths.objectPath(key)), bytes);
    assert.equal(readFileSync(paths.manifestCopy, 'utf8'), serializeManifest(manifestWith()));
    assert.equal(readFileSync(paths.indexCopy, 'utf8'), serializeIndex(indexWith()));
    assert.ok(!readdirSync(join(out, 'd1')).some((name) => name.endsWith('.part') || name.endsWith('.verify')), 'no temp file left');

    assert.equal(ledgers.length, 1);
    assert.equal(ledgers[0].path, join(dir, 'ledger.json'));
    assert.deepEqual(parseLedger(ledgers[0].text), { pulledAt: NOW.toISOString(), dumpTs: DUMP_TS, objects: 3 });
    assert.deepEqual(result.ledger, { pulledAt: NOW.toISOString(), dumpTs: DUMP_TS, objects: 3 });

    // Backup bucket only: every call is `r2 object get budo-backups/…`; no d1, no media bucket.
    assert.ok(calls.length >= 6);
    for (const argv of calls) {
      assert.deepEqual(argv.slice(5, 8), ['r2', 'object', 'get']);
      assert.ok(argv[8].startsWith('budo-backups/'), `targets the backup bucket: ${argv[8]}`);
      assert.ok(argv.includes('--remote'));
      assert.ok(!argv.includes('d1') && !argv.some((part) => part.includes('budo-media')), 'never d1, never the media bucket');
    }
  }));

test('second run: nothing downloaded, reported as skipped, ledger refreshed', () =>
  withTmp(async (dir) => {
    await pull(dir);
    const { result, ledgers, calls } = await pull(dir, { bucket: fakeBucket() });
    assert.equal(result.pulled, 0);
    assert.equal(result.skipped, 4);
    assert.equal(result.failed, 0);
    assert.equal(result.bytes, 0);
    assert.equal(calls.length, 2, 'only the manifest and the index were read');
    assert.deepEqual(parseLedger(ledgers[0].text), { pulledAt: NOW.toISOString(), dumpTs: DUMP_TS, objects: 3 });
  }));

test('a changed object (size differs on disk) is pulled again; the rest is skipped', () =>
  withTmp(async (dir) => {
    const { out } = await pull(dir);
    writeFileSync(localPaths(out).objectPath('topics/t1/media/m2/flyer.pdf'), 'x');
    const { result } = await pull(dir, { bucket: fakeBucket() });
    assert.equal(result.pulled, 1);
    assert.equal(result.skipped, 3);
    assert.deepEqual(readFileSync(localPaths(out).objectPath('topics/t1/media/m2/flyer.pdf')), MEDIA['topics/t1/media/m2/flyer.pdf']);
  }));

test('sha mismatch: the part is removed, no ledger, throws (exit 1)', () =>
  withTmp(async (dir) => {
    const bucket = fakeBucket({ gz: gzipSync(Buffer.from('tampered'), { level: 9 }) });
    const out = join(dir, 'backups');
    const ledgers = [];
    await assert.rejects(
      runPull(target(), {
    log: quietLog, run: bucket.run, out, now: NOW, writeLedger: (path, text) => ledgers.push(text), ledgerFile: join(dir, 'ledger.json') }),
      /does not match its manifest entry/,
    );
    assert.equal(ledgers.length, 0);
    const d1 = join(out, 'd1');
    assert.ok(!existsSync(d1) || readdirSync(d1).length === 0, 'no dump, no part, no manifest copy');
    assert.ok(!existsSync(join(out, 'r2')), 'no object was downloaded');
  }));

test('one failed object: exit 1, the rest on disk, ledger written with what is present; the next run resumes', () =>
  withTmp(async (dir) => {
    const { result, ledgers, out } = await pull(dir, { bucket: fakeBucket({ failKeys: [`${MIRROR_PREFIX}topics/t1/media/m1/kata.mp4`] }) });
    assert.equal(result.failed, 1);
    assert.equal(result.pulled, 3);
    assert.ok(!existsSync(localPaths(out).objectPath('topics/t1/media/m1/kata.mp4')));
    assert.ok(!existsSync(`${localPaths(out).objectPath('topics/t1/media/m1/kata.mp4')}.part`));
    assert.deepEqual(parseLedger(ledgers[0].text), { pulledAt: NOW.toISOString(), dumpTs: DUMP_TS, objects: 2 });

    const code = await main(['--label', 'budo', '-e', 'production', '--out', out], {
      log: quietLog,
      profiles: PROFILES,
      run: fakeBucket().run,
      now: NOW,
      writeLedger: (path, text) => ledgers.push({ path, text }),
      ledgerFile: join(dir, 'ledger.json'),
    });
    assert.equal(code, 0);
    assert.deepEqual(readFileSync(localPaths(out).objectPath('topics/t1/media/m1/kata.mp4')), MEDIA['topics/t1/media/m1/kata.mp4']);
    assert.deepEqual(parseLedger(ledgers.at(-1).text), { pulledAt: NOW.toISOString(), dumpTs: DUMP_TS, objects: 3 });
  }));

test('main returns 1 when an object failed, 0 otherwise', () =>
  withTmp(async (dir) => {
    const deps = { log: quietLog, profiles: PROFILES, now: NOW, writeLedger: () => {}, ledgerFile: join(dir, 'ledger.json') };
    const out = join(dir, 'backups');
    assert.equal(await main(['--label', 'budo', '-e', 'production', '--out', out], { ...deps, run: fakeBucket({ failKeys: [`${MIRROR_PREFIX}submissions/u1/s1.mp4`] }).run }), 1);
    assert.equal(await main(['--label', 'budo', '-e', 'production', '--out', out], { ...deps, run: fakeBucket().run }), 0);
  }));

test('missing index: the dump alone is pulled, ledger says 0 objects', () =>
  withTmp(async (dir) => {
    const { result, ledgers, out } = await pull(dir, { bucket: fakeBucket({ index: null, media: {} }) });
    assert.equal(result.pulled, 1);
    assert.deepEqual(result.plan.objects, []);
    assert.ok(existsSync(localPaths(out).dumpPath(DAILY)));
    assert.ok(!existsSync(localPaths(out).indexCopy));
    assert.deepEqual(parseLedger(ledgers[0].text), { pulledAt: NOW.toISOString(), dumpTs: DUMP_TS, objects: 0 });
  }));

test('missing manifest / no d1.latest / foreign label: nothing pulled, no ledger', () =>
  withTmp(async (dir) => {
    const ledgers = [];
    const opts = (bucket) => ({ log: quietLog, run: bucket.run, out: join(dir, 'backups'), now: NOW, writeLedger: (p, t) => ledgers.push(t), ledgerFile: join(dir, 'ledger.json') });
    await assert.rejects(runPull(target(), opts(fakeBucket({ manifest: null }))), /no manifest — nothing to pull.*backup-d1-prod/);
    await assert.rejects(runPull(target(), opts(fakeBucket({ manifest: manifestWith({ latest: false }) }))), /no d1\.latest/);
    await assert.rejects(runPull(target(), opts(fakeBucket({ manifest: appendD1Entry(emptyManifest('spaziord'), manifestWith().d1.latest) }))), /belongs to label "spaziord"/);
    assert.equal(ledgers.length, 0);
    assert.ok(!existsSync(join(dir, 'backups')));
  }));

test('--dry-run: only the manifest and the index are read; nothing on disk, no ledger', () =>
  withTmp(async (dir) => {
    const { result, ledgers, calls, out } = await pull(dir, { dryRun: true });
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((argv) => argv[8]),
      [`budo-backups/${MANIFEST_KEY}`, `budo-backups/${INDEX_KEY}`],
    );
    assert.equal(result.pulled, 0);
    assert.equal(result.plan.totalBytes, GZ.length + Object.values(MEDIA).reduce((sum, b) => sum + b.length, 0));
    assert.equal(ledgers.length, 0);
    assert.ok(!existsSync(out));
    const bucket = fakeBucket();
    assert.equal(await main(['--label', 'budo', '-e', 'production', '--out', out, '--dry-run'], { log: quietLog, profiles: PROFILES, run: bucket.run, writeLedger: () => assert.fail('no ledger on a dry run') }), 0);
    assert.equal(bucket.calls.length, 2);
  }));
