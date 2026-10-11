/**
 * Unit tests for scripts/backup/manifest.mjs — the versioned schema, parse,
 * append (cap + monthly), stable serialization, object keys, and the wrangler
 * object store with its runner stubbed: no network, no Cloudflare credentials.
 * Run with: node --test scripts/backup/manifest.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HISTORY_MAX,
  MANIFEST_KEY,
  MANIFEST_VERSION,
  appendD1Entry,
  emptyManifest,
  firstLine,
  getObjectCommand,
  isMissingObjectOutput,
  isoStamp,
  monthKey,
  monthlyCopyNeeded,
  objectKeys,
  parseManifest,
  putObjectCommand,
  serializeManifest,
  wranglerObjectStore,
} from './manifest.mjs';

const TS = new Date('2026-10-11T06:15:02.345Z');
const SHA = 'a'.repeat(64);
const entry = (overrides = {}) => ({
  ts: TS.toISOString(),
  key: 'd1/production/daily/2026/10/11/2026-10-11T06-15-02Z.sql.gz',
  bytes: 1234,
  sha256: SHA,
  rowCounts: { users: 3, topic_nodes: 7 },
  durationMs: 4100,
  ...overrides,
});

// ── schema ───────────────────────────────────────────────────────────────────

test('emptyManifest: versioned shape with empty d1 and null r2/drill', () => {
  const m = emptyManifest('budo');
  assert.deepEqual(m, {
    manifestVersion: 1,
    label: 'budo',
    env: 'production',
    d1: { latest: null, history: [], monthly: [] },
    r2: null,
    drill: null,
  });
  assert.equal(MANIFEST_VERSION, 1);
  assert.equal(MANIFEST_KEY, 'd1/production/manifest.json');
  assert.throws(() => emptyManifest(''), /label is required/);
});

test('parseManifest: round-trips a serialized manifest', () => {
  const m = appendD1Entry(emptyManifest('budo'), entry());
  const parsed = parseManifest(serializeManifest(m));
  assert.deepEqual(parsed, m);
});

test('parseManifest: empty text is an error (a missing manifest is the caller`s call)', () => {
  assert.throws(() => parseManifest(''), /is empty/);
  assert.throws(() => parseManifest('   \n'), /is empty/);
  assert.throws(() => parseManifest(null), /is empty/);
});

test('parseManifest: invalid JSON, non-object and a broken d1 block throw', () => {
  assert.throws(() => parseManifest('{ not json'), /not valid JSON/);
  assert.throws(() => parseManifest('[]'), /not a JSON object/);
  assert.throws(() => parseManifest(JSON.stringify({ manifestVersion: 1, label: 'budo', d1: { history: [] } })), /d1 must hold/);
  assert.throws(() => parseManifest(JSON.stringify({ manifestVersion: 1, d1: { latest: null, history: [], monthly: [] } })), /no label/);
});

test('parseManifest: a different manifestVersion is refused, naming both versions', () => {
  const text = JSON.stringify({ ...emptyManifest('budo'), manifestVersion: 2 });
  assert.throws(() => parseManifest(text), /manifestVersion 2; this tool reads version 1/);
  assert.throws(() => parseManifest(JSON.stringify({ label: 'budo', d1: {} })), /manifestVersion undefined/);
});

// ── months ───────────────────────────────────────────────────────────────────

test('monthKey and monthlyCopyNeeded: UTC calendar month', () => {
  assert.equal(monthKey(TS), '2026-10');
  assert.equal(monthKey('2026-10-31T23:59:59Z'), '2026-10');
  assert.throws(() => monthKey('nope'), /invalid timestamp/);

  const m = emptyManifest('budo');
  assert.equal(monthlyCopyNeeded(m, TS), true);
  const after = appendD1Entry(m, entry(), { monthlyKey: 'd1/production/monthly/2026/10/x.sql.gz' });
  assert.equal(monthlyCopyNeeded(after, TS), false);
  assert.equal(monthlyCopyNeeded(after, new Date('2026-10-30T00:00:00Z')), false);
  assert.equal(monthlyCopyNeeded(after, new Date('2026-11-01T00:00:00Z')), true);
});

// ── append ───────────────────────────────────────────────────────────────────

test('appendD1Entry: sets latest, appends history, leaves the input untouched', () => {
  const m = emptyManifest('budo');
  const next = appendD1Entry(m, entry());
  assert.deepEqual(m.d1, { latest: null, history: [], monthly: [] });
  assert.deepEqual(next.d1.latest, entry());
  assert.deepEqual(next.d1.history, [entry()]);
  assert.deepEqual(next.d1.monthly, []);
  assert.equal(next.manifestVersion, 1);

  const second = entry({ ts: '2026-10-12T06:15:02.000Z', key: 'd1/production/daily/2026/10/12/x.sql.gz' });
  const later = appendD1Entry(next, second);
  assert.equal(later.d1.history.length, 2);
  assert.equal(later.d1.history[1].key, second.key, 'newest last');
  assert.equal(later.d1.latest.key, second.key);
});

test('appendD1Entry: monthlyKey records the month and marks the entry', () => {
  const monthlyKey = 'd1/production/monthly/2026/10/2026-10-11T06-15-02Z.sql.gz';
  const next = appendD1Entry(emptyManifest('budo'), entry(), { monthlyKey });
  assert.deepEqual(next.d1.monthly, [{ month: '2026-10', key: monthlyKey, ts: TS.toISOString() }]);
  assert.equal(next.d1.latest.monthlyKey, monthlyKey);
  assert.equal(next.d1.history[0].monthlyKey, monthlyKey);
  assert.equal('monthlyKey' in appendD1Entry(emptyManifest('budo'), entry()).d1.latest, false);
});

test('appendD1Entry: history is capped at HISTORY_MAX, dropping the oldest', () => {
  let m = emptyManifest('budo');
  for (let i = 0; i < HISTORY_MAX + 5; i += 1) {
    m = appendD1Entry(m, entry({ key: `k${i}` }));
  }
  assert.equal(m.d1.history.length, HISTORY_MAX);
  assert.equal(m.d1.history[0].key, 'k5');
  assert.equal(m.d1.history.at(-1).key, `k${HISTORY_MAX + 4}`);
  assert.equal(m.d1.latest.key, `k${HISTORY_MAX + 4}`);
});

test('appendD1Entry: validates the entry', () => {
  const m = emptyManifest('budo');
  assert.throws(() => appendD1Entry(m, entry({ sha256: 'xyz' })), /sha256/);
  assert.throws(() => appendD1Entry(m, entry({ bytes: -1 })), /bytes/);
  assert.throws(() => appendD1Entry(m, entry({ bytes: 1.5 })), /bytes/);
  assert.throws(() => appendD1Entry(m, entry({ ts: 'yesterday' })), /ts/);
  assert.throws(() => appendD1Entry(m, entry({ key: '' })), /key/);
  assert.throws(() => appendD1Entry(m, entry({ rowCounts: [] })), /rowCounts/);
  assert.throws(() => appendD1Entry(m, entry({ durationMs: -1 })), /durationMs/);
});

// ── serialize ────────────────────────────────────────────────────────────────

test('serializeManifest: stable output regardless of key order, trailing newline', () => {
  const m = appendD1Entry(emptyManifest('budo'), entry());
  const shuffled = { drill: m.drill, r2: m.r2, d1: { monthly: m.d1.monthly, history: m.d1.history, latest: m.d1.latest }, env: m.env, label: m.label, manifestVersion: m.manifestVersion };
  const text = serializeManifest(m);
  assert.equal(serializeManifest(shuffled), text);
  assert.ok(text.endsWith('}\n'));
  assert.equal(text.indexOf('"manifestVersion"') < text.indexOf('"label"'), true);
  assert.equal(serializeManifest(parseManifest(text)), text);
});

// ── keys ─────────────────────────────────────────────────────────────────────

test('isoStamp and objectKeys: lifecycle-prefixed daily/monthly keys, one manifest', () => {
  assert.equal(isoStamp(TS), '2026-10-11T06-15-02Z');
  assert.deepEqual(objectKeys('production', TS), {
    daily: 'd1/production/daily/2026/10/11/2026-10-11T06-15-02Z.sql.gz',
    monthly: 'd1/production/monthly/2026/10/2026-10-11T06-15-02Z.sql.gz',
    manifest: 'd1/production/manifest.json',
  });
  assert.equal(objectKeys('production', TS).manifest, MANIFEST_KEY);
  assert.throws(() => isoStamp('nope'), /invalid timestamp/);
});

// ── store ────────────────────────────────────────────────────────────────────

test('commands: get/put argv shape (remote, file, content type, -y on put)', () => {
  assert.deepEqual(getObjectCommand('budo-backups', 'd1/production/manifest.json', '/tmp/x'), [
    'pnpm', '--filter', 'api', 'exec', 'wrangler', 'r2', 'object', 'get', 'budo-backups/d1/production/manifest.json', '--file', '/tmp/x', '--remote',
  ]);
  assert.deepEqual(putObjectCommand('budo-backups', 'a/b.gz', '/tmp/b.gz', 'application/gzip'), [
    'pnpm', '--filter', 'api', 'exec', 'wrangler', 'r2', 'object', 'put', 'budo-backups/a/b.gz', '--file', '/tmp/b.gz', '--remote', '--content-type', 'application/gzip', '-y',
  ]);
});

test('firstLine and isMissingObjectOutput', () => {
  assert.equal(firstLine('\n\n  ✘ [ERROR] boom  \nsecond line\n'), '✘ [ERROR] boom');
  assert.equal(firstLine(''), '');
  assert.equal(isMissingObjectOutput('✘ [ERROR] The specified key does not exist. [code: 10007]'), true);
  assert.equal(isMissingObjectOutput('✘ [ERROR] Authentication error [code: 10000]'), false);
  assert.equal(isMissingObjectOutput(''), false);
});

/** A runner over an in-memory bucket; `fail` forces a non-missing failure on every call. */
function fakeRunner({ objects = new Map(), fail = null } = {}) {
  const calls = [];
  const run = (argv) => {
    calls.push(argv);
    if (fail) return { status: 1, stdout: '', stderr: fail };
    const verb = argv[7];
    const key = argv[8].split('/').slice(1).join('/');
    const path = argv[argv.indexOf('--file') + 1];
    if (verb === 'get') {
      if (!objects.has(key)) return { status: 1, stdout: '', stderr: '\n✘ [ERROR] The specified key does not exist. [code: 10007]\n' };
      writeFileSync(path, objects.get(key));
      return { status: 0, stdout: 'ok', stderr: '' };
    }
    objects.set(key, readFileSync(path));
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  return { run, calls, objects };
}

test('wranglerObjectStore.getText: null only when the object is missing, throws otherwise', () => {
  const missing = fakeRunner();
  const store = wranglerObjectStore('budo-backups', { run: missing.run });
  assert.equal(store.getText('d1/production/manifest.json'), null);
  assert.equal(missing.calls.length, 1);
  assert.equal(missing.calls[0][8], 'budo-backups/d1/production/manifest.json');

  const present = fakeRunner({ objects: new Map([['d1/production/manifest.json', Buffer.from('{"x":1}\n')]]) });
  assert.equal(wranglerObjectStore('budo-backups', { run: present.run }).getText('d1/production/manifest.json'), '{"x":1}\n');

  const broken = fakeRunner({ fail: '✘ [ERROR] Authentication error [code: 10000]\nmore detail that must not leak' });
  assert.throws(
    () => wranglerObjectStore('budo-backups', { run: broken.run }).getText('d1/production/manifest.json'),
    (error) => /exited with status 1: ✘ \[ERROR\] Authentication error/.test(error.message) && !error.message.includes('more detail'),
  );
  assert.throws(() => wranglerObjectStore('', {}), /bucket is required/);
});

test('wranglerObjectStore.putFile / getFile: round-trip through the runner, throws on failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aq-manifest-test-'));
  try {
    const src = join(dir, 'in.gz');
    writeFileSync(src, Buffer.from([1, 2, 3]));
    const fake = fakeRunner();
    const store = wranglerObjectStore('budo-backups', { run: fake.run });
    store.putFile('d1/production/daily/x.sql.gz', src, 'application/gzip');
    assert.deepEqual(fake.calls[0].slice(5), ['r2', 'object', 'put', 'budo-backups/d1/production/daily/x.sql.gz', '--file', src, '--remote', '--content-type', 'application/gzip', '-y']);
    const out = join(dir, 'out.gz');
    store.getFile('d1/production/daily/x.sql.gz', out);
    assert.deepEqual([...readFileSync(out)], [1, 2, 3]);
    assert.throws(() => store.getFile('d1/production/daily/absent.sql.gz', out), /does not exist/);

    const failing = fakeRunner({ fail: 'network down' });
    assert.throws(() => wranglerObjectStore('budo-backups', { run: failing.run }).putFile('k', src, 'application/gzip'), /r2 object put k exited with status 1: network down/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
