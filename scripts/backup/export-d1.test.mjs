/**
 * Unit tests for scripts/backup/export-d1.mjs — arguments, the production-only
 * refusals (asserted to happen before any wrangler call), the dry run, and the
 * export pipeline against a stubbed wrangler and an in-memory bucket: no
 * network, no Cloudflare credentials. The filesystem is real, in a temp dir.
 * Run with: node --test scripts/backup/export-d1.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import {
  LIST_TABLES_QUERY,
  buildCountSql,
  buildExportPlan,
  formatPlan,
  main,
  parseArgs,
  resolveBackupTarget,
  rowCountsFrom,
  runExport,
  tableNames,
} from './export-d1.mjs';
import { emptyManifest, parseManifest, serializeManifest } from './manifest.mjs';

const production = (overrides = {}) => ({
  d1: { name: 'budo-db' },
  r2: { bucket: 'budo-media' },
  backup: { bucket: 'budo-backups', retention: { dailyDays: 35, monthlyMonths: 12, tombstoneDays: 90 } },
  ...overrides,
});
const profile = (prod, staging = { d1: { name: 'budo-db-staging' }, r2: { bucket: 'budo-media-staging' } }) => ({
  label: 'budo',
  environments: { staging, production: prod },
});
const PROFILES = { budo: profile(production()) };
const NOW = new Date('2026-10-11T06:15:02.345Z');
const DAILY = 'd1/production/daily/2026/10/11/2026-10-11T06-15-02Z.sql.gz';
const MONTHLY = 'd1/production/monthly/2026/10/2026-10-11T06-15-02Z.sql.gz';
const MANIFEST = 'd1/production/manifest.json';
const SQL = 'CREATE TABLE users (id TEXT);\nINSERT INTO users VALUES (\'u1\');\n';
const TABLES = [{ name: 'topic_nodes' }, { name: 'users' }, { name: 'sqlite_sequence' }, { name: '_cf_KV' }];
const COUNTS = [{ t: 'topic_nodes', n: 7 }, { t: 'users', n: 3 }];

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const d1Json = (rows) => `banner line\n${JSON.stringify([{ results: rows, success: true }])}`;

/**
 * A wrangler stub: `d1 export` writes SQL to --output, `d1 execute --json`
 * answers the two read-only queries, `r2 object put/get` work against an
 * in-memory bucket. `failPut` names keys whose upload exits non-zero;
 * `corruptGet` names keys whose download comes back altered.
 */
function fakeWrangler({ objects = new Map(), failPut = [], corruptGet = [], sql = SQL } = {}) {
  const calls = [];
  const run = (argv) => {
    const kind = argv[5] === 'd1' ? `d1 ${argv[6]}` : `r2 ${argv[7]}`;
    const record = { kind, argv };
    calls.push(record);
    if (kind === 'd1 export') {
      writeFileSync(argv[argv.indexOf('--output') + 1], sql);
      return { status: 0, stdout: 'Export complete', stderr: '' };
    }
    if (kind === 'd1 execute') {
      const command = argv[argv.indexOf('--command') + 1];
      if (command === LIST_TABLES_QUERY) return { status: 0, stdout: d1Json(TABLES), stderr: '' };
      if (command.startsWith('SELECT ') && command.includes('COUNT(*)')) {
        record.sql = command;
        return { status: 0, stdout: d1Json(COUNTS), stderr: '' };
      }
      return { status: 1, stdout: '', stderr: `unexpected statement: ${command}` };
    }
    const key = argv[8].split('/').slice(1).join('/');
    record.key = key;
    const path = argv[argv.indexOf('--file') + 1];
    if (kind === 'r2 put') {
      if (failPut.includes(key)) return { status: 1, stdout: '', stderr: '✘ [ERROR] upload failed [code: 10001]' };
      objects.set(key, Buffer.from(readFileSync(path)));
      return { status: 0, stdout: 'Upload complete.', stderr: '' };
    }
    if (!objects.has(key)) return { status: 1, stdout: '', stderr: '✘ [ERROR] The specified key does not exist. [code: 10007]' };
    const bytes = objects.get(key);
    writeFileSync(path, corruptGet.includes(key) ? Buffer.concat([bytes, Buffer.from([0])]) : bytes);
    return { status: 0, stdout: 'Downloaded', stderr: '' };
  };
  return { run, calls, objects, of: (kind) => calls.filter((c) => c.kind === kind) };
}

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'aq-export-test-'));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => rmSync(dir, { recursive: true, force: true }));
}

const target = () => resolveBackupTarget({ label: 'budo', env: 'production', profiles: PROFILES });

// ── arguments ────────────────────────────────────────────────────────────────

test('parseArgs: label + env required, flags parsed, unknown option refused', () => {
  assert.deepEqual(parseArgs(['--label', 'budo', '-e', 'production']), { label: 'budo', env: 'production', dryRun: false, yes: false });
  assert.deepEqual(parseArgs(['--label', 'budo', '--env', 'production', '--dry-run', '--yes']), { label: 'budo', env: 'production', dryRun: true, yes: true });
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.throws(() => parseArgs(['-e', 'production']), /--label/);
  assert.throws(() => parseArgs(['--label', 'Budo', '-e', 'production']), /kebab-case/);
  assert.throws(() => parseArgs(['--label', 'budo']), /-e\/--env is required/);
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'production', '--force']), /invalid arguments/);
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'production', 'extra']), /invalid arguments/);
});

// ── target ───────────────────────────────────────────────────────────────────

test('resolveBackupTarget: production of a complete profile', () => {
  assert.deepEqual(target(), { label: 'budo', env: 'production', database: 'budo-db', bucket: 'budo-backups', wranglerEnv: 'budo' });
});

test('resolveBackupTarget: refuses staging, local and unknown environments', () => {
  assert.throws(() => resolveBackupTarget({ label: 'budo', env: 'staging', profiles: PROFILES }), /refusing -e staging/);
  assert.throws(() => resolveBackupTarget({ label: 'budo', env: 'local', profiles: PROFILES }), /refusing -e local/);
  assert.throws(() => resolveBackupTarget({ label: 'budo', env: 'prod', profiles: PROFILES }), /unknown environment "prod"/);
  assert.throws(() => resolveBackupTarget({ label: 'budo', env: undefined, profiles: PROFILES }), /unknown environment/);
});

test('resolveBackupTarget: refuses a missing profile, d1.name or backup block', () => {
  assert.throws(() => resolveBackupTarget({ label: 'nope', env: 'production', profiles: PROFILES }), /profile not found/);
  const noD1 = { budo: profile(production({ d1: {} })) };
  assert.throws(() => resolveBackupTarget({ label: 'budo', env: 'production', profiles: noD1 }), /production\.d1\.name/);
  const noBackup = { budo: profile(production({ backup: undefined })) };
  assert.throws(() => resolveBackupTarget({ label: 'budo', env: 'production', profiles: noBackup }), /production\.backup\.bucket/);
});

test('resolveBackupTarget: refuses a database or bucket that collides with another profile', () => {
  const pasted = { budo: PROFILES.budo, other: profile(production({ d1: { name: 'other-db' } }), { d1: { name: 'budo-db' } }) };
  assert.throws(() => resolveBackupTarget({ label: 'budo', env: 'production', profiles: pasted }), /"budo-db" of "budo" is the staging database name of "other"/);
  const media = { budo: profile(production({ backup: { bucket: 'budo-media' } })) };
  assert.throws(() => resolveBackupTarget({ label: 'budo', env: 'production', profiles: media }), /"budo-media" of "budo" is the production media bucket/);
});

test('main: -e staging and -e local exit non-zero before any wrangler invocation', async () => {
  for (const env of ['staging', 'local']) {
    const fake = fakeWrangler();
    await assert.rejects(main(['--label', 'budo', '-e', env, '--yes'], { profiles: PROFILES, run: fake.run, now: NOW }), /refusing -e/);
    assert.equal(fake.calls.length, 0, `${env}: no runner call`);
  }
});

test('main: a real run without --yes is refused before any wrangler invocation', async () => {
  const fake = fakeWrangler();
  await assert.rejects(main(['--label', 'budo', '-e', 'production'], { profiles: PROFILES, run: fake.run, now: NOW }), /needs --yes/);
  assert.equal(fake.calls.length, 0);
});

// ── plan ─────────────────────────────────────────────────────────────────────

test('buildCountSql, tableNames, rowCountsFrom', () => {
  assert.equal(
    buildCountSql(['users', 'odd"name']),
    `SELECT 'users' AS t, COUNT(*) AS n FROM "users" UNION ALL SELECT 'odd"name' AS t, COUNT(*) AS n FROM "odd""name"`,
  );
  assert.throws(() => buildCountSql([]), /no tables/);
  assert.deepEqual(tableNames(TABLES), ['topic_nodes', 'users']);
  assert.deepEqual(rowCountsFrom(COUNTS, ['topic_nodes', 'users']), { topic_nodes: 7, users: 3 });
  assert.throws(() => rowCountsFrom(COUNTS, ['topic_nodes', 'users', 'tags']), /row count for "tags" is missing/);
  assert.throws(() => rowCountsFrom([{ t: 'users', n: '3' }], ['users']), /not an integer/);
});

test('buildExportPlan: ordered steps with the keys; formatPlan prints argv and notes', () => {
  const steps = buildExportPlan(target(), NOW);
  assert.deepEqual(steps.map((s) => s.id), ['export', 'count', 'gzip', 'hash', 'put', 'verify', 'monthly', 'manifest']);
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  assert.deepEqual(byId.export.argv.slice(5), ['d1', 'export', 'budo-db', '--remote', '--env', 'budo', '--output', join('<tmp>', 'dump.sql'), '-y']);
  assert.equal(byId.count.argv.at(-2), LIST_TABLES_QUERY);
  assert.equal(byId.put.argv[8], `budo-backups/${DAILY}`);
  assert.equal(byId.monthly.argv[8], `budo-backups/${MONTHLY}`);
  assert.match(byId.monthly.note, /2026-10/);
  assert.equal(byId.manifest.argv[8], `budo-backups/${MANIFEST}`);
  assert.match(byId.manifest.note, /only after verify/);
  const text = formatPlan(steps).join('\n');
  assert.match(text, /1\. export/);
  assert.ok(text.includes(DAILY) && text.includes(MONTHLY) && text.includes(MANIFEST));
  assert.ok(text.includes('wrangler d1 export budo-db --remote --env budo'));
});

test('main --dry-run: prints the plan and performs no call', async () => {
  const fake = fakeWrangler();
  const code = await main(['--label', 'budo', '-e', 'production', '--dry-run'], { profiles: PROFILES, run: fake.run, now: NOW });
  assert.equal(code, 0);
  assert.equal(fake.calls.length, 0);
});

// ── pipeline ─────────────────────────────────────────────────────────────────

test('runExport happy path: object + manifest, sha256 and row counts match, only two SELECTs reach D1', () =>
  withTmp(async (tmpDir) => {
    const fake = fakeWrangler();
    const result = await runExport(target(), { run: fake.run, now: NOW, tmpDir });

    const stored = fake.objects.get(DAILY);
    assert.ok(stored, 'daily object stored');
    assert.equal(gunzipSync(stored).toString('utf8'), SQL, 'the object is the gzipped dump');
    const manifest = parseManifest(fake.objects.get(MANIFEST).toString('utf8'));
    assert.equal(manifest.d1.latest.sha256, sha256(stored));
    assert.equal(manifest.d1.latest.bytes, stored.length);
    assert.equal(manifest.d1.latest.key, DAILY);
    assert.equal(manifest.d1.latest.ts, NOW.toISOString());
    assert.deepEqual(manifest.d1.latest.rowCounts, { topic_nodes: 7, users: 3 });
    assert.ok(Number.isInteger(manifest.d1.latest.durationMs) && manifest.d1.latest.durationMs >= 0);
    assert.equal(manifest.d1.history.length, 1);
    assert.equal(manifest.label, 'budo');
    assert.deepEqual(result.entry, manifest.d1.latest);
    assert.equal(fake.objects.get(MANIFEST).toString('utf8'), serializeManifest(result.manifest));

    const d1 = fake.calls.filter((c) => c.kind.startsWith('d1'));
    assert.deepEqual(d1.map((c) => c.kind), ['d1 export', 'd1 execute', 'd1 execute']);
    assert.equal(d1[2].sql, buildCountSql(['topic_nodes', 'users']));
    for (const c of d1) assert.ok(c.argv.includes('--remote') && c.argv.includes('budo'), 'remote, env budo');

    assert.deepEqual(fake.calls.map((c) => c.kind), ['r2 get', 'd1 export', 'd1 execute', 'd1 execute', 'r2 put', 'r2 get', 'r2 put', 'r2 put']);
    assert.deepEqual(fake.of('r2 put').map((c) => c.key), [DAILY, MONTHLY, MANIFEST], 'first run of the month: monthly copy');
    assert.equal(fake.of('r2 put')[0].argv.at(-2), 'application/gzip');
    assert.equal(fake.of('r2 put')[2].argv.at(-2), 'application/json');
    assert.deepEqual(readdirSync(tmpDir), [], 'temp files removed');
  }));

test('runExport: an upload failure leaves manifest.json byte-identical and throws', () =>
  withTmp(async (tmpDir) => {
    const previous = serializeManifest(emptyManifest('budo'));
    const fake = fakeWrangler({ objects: new Map([[MANIFEST, Buffer.from(previous)]]), failPut: [DAILY] });
    await assert.rejects(runExport(target(), { run: fake.run, now: NOW, tmpDir }), /r2 object put .*exited with status 1: ✘ \[ERROR\] upload failed/);
    assert.equal(fake.of('r2 put').filter((c) => c.key === MANIFEST).length, 0, 'manifest put never called');
    assert.equal(fake.objects.get(MANIFEST).toString('utf8'), previous);
    assert.equal(fake.objects.has(MONTHLY), false);
    assert.deepEqual(readdirSync(tmpDir), []);
  }));

test('runExport: a verify mismatch throws before the manifest is written', () =>
  withTmp(async (tmpDir) => {
    const fake = fakeWrangler({ corruptGet: [DAILY] });
    await assert.rejects(runExport(target(), { run: fake.run, now: NOW, tmpDir }), /verify failed/);
    assert.equal(fake.objects.has(MANIFEST), false);
    assert.equal(fake.objects.has(MONTHLY), false);
    assert.deepEqual(fake.of('r2 put').map((c) => c.key), [DAILY]);
  }));

test('runExport: a corrupt manifest aborts before the database is touched', () =>
  withTmp(async (tmpDir) => {
    const fake = fakeWrangler({ objects: new Map([[MANIFEST, Buffer.from('{ broken')]]) });
    await assert.rejects(runExport(target(), { run: fake.run, now: NOW, tmpDir }), /not valid JSON/);
    assert.equal(fake.calls.filter((c) => c.kind.startsWith('d1')).length, 0);
    const other = fakeWrangler({ objects: new Map([[MANIFEST, Buffer.from(JSON.stringify({ ...emptyManifest('budo'), manifestVersion: 9 }))]]) });
    await assert.rejects(runExport(target(), { run: other.run, now: NOW, tmpDir }), /manifestVersion 9/);
    const foreign = fakeWrangler({ objects: new Map([[MANIFEST, Buffer.from(serializeManifest(emptyManifest('spaziord')))]]) });
    await assert.rejects(runExport(target(), { run: foreign.run, now: NOW, tmpDir }), /belongs to label "spaziord"/);
  }));

test('runExport: monthly copy on the first run of a month, not on the second, again next month', () =>
  withTmp(async (tmpDir) => {
    const fake = fakeWrangler();
    const first = await runExport(target(), { run: fake.run, now: NOW, tmpDir });
    assert.equal(first.monthlyKey, MONTHLY);

    const nextDay = new Date('2026-10-12T06:15:02.000Z');
    const second = await runExport(target(), { run: fake.run, now: nextDay, tmpDir });
    assert.equal(second.monthlyKey, null);
    assert.equal(fake.of('r2 put').filter((c) => c.key.includes('/monthly/')).length, 1);
    const manifest = parseManifest(fake.objects.get(MANIFEST).toString('utf8'));
    assert.equal(manifest.d1.history.length, 2);
    assert.equal(manifest.d1.monthly.length, 1);
    assert.equal(manifest.d1.latest.ts, nextDay.toISOString());

    const nextMonth = new Date('2026-11-01T06:15:02.000Z');
    const third = await runExport(target(), { run: fake.run, now: nextMonth, tmpDir });
    assert.equal(third.monthlyKey, 'd1/production/monthly/2026/11/2026-11-01T06-15-02Z.sql.gz');
    assert.deepEqual(parseManifest(fake.objects.get(MANIFEST).toString('utf8')).d1.monthly.map((m) => m.month), ['2026-10', '2026-11']);
  }));

test('main: a real run with --yes drives runExport through the injected runner', () =>
  withTmp(async (tmpDir) => {
    const fake = fakeWrangler();
    const code = await main(['--label', 'budo', '-e', 'production', '--yes'], { profiles: PROFILES, run: fake.run, now: NOW, tmpDir });
    assert.equal(code, 0);
    assert.ok(fake.objects.has(DAILY) && fake.objects.has(MANIFEST));
  }));
