/**
 * Unit tests for scripts/backup/drill.mjs — arguments, the production-only
 * refusals (asserted to happen before any wrangler call), the dry run, the
 * manifest's `drill` field, and the drill pipeline against a stubbed wrangler
 * (an in-memory bucket plus a fake local D1): no network, no Cloudflare
 * credentials, no real miniflare. The filesystem is real, in a temp dir.
 * Run with: node --test scripts/backup/drill.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { LIST_TABLES_QUERY, resolveBackupTarget } from './export-d1.mjs';
import { applyCommand, buildDrillPlan, compareCounts, localQueryCommand, main, parseArgs, runDrill } from './drill.mjs';
import { MANIFEST_KEY, appendD1Entry, emptyManifest, parseManifest, serializeManifest, setDrill, validateDrill } from './manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));

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
const SQL = "CREATE TABLE users (id TEXT);\nINSERT INTO users VALUES ('u1');\n";
const GZ = gzipSync(Buffer.from(SQL), { level: 9 });
const ROW_COUNTS = { topic_nodes: 7, users: 3 };
const TABLES = [{ name: 'topic_nodes' }, { name: 'users' }, { name: 'sqlite_sequence' }, { name: '_cf_KV' }];

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const d1Json = (rows) => `banner line\n${JSON.stringify([{ results: rows, success: true }])}`;
const target = () => resolveBackupTarget({ label: 'budo', env: 'production', profiles: PROFILES });

/** A manifest whose `d1.latest` describes GZ (or `gz`), as the export would have written it. */
function manifestWith({ gz = GZ, rowCounts = ROW_COUNTS, latest = true } = {}) {
  const base = emptyManifest('budo');
  if (!latest) return base;
  return appendD1Entry(base, { ts: DUMP_TS, key: DAILY, bytes: gz.length, sha256: sha256(gz), rowCounts, durationMs: 4100 });
}

/**
 * A wrangler stub: `r2 object get/put` work against an in-memory bucket;
 * `d1 execute --local` is a fake store — `--file` records the applied SQL (or
 * fails when `failApply`), `--command` answers the two read-only queries with
 * `tables` / `counts`.
 */
function fakeWrangler({ objects = new Map(), counts = [{ t: 'topic_nodes', n: 7 }, { t: 'users', n: 3 }], tables = TABLES, failApply = false } = {}) {
  const calls = [];
  const run = (argv) => {
    assert.deepEqual(argv.slice(0, 5), ['pnpm', '--filter', 'api', 'exec', 'wrangler']);
    const kind = argv[5] === 'd1' ? (argv.includes('--file') ? 'd1 apply' : 'd1 query') : `r2 ${argv[7]}`;
    const record = { kind, argv };
    calls.push(record);
    if (kind === 'd1 apply') {
      assert.ok(argv.includes('--local') && argv.includes('--persist-to'), 'the restore targets a local persist dir');
      assert.ok(!argv.includes('--remote'), 'the drill never writes a remote database');
      record.sql = readFileSync(argv[argv.indexOf('--file') + 1], 'utf8');
      record.persistTo = argv[argv.indexOf('--persist-to') + 1];
      if (failApply) return { status: 1, stdout: '', stderr: '✘ [ERROR] near "CREATE": syntax error at offset 0' };
      return { status: 0, stdout: '🌀 Executing on local database', stderr: '' };
    }
    if (kind === 'd1 query') {
      assert.ok(argv.includes('--local') && !argv.includes('--remote'));
      const command = argv[argv.indexOf('--command') + 1];
      if (command === LIST_TABLES_QUERY) return { status: 0, stdout: d1Json(tables), stderr: '' };
      if (command.startsWith('SELECT ') && command.includes('COUNT(*)')) {
        record.sql = command;
        return { status: 0, stdout: d1Json(counts), stderr: '' };
      }
      return { status: 1, stdout: '', stderr: `unexpected statement: ${command}` };
    }
    const key = argv[8].split('/').slice(1).join('/');
    record.key = key;
    const path = argv[argv.indexOf('--file') + 1];
    if (kind === 'r2 put') {
      objects.set(key, Buffer.from(readFileSync(path)));
      return { status: 0, stdout: 'Upload complete.', stderr: '' };
    }
    if (!objects.has(key)) return { status: 1, stdout: '', stderr: '✘ [ERROR] The specified key does not exist. [code: 10007]' };
    writeFileSync(path, objects.get(key));
    return { status: 0, stdout: 'Downloaded', stderr: '' };
  };
  return { run, calls, objects, of: (kind) => calls.filter((c) => c.kind === kind) };
}

function bucketWith(manifest, gz = GZ) {
  const objects = new Map();
  if (manifest) objects.set(MANIFEST_KEY, Buffer.from(serializeManifest(manifest)));
  if (gz) objects.set(DAILY, Buffer.from(gz));
  return objects;
}

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'aq-drill-test-'));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => rmSync(dir, { recursive: true, force: true }));
}

const storedManifest = (fake) => parseManifest(fake.objects.get(MANIFEST_KEY).toString('utf8'));

// ── arguments ────────────────────────────────────────────────────────────────

test('parseArgs: label + env required, flags parsed, unknown option refused', () => {
  assert.deepEqual(parseArgs(['--label', 'budo', '-e', 'production']), { label: 'budo', env: 'production', dryRun: false, yes: false, keep: false });
  assert.deepEqual(parseArgs(['--label', 'budo', '--env', 'production', '--dry-run', '--yes', '--keep']), {
    label: 'budo',
    env: 'production',
    dryRun: true,
    yes: true,
    keep: true,
  });
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.throws(() => parseArgs(['-e', 'production']), /--label/);
  assert.throws(() => parseArgs(['--label', 'Budo', '-e', 'production']), /kebab-case/);
  assert.throws(() => parseArgs(['--label', 'budo']), /-e\/--env is required/);
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'production', '--force']), /invalid arguments/);
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'production', 'extra']), /invalid arguments/);
});

// ── pure: compare, commands, plan ────────────────────────────────────────────

test('compareCounts: equal → empty; differing, missing on either side → sorted rows with null', () => {
  assert.deepEqual(compareCounts({ users: 3, topic_nodes: 7 }, { topic_nodes: 7, users: 3 }), []);
  assert.deepEqual(compareCounts({}, {}), []);
  assert.deepEqual(compareCounts({ users: 3 }, { users: 2 }), [{ table: 'users', expected: 3, actual: 2 }]);
  assert.deepEqual(compareCounts({ users: 3, tags: 1 }, { users: 3 }), [{ table: 'tags', expected: 1, actual: null }]);
  assert.deepEqual(compareCounts({ users: 3 }, { users: 3, extra: 0 }), [{ table: 'extra', expected: null, actual: 0 }]);
  assert.deepEqual(
    compareCounts({ zeta: 1, alpha: 1, mid: 2 }, { mid: 3, alpha: 0, zeta: 1 }).map((m) => m.table),
    ['alpha', 'mid'],
  );
  assert.deepEqual(compareCounts(undefined, { users: 1 }), [{ table: 'users', expected: null, actual: 1 }]);
});

test('applyCommand / localQueryCommand: the throwaway store is local, never remote', () => {
  const apply = applyCommand('/tmp/x/d1', '/tmp/x/dump.sql');
  assert.deepEqual(apply.slice(5), ['d1', 'execute', 'arenaquest-db', '--local', '--persist-to', '/tmp/x/d1', '--file', '/tmp/x/dump.sql']);
  const query = localQueryCommand('/tmp/x/d1', 'SELECT 1');
  assert.deepEqual(query.slice(5), ['d1', 'execute', 'arenaquest-db', '--local', '--persist-to', '/tmp/x/d1', '--command', 'SELECT 1', '--json']);
  assert.ok(!apply.includes('--remote') && !query.includes('--remote'));
});

test('buildDrillPlan: ordered steps; the dump key comes from latest or is a placeholder', () => {
  const steps = buildDrillPlan(target());
  assert.deepEqual(steps.map((s) => s.id), ['fetch', 'download', 'verify', 'gunzip', 'apply', 'count', 'compare', 'record']);
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  assert.equal(byId.fetch.argv[8], `budo-backups/${MANIFEST_KEY}`);
  assert.equal(byId.download.argv[8], 'budo-backups/<d1.latest.key>');
  assert.match(byId.verify.note, /aborts before any apply/);
  assert.ok(byId.apply.argv.includes('--local') && byId.apply.argv.includes('--persist-to'));
  assert.equal(byId.count.argv.at(-2), LIST_TABLES_QUERY);
  assert.equal(byId.record.argv[8], `budo-backups/${MANIFEST_KEY}`);
  const named = buildDrillPlan(target(), { key: DAILY, bytes: 42 });
  assert.equal(named[1].argv[8], `budo-backups/${DAILY}`);
  assert.match(named[1].note, /42 bytes/);
});

// ── manifest: the drill field ────────────────────────────────────────────────

const DRILL = { at: NOW.toISOString(), ok: true, dumpTs: DUMP_TS, dumpKey: DAILY, mismatches: [], durationMs: 1234 };

test('setDrill: validated, copied, round-trips through serialize/parse; input untouched', () => {
  const before = manifestWith();
  const snapshot = JSON.stringify(before);
  const failed = { ...DRILL, ok: false, mismatches: [{ table: 'users', expected: 3, actual: 2 }], error: null };
  const next = setDrill(before, failed);
  assert.equal(JSON.stringify(before), snapshot);
  const { error: _dropped, ...expected } = failed;
  assert.deepEqual(next.drill, expected);
  assert.ok(!('error' in next.drill), 'a null error is dropped');
  assert.deepEqual(parseManifest(serializeManifest(next)).drill, { ...DRILL, ok: false, mismatches: [{ table: 'users', expected: 3, actual: 2 }] });
  const withError = setDrill(before, { ...DRILL, ok: false, error: 'boom' });
  assert.equal(parseManifest(serializeManifest(withError)).drill.error, 'boom');
  assert.equal(serializeManifest(withError).indexOf('"drill"') > serializeManifest(withError).indexOf('"r2"'), true, 'drill stays after r2');
});

test('validateDrill: refuses every malformed shape', () => {
  assert.doesNotThrow(() => validateDrill(DRILL));
  assert.throws(() => validateDrill(null), /must be an object/);
  assert.throws(() => validateDrill([]), /must be an object/);
  assert.throws(() => validateDrill({ ...DRILL, at: 'yesterday' }), /at must be an ISO timestamp/);
  assert.throws(() => validateDrill({ ...DRILL, ok: 'yes' }), /ok must be a boolean/);
  assert.throws(() => validateDrill({ ...DRILL, dumpTs: 1 }), /dumpTs/);
  assert.throws(() => validateDrill({ ...DRILL, dumpKey: '' }), /dumpKey/);
  assert.throws(() => validateDrill({ ...DRILL, mismatches: null }), /mismatches must be an array/);
  assert.throws(() => validateDrill({ ...DRILL, ok: false, mismatches: [{ table: '', expected: 1, actual: 2 }] }), /table is required/);
  assert.throws(() => validateDrill({ ...DRILL, ok: false, mismatches: [{ table: 'users', expected: -1, actual: 2 }] }), /expected must be null or/);
  assert.throws(() => validateDrill({ ...DRILL, ok: false, mismatches: [{ table: 'users', expected: null, actual: null }] }), /no count on either side/);
  assert.throws(() => validateDrill({ ...DRILL, durationMs: -1 }), /durationMs/);
  assert.throws(() => validateDrill({ ...DRILL, error: '' }), /error must be a non-empty string/);
  assert.throws(() => validateDrill({ ...DRILL, mismatches: [{ table: 'users', expected: 3, actual: 2 }] }), /ok cannot be true/);
  assert.throws(() => validateDrill({ ...DRILL, error: 'boom' }), /ok cannot be true/);
});

test('parseManifest: a non-null drill must be an object with at + ok; null is fine', () => {
  const text = (drill) => JSON.stringify({ ...manifestWith(), drill });
  assert.equal(parseManifest(text(null)).drill, null);
  assert.deepEqual(parseManifest(text(DRILL)).drill, DRILL);
  assert.throws(() => parseManifest(text('done')), /drill must be null or/);
  assert.throws(() => parseManifest(text([])), /drill must be null or/);
  assert.throws(() => parseManifest(text({ at: NOW.toISOString() })), /drill must be null or/);
  assert.throws(() => parseManifest(text({ ok: true })), /drill must be null or/);
});

// ── refusals and dry run (no wrangler call) ──────────────────────────────────

test('main: -e staging and -e local exit non-zero before any wrangler invocation', async () => {
  for (const env of ['staging', 'local']) {
    const fake = fakeWrangler();
    await assert.rejects(main(['--label', 'budo', '-e', env, '--yes'], { profiles: PROFILES, run: fake.run, now: NOW }), /refusing -e/);
    assert.equal(fake.calls.length, 0, `${env}: no runner call`);
  }
  const fake = fakeWrangler();
  await assert.rejects(main(['--label', 'nope', '-e', 'production', '--yes'], { profiles: PROFILES, run: fake.run, now: NOW }), /profile not found/);
  assert.equal(fake.calls.length, 0);
});

test('main: a real drill without --yes is refused before any wrangler invocation', async () => {
  const fake = fakeWrangler({ objects: bucketWith(manifestWith()) });
  await assert.rejects(main(['--label', 'budo', '-e', 'production'], { profiles: PROFILES, run: fake.run, now: NOW }), /needs --yes/);
  assert.equal(fake.calls.length, 0);
});

test('main --dry-run: prints the plan and performs no call', async () => {
  const fake = fakeWrangler({ objects: bucketWith(manifestWith()) });
  const code = await main(['--label', 'budo', '-e', 'production', '--dry-run'], { profiles: PROFILES, run: fake.run, now: NOW });
  assert.equal(code, 0);
  assert.equal(fake.calls.length, 0);
});

// ── pipeline ─────────────────────────────────────────────────────────────────

test('happy path: verified dump applied to a local store, counts match → drill.ok, manifest put once, exit 0, temp dir removed', () =>
  withTmp(async (tmpDir) => {
    const fake = fakeWrangler({ objects: bucketWith(manifestWith()) });
    const { drill, dir } = await runDrill(target(), { run: fake.run, now: NOW, tmpDir });
    assert.deepEqual(drill, { ...DRILL, durationMs: drill.durationMs });
    assert.ok(Number.isInteger(drill.durationMs) && drill.durationMs >= 0);
    assert.ok(!existsSync(dir), 'temp dir removed');

    const [apply] = fake.of('d1 apply');
    assert.equal(apply.sql, SQL, 'the gunzipped dump is what gets applied');
    assert.ok(apply.persistTo.startsWith(dir), 'the store lives inside the temp dir');
    assert.equal(fake.of('d1 query').length, 2, 'list tables + one count statement');
    assert.match(fake.of('d1 query')[1].sql, /^SELECT 'topic_nodes' AS t, COUNT\(\*\) AS n FROM "topic_nodes" UNION ALL SELECT 'users'/);
    assert.deepEqual(fake.of('r2 get').map((c) => c.key), [MANIFEST_KEY, DAILY]);
    assert.deepEqual(fake.of('r2 put').map((c) => c.key), [MANIFEST_KEY]);
    assert.ok(fake.calls.every((c) => !c.argv.includes('--remote') || c.kind.startsWith('r2 ')), 'only the bucket is remote');

    const stored = storedManifest(fake);
    assert.deepEqual(stored.drill, drill);
    assert.equal(stored.d1.latest.key, DAILY, 'latest untouched');

    const again = fakeWrangler({ objects: bucketWith(manifestWith()) });
    assert.equal(await main(['--label', 'budo', '-e', 'production', '--yes'], { profiles: PROFILES, run: again.run, now: NOW, tmpDir }), 0);
  }));

test('tampered dump: SHA-256 mismatch aborts before any d1 execute; manifest untouched; non-zero', () =>
  withTmp(async (tmpDir) => {
    const manifest = manifestWith();
    const tampered = Buffer.concat([GZ, Buffer.from([0])]);
    const fake = fakeWrangler({ objects: bucketWith(manifest, tampered) });
    const before = fake.objects.get(MANIFEST_KEY).toString('utf8');
    await assert.rejects(main(['--label', 'budo', '-e', 'production', '--yes'], { profiles: PROFILES, run: fake.run, now: NOW, tmpDir }), /does not match its manifest entry/);
    assert.equal(fake.of('d1 apply').length, 0, 'no restore attempted');
    assert.equal(fake.of('d1 query').length, 0);
    assert.equal(fake.of('r2 put').length, 0, 'no manifest write');
    assert.equal(fake.objects.get(MANIFEST_KEY).toString('utf8'), before);
    assert.equal(storedManifest(fake).drill, null);

    // Same bytes count, different content: still caught by the hash.
    const flipped = Buffer.from(GZ);
    flipped[flipped.length - 1] ^= 0xff;
    const same = fakeWrangler({ objects: bucketWith(manifestWith(), flipped) });
    await assert.rejects(runDrill(target(), { run: same.run, now: NOW, tmpDir }), /does not match/);
    assert.equal(same.of('d1 apply').length, 0);
  }));

test('row-count mismatch: drill.ok false with the tables listed, manifest written, exit 1', () =>
  withTmp(async (tmpDir) => {
    const counts = [{ t: 'topic_nodes', n: 7 }, { t: 'users', n: 2 }, { t: 'tags', n: 0 }];
    const tables = [...TABLES, { name: 'tags' }];
    const fake = fakeWrangler({ objects: bucketWith(manifestWith()), counts, tables });
    const code = await main(['--label', 'budo', '-e', 'production', '--yes'], { profiles: PROFILES, run: fake.run, now: NOW, tmpDir });
    assert.equal(code, 1);
    assert.equal(fake.of('r2 put').length, 1);
    const stored = storedManifest(fake);
    assert.equal(stored.drill.ok, false);
    assert.deepEqual(stored.drill.mismatches, [
      { table: 'tags', expected: null, actual: 0 },
      { table: 'users', expected: 3, actual: 2 },
    ]);
    assert.equal(stored.drill.dumpKey, DAILY);
    assert.equal(stored.drill.dumpTs, DUMP_TS);
    assert.ok(!('error' in stored.drill));
  }));

test('a dump that does not apply: recorded as ok false with the error, exit 1', () =>
  withTmp(async (tmpDir) => {
    const fake = fakeWrangler({ objects: bucketWith(manifestWith()), failApply: true });
    const code = await main(['--label', 'budo', '-e', 'production', '--yes'], { profiles: PROFILES, run: fake.run, now: NOW, tmpDir });
    assert.equal(code, 1);
    assert.equal(fake.of('d1 query').length, 0, 'no count after a failed apply');
    const stored = storedManifest(fake);
    assert.equal(stored.drill.ok, false);
    assert.deepEqual(stored.drill.mismatches, []);
    assert.match(stored.drill.error, /wrangler d1 execute --file \(local restore\) exited with status 1: .*syntax error/);
  }));

test('nothing to drill: no manifest, or no d1.latest → non-zero and no write', () =>
  withTmp(async (tmpDir) => {
    const none = fakeWrangler({ objects: bucketWith(null, null) });
    await assert.rejects(runDrill(target(), { run: none.run, now: NOW, tmpDir }), /nothing to drill: budo-backups has no d1\/production\/manifest\.json/);
    assert.equal(none.of('r2 put').length, 0);
    assert.equal(none.of('d1 apply').length, 0);

    const empty = fakeWrangler({ objects: bucketWith(manifestWith({ latest: false }), null) });
    await assert.rejects(main(['--label', 'budo', '-e', 'production', '--yes'], { profiles: PROFILES, run: empty.run, now: NOW, tmpDir }), /nothing to drill: the manifest has no d1\.latest/);
    assert.equal(empty.of('r2 put').length, 0);
    assert.equal(empty.of('r2 get').length, 1, 'only the manifest read');

    const other = fakeWrangler({ objects: bucketWith({ ...manifestWith(), label: 'spaziord' }) });
    await assert.rejects(runDrill(target(), { run: other.run, now: NOW, tmpDir }), /belongs to label "spaziord"/);
    assert.equal(other.of('r2 put').length, 0);
  }));

test('--keep leaves the temp dir (dump + local store) for inspection', () =>
  withTmp(async (tmpDir) => {
    const fake = fakeWrangler({ objects: bucketWith(manifestWith()) });
    const { dir } = await runDrill(target(), { run: fake.run, now: NOW, tmpDir, keep: true });
    assert.ok(existsSync(dir));
    assert.ok(existsSync(join(dir, 'dump.sql')) && existsSync(join(dir, 'dump.sql.gz')) && existsSync(join(dir, 'd1')));
    assert.ok(dir.startsWith(tmpDir));
  }));

// ── the workflow (text-level: no YAML parser in the tree; `python3 -c "import yaml"` is the parse check) ──

test('backup.yml: schedules, the scripts with their flags, and only the four secret names', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'backup.yml'), 'utf8');
  assert.match(yml, /cron: '30 7 \* \* \*'/, 'daily, offset from the 06:00 UTC billing cron');
  assert.match(yml, /cron: '30 9 \* \* 0'/, 'weekly drill on Sunday');
  assert.ok(!yml.includes("'0 6 * * *'"), 'never on the billing cron');
  assert.match(yml, /node scripts\/backup\/export-d1\.mjs --label \$\{\{ matrix\.label \}\} -e production --yes/);
  assert.match(yml, /node scripts\/backup\/mirror-r2\.mjs --label \$\{\{ matrix\.label \}\} -e production --yes --max-seconds 2700/);
  assert.match(yml, /node scripts\/backup\/drill\.mjs --label \$\{\{ matrix\.label \}\} -e production --yes/);
  const secrets = [...yml.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(secrets)].sort(), ['CF_ACCOUNT_ID', 'CF_API_TOKEN', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']);
  const r2Lines = yml.split('\n').filter((line) => /secrets\.R2_/.test(line));
  assert.equal(r2Lines.length, 2, 'the R2 keys reach exactly one step: the mirror');
  assert.ok(!/-e staging/.test(yml), 'staging is never backed up');
  assert.ok(!/wrangler d1 export|wrangler r2 object put/.test(yml), 'nothing re-implemented inline');
});
