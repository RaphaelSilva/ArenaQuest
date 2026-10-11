/**
 * Unit tests for scripts/backup/restore-local.mjs — arguments, the local-only
 * refusals (asserted to happen before any wrangler call, removal or bucket
 * open), the confirmation rule, the dry run, the happy path against a stubbed
 * wrangler (a fake local D1) and a stubbed local bucket, a count mismatch, a
 * corrupt dump and `--skip-media`. No network, no credentials, no real
 * miniflare. The filesystem is real, in a temp dir.
 * Run with: node --test scripts/backup/restore-local.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { LIST_TABLES_QUERY } from './export-d1.mjs';
import { appendD1Entry, emptyManifest, serializeManifest } from './manifest.mjs';
import { quietLog } from './mirror-r2.mjs';
import {
  deployedResourceNames,
  entryForDump,
  listPulledMedia,
  main,
  newestDump,
  parseArgs,
  resolveRestoreTarget,
  runRestore,
} from './restore-local.mjs';

const PROFILES = {
  budo: {
    label: 'budo',
    environments: {
      staging: { d1: { name: 'budo-db-staging' }, r2: { bucket: 'budo-media-staging' } },
      production: { d1: { name: 'budo-db' }, r2: { bucket: 'budo-media' }, backup: { bucket: 'budo-backups' } },
    },
  },
  spaziord: {
    label: 'spaziord',
    environments: { production: { d1: { name: 'spaziord-db' }, r2: { bucket: 'spaziord-media' } } },
  },
};
const BUCKET = 'arenaquest-media';
const DUMP_TS = '2026-10-17T07:30:02.000Z';
const DUMP_NAME = '2026-10-17T07-30-02Z.sql.gz';
const DAILY = `d1/production/daily/2026/10/17/${DUMP_NAME}`;
const OLDER_NAME = '2026-10-16T07-30-02Z.sql.gz';
const SQL = "CREATE TABLE users (id TEXT);\nINSERT INTO users VALUES ('u1');\n";
const GZ = gzipSync(Buffer.from(SQL), { level: 9 });
const ROW_COUNTS = { topic_nodes: 7, users: 3 };
const TABLES = [{ name: 'topic_nodes' }, { name: 'users' }, { name: 'sqlite_sequence' }, { name: '_cf_KV' }];
const MEDIA = { 'topics/t1/media/m1/kata.mp4': Buffer.from('video-bytes'), 'submissions/u1/s1.pdf': Buffer.from('pdf-bytes'), 'topics/t2/note.bin': Buffer.from('bin') };

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const d1Json = (rows) => `banner line\n${JSON.stringify([{ results: rows, success: true }])}`;

function manifestWith(gz = GZ) {
  const older = { ts: '2026-10-16T07:30:02.000Z', key: `d1/production/daily/2026/10/16/${OLDER_NAME}`, bytes: 1, sha256: 'a'.repeat(64), rowCounts: { users: 1 }, durationMs: 1 };
  const base = appendD1Entry(emptyManifest('budo'), older);
  return appendD1Entry(base, { ts: DUMP_TS, key: DAILY, bytes: gz.length, sha256: sha256(gz), rowCounts: ROW_COUNTS, durationMs: 4100 });
}

/** A pull directory as pull.mjs leaves it: d1/<dump>, d1/manifest.json, r2/index.json, r2/<key>. */
function pulledDir(root, { gz = GZ, manifest = manifestWith(), media = MEDIA, dumpBytes = null } = {}) {
  const from = join(root, 'backups');
  mkdirSync(join(from, 'd1'), { recursive: true });
  writeFileSync(join(from, 'd1', DUMP_NAME), dumpBytes ?? gz);
  writeFileSync(join(from, 'd1', OLDER_NAME), 'older');
  writeFileSync(join(from, 'd1', 'manifest.json'), serializeManifest(manifest));
  mkdirSync(join(from, 'r2'), { recursive: true });
  writeFileSync(join(from, 'r2', 'index.json'), '{"indexVersion":1}');
  for (const [key, bytes] of Object.entries(media)) {
    const path = join(from, 'r2', ...key.split('/'));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, bytes);
  }
  return from;
}

/** A wrangler stub that is only a fake local D1: `--file` applies, `--command` answers the two read-only queries. */
function fakeWrangler({ counts = [{ t: 'topic_nodes', n: 7 }, { t: 'users', n: 3 }], tables = TABLES, failApply = false, onApply = () => {} } = {}) {
  const calls = [];
  const run = (argv) => {
    assert.deepEqual(argv.slice(0, 5), ['pnpm', '--filter', 'api', 'exec', 'wrangler']);
    assert.equal(argv[5], 'd1', 'only d1 is spawned');
    assert.ok(argv.includes('--local') && argv.includes('--persist-to') && !argv.includes('--remote'), 'local only, never --remote');
    assert.equal(argv[7], 'arenaquest-db');
    const kind = argv.includes('--file') ? 'apply' : 'query';
    const record = { kind, argv, persistTo: argv[argv.indexOf('--persist-to') + 1] };
    calls.push(record);
    if (kind === 'apply') {
      record.sql = readFileSync(argv[argv.indexOf('--file') + 1], 'utf8');
      onApply(record);
      if (failApply) return { status: 1, stdout: '', stderr: '✘ [ERROR] near "CREATE": syntax error at offset 0' };
      return { status: 0, stdout: '🌀 Executing on local database', stderr: '' };
    }
    const command = argv[argv.indexOf('--command') + 1];
    if (command === LIST_TABLES_QUERY) return { status: 0, stdout: d1Json(tables), stderr: '' };
    if (command.startsWith('SELECT ') && command.includes('COUNT(*)')) {
      record.sql = command;
      return { status: 0, stdout: d1Json(counts), stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected statement: ${command}` };
  };
  return { run, calls, of: (kind) => calls.filter((c) => c.kind === kind) };
}

/** A stubbed local bucket: records every put and whether `dispose` ran. */
function fakeR2() {
  const state = { opened: [], puts: [], disposed: 0 };
  const openR2 = async (opts) => {
    state.opened.push(opts);
    return {
      async put(key, file, contentType) {
        state.puts.push({ key, bytes: readFileSync(file), contentType });
      },
      async dispose() {
        state.disposed += 1;
      },
    };
  };
  return { openR2, state };
}

async function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'aq-restore-test-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const localTarget = (persistTo) => resolveRestoreTarget({ label: 'budo', env: 'local', profiles: PROFILES, persistTo, bucket: BUCKET });

/** A persist dir holding a stale D1 state and a stale object store, as a previous replica would have left them. */
function stalePersistDir(root) {
  const persistTo = join(root, 'state');
  mkdirSync(join(persistTo, 'v3', 'd1', 'miniflare-D1DatabaseObject'), { recursive: true });
  writeFileSync(join(persistTo, 'v3', 'd1', 'miniflare-D1DatabaseObject', 'old.sqlite'), 'stale');
  mkdirSync(join(persistTo, 'v3', 'r2'), { recursive: true });
  writeFileSync(join(persistTo, 'v3', 'r2', 'keep-me'), 'bucket state is not removed');
  return persistTo;
}

// ── arguments ───────────────────────────────────────────────────────────────

test('parseArgs: label + env required, every flag parsed, defaults', () => {
  assert.deepEqual(parseArgs(['--label', 'budo', '-e', 'local']), {
    label: 'budo',
    env: 'local',
    from: null,
    dump: null,
    persistTo: null,
    skipMedia: false,
    dryRun: false,
    yes: false,
  });
  assert.deepEqual(parseArgs(['--label', 'budo', '-e', 'local', '--from', '/x', '--dump', '/x/d.sql.gz', '--persist-to', '/p', '--skip-media', '--dry-run', '--yes']), {
    label: 'budo',
    env: 'local',
    from: '/x',
    dump: '/x/d.sql.gz',
    persistTo: '/p',
    skipMedia: true,
    dryRun: true,
    yes: true,
  });
  assert.deepEqual(parseArgs(['-h']), { help: true });
  assert.throws(() => parseArgs(['-e', 'local']), /--label/);
  assert.throws(() => parseArgs(['--label', 'budo']), /-e\/--env/);
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'local', '--remote']), /invalid arguments/);
});

// ── target refusals ─────────────────────────────────────────────────────────

test('resolveRestoreTarget: staging, production, unknown refused; local resolves to arenaquest-db', () => {
  assert.throws(() => localTargetWith('staging'), /refusing -e staging/);
  assert.throws(() => localTargetWith('production'), /refusing -e production/);
  assert.throws(() => localTargetWith('prod'), /unknown environment "prod"/);
  assert.throws(() => resolveRestoreTarget({ label: 'nope', env: 'local', profiles: PROFILES, bucket: BUCKET }), /profile not found/);
  assert.deepEqual(localTarget(null), { label: 'budo', env: 'local', database: 'arenaquest-db', persistTo: null, bucket: BUCKET });
  const withDir = localTarget('./relative/state');
  assert.equal(withDir.persistTo, join(process.cwd(), 'relative', 'state'), 'absolute: wrangler runs from apps/api');
  function localTargetWith(env) {
    return resolveRestoreTarget({ label: 'budo', env, profiles: PROFILES, bucket: BUCKET });
  }
});

test('resolveRestoreTarget: a --persist-to carrying any production or staging D1/bucket name is refused', () => {
  assert.deepEqual([...deployedResourceNames(PROFILES)].sort(), ['budo-db', 'budo-db-staging', 'budo-media', 'budo-media-staging', 'spaziord-db', 'spaziord-media']);
  for (const dir of ['/srv/budo-db/state', '/tmp/x/budo-media-staging', '/data/spaziord-media/v3', './budo-db-staging']) {
    assert.throws(() => localTarget(dir), /refusing --persist-to .* deployed resource name/, dir);
  }
  assert.equal(localTarget('/srv/budo-replica').persistTo, '/srv/budo-replica');
});

test('resolveRestoreTarget reads the top-level R2 bucket of apps/api/wrangler.jsonc when none is injected', () => {
  assert.equal(resolveRestoreTarget({ label: 'budo', env: 'local', profiles: PROFILES }).bucket, BUCKET);
});

test('main: -e staging / -e production / production-named persist dir exit before any call, removal or bucket open', () =>
  withTmp(async (dir) => {
    const persistTo = stalePersistDir(dir);
    const run = () => assert.fail('wrangler must not be called');
    const openR2 = () => assert.fail('the bucket must not be opened');
    const deps = { log: quietLog, profiles: PROFILES, run, openR2, isTTY: false, bucket: BUCKET };
    await assert.rejects(main(['--label', 'budo', '-e', 'staging', '--yes'], deps), /refusing -e staging/);
    await assert.rejects(main(['--label', 'budo', '-e', 'production', '--yes'], deps), /refusing -e production/);
    await assert.rejects(main(['--label', 'budo', '-e', 'local', '--yes', '--persist-to', join(dir, 'budo-db')], deps), /refusing --persist-to/);
    assert.ok(existsSync(join(persistTo, 'v3', 'd1', 'miniflare-D1DatabaseObject', 'old.sqlite')), 'nothing removed');
  }));

// ── helpers ─────────────────────────────────────────────────────────────────

test('newestDump / entryForDump / listPulledMedia', () =>
  withTmp(async (dir) => {
    const from = pulledDir(dir);
    assert.equal(newestDump(join(from, 'd1')), join(from, 'd1', DUMP_NAME));
    assert.equal(newestDump(join(dir, 'absent')), null);
    assert.equal(entryForDump(manifestWith(), DUMP_NAME).key, DAILY);
    assert.equal(entryForDump(manifestWith(), OLDER_NAME).sha256, 'a'.repeat(64), 'history entries are found too');
    assert.equal(entryForDump(manifestWith(), 'nope.sql.gz'), null);
    const media = listPulledMedia(from);
    assert.deepEqual(
      media.map((file) => file.key),
      ['submissions/u1/s1.pdf', 'topics/t1/media/m1/kata.mp4', 'topics/t2/note.bin'],
      'index.json left out, keys use forward slashes',
    );
    assert.deepEqual(listPulledMedia(join(dir, 'absent')), []);
  }));

// ── confirmation and dry run ────────────────────────────────────────────────

test('without --yes and no TTY: aborts after verifying, before any removal, apply or put', () =>
  withTmp(async (dir) => {
    const from = pulledDir(dir);
    const persistTo = stalePersistDir(dir);
    const wrangler = fakeWrangler();
    const r2 = fakeR2();
    await assert.rejects(
      main(['--label', 'budo', '-e', 'local', '--from', from, '--persist-to', persistTo], { log: quietLog, profiles: PROFILES, run: wrangler.run, openR2: r2.openR2, isTTY: false, bucket: BUCKET }),
      /needs confirmation: re-run with --yes/,
    );
    assert.equal(wrangler.calls.length, 0);
    assert.equal(r2.state.opened.length, 0);
    assert.ok(existsSync(join(persistTo, 'v3', 'd1', 'miniflare-D1DatabaseObject', 'old.sqlite')), 'nothing removed');
  }));

test('a declined confirmation aborts the same way', () =>
  withTmp(async (dir) => {
    const from = pulledDir(dir);
    const persistTo = stalePersistDir(dir);
    const wrangler = fakeWrangler();
    const questions = [];
    await assert.rejects(
      runRestore(localTarget(persistTo), { log: quietLog,
        run: wrangler.run,
        from,
        confirm: async (question) => {
          questions.push(question);
          return false;
        },
        openR2: fakeR2().openR2,
      }),
      /aborted: the replica was not replaced/,
    );
    assert.equal(questions.length, 1);
    assert.match(questions[0], /Replace the local replica in .*state with the production dump of "budo"/);
    assert.equal(wrangler.calls.length, 0);
    assert.ok(existsSync(join(persistTo, 'v3', 'd1', 'miniflare-D1DatabaseObject', 'old.sqlite')));
  }));

test('--dry-run: the plan is printed and nothing is removed, applied or put (no confirmation asked)', () =>
  withTmp(async (dir) => {
    const from = pulledDir(dir);
    const persistTo = stalePersistDir(dir);
    const wrangler = fakeWrangler();
    const r2 = fakeR2();
    const code = await main(['--label', 'budo', '-e', 'local', '--from', from, '--persist-to', persistTo, '--dry-run'], {
      log: quietLog,
      profiles: PROFILES,
      run: wrangler.run,
      openR2: r2.openR2,
      isTTY: false,
      confirm: () => assert.fail('no confirmation on a dry run'),
      bucket: BUCKET,
    });
    assert.equal(code, 0);
    assert.equal(wrangler.calls.length, 0);
    assert.equal(r2.state.opened.length, 0);
    assert.ok(existsSync(join(persistTo, 'v3', 'd1', 'miniflare-D1DatabaseObject', 'old.sqlite')));
  }));

// ── the restore ─────────────────────────────────────────────────────────────

test('happy path: remove → apply → count → compare → media put per file, in that order; exit 0', () =>
  withTmp(async (dir) => {
    const from = pulledDir(dir);
    const persistTo = stalePersistDir(dir);
    const order = [];
    const wrangler = fakeWrangler({
      onApply: () => {
        order.push('apply');
        assert.ok(!existsSync(join(persistTo, 'v3', 'd1')), 'the D1 subtree is gone before the apply');
      },
    });
    const r2 = fakeR2();
    const openR2 = async (opts) => {
      order.push('open-r2');
      assert.equal(wrangler.of('query').length, 2, 'the bucket opens after the counts');
      return r2.openR2(opts);
    };
    const code = await main(['--label', 'budo', '-e', 'local', '--from', from, '--persist-to', persistTo, '--yes'], {
      log: quietLog,
      profiles: PROFILES,
      run: wrangler.run,
      openR2,
      isTTY: false,
      bucket: BUCKET,
    });
    assert.equal(code, 0);
    assert.deepEqual(order, ['apply', 'open-r2']);

    const [apply] = wrangler.of('apply');
    assert.equal(apply.sql, SQL, 'the gunzipped dump is what gets applied');
    assert.equal(apply.persistTo, persistTo);
    const queries = wrangler.of('query');
    assert.equal(queries.length, 2);
    assert.ok(queries.every((q) => q.persistTo === persistTo));
    assert.match(queries[1].sql, /SELECT 'topic_nodes' AS t, COUNT\(\*\) AS n FROM "topic_nodes" UNION ALL SELECT 'users'/);
    assert.ok(!queries[1].sql.includes('sqlite_sequence') && !queries[1].sql.includes('_cf_KV'));

    assert.ok(existsSync(join(persistTo, 'v3', 'r2', 'keep-me')), 'only the D1 subtree was removed');
    assert.deepEqual(r2.state.opened, [{ bucket: BUCKET, persistTo, repoRoot: r2.state.opened[0].repoRoot }]);
    assert.equal(r2.state.disposed, 1);
    const puts = Object.fromEntries(r2.state.puts.map((p) => [p.key, p]));
    assert.deepEqual(Object.keys(puts).sort(), Object.keys(MEDIA).sort());
    for (const [key, bytes] of Object.entries(MEDIA)) assert.deepEqual(puts[key].bytes, bytes);
    assert.equal(puts['topics/t1/media/m1/kata.mp4'].contentType, 'video/mp4');
    assert.equal(puts['submissions/u1/s1.pdf'].contentType, 'application/pdf');
    assert.equal(puts['topics/t2/note.bin'].contentType, 'application/octet-stream');
  }));

test('--dump picks a history entry; a dump without a manifest entry is refused with the re-pull command', () =>
  withTmp(async (dir) => {
    const olderGz = gzipSync(Buffer.from('CREATE TABLE users (id TEXT);\n'));
    const manifest = appendD1Entry(
      appendD1Entry(emptyManifest('budo'), { ts: '2026-10-16T07:30:02.000Z', key: `d1/production/daily/2026/10/16/${OLDER_NAME}`, bytes: olderGz.length, sha256: sha256(olderGz), rowCounts: { users: 1 }, durationMs: 1 }),
      { ts: DUMP_TS, key: DAILY, bytes: GZ.length, sha256: sha256(GZ), rowCounts: ROW_COUNTS, durationMs: 2 },
    );
    const from = pulledDir(dir, { manifest });
    writeFileSync(join(from, 'd1', OLDER_NAME), olderGz);
    writeFileSync(join(from, 'd1', 'stray.sql.gz'), GZ);
    const persistTo = join(dir, 'state');
    const wrangler = fakeWrangler({ counts: [{ t: 'users', n: 1 }], tables: [{ name: 'users' }] });
    const result = await runRestore(localTarget(persistTo), { log: quietLog, run: wrangler.run, from, dump: join(from, 'd1', OLDER_NAME), confirm: async () => true, openR2: fakeR2().openR2, skipMedia: true });
    assert.equal(result.ok, true);
    assert.equal(result.dumpPath, join(from, 'd1', OLDER_NAME));

    await assert.rejects(
      runRestore(localTarget(persistTo), { log: quietLog, run: () => assert.fail('no call'), from, dump: join(from, 'd1', 'stray.sql.gz'), confirm: async () => true, openR2: fakeR2().openR2 }),
      /has no entry for stray\.sql\.gz: re-pull \(make backup-pull-prod LABEL=budo OUT=/,
    );
  }));

test('count mismatch: exit 1, tables listed, replica left in place, media not copied', () =>
  withTmp(async (dir) => {
    const from = pulledDir(dir);
    const persistTo = stalePersistDir(dir);
    const wrangler = fakeWrangler({ counts: [{ t: 'topic_nodes', n: 6 }, { t: 'users', n: 3 }, { t: 'extra', n: 1 }], tables: [...TABLES, { name: 'extra' }] });
    const r2 = fakeR2();
    const result = await runRestore(localTarget(persistTo), { log: quietLog, run: wrangler.run, from, confirm: async () => true, openR2: r2.openR2 });
    assert.equal(result.ok, false);
    assert.deepEqual(result.mismatches, [
      { table: 'extra', expected: null, actual: 1 },
      { table: 'topic_nodes', expected: 7, actual: 6 },
    ]);
    assert.equal(r2.state.opened.length, 0, 'media is not copied onto a replica that does not match');
    assert.equal(wrangler.of('apply').length, 1, 'the replica was applied and is left in place');
    assert.ok(!existsSync(join(persistTo, 'v3', 'd1', 'miniflare-D1DatabaseObject', 'old.sqlite')), 'the stale state was replaced');
    const code = await main(['--label', 'budo', '-e', 'local', '--from', from, '--persist-to', persistTo, '--yes'], { log: quietLog, profiles: PROFILES, run: wrangler.run, openR2: r2.openR2, isTTY: false, bucket: BUCKET });
    assert.equal(code, 1);
  }));

test('a dump that fails to apply throws (exit 1) and the bucket is never opened', () =>
  withTmp(async (dir) => {
    const from = pulledDir(dir);
    const persistTo = join(dir, 'state');
    const r2 = fakeR2();
    await assert.rejects(
      runRestore(localTarget(persistTo), { log: quietLog, run: fakeWrangler({ failApply: true }).run, from, confirm: async () => true, openR2: r2.openR2 }),
      /wrangler d1 execute --file \(local restore\) exited with status 1: .*syntax error/,
    );
    assert.equal(r2.state.opened.length, 0);
  }));

test('corrupt dump on disk: aborts with the re-pull command before any removal, apply or confirmation', () =>
  withTmp(async (dir) => {
    const from = pulledDir(dir, { dumpBytes: gzipSync(Buffer.from('tampered')) });
    const persistTo = stalePersistDir(dir);
    const wrangler = fakeWrangler();
    const r2 = fakeR2();
    await assert.rejects(
      runRestore(localTarget(persistTo), { log: quietLog, run: wrangler.run, from, confirm: () => assert.fail('verify comes before the confirmation'), openR2: r2.openR2 }),
      /does not match its manifest entry: .* nothing replaced; re-pull it \(make backup-pull-prod LABEL=budo OUT=/,
    );
    assert.equal(wrangler.calls.length, 0);
    assert.equal(r2.state.opened.length, 0);
    assert.ok(existsSync(join(persistTo, 'v3', 'd1', 'miniflare-D1DatabaseObject', 'old.sqlite')), 'nothing removed');
  }));

test('missing dump or manifest copy: throws naming the pull command', () =>
  withTmp(async (dir) => {
    const from = join(dir, 'empty');
    mkdirSync(from, { recursive: true });
    const noCall = () => assert.fail('no call');
    await assert.rejects(runRestore(localTarget(join(dir, 'state')), { run: noCall, from, confirm: noCall, openR2: noCall }), /no dump under .*: pull one first \(make backup-pull-prod LABEL=budo/);
    mkdirSync(join(from, 'd1'), { recursive: true });
    writeFileSync(join(from, 'd1', DUMP_NAME), GZ);
    await assert.rejects(runRestore(localTarget(join(dir, 'state')), { run: noCall, from, confirm: noCall, openR2: noCall }), /manifest\.json is missing: the pull writes it/);
  }));

test('--skip-media: the D1 replica is restored and nothing is put', () =>
  withTmp(async (dir) => {
    const from = pulledDir(dir);
    const persistTo = join(dir, 'state');
    const wrangler = fakeWrangler();
    const r2 = fakeR2();
    const code = await main(['--label', 'budo', '-e', 'local', '--from', from, '--persist-to', persistTo, '--yes', '--skip-media'], {
      log: quietLog,
      profiles: PROFILES,
      run: wrangler.run,
      openR2: r2.openR2,
      isTTY: false,
      bucket: BUCKET,
    });
    assert.equal(code, 0);
    assert.equal(wrangler.of('apply').length, 1);
    assert.equal(r2.state.opened.length, 0);
    assert.equal(r2.state.puts.length, 0);
  }));

test('a failed media put is reported and exits 1; the bucket is still disposed', () =>
  withTmp(async (dir) => {
    const from = pulledDir(dir);
    const persistTo = join(dir, 'state');
    let disposed = 0;
    const openR2 = async () => ({
      async put(key) {
        if (key === 'topics/t2/note.bin') throw new Error('disk full');
      },
      async dispose() {
        disposed += 1;
      },
    });
    const result = await runRestore(localTarget(persistTo), { log: quietLog, run: fakeWrangler().run, from, confirm: async () => true, openR2 });
    assert.equal(result.ok, false);
    assert.deepEqual(result.media, { put: 2, failed: 1 });
    assert.equal(disposed, 1);
  }));
