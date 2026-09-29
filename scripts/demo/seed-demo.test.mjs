/**
 * Unit tests for scripts/demo/seed-demo.mjs — arguments, target resolution and
 * the production refusal. No wrangler, no network.
 * Run with: node --test scripts/demo/seed-demo.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DRY_RUN_PASSWORD_HASH,
  LOCAL_DATABASE,
  loadAllProfiles,
  loadSanitizeMarkdown,
  main,
  parseSeedArgs,
  productionResources,
  readPassword,
  resolveTarget,
  sqlFilePath,
  wranglerCommand,
} from './seed-demo.mjs';

const profile = (staging, production) => ({ environments: { staging, production } });
const PROFILES = {
  budo: profile(
    { d1: { name: 'budo-db-staging' }, r2: { bucket: 'budo-media-staging' } },
    { d1: { name: 'budo-db' }, r2: { bucket: 'budo-media' } },
  ),
  other: profile({ d1: { name: 'other-db-staging' } }, { d1: { name: 'other-db' }, r2: { bucket: 'other-media' } }),
};

test('parseSeedArgs accepts local|staging with flags', () => {
  assert.deepEqual(parseSeedArgs(['--label', 'budo', '-e', 'local']), { label: 'budo', env: 'local', dryRun: false, yes: false });
  assert.deepEqual(parseSeedArgs(['--label', 'budo', '--env', 'staging', '--dry-run', '--yes']), {
    label: 'budo',
    env: 'staging',
    dryRun: true,
    yes: true,
  });
});

test('parseSeedArgs refuses production, unknown envs, a missing label and any password flag', () => {
  assert.throws(() => parseSeedArgs(['--label', 'budo', '-e', 'production']), /refusing -e production/);
  assert.throws(() => parseSeedArgs(['--label', 'budo', '-e', 'prod']), /must be one of local\|staging/);
  assert.throws(() => parseSeedArgs(['-e', 'local']), /--label/);
  assert.throws(() => parseSeedArgs(['--label', 'budo', '-e', 'local', '--password', 'x']), /invalid arguments/);
});

test('local resolves to the shared local replica', () => {
  assert.deepEqual(resolveTarget({ label: 'budo', env: 'local', profiles: PROFILES }), {
    env: 'local',
    remote: false,
    database: LOCAL_DATABASE,
    wranglerArgs: ['--local'],
  });
});

test('--persist-to is local-only and resolves to an absolute store for D1 and R2 alike', () => {
  assert.deepEqual(parseSeedArgs(['--label', 'budo', '-e', 'local', '--persist-to', 'tmp/state']), {
    label: 'budo',
    env: 'local',
    dryRun: false,
    yes: false,
    persistTo: 'tmp/state',
  });
  assert.throws(() => parseSeedArgs(['--label', 'budo', '-e', 'staging', '--persist-to', '/x']), /only applies to -e local/);
  assert.throws(() => parseSeedArgs(['--label', 'budo', '-e', 'local', '--persist-to', ' ']), /needs a directory/);
  const target = resolveTarget({ label: 'budo', env: 'local', profiles: PROFILES, persistTo: 'tmp/state' });
  assert.equal(target.persistTo, resolve('tmp/state'));
  assert.deepEqual(target.wranglerArgs, ['--local', '--persist-to', resolve('tmp/state')]);
  assert.deepEqual(wranglerCommand(target, '/abs/demo.sql').slice(-7), ['arenaquest-db', '--local', '--persist-to', resolve('tmp/state'), '--file', '/abs/demo.sql', '--yes']);
  assert.throws(() => resolveTarget({ label: 'budo', env: 'staging', profiles: PROFILES, persistTo: '/x' }), /only applies to -e local/);
});

test('staging resolves to the profile D1 and the <label>-staging wrangler env', () => {
  const target = resolveTarget({ label: 'budo', env: 'staging', profiles: PROFILES });
  assert.equal(target.database, 'budo-db-staging');
  assert.deepEqual(target.wranglerArgs, ['--remote', '--env', 'budo-staging']);
  assert.deepEqual(wranglerCommand(target, '/abs/demo.sql').slice(-7), [
    'budo-db-staging',
    '--remote',
    '--env',
    'budo-staging',
    '--file',
    '/abs/demo.sql',
    '--yes',
  ]);
});

test('production and unknown envs are refused by resolveTarget too', () => {
  assert.throws(() => resolveTarget({ label: 'budo', env: 'production', profiles: PROFILES }), /refusing -e production/);
  assert.throws(() => resolveTarget({ label: 'budo', env: 'preview', profiles: PROFILES }), /unknown environment/);
  assert.throws(() => resolveTarget({ label: 'nope', env: 'local', profiles: PROFILES }), /profile not found/);
});

test('a staging D1 named like ANY profile production D1 is refused', () => {
  const profiles = { ...PROFILES, budo: profile({ d1: { name: 'other-db' } }, { d1: { name: 'budo-db' } }) };
  assert.throws(() => resolveTarget({ label: 'budo', env: 'staging', profiles }), /production database name/);
  const own = { ...PROFILES, budo: profile({ d1: { name: 'budo-db' } }, { d1: { name: 'budo-db' } }) };
  assert.throws(() => resolveTarget({ label: 'budo', env: 'staging', profiles: own }), /production database name/);
});

test('a staging R2 bucket named like any production bucket is refused', () => {
  const profiles = {
    ...PROFILES,
    budo: profile({ d1: { name: 'budo-db-staging' }, r2: { bucket: 'other-media' } }, { d1: { name: 'budo-db' } }),
  };
  assert.throws(() => resolveTarget({ label: 'budo', env: 'staging', profiles }), /production bucket/);
});

test('productionResources collects every production D1 and bucket', () => {
  const { d1, buckets } = productionResources(PROFILES);
  assert.deepEqual([...d1].sort(), ['budo-db', 'other-db']);
  assert.deepEqual([...buckets].sort(), ['budo-media', 'other-media']);
});

test('the committed profiles resolve staging without tripping the guard', () => {
  const profiles = loadAllProfiles();
  for (const label of Object.keys(profiles)) {
    const target = resolveTarget({ label, env: 'staging', profiles });
    assert.ok(target.remote);
    assert.ok(!productionResources(profiles).d1.has(target.database));
  }
});

test('readPassword needs AQ_DEMO_PASSWORD unless dry-running', () => {
  assert.throws(() => readPassword({}, { dryRun: false }), /AQ_DEMO_PASSWORD/);
  assert.throws(() => readPassword({ AQ_DEMO_PASSWORD: '' }, { dryRun: false }), /AQ_DEMO_PASSWORD/);
  assert.equal(readPassword({}, { dryRun: true }), null);
  assert.equal(readPassword({ AQ_DEMO_PASSWORD: 'pw' }, { dryRun: false }), 'pw');
});

test('the dry-run placeholder is not a hash the adapter would accept', () => {
  assert.doesNotMatch(DRY_RUN_PASSWORD_HASH, /^pbkdf2:/);
});

test('main refuses production and a missing password before writing the SQL file', async () => {
  const file = sqlFilePath('spaziord', 'staging');
  rmSync(file, { force: true });
  await assert.rejects(() => main(['--label', 'spaziord', '-e', 'production'], {}), /refusing -e production/);
  await assert.rejects(() => main(['--label', 'spaziord', '-e', 'staging'], {}), /AQ_DEMO_PASSWORD is not set/);
  assert.equal(existsSync(file), false);
});

test('the shared sanitiser loads from packages/shared and strips script tags', async () => {
  const sanitize = await loadSanitizeMarkdown();
  assert.equal(sanitize('a<script>x</script>b'), 'ab');
});
