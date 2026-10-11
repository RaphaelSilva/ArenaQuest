/**
 * Unit tests for scripts/backup/status.mjs — arguments, the pull ledger's
 * shape, every line's green / amber / red state with its fix command, the
 * `--json` snapshot, exit codes, the production-only refusal (before any
 * wrangler call) and the read-only guarantee (every runner call is `r2 object
 * get` or `d1 time-travel info`). No network, no Cloudflare credentials.
 * Run with: node --test scripts/backup/status.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

import { resolveBackupTarget } from './export-d1.mjs';
import { MANIFEST_KEY, appendD1Entry, emptyManifest, serializeManifest, setDrill, setR2LastRun } from './manifest.mjs';
import {
  LINE_IDS,
  THRESHOLDS,
  TIME_TRAVEL_WINDOW_NOTE,
  collect,
  evaluate,
  exitCodeOf,
  fixCommands,
  ledgerPath,
  main,
  parseArgs,
  parseLedger,
  previousEntry,
  render,
  sizeDropPct,
} from './status.mjs';

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
const PREV_TS = '2026-10-17T07:30:02.000Z';
const LATEST_TS = '2026-10-18T07:30:02.000Z'; // 2 h before NOW
const PREV_KEY = 'd1/production/daily/2026/10/17/2026-10-17T07-30-02Z.sql.gz';
const LATEST_KEY = 'd1/production/daily/2026/10/18/2026-10-18T07-30-02Z.sql.gz';
const MONTHLY_KEY = 'd1/production/monthly/2026/10/2026-10-01T07-30-02Z.sql.gz';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const BOOKMARK = '00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683';

const isoAgo = ({ hours = 0, days = 0 }) => new Date(NOW.getTime() - (hours + days * 24) * 60 * 60 * 1000).toISOString();

const target = () => ({ ...resolveBackupTarget({ label: 'budo', env: 'production', profiles: PROFILES }), tombstoneDays: 90 });

const PASSING_DRILL = { at: isoAgo({ hours: 1 }), ok: true, dumpTs: LATEST_TS, dumpKey: LATEST_KEY, mismatches: [], durationMs: 5000 };
const CLEAN_RUN = {
  at: isoAgo({ hours: 3 }),
  durationMs: 1000,
  copied: { objects: 2, bytes: 300 },
  pending: { objects: 0, bytes: 0 },
  failed: 0,
  tombstoned: 1,
  pruned: 0,
  unchanged: 10,
  sourceObjects: 12,
  stoppedBy: null,
};

/** A healthy manifest: two dumps (the latest 2 h old, 5 % smaller), a monthly copy, a passing drill of the latest dump, a clean mirror run. */
function healthyManifest({ latestTs = LATEST_TS, latestBytes = 950, previousBytes = 1000, drill = PASSING_DRILL, run = CLEAN_RUN, monthly = true } = {}) {
  let manifest = emptyManifest('budo');
  manifest = appendD1Entry(
    manifest,
    { ts: PREV_TS, key: PREV_KEY, bytes: previousBytes, sha256: SHA_A, rowCounts: { users: 3 }, durationMs: 4000 },
    { monthlyKey: monthly ? MONTHLY_KEY : null },
  );
  manifest = appendD1Entry(manifest, { ts: latestTs, key: LATEST_KEY, bytes: latestBytes, sha256: SHA_B, rowCounts: { users: 3 }, durationMs: 4100 });
  if (drill) manifest = setDrill(manifest, drill);
  if (run) manifest = setR2LastRun(manifest, run);
  return manifest;
}

const HEALTHY_LEDGER = { pulledAt: isoAgo({ days: 1 }), dumpTs: LATEST_TS, objects: 12 };
const TT_OK = { bookmark: BOOKMARK, error: null };

function report(overrides = {}) {
  return evaluate({ target: target(), manifest: healthyManifest(), timeTravel: TT_OK, ledger: HEALTHY_LEDGER, now: NOW, ...overrides });
}

const lineOf = (rep, id) => rep.lines.find((item) => item.id === id);

/**
 * A wrangler stub: `r2 object get` serves an in-memory bucket (writing to the
 * `--file` path, as the real one does); `d1 time-travel info` answers with
 * `timeTravel` (`{ status, stdout, stderr }`). Any other command fails loudly.
 */
function fakeWrangler({ objects = new Map(), timeTravel = { status: 0, stdout: `⛅️ wrangler 4.0.0\n-------------------\n${JSON.stringify({ bookmark: BOOKMARK })}\n`, stderr: '' } } = {}) {
  const calls = [];
  const run = (argv) => {
    assert.deepEqual(argv.slice(0, 5), ['pnpm', '--filter', 'api', 'exec', 'wrangler']);
    calls.push(argv);
    if (argv[5] === 'r2' && argv[6] === 'object' && argv[7] === 'get') {
      const key = argv[8].split('/').slice(1).join('/');
      if (!objects.has(key)) return { status: 1, stdout: '', stderr: '✘ [ERROR] The specified key does not exist. [code: 10007]' };
      writeFileSync(argv[argv.indexOf('--file') + 1], objects.get(key));
      return { status: 0, stdout: 'Downloaded', stderr: '' };
    }
    if (argv[5] === 'd1' && argv[6] === 'time-travel' && argv[7] === 'info') return timeTravel;
    return { status: 1, stdout: '', stderr: `unexpected command: ${argv.slice(5).join(' ')}` };
  };
  return { run, calls, objects };
}

function bucketWith(manifest) {
  const objects = new Map();
  if (manifest) objects.set(MANIFEST_KEY, Buffer.from(serializeManifest(manifest)));
  return objects;
}

// ── arguments, ledger, fix commands ──────────────────────────────────────────

test('parseArgs: label + env required, --json parsed, no --yes (nothing to confirm), unknown option refused', () => {
  assert.deepEqual(parseArgs(['--label', 'budo', '-e', 'production']), { label: 'budo', env: 'production', json: false });
  assert.deepEqual(parseArgs(['--label', 'budo', '--env', 'production', '--json']), { label: 'budo', env: 'production', json: true });
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.throws(() => parseArgs(['-e', 'production']), /--label/);
  assert.throws(() => parseArgs(['--label', 'Budo', '-e', 'production']), /kebab-case/);
  assert.throws(() => parseArgs(['--label', 'budo']), /-e\/--env is required/);
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'production', '--yes']), /invalid arguments/);
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'production', 'extra']), /invalid arguments/);
});

test('ledgerPath: .arenaquest/backup-pull-<label>-<env>.json under the given root', () => {
  assert.equal(ledgerPath('budo', 'production', '/repo'), '/repo/.arenaquest/backup-pull-budo-production.json');
});

test('parseLedger: { pulledAt, dumpTs, objects } accepted; anything else throws with a reason', () => {
  assert.deepEqual(parseLedger(JSON.stringify({ pulledAt: LATEST_TS, dumpTs: LATEST_TS, objects: 3, extra: 1 })), { pulledAt: LATEST_TS, dumpTs: LATEST_TS, objects: 3 });
  assert.throws(() => parseLedger(''), /empty/);
  assert.throws(() => parseLedger('{'), /not valid JSON/);
  assert.throws(() => parseLedger('[]'), /not a JSON object/);
  assert.throws(() => parseLedger(JSON.stringify({ dumpTs: LATEST_TS, objects: 3 })), /pulledAt/);
  assert.throws(() => parseLedger(JSON.stringify({ pulledAt: LATEST_TS, dumpTs: 'yesterday', objects: 3 })), /dumpTs/);
  assert.throws(() => parseLedger(JSON.stringify({ pulledAt: LATEST_TS, dumpTs: LATEST_TS, objects: -1 })), /objects/);
});

test('fixCommands: the label is filled in; the Make targets, the drill and the runbook sections match', () => {
  const fix = fixCommands(target());
  assert.equal(fix.exportD1, 'make backup-d1-prod LABEL=budo');
  assert.equal(fix.mirrorR2, 'make backup-r2-prod LABEL=budo');
  assert.equal(fix.drill, 'node scripts/backup/drill.mjs --label budo -e production --yes');
  assert.equal(fix.pull, 'make backup-pull-prod LABEL=budo');
  assert.equal(fix.timeTravel, 'pnpm --filter api exec wrangler d1 time-travel info budo-db --env budo --json');
  assert.match(fix.inspectDump, /backup-restore\.md §2/);
  assert.match(fix.copyBack, /backup-restore\.md §3/);
});

test('THRESHOLDS: the documented values, frozen', () => {
  assert.deepEqual(THRESHOLDS, { dumpMaxAgeHours: 26, mirrorMaxAgeHours: 26, drillMaxAgeDays: 8, sizeDropMaxPct: 30, mirrorPendingAmber: 1, homeLabMaxAgeDays: 7 });
  assert.ok(Object.isFrozen(THRESHOLDS));
});

// ── pure helpers ─────────────────────────────────────────────────────────────

test('previousEntry / sizeDropPct: the newest history entry that is not the latest; null without one', () => {
  const manifest = healthyManifest();
  assert.equal(previousEntry(manifest).key, PREV_KEY);
  assert.equal(previousEntry(null), null);
  const single = appendD1Entry(emptyManifest('budo'), { ts: LATEST_TS, key: LATEST_KEY, bytes: 10, sha256: SHA_A, rowCounts: {}, durationMs: 1 });
  assert.equal(previousEntry(single), null);
  assert.equal(sizeDropPct({ bytes: 60 }, { bytes: 100 }), 40);
  assert.equal(sizeDropPct({ bytes: 110 }, { bytes: 100 }), -10);
  assert.equal(sizeDropPct({ bytes: 1 }, { bytes: 0 }), null);
  assert.equal(sizeDropPct({ bytes: 1 }, null), null);
});

test('exitCodeOf: 0 green, 1 red, 2 amber', () => {
  assert.equal(exitCodeOf('green'), 0);
  assert.equal(exitCodeOf('red'), 1);
  assert.equal(exitCodeOf('amber'), 2);
});

// ── evaluate: the healthy case ───────────────────────────────────────────────

test('evaluate: fresh dump + passing drill of it + clean mirror + ledger 1 d old → every line green, exit 0, verified', () => {
  const rep = report();
  assert.deepEqual(rep.lines.map((item) => item.id), LINE_IDS);
  assert.deepEqual(rep.lines.map((item) => item.status), LINE_IDS.map(() => 'green'));
  assert.equal(rep.status, 'green');
  assert.equal(rep.unverified, false);
  assert.equal(exitCodeOf(rep.status), 0);
  for (const item of rep.lines) if (item.id !== 'r2.tombstones') assert.equal(item.fix, null, `${item.id} carries no fix when green`);
  assert.match(lineOf(rep, 'r2.tombstones').detail, /1 tombstoned and 0 pruned.*kept 90 days/);
  assert.match(lineOf(rep, 'timeTravel').detail, new RegExp(`bookmark ${BOOKMARK}`));
});

test('evaluate: on a clean clone (no ledger) the D1 lines stay green and homeLab is amber "never pulled on this machine" with the pull command', () => {
  const rep = report({ ledger: null });
  assert.equal(rep.status, 'amber');
  assert.equal(exitCodeOf(rep.status), 2);
  for (const id of ['d1.dump', 'd1.size', 'd1.drill', 'd1.monthly']) assert.equal(lineOf(rep, id).status, 'green');
  assert.deepEqual(lineOf(rep, 'homeLab'), { id: 'homeLab', status: 'amber', detail: 'never pulled on this machine', fix: 'make backup-pull-prod LABEL=budo' });
  assert.deepEqual(rep.data.homeLab, { pulledAt: null, ageDays: null, dumpTs: null, objects: null });
});

// ── evaluate: d1.dump ────────────────────────────────────────────────────────

test('evaluate: a dump 27 h old → d1.dump red with the export command; 25 h → green', () => {
  const stale = report({ manifest: healthyManifest({ latestTs: isoAgo({ hours: 27 }), drill: { ...PASSING_DRILL, dumpTs: isoAgo({ hours: 27 }) } }) });
  const line = lineOf(stale, 'd1.dump');
  assert.equal(line.status, 'red');
  assert.match(line.detail, /27 h old \(threshold 26 h\)/);
  assert.equal(line.fix, 'make backup-d1-prod LABEL=budo');
  assert.equal(stale.status, 'red');
  assert.equal(stale.data.dump.ageHours, 27);

  const fresh = report({ manifest: healthyManifest({ latestTs: isoAgo({ hours: 25 }), drill: { ...PASSING_DRILL, dumpTs: isoAgo({ hours: 25 }) } }) });
  assert.equal(lineOf(fresh, 'd1.dump').status, 'green');
});

test('evaluate: no manifest → every manifest-derived line red "no manifest — never backed up" with its fix; Time Travel and homeLab still reported', () => {
  const rep = report({ manifest: null, ledger: null });
  assert.equal(rep.status, 'red');
  assert.equal(rep.unverified, true);
  for (const id of ['d1.dump', 'd1.size', 'd1.drill', 'd1.monthly', 'r2.mirror', 'r2.tombstones']) {
    const line = lineOf(rep, id);
    assert.equal(line.status, 'red', id);
    assert.equal(line.detail, 'no manifest — never backed up', id);
    assert.ok(line.fix, `${id} carries a fix`);
  }
  assert.equal(lineOf(rep, 'd1.dump').fix, 'make backup-d1-prod LABEL=budo');
  assert.equal(lineOf(rep, 'd1.drill').fix, 'node scripts/backup/drill.mjs --label budo -e production --yes');
  assert.equal(lineOf(rep, 'r2.mirror').fix, 'make backup-r2-prod LABEL=budo');
  assert.equal(lineOf(rep, 'timeTravel').status, 'green');
  assert.equal(lineOf(rep, 'homeLab').status, 'amber');
  assert.deepEqual(rep.data.dump, null);
  assert.deepEqual(rep.data.drill, null);
  assert.deepEqual(rep.data.mirror, null);
  assert.equal(rep.data.previousBytes, null);
});

test('evaluate: a manifest without d1.latest → d1.dump red "never backed up"', () => {
  const rep = report({ manifest: emptyManifest('budo') });
  assert.equal(lineOf(rep, 'd1.dump').status, 'red');
  assert.match(lineOf(rep, 'd1.dump').detail, /no d1\.latest — never backed up/);
  assert.equal(lineOf(rep, 'd1.dump').fix, 'make backup-d1-prod LABEL=budo');
  assert.equal(lineOf(rep, 'd1.drill').status, 'red');
  assert.equal(lineOf(rep, 'r2.mirror').status, 'red');
});

// ── evaluate: d1.size ────────────────────────────────────────────────────────

test('evaluate: a 40 % size drop → d1.size red pointing at the runbook; 10 % → green; a first dump → green', () => {
  const drop = report({ manifest: healthyManifest({ latestBytes: 600, previousBytes: 1000 }) });
  assert.equal(lineOf(drop, 'd1.size').status, 'red');
  assert.match(lineOf(drop, 'd1.size').detail, /40 % smaller.*threshold 30 %/);
  assert.match(lineOf(drop, 'd1.size').fix, /inspect the dump before trusting it: docs\/operations\/backup-restore\.md §2/);
  assert.equal(drop.data.previousBytes, 1000);

  const small = report({ manifest: healthyManifest({ latestBytes: 900, previousBytes: 1000 }) });
  assert.equal(lineOf(small, 'd1.size').status, 'green');
  assert.match(lineOf(small, 'd1.size').detail, /10 % smaller/);

  const grew = report({ manifest: healthyManifest({ latestBytes: 1200, previousBytes: 1000 }) });
  assert.equal(lineOf(grew, 'd1.size').status, 'green');
  assert.match(lineOf(grew, 'd1.size').detail, /20 % larger/);

  let first = appendD1Entry(emptyManifest('budo'), { ts: LATEST_TS, key: LATEST_KEY, bytes: 10, sha256: SHA_A, rowCounts: {}, durationMs: 1 }, { monthlyKey: MONTHLY_KEY });
  first = setDrill(first, PASSING_DRILL);
  const firstRep = report({ manifest: setR2LastRun(first, CLEAN_RUN) });
  assert.equal(lineOf(firstRep, 'd1.size').status, 'green');
  assert.match(lineOf(firstRep, 'd1.size').detail, /first dump/);
  assert.equal(firstRep.data.previousBytes, null);
});

// ── evaluate: d1.drill ───────────────────────────────────────────────────────

test('evaluate: a failed drill → d1.drill red with the drill command; unverified', () => {
  const mismatch = report({ manifest: healthyManifest({ drill: { ...PASSING_DRILL, ok: false, mismatches: [{ table: 'users', expected: 3, actual: 2 }] } }) });
  assert.equal(mismatch.status, 'red');
  assert.equal(mismatch.unverified, true);
  assert.match(lineOf(mismatch, 'd1.drill').detail, /FAILED.*1 row-count mismatches.*unverified/);
  assert.equal(lineOf(mismatch, 'd1.drill').fix, 'node scripts/backup/drill.mjs --label budo -e production --yes');
  assert.equal(mismatch.data.drill.mismatches, 1);

  const broken = report({ manifest: healthyManifest({ drill: { ...PASSING_DRILL, ok: false, error: 'wrangler d1 execute exited with status 1' } }) });
  assert.match(lineOf(broken, 'd1.drill').detail, /dump did not restore: wrangler d1 execute exited/);
  assert.equal(broken.data.drill.error, 'wrangler d1 execute exited with status 1');
});

test('evaluate: a passing drill 9 d old → red; 7 d old for the latest dump → green', () => {
  const old = report({ manifest: healthyManifest({ drill: { ...PASSING_DRILL, at: isoAgo({ days: 9 }) } }) });
  assert.equal(lineOf(old, 'd1.drill').status, 'red');
  assert.match(lineOf(old, 'd1.drill').detail, /9 d old.*threshold 8 d/);
  assert.equal(lineOf(old, 'd1.drill').fix, 'node scripts/backup/drill.mjs --label budo -e production --yes');
  assert.equal(old.data.drill.ageDays, 9);

  const recent = report({ manifest: healthyManifest({ drill: { ...PASSING_DRILL, at: isoAgo({ days: 7 }) } }) });
  assert.equal(lineOf(recent, 'd1.drill').status, 'green');
});

test('evaluate: a passing drill of an OLDER dump → amber, the latest dump is unverified', () => {
  const rep = report({ manifest: healthyManifest({ drill: { ...PASSING_DRILL, dumpTs: PREV_TS, dumpKey: PREV_KEY } }) });
  assert.equal(rep.unverified, true);
  const line = lineOf(rep, 'd1.drill');
  assert.equal(line.status, 'amber');
  assert.match(line.detail, new RegExp(`for the dump of ${PREV_TS} — the latest dump \\(${LATEST_TS}\\) is unverified`));
  assert.equal(line.fix, 'node scripts/backup/drill.mjs --label budo -e production --yes');
  assert.equal(rep.status, 'amber');
});

test('evaluate: no drill at all → red, unverified', () => {
  const rep = report({ manifest: healthyManifest({ drill: null }) });
  assert.equal(rep.unverified, true);
  assert.equal(lineOf(rep, 'd1.drill').status, 'red');
  assert.match(lineOf(rep, 'd1.drill').detail, /no restore drill has run yet/);
  assert.equal(rep.data.drill, null);
});

// ── evaluate: d1.monthly ─────────────────────────────────────────────────────

test('evaluate: no monthly copy for the current month → amber with the export command; present → green', () => {
  const missing = report({ manifest: healthyManifest({ monthly: false }) });
  assert.equal(lineOf(missing, 'd1.monthly').status, 'amber');
  assert.match(lineOf(missing, 'd1.monthly').detail, /no monthly copy for 2026-10 yet/);
  assert.equal(lineOf(missing, 'd1.monthly').fix, 'make backup-d1-prod LABEL=budo');
  assert.equal(lineOf(report(), 'd1.monthly').detail, `monthly copy for 2026-10: ${MONTHLY_KEY}`);
});

// ── evaluate: r2.mirror / r2.tombstones ──────────────────────────────────────

test('evaluate: mirror pending > 0 → amber; failed > 0 → red; no run → red; run 27 h old → red', () => {
  const pending = report({ manifest: healthyManifest({ run: { ...CLEAN_RUN, pending: { objects: 3, bytes: 150 }, stoppedBy: 'maxBytes' } }) });
  assert.equal(lineOf(pending, 'r2.mirror').status, 'amber');
  assert.match(lineOf(pending, 'r2.mirror').detail, /3 objects \(150 bytes\) pending.*stopped by maxBytes/);
  assert.equal(lineOf(pending, 'r2.mirror').fix, 'make backup-r2-prod LABEL=budo');
  assert.deepEqual(pending.data.mirror.pending, { objects: 3, bytes: 150 });
  assert.equal(pending.data.mirror.stoppedBy, 'maxBytes');

  const failed = report({ manifest: healthyManifest({ run: { ...CLEAN_RUN, pending: { objects: 1, bytes: 50 }, failed: 1 } }) });
  assert.equal(lineOf(failed, 'r2.mirror').status, 'red');
  assert.match(lineOf(failed, 'r2.mirror').detail, /1 copies failed/);
  assert.equal(lineOf(failed, 'r2.mirror').fix, 'make backup-r2-prod LABEL=budo');

  const never = report({ manifest: healthyManifest({ run: null }) });
  assert.equal(lineOf(never, 'r2.mirror').status, 'red');
  assert.match(lineOf(never, 'r2.mirror').detail, /never run/);
  assert.equal(lineOf(never, 'r2.tombstones').status, 'green');
  assert.match(lineOf(never, 'r2.tombstones').detail, /no mirror run yet/);
  assert.equal(never.data.mirror, null);

  const stale = report({ manifest: healthyManifest({ run: { ...CLEAN_RUN, at: isoAgo({ hours: 27 }) } }) });
  assert.equal(lineOf(stale, 'r2.mirror').status, 'red');
  assert.match(lineOf(stale, 'r2.mirror').detail, /27 h old.*threshold 26 h/);
});

test('evaluate: r2.tombstones is informational — always green, with the copy-back pointer; retention omitted when unknown', () => {
  const rep = report({ manifest: healthyManifest({ run: { ...CLEAN_RUN, tombstoned: 4, pruned: 2 } }) });
  assert.equal(lineOf(rep, 'r2.tombstones').status, 'green');
  assert.equal(lineOf(rep, 'r2.tombstones').detail, '4 tombstoned and 2 pruned in the last run, kept 90 days');
  assert.equal(lineOf(rep, 'r2.tombstones').fix, 'copy-back: docs/operations/backup-restore.md §3 (R2 copy-back)');
  const unknown = report({ target: { ...target(), tombstoneDays: null } });
  assert.equal(lineOf(unknown, 'r2.tombstones').detail, '1 tombstoned and 0 pruned in the last run');
});

// ── evaluate: timeTravel / homeLab ───────────────────────────────────────────

test('evaluate: Time Travel unknown → amber with the manual command; the window is stated, never probed', () => {
  const rep = report({ timeTravel: { bookmark: null, error: 'exited with status 1: Authentication error' } });
  const line = lineOf(rep, 'timeTravel');
  assert.equal(line.status, 'amber');
  assert.match(line.detail, /unknown: exited with status 1: Authentication error/);
  assert.equal(line.fix, 'pnpm --filter api exec wrangler d1 time-travel info budo-db --env budo --json');
  assert.deepEqual(rep.data.timeTravel, { bookmark: null, windowNote: TIME_TRAVEL_WINDOW_NOTE });
  assert.match(lineOf(report(), 'timeTravel').detail, /window up to 30 days \(plan-dependent/);
});

test('evaluate: ledger 8 d old → amber with the pull command; unreadable ledger → amber; a newer dump is mentioned on a green line', () => {
  const old = report({ ledger: { ...HEALTHY_LEDGER, pulledAt: isoAgo({ days: 8 }) } });
  assert.equal(lineOf(old, 'homeLab').status, 'amber');
  assert.match(lineOf(old, 'homeLab').detail, /8 d old.*threshold 7 d/);
  assert.equal(lineOf(old, 'homeLab').fix, 'make backup-pull-prod LABEL=budo');
  assert.equal(old.data.homeLab.ageDays, 8);

  const corrupt = report({ ledger: { error: 'pull ledger is not valid JSON: Unexpected end' } });
  assert.equal(lineOf(corrupt, 'homeLab').status, 'amber');
  assert.match(lineOf(corrupt, 'homeLab').detail, /pull ledger unreadable/);
  assert.equal(lineOf(corrupt, 'homeLab').fix, 'make backup-pull-prod LABEL=budo');

  const behind = report({ ledger: { ...HEALTHY_LEDGER, dumpTs: PREV_TS } });
  assert.equal(lineOf(behind, 'homeLab').status, 'green');
  assert.match(lineOf(behind, 'homeLab').detail, new RegExp(`a newer dump \\(${LATEST_TS}\\) exists`));
  assert.deepEqual(behind.data.homeLab, { pulledAt: HEALTHY_LEDGER.pulledAt, ageDays: 1, dumpTs: PREV_TS, objects: 12 });
});

test('evaluate: overall status is the worst line — red beats amber beats green', () => {
  assert.equal(report().status, 'green');
  assert.equal(report({ ledger: null }).status, 'amber');
  assert.equal(report({ ledger: null, manifest: healthyManifest({ drill: null }) }).status, 'red');
});

// ── --json snapshot ──────────────────────────────────────────────────────────

test('evaluate: the --json shape is stable (snapshot, key order included)', () => {
  const rep = report({ ledger: null });
  const expected = {
    label: 'budo',
    env: 'production',
    checkedAt: '2026-10-18T09:30:00.000Z',
    status: 'amber',
    unverified: false,
    lines: [
      { id: 'd1.dump', status: 'green', detail: `latest dump ${LATEST_KEY} is 2 h old (950 bytes, exported ${LATEST_TS})`, fix: null },
      { id: 'd1.size', status: 'green', detail: '950 bytes, 5 % smaller than the previous dump (1000 bytes)', fix: null },
      { id: 'd1.drill', status: 'green', detail: `drill passed at ${PASSING_DRILL.at} for the latest dump (5000 ms)`, fix: null },
      { id: 'd1.monthly', status: 'green', detail: `monthly copy for 2026-10: ${MONTHLY_KEY}`, fix: null },
      { id: 'r2.mirror', status: 'green', detail: `mirror up to date at ${CLEAN_RUN.at}: 12 source objects, 2 copied, 10 unchanged`, fix: null },
      {
        id: 'r2.tombstones',
        status: 'green',
        detail: '1 tombstoned and 0 pruned in the last run, kept 90 days',
        fix: 'copy-back: docs/operations/backup-restore.md §3 (R2 copy-back)',
      },
      { id: 'timeTravel', status: 'green', detail: `bookmark ${BOOKMARK}; window ${TIME_TRAVEL_WINDOW_NOTE}`, fix: null },
      { id: 'homeLab', status: 'amber', detail: 'never pulled on this machine', fix: 'make backup-pull-prod LABEL=budo' },
    ],
    data: {
      dump: { ts: LATEST_TS, ageHours: 2, bytes: 950, sha256: SHA_B },
      previousBytes: 1000,
      drill: { at: PASSING_DRILL.at, ok: true, dumpTs: LATEST_TS, ageDays: 0, mismatches: 0, error: null },
      mirror: { at: CLEAN_RUN.at, ageHours: 3, pending: { objects: 0, bytes: 0 }, failed: 0, tombstoned: 1, pruned: 0, sourceObjects: 12, stoppedBy: null },
      timeTravel: { bookmark: BOOKMARK, windowNote: TIME_TRAVEL_WINDOW_NOTE },
      homeLab: { pulledAt: null, ageDays: null, dumpTs: null, objects: null },
    },
  };
  assert.equal(JSON.stringify(rep, null, 2), JSON.stringify(expected, null, 2));
});

// ── render ───────────────────────────────────────────────────────────────────

test('render: header, one line per check with an icon, → fix under non-green lines, footer with status and exit', () => {
  const text = render(report({ ledger: null, manifest: healthyManifest({ latestTs: isoAgo({ hours: 30 }), drill: { ...PASSING_DRILL, dumpTs: isoAgo({ hours: 30 }) } }) }));
  const lines = text.split('\n');
  assert.equal(lines[0], 'budo — production backups (checked 2026-10-18T09:30:00.000Z)');
  assert.match(lines[1], /^ {2}❌ d1\.dump {8}latest dump .* is 30 h old/);
  assert.equal(lines[2], '        → make backup-d1-prod LABEL=budo');
  assert.ok(lines.some((line) => /⚠️ homeLab {8}never pulled on this machine/.test(line)));
  assert.equal(lines.at(-1), 'Status: RED — 1 red, 1 amber.  Exit 1.');
  const unverified = render(report({ manifest: healthyManifest({ drill: null }) }));
  assert.match(unverified.split('\n').at(-1), /the latest dump is UNVERIFIED/);
});

// ── collect: read-only, Time Travel parsing, ledger ──────────────────────────

test('collect: reads the manifest, parses the bookmark after wrangler banners, reads the ledger — and issues only read calls', () => {
  const fake = fakeWrangler({ objects: bucketWith(healthyManifest()) });
  const ledgerReads = [];
  const inputs = collect(target(), {
    run: fake.run,
    readLedger: (path) => {
      ledgerReads.push(path);
      return JSON.stringify(HEALTHY_LEDGER);
    },
  });
  assert.equal(inputs.manifest.d1.latest.key, LATEST_KEY);
  assert.deepEqual(inputs.timeTravel, { bookmark: BOOKMARK, error: null });
  assert.deepEqual(inputs.ledger, HEALTHY_LEDGER);
  assert.deepEqual(ledgerReads, [ledgerPath('budo', 'production')]);

  assert.equal(fake.calls.length, 2);
  for (const argv of fake.calls) {
    const verb = argv.slice(5, 8).join(' ');
    assert.ok(verb === 'r2 object get' || verb === 'd1 time-travel info', `read-only call expected, got: ${verb}`);
    assert.ok(!argv.includes('put') && !argv.includes('delete') && !argv.includes('execute') && !argv.includes('restore'), argv.join(' '));
  }
  assert.deepEqual(fake.calls[0].slice(5, 9), ['r2', 'object', 'get', `budo-backups/${MANIFEST_KEY}`]);
  assert.deepEqual(fake.calls[1].slice(5), ['d1', 'time-travel', 'info', 'budo-db', '--env', 'budo', '--json']);
});

test('collect: a missing manifest → null; a corrupt one throws; a foreign label throws', () => {
  const missing = collect(target(), { run: fakeWrangler().run, readLedger: () => null });
  assert.equal(missing.manifest, null);
  assert.equal(missing.ledger, null);
  const corrupt = new Map([[MANIFEST_KEY, Buffer.from('{ not json')]]);
  assert.throws(() => collect(target(), { run: fakeWrangler({ objects: corrupt }).run, readLedger: () => null }), /not valid JSON/);
  assert.throws(() => collect(target(), { run: fakeWrangler({ objects: bucketWith(emptyManifest('spaziord')) }).run, readLedger: () => null }), /belongs to label "spaziord"/);
});

test('collect: a failing or unparsable time-travel call → { bookmark: null, error } — never a throw', () => {
  const failing = fakeWrangler({ objects: bucketWith(healthyManifest()), timeTravel: { status: 1, stdout: '', stderr: '✘ [ERROR] Authentication error [code: 10000]' } });
  assert.deepEqual(collect(target(), { run: failing.run, readLedger: () => null }).timeTravel, {
    bookmark: null,
    error: 'exited with status 1: ✘ [ERROR] Authentication error [code: 10000]',
  });
  const spawnError = fakeWrangler({ objects: bucketWith(healthyManifest()), timeTravel: { status: null, stdout: '', stderr: '', error: new Error('spawn pnpm ENOENT') } });
  assert.deepEqual(collect(target(), { run: spawnError.run, readLedger: () => null }).timeTravel, { bookmark: null, error: 'spawn pnpm ENOENT' });
  const noJson = fakeWrangler({ objects: bucketWith(healthyManifest()), timeTravel: { status: 0, stdout: 'banner only\n', stderr: '' } });
  assert.match(collect(target(), { run: noJson.run, readLedger: () => null }).timeTravel.error, /printed no JSON object/);
});

test('collect: a corrupt ledger is reported as { error }, not mistaken for "never pulled"', () => {
  const inputs = collect(target(), { run: fakeWrangler({ objects: bucketWith(healthyManifest()) }).run, readLedger: () => '{ nope' });
  assert.match(inputs.ledger.error, /pull ledger is not valid JSON/);
});

// ── main: refusals, exit codes, --json on stdout only ────────────────────────

test('main: -e staging / -e local / unknown env are refused before any wrangler call', async () => {
  const calls = [];
  const run = (argv) => {
    calls.push(argv);
    throw new Error('must not be called');
  };
  await assert.rejects(main(['--label', 'budo', '-e', 'staging'], { profiles: PROFILES, run }), /refusing -e staging/);
  await assert.rejects(main(['--label', 'budo', '-e', 'local'], { profiles: PROFILES, run }), /refusing -e local/);
  await assert.rejects(main(['--label', 'budo', '-e', 'prod'], { profiles: PROFILES, run }), /unknown environment "prod"/);
  await assert.rejects(main(['--label', 'nope', '-e', 'production'], { profiles: PROFILES, run }), /profile not found/);
  assert.equal(calls.length, 0);
});

test('main: exit 0 all green, 2 amber only, 1 any red; human output by default', async () => {
  const printed = [];
  const out = (text) => printed.push(text);
  const fake = fakeWrangler({ objects: bucketWith(healthyManifest()) });
  assert.equal(await main(['--label', 'budo', '-e', 'production'], { profiles: PROFILES, run: fake.run, now: NOW, readLedger: () => JSON.stringify(HEALTHY_LEDGER), out }), 0);
  assert.match(printed.at(-1), /^budo — production backups/);
  assert.match(printed.at(-1), /Status: GREEN — 0 red, 0 amber\.  Exit 0\./);

  assert.equal(await main(['--label', 'budo', '-e', 'production'], { profiles: PROFILES, run: fake.run, now: NOW, readLedger: () => null, out }), 2);
  assert.match(printed.at(-1), /never pulled on this machine/);

  const empty = fakeWrangler();
  assert.equal(await main(['--label', 'budo', '-e', 'production'], { profiles: PROFILES, run: empty.run, now: NOW, readLedger: () => null, out }), 1);
  assert.match(printed.at(-1), /no manifest — never backed up/);
  for (const argv of [...fake.calls, ...empty.calls]) {
    const verb = argv.slice(5, 8).join(' ');
    assert.ok(verb === 'r2 object get' || verb === 'd1 time-travel info', `read-only call expected, got: ${verb}`);
  }
});

test('main --json: exactly one JSON document on stdout with the same states, commands and exit code', async () => {
  const printed = [];
  const fake = fakeWrangler({ objects: bucketWith(healthyManifest({ drill: null })) });
  const code = await main(['--label', 'budo', '-e', 'production', '--json'], { profiles: PROFILES, run: fake.run, now: NOW, readLedger: () => null, out: (t) => printed.push(t) });
  assert.equal(code, 1);
  assert.equal(printed.length, 1);
  const parsed = JSON.parse(printed[0]);
  assert.deepEqual(Object.keys(parsed), ['label', 'env', 'checkedAt', 'status', 'unverified', 'lines', 'data']);
  assert.equal(parsed.status, 'red');
  assert.equal(parsed.unverified, true);
  assert.equal(parsed.lines.find((item) => item.id === 'd1.drill').fix, 'node scripts/backup/drill.mjs --label budo -e production --yes');
  assert.equal(parsed.lines.find((item) => item.id === 'homeLab').fix, 'make backup-pull-prod LABEL=budo');
  assert.equal(parsed.data.timeTravel.bookmark, BOOKMARK);
  assert.deepEqual(Object.keys(parsed.data), ['dump', 'previousBytes', 'drill', 'mirror', 'timeTravel', 'homeLab']);
});
