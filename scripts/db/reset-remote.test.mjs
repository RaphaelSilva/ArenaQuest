/**
 * Unit tests for scripts/db/reset-remote.mjs — arguments, refusals, the fixed
 * command sequence and the "no bookmark → nothing dropped" rule. Wrangler and
 * the seed are stubbed: no network, no Cloudflare credentials.
 * Run with: node --test scripts/db/reset-remote.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIST_OBJECTS_QUERY,
  buildDropSql,
  droppableObjects,
  executeReset,
  main,
  parseBookmark,
  parseResetArgs,
  resolveResetTarget,
} from './reset-remote.mjs';

const profile = (staging, production) => ({ environments: { staging, production } });
const PROFILES = {
  budo: profile(
    { d1: { name: 'budo-db-staging' }, r2: { bucket: 'budo-media-staging' } },
    { d1: { name: 'budo-db' }, r2: { bucket: 'budo-media' } },
  ),
  pasted: profile({ d1: { name: 'budo-db' } }, { d1: { name: 'pasted-db' } }),
  bucketed: profile({ d1: { name: 'bucketed-db-staging' }, r2: { bucket: 'budo-media' } }, { d1: { name: 'bucketed-db' } }),
};
const ENV = { AQ_DEMO_PASSWORD: 'demo-pass' };
const BOOKMARK = '0000007b-00000002-00004f6d-a3c2c1f7a0b5e3f2d9d2f8e1c3a4b5c6';

const TABLES = [
  { type: 'view', name: 'v_stale' },
  { type: 'table', name: 'users' },
  { type: 'table', name: 'd1_migrations' },
  { type: 'table', name: 'abandoned_candidate' },
  { type: 'table', name: 'sqlite_sequence' },
  { type: 'table', name: '_cf_KV' },
];
const d1Json = (rows) => `banner line\n${JSON.stringify([{ results: rows, success: true }])}`;

/** A wrangler stub recording every argv; `fail` names the step that exits non-zero. */
function fakeWrangler({ fail = null, bookmarkStdout = `▲ proxy warning\n{\n  "bookmark": "${BOOKMARK}"\n}\n`, left = [] } = {}) {
  const calls = [];
  let lists = 0;
  const step = (argv) => {
    if (argv.includes('time-travel')) return 'bookmark';
    if (argv.includes('migrations')) return 'migrate';
    if (argv.some((part) => part.endsWith('seed-demo.mjs'))) return 'seed';
    if (argv.includes(LIST_OBJECTS_QUERY)) return 'list';
    return 'drop';
  };
  const respond = (argv) => {
    const name = step(argv);
    calls.push({ name, argv });
    if (name === fail) return { status: 1, stdout: '', stderr: `${name} failed` };
    if (name === 'bookmark') return { status: 0, stdout: bookmarkStdout, stderr: '' };
    if (name === 'list') return { status: 0, stdout: d1Json(lists++ === 0 ? TABLES : left), stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { calls, run: respond, stream: respond };
}

const target = () => resolveResetTarget({ label: 'budo', env: 'staging', profiles: PROFILES });

test('parseResetArgs accepts staging with flags', () => {
  assert.deepEqual(parseResetArgs(['--label', 'budo', '-e', 'staging']), { label: 'budo', env: 'staging', dryRun: false, yes: false });
  assert.deepEqual(parseResetArgs(['--label', 'budo', '--env', 'staging', '--dry-run', '--yes']), {
    label: 'budo',
    env: 'staging',
    dryRun: true,
    yes: true,
  });
});

test('parseResetArgs refuses production, local, unknown envs, a missing label and any bypass flag', () => {
  assert.throws(() => parseResetArgs(['--label', 'budo', '-e', 'production']), /refusing -e production/);
  assert.throws(() => parseResetArgs(['--label', 'budo', '-e', 'local']), /db-reset-local/);
  assert.throws(() => parseResetArgs(['--label', 'budo', '-e', 'prod']), /must be staging/);
  assert.throws(() => parseResetArgs(['--label', 'budo']), /must be staging/);
  assert.throws(() => parseResetArgs(['-e', 'staging']), /--label/);
  assert.throws(() => parseResetArgs(['--label', 'budo', '-e', 'staging', '--force']), /invalid arguments/);
});

test('the target is the seed resolution: staging D1 of the label, remote, --env <label>-staging', () => {
  assert.deepEqual(target(), {
    env: 'staging',
    remote: true,
    database: 'budo-db-staging',
    bucket: 'budo-media-staging',
    wranglerEnv: 'budo-staging',
    wranglerArgs: ['--remote', '--env', 'budo-staging'],
  });
});

test('a staging block naming a production D1 or bucket is refused', () => {
  assert.throws(() => resolveResetTarget({ label: 'pasted', env: 'staging', profiles: PROFILES }), /production database name/);
  assert.throws(() => resolveResetTarget({ label: 'bucketed', env: 'staging', profiles: PROFILES }), /production bucket/);
  assert.throws(() => resolveResetTarget({ label: 'budo', env: 'production', profiles: PROFILES }), /refusing -e production/);
  assert.throws(() => resolveResetTarget({ label: 'nope', env: 'staging', profiles: PROFILES }), /profile not found/);
});

test('main refuses production and a production-named D1 before any wrangler call', async () => {
  const fake = fakeWrangler();
  await assert.rejects(() => main(['--label', 'budo', '-e', 'production', '--yes'], ENV, { profiles: PROFILES, ...fake }), /refusing -e production/);
  await assert.rejects(() => main(['--label', 'pasted', '-e', 'staging', '--yes'], ENV, { profiles: PROFILES, ...fake }), /production database name/);
  await assert.rejects(() => main(['--label', 'budo', '-e', 'local', '--yes'], ENV, { profiles: PROFILES, ...fake }), /db-reset-local/);
  assert.deepEqual(fake.calls, []);
});

test('main refuses a real run without AQ_DEMO_PASSWORD before any wrangler call', async () => {
  const fake = fakeWrangler();
  await assert.rejects(
    () => main(['--label', 'budo', '-e', 'staging', '--yes'], {}, { profiles: PROFILES, ...fake, isTTY: false }),
    /AQ_DEMO_PASSWORD is not set/,
  );
  assert.deepEqual(fake.calls, []);
});

test('without AQ_DEMO_PASSWORD on a TTY: asks for it before any wrangler call and hands it to the seed', async () => {
  const fake = fakeWrangler();
  const envVars = {};
  let callsWhenAsked = null;
  const askPassword = async () => {
    callsWhenAsked ??= fake.calls.length;
    return 'typed-pass-1';
  };
  assert.equal(
    await main(['--label', 'budo', '-e', 'staging', '--yes'], envVars, { profiles: PROFILES, ...fake, isTTY: true, askPassword }),
    0,
  );
  assert.equal(callsWhenAsked, 0);
  assert.equal(envVars.AQ_DEMO_PASSWORD, 'typed-pass-1', 'the seed child inherits it');
});

test('--dry-run makes no wrangler call (password optional)', async () => {
  const fake = fakeWrangler();
  assert.equal(await main(['--label', 'budo', '-e', 'staging', '--dry-run'], {}, { profiles: PROFILES, ...fake }), 0);
  assert.deepEqual(fake.calls, []);
});

test('without --yes: no TTY aborts, a wrong name aborts, the right name proceeds', async () => {
  const fake = fakeWrangler();
  const deps = { profiles: PROFILES, ...fake };
  await assert.rejects(() => main(['--label', 'budo', '-e', 'staging'], ENV, { ...deps, isTTY: false }), /re-run with --yes/);
  await assert.rejects(() => main(['--label', 'budo', '-e', 'staging'], ENV, { ...deps, isTTY: true, ask: async () => 'budo-db' }), /did not match/);
  assert.deepEqual(fake.calls, []);
  assert.equal(await main(['--label', 'budo', '-e', 'staging'], ENV, { ...deps, isTTY: true, ask: async () => ' budo-db-staging ' }), 0);
  assert.equal(fake.calls[0].name, 'bookmark');
});

test('the sequence is fixed: bookmark → list → drop → list → migrate → seed, with the exact argv', async () => {
  const fake = fakeWrangler();
  assert.equal(await main(['--label', 'budo', '-e', 'staging', '--yes'], ENV, { profiles: PROFILES, ...fake }), 0);
  assert.deepEqual(
    fake.calls.map((call) => call.name),
    ['bookmark', 'list', 'drop', 'list', 'migrate', 'seed'],
  );
  const W = ['pnpm', '--filter', 'api', 'exec', 'wrangler'];
  const [bookmark, list, drop, , migrate, seed] = fake.calls.map((call) => call.argv);
  assert.deepEqual(bookmark, [...W, 'd1', 'time-travel', 'info', 'budo-db-staging', '--env', 'budo-staging', '--json']);
  assert.deepEqual(list, [...W, 'd1', 'execute', 'budo-db-staging', '--remote', '--env', 'budo-staging', '--command', LIST_OBJECTS_QUERY, '--json']);
  assert.deepEqual(drop.slice(0, -3), [...W, 'd1', 'execute', 'budo-db-staging', '--remote', '--env', 'budo-staging']);
  assert.deepEqual(drop.slice(-3, -2), ['--command']);
  assert.equal(drop.at(-1), '--yes');
  assert.deepEqual(migrate, [...W, 'd1', 'migrations', 'apply', 'budo-db-staging', '--remote', '--env', 'budo-staging']);
  assert.deepEqual(seed.slice(1), ['scripts/demo/seed-demo.mjs', '--label', 'budo', '-e', 'staging', '--yes']);
  assert.equal(seed[0], process.execPath);
});

test('the drop batch defers FK checks, drops d1_migrations and never sqlite_* / _cf_*', () => {
  const fake = fakeWrangler();
  const result = executeReset({ target: target(), label: 'budo', ...fake });
  const sql = fake.calls.find((call) => call.name === 'drop').argv.at(-2);
  assert.ok(sql.startsWith('PRAGMA defer_foreign_keys = on;'), sql);
  assert.match(sql, /DROP TABLE IF EXISTS "d1_migrations";/);
  assert.match(sql, /DROP TABLE IF EXISTS "abandoned_candidate";/);
  assert.match(sql, /DROP VIEW IF EXISTS "v_stale";/);
  assert.ok(sql.indexOf('DROP VIEW') < sql.indexOf('DROP TABLE'), 'views are dropped before tables');
  assert.doesNotMatch(sql, /sqlite_sequence|_cf_KV/);
  assert.deepEqual(result.dropped, ['v_stale', 'users', 'd1_migrations', 'abandoned_candidate']);
  assert.equal(result.bookmark, BOOKMARK);
  assert.equal(result.restore, `pnpm --filter api exec wrangler d1 time-travel restore budo-db-staging --bookmark=${BOOKMARK} --env budo-staging`);
});

test('no bookmark → abort before anything is listed or dropped', () => {
  for (const options of [{ fail: 'bookmark' }, { bookmarkStdout: 'no json here' }, { bookmarkStdout: '{"bookmark": ""}' }]) {
    const fake = fakeWrangler(options);
    assert.throws(() => executeReset({ target: target(), label: 'budo', ...fake }), /aborted before dropping anything/);
    assert.deepEqual(fake.calls.map((call) => call.name), ['bookmark']);
  }
});

test('a failure after the bookmark stops the sequence and names the restore command', () => {
  for (const [fail, expected] of [
    ['drop', ['bookmark', 'list', 'drop']],
    ['migrate', ['bookmark', 'list', 'drop', 'list', 'migrate']],
    ['seed', ['bookmark', 'list', 'drop', 'list', 'migrate', 'seed']],
  ]) {
    const fake = fakeWrangler({ fail });
    assert.throws(
      () => executeReset({ target: target(), label: 'budo', ...fake }),
      (error) => error.message.includes(`--bookmark=${BOOKMARK}`) && /restore the pre-reset data/.test(error.message),
    );
    assert.deepEqual(fake.calls.map((call) => call.name), expected);
  }
});

test('tables surviving the drop fail the run before migrating', () => {
  const fake = fakeWrangler({ left: [{ type: 'table', name: 'users' }] });
  assert.throws(() => executeReset({ target: target(), label: 'budo', ...fake }), /still present after the drop: users/);
  assert.ok(!fake.calls.some((call) => call.name === 'migrate'));
});

test('parseBookmark skips banners and requires a bookmark', () => {
  assert.equal(parseBookmark(`▲ [WARNING] proxy\n{\n  "bookmark": "abc"\n}`), 'abc');
  assert.throws(() => parseBookmark(''), /no JSON object/);
  assert.throws(() => parseBookmark('{ "x": 1 }'), /no bookmark/);
});

test('droppableObjects and buildDropSql quote identifiers and filter reserved names', () => {
  assert.deepEqual(droppableObjects([...TABLES, { type: 'index', name: 'idx' }]).map((object) => object.name), [
    'v_stale',
    'users',
    'd1_migrations',
    'abandoned_candidate',
  ]);
  assert.equal(
    buildDropSql([{ type: 'table', name: 'we"ird' }]),
    'PRAGMA defer_foreign_keys = on; DROP TABLE IF EXISTS "we""ird";',
  );
  // `_` is a LIKE wildcard: the query filters with substr, so "xcf_table" is not mistaken for a _cf_ table.
  assert.match(LIST_OBJECTS_QUERY, /substr\(name, 1, 4\) <> '_cf_'/);
  assert.deepEqual(droppableObjects([{ type: 'table', name: 'xcf_table' }]).map((object) => object.name), ['xcf_table']);
});
