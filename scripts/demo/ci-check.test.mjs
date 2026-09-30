/**
 * Unit tests for scripts/demo/ci-check.mjs — the pure parts: arguments, the
 * fixture cache, the network guard and the assertions. No wrangler, no network
 * (the check itself runs as `node scripts/demo/ci-check.mjs`, see the CI job).
 * Run with: node --test scripts/demo/ci-check.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FIXTURES_DIR,
  RFC_FLOOR,
  assertNodeVersion,
  checkLabel,
  countDrift,
  expectations,
  guardedFetch,
  manifestFiles,
  parseCheckArgs,
  prefillCache,
} from './ci-check.mjs';
import { loadDataset } from './dataset.mjs';
import { listLabels } from './ids.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const scratch = () => mkdtempSync(join(tmpdir(), 'demo-ci-check-'));

test('parseCheckArgs: every label by default, --label repeatable, --keep', () => {
  assert.deepEqual(parseCheckArgs([]), { labels: null, keep: false });
  assert.deepEqual(parseCheckArgs(['--label', 'budo', '--label', 'spaziord', '--keep']), { labels: ['budo', 'spaziord'], keep: true });
  assert.throws(() => parseCheckArgs(['--password', 'x']), /invalid arguments/);
});

test('assertNodeVersion refuses a Node older than wrangler needs', () => {
  assert.throws(() => assertNodeVersion('20.19.0'), /needs Node >= 22/);
  assert.doesNotThrow(() => assertNodeVersion('22.12.0'));
});

test('the committed fixtures are exactly the pinned manifest files of every label', () => {
  const files = manifestFiles(listLabels().map((label) => loadDataset(label)));
  assert.ok(files.length > 0);
  for (const file of files) {
    const bytes = readFileSync(join(FIXTURES_DIR, file.fileName));
    assert.equal(sha(bytes), file.sha256, file.fileName);
    assert.equal(bytes.length, file.sizeBytes, file.fileName);
  }
});

test('prefillCache fills <cache>/<sha256> and refuses a missing or altered fixture', () => {
  const dir = scratch();
  const bytes = Buffer.from('fixture-bytes');
  writeFileSync(join(dir, 'a.jpg'), bytes);
  const file = { key: 'sample-image', fileName: 'a.jpg', sha256: sha(bytes) };
  assert.equal(prefillCache([file], { cacheDir: join(dir, 'cache'), fixturesDir: dir }), 1);
  assert.deepEqual(readFileSync(join(dir, 'cache', file.sha256)), bytes);
  assert.throws(() => prefillCache([{ ...file, fileName: 'b.jpg' }], { cacheDir: join(dir, 'cache'), fixturesDir: dir }), /no fixture/);
  assert.throws(() => prefillCache([{ ...file, sha256: sha(Buffer.from('other')) }], { cacheDir: join(dir, 'cache'), fixturesDir: dir }), /not the pinned/);
  rmSync(dir, { recursive: true, force: true });
});

test('guardedFetch passes loopback to the real fetch and refuses anything else', async () => {
  const seen = [];
  const { fetch, blocked } = guardedFetch(async (url) => {
    seen.push(url);
    return 'ok';
  });
  assert.equal(await fetch('http://127.0.0.1:8787/x'), 'ok');
  assert.equal(await fetch(new URL('http://localhost:1/')), 'ok');
  await assert.rejects(() => fetch('https://images-assets.nasa.gov/x.jpg'), /network request refused/);
  await assert.rejects(() => fetch({ url: 'https://workers.cloudflare.com/cf.json' }), /refused/);
  assert.equal(seen.length, 2);
  assert.deepEqual(blocked, ['https://images-assets.nasa.gov/x.jpg', 'https://workers.cloudflare.com/cf.json']);
});

test('expectations for budo meet the RFC 0021 criteria', () => {
  const expected = expectations(loadDataset('budo'));
  assert.deepEqual(expected.expect, {
    users: 6,
    topics: 21,
    readyMedia: 27,
    groups: 1,
    groupMembers: 2,
    enrollments: 2,
    events: 3,
    eventGrants: 1,
    billingPlans: 2,
    activeSubscriptions: 2,
    paidInvoices: 1,
    openInvoices: 1,
    payments: 1,
    tasks: 1,
    taskStages: 3,
    taskTopicLinks: 1,
    stageTopicLinks: 3,
    comments: 2,
    commentLikes: 1,
  });
  assert.ok(expected.expect.readyMedia >= RFC_FLOOR.readyMedia);
  assert.deepEqual(
    expected.students.map(({ user, xp, badges }) => ({ user, xp, badges })),
    [
      { user: 'student-1', xp: 350, badges: 1 },
      { user: 'student-2', xp: 950, badges: 2 },
      { user: 'student-3', xp: 0, badges: 0 },
    ],
  );
  assert.equal(new Set(expected.media.map((entry) => entry.id)).size, expected.media.length);
});

/** The observation a correct seed of `expected` produces. */
function goodObservation(expected) {
  return {
    counts: { ...expected.expect },
    objects: expected.media.map((entry) => ({ id: entry.id, key: `topics/x/${entry.id}`, state: 'ok' })),
    students: expected.students.map(({ id, xp, badges }) => ({ id, xp, badges })),
    xpProblems: [],
  };
}

test('checkLabel accepts a correct seed and names every deviation', () => {
  const expected = expectations(loadDataset('budo'));
  assert.deepEqual(checkLabel(goodObservation(expected), expected), []);

  const bad = goodObservation(expected);
  bad.counts.topics = 20;
  bad.objects[0].state = 'missing';
  bad.students[0].xp = 300;
  bad.xpProblems = ['student-2: user_xp.total_xp 1 but the xp_events ledger sums to 950'];
  bad.counts.openInvoices = 0;
  const problems = checkLabel(bad, expected);
  assert.ok(problems.some((line) => /^topics: 20, expected 21/.test(line)));
  assert.ok(problems.some((line) => /topics: 20 < RFC floor 21/.test(line)));
  assert.ok(problems.some((line) => /object missing/.test(line)));
  assert.ok(problems.some((line) => /student-1 total_xp: 300, expected 350/.test(line)));
  assert.ok(problems.some((line) => /ledger sums to 950/.test(line)));
  assert.ok(problems.some((line) => /^openInvoices: 0, expected 1/.test(line)));

  const gone = goodObservation(expected);
  gone.students = gone.students.slice(1);
  assert.ok(checkLabel(gone, expected).some((line) => /student-1: not found/.test(line)));
});

test('countDrift names the tables whose count changed', () => {
  assert.deepEqual(countDrift({ users: 6, media: 27 }, { users: 6, media: 27 }), []);
  assert.deepEqual(countDrift({ users: 6, media: 27 }, { users: 6, media: 54 }), ['media: 27 → 54']);
});
