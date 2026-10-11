#!/usr/bin/env node
/**
 * status.mjs — "was a backup made, and what do I do if not?" (RFC 0025 §4.5).
 *
 *   node scripts/backup/status.mjs --label <label> -e production [--json]
 *
 * For one production label, three READ-ONLY sources are consulted and turned
 * into one ordered checklist, each line green / amber / red against a named
 * threshold and, when not green, carrying the exact command that fixes it —
 * printed, never run:
 *
 *   manifest     `d1/production/manifest.json` in the backup bucket (one
 *                `wrangler r2 object get`); missing → every manifest-derived
 *                line is red "no manifest — never backed up";
 *   Time Travel  `wrangler d1 time-travel info <db> --env <label> --json`;
 *                a failure degrades to amber "unknown" with the command to run
 *                by hand — it never aborts the report;
 *   pull ledger  `.arenaquest/backup-pull-<label>-<env>.json` on THIS machine,
 *                `{ pulledAt, dumpTs, objects }`, written by `backup-pull-prod`
 *                (Task 14); missing → "never pulled on this machine".
 *
 * Lines, in order:
 *   d1.dump        age of the latest dump
 *   d1.size        size of the latest dump against the previous one
 *   d1.drill       the last restore drill: result, age, and whether it covered
 *                  the LATEST dump — a passing drill of an older dump leaves the
 *                  latest one `unverified` (amber)
 *   d1.monthly     a monthly copy for the current calendar month
 *   r2.mirror      the R2 mirror's last run: age, failed and pending copies
 *   r2.tombstones  informational: tombstoned / pruned counts and the retention
 *   timeTravel     the current D1 Time Travel bookmark; the window is a plan
 *                  property (30 days paid, 7 free) and is NOT probed
 *   homeLab        age of the last `backup-pull-prod` on this machine
 *
 * Thresholds (THRESHOLDS, the one place they live):
 *   dumpMaxAgeHours   26   a dump older than this is red (daily job + slack)
 *   mirrorMaxAgeHours 26   a mirror run older than this is red
 *   drillMaxAgeDays    8   a passing drill older than this is red (weekly job + slack)
 *   sizeDropMaxPct    30   a dump this much smaller than the previous one is red
 *   mirrorPendingAmber 1   this many pending objects after a run is amber
 *   homeLabMaxAgeDays  7   a local pull older than this is amber
 *
 * Overall status is the worst line (red > amber > green); the exit code is
 * 0 green, 1 red, 2 amber only (the `mapExitCode` convention). `--json` prints
 * the report alone on stdout, in a stable key order — the shape Task 12's
 * `backup_status` and `time_travel_status` tools return — with the same exit
 * code; everything else goes to stderr.
 *
 * Read-only by construction: the only wrangler calls are `r2 object get` and
 * `d1 time-travel info` (a test asserts it), the ledger is only read, and no
 * fix command is ever executed. The read-only Cloudflare token is enough.
 * Refusals mirror export-d1's (`resolveBackupTarget`): `-e staging`, `-e local`,
 * an unknown environment or an unsafe profile exit before any wrangler call.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';

import log from '../lib/log.mjs';
import { bookmarkCommand, parseBookmark } from '../db/reset-remote.mjs';
import { loadAllProfiles } from '../demo/seed-demo.mjs';
import { renderCommand, resolveBackupTarget } from './export-d1.mjs';
import { MANIFEST_KEY, firstLine, monthKey, parseManifest, runCaptured, wranglerObjectStore } from './manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE)); // repo root (scripts/backup/..)

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Every threshold of the report, documented in the header. */
export const THRESHOLDS = Object.freeze({
  dumpMaxAgeHours: 26,
  mirrorMaxAgeHours: 26,
  drillMaxAgeDays: 8,
  sizeDropMaxPct: 30,
  mirrorPendingAmber: 1,
  homeLabMaxAgeDays: 7,
});

export const RUNBOOK = 'docs/operations/backup-restore.md';
export const TIME_TRAVEL_WINDOW_NOTE = 'up to 30 days (plan-dependent: 30 on paid, 7 on free)';
export const LINE_IDS = ['d1.dump', 'd1.size', 'd1.drill', 'd1.monthly', 'r2.mirror', 'r2.tombstones', 'timeTravel', 'homeLab'];

const RANK = { green: 0, amber: 1, red: 2 };
const ICON = { green: '✅', amber: '⚠️', red: '❌' };
const NO_MANIFEST = 'no manifest — never backed up';

// ════════════════════════════════════════════════════════════════════════════
// PURE: arguments, paths, ledger, fix commands
// ════════════════════════════════════════════════════════════════════════════

export function parseArgs(argv) {
  let values;
  try {
    ({ values } = nodeParseArgs({
      args: argv,
      options: {
        label: { type: 'string' },
        env: { type: 'string', short: 'e' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    throw new Error(`invalid arguments: ${error.message}`);
  }
  if (values.help) return { help: true };
  if (!values.label || !/^[a-z][a-z0-9-]*$/.test(values.label)) throw new Error('--label <label> is required (lowercase kebab-case)');
  if (values.env === undefined || values.env === '') throw new Error('-e/--env is required (production)');
  return { label: values.label, env: values.env, json: Boolean(values.json) };
}

/** Where `backup-pull-prod` records its last pull on this machine (gitignored). */
export function ledgerPath(label, env, root = ROOT) {
  return join(root, '.arenaquest', `backup-pull-${label}-${env}.json`);
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

/**
 * The pull ledger's shape, `{ pulledAt, dumpTs, objects }` — defined here and
 * written by Task 14. Throws on anything else: a corrupt ledger is reported,
 * not mistaken for "never pulled".
 */
export function parseLedger(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('pull ledger is empty');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`pull ledger is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('pull ledger is not a JSON object');
  if (!isIsoTimestamp(parsed.pulledAt)) throw new Error('pull ledger: pulledAt must be an ISO timestamp');
  if (!isIsoTimestamp(parsed.dumpTs)) throw new Error('pull ledger: dumpTs must be an ISO timestamp');
  if (!Number.isInteger(parsed.objects) || parsed.objects < 0) throw new Error('pull ledger: objects must be a non-negative integer');
  return { pulledAt: parsed.pulledAt, dumpTs: parsed.dumpTs, objects: parsed.objects };
}

/** The commands a non-green line points at, with the label filled in. Matched to the Make targets and the runbook. */
export function fixCommands(target) {
  return {
    exportD1: `make backup-d1-prod LABEL=${target.label}`,
    mirrorR2: `make backup-r2-prod LABEL=${target.label}`,
    drill: `node scripts/backup/drill.mjs --label ${target.label} -e production --yes`,
    pull: `make backup-pull-prod LABEL=${target.label}`,
    timeTravel: renderCommand(bookmarkCommand(target)),
    inspectDump: `inspect the dump before trusting it: ${RUNBOOK} §2 (Restore a dump)`,
    copyBack: `copy-back: ${RUNBOOK} §3 (R2 copy-back)`,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// PURE: evaluate
// ════════════════════════════════════════════════════════════════════════════

function hoursBetween(from, now) {
  return (now.getTime() - new Date(from).getTime()) / HOUR_MS;
}

function daysBetween(from, now) {
  return (now.getTime() - new Date(from).getTime()) / DAY_MS;
}

const round1 = (n) => Math.round(n * 10) / 10;
const hours = (n) => `${round1(n)} h`;
const days = (n) => `${round1(n)} d`;

/** The history entry before `latest`: the newest one that is not the latest dump itself. */
export function previousEntry(manifest) {
  const latest = manifest?.d1?.latest;
  if (!latest) return null;
  return (manifest.d1.history ?? []).filter((entry) => entry?.key !== latest.key).at(-1) ?? null;
}

/** Percentage the latest dump shrank against the previous one (negative = grew); null without a comparable previous. */
export function sizeDropPct(latest, previous) {
  if (!latest || !previous || !Number.isFinite(previous.bytes) || previous.bytes <= 0) return null;
  return ((previous.bytes - latest.bytes) / previous.bytes) * 100;
}

function worstOf(lines) {
  return lines.reduce((worst, line) => (RANK[line.status] > RANK[worst] ? line.status : worst), 'green');
}

/**
 * The report from already-collected inputs. Pure: `now` is injected,
 * `timeTravel` is `{ bookmark, error }`, `ledger` is `{ pulledAt, dumpTs,
 * objects }`, `{ error }` or null, `manifest` is a parsed manifest or null.
 * Returns `{ label, env, checkedAt, status, unverified, lines, data }` in a
 * fixed key order.
 */
export function evaluate({ target, manifest, timeTravel, ledger, now, thresholds = THRESHOLDS }) {
  const fix = fixCommands(target);
  const line = (id, status, detail, fixText = null) => ({ id, status, detail, fix: fixText });
  const lines = [];

  const latest = manifest?.d1?.latest ?? null;
  const previous = previousEntry(manifest);
  const drill = manifest?.drill ?? null;
  const run = manifest?.r2?.lastRun ?? null;
  const dumpAgeHours = latest ? hoursBetween(latest.ts, now) : null;
  let unverified = true;

  // d1.dump
  if (!manifest) lines.push(line('d1.dump', 'red', NO_MANIFEST, fix.exportD1));
  else if (!latest) lines.push(line('d1.dump', 'red', 'the manifest has no d1.latest — never backed up', fix.exportD1));
  else if (dumpAgeHours > thresholds.dumpMaxAgeHours) {
    lines.push(line('d1.dump', 'red', `latest dump ${latest.key} is ${hours(dumpAgeHours)} old (threshold ${thresholds.dumpMaxAgeHours} h)`, fix.exportD1));
  } else lines.push(line('d1.dump', 'green', `latest dump ${latest.key} is ${hours(dumpAgeHours)} old (${latest.bytes} bytes, exported ${latest.ts})`));

  // d1.size
  const drop = sizeDropPct(latest, previous);
  if (!manifest) lines.push(line('d1.size', 'red', NO_MANIFEST, fix.exportD1));
  else if (!latest) lines.push(line('d1.size', 'red', 'no dump to size', fix.exportD1));
  else if (drop === null) lines.push(line('d1.size', 'green', `${latest.bytes} bytes — first dump, nothing to compare against`));
  else if (drop > thresholds.sizeDropMaxPct) {
    lines.push(line('d1.size', 'red', `${latest.bytes} bytes, ${round1(drop)} % smaller than the previous dump (${previous.bytes} bytes; threshold ${thresholds.sizeDropMaxPct} %)`, fix.inspectDump));
  } else {
    const delta = drop > 0 ? `${round1(drop)} % smaller than` : drop < 0 ? `${round1(-drop)} % larger than` : 'the same size as';
    lines.push(line('d1.size', 'green', `${latest.bytes} bytes, ${delta} the previous dump (${previous.bytes} bytes)`));
  }

  // d1.drill
  const drillAgeDays = drill ? daysBetween(drill.at, now) : null;
  if (!manifest) lines.push(line('d1.drill', 'red', NO_MANIFEST, fix.drill));
  else if (!drill) lines.push(line('d1.drill', 'red', 'no restore drill has run yet — the latest dump is unverified', fix.drill));
  else if (!drill.ok) {
    const why = drill.error ? `dump did not restore: ${drill.error}` : `${(drill.mismatches ?? []).length} row-count mismatches`;
    lines.push(line('d1.drill', 'red', `drill FAILED at ${drill.at} (${why}) — the latest dump is unverified`, fix.drill));
  } else if (drillAgeDays > thresholds.drillMaxAgeDays) {
    unverified = !latest || drill.dumpTs !== latest.ts;
    lines.push(line('d1.drill', 'red', `last passing drill is ${days(drillAgeDays)} old (${drill.at}; threshold ${thresholds.drillMaxAgeDays} d)`, fix.drill));
  } else if (latest && drill.dumpTs === latest.ts) {
    unverified = false;
    lines.push(line('d1.drill', 'green', `drill passed at ${drill.at} for the latest dump (${drill.durationMs} ms)`));
  } else {
    lines.push(line('d1.drill', 'amber', `drill passed at ${drill.at} but for the dump of ${drill.dumpTs} — the latest dump (${latest?.ts ?? 'none'}) is unverified`, fix.drill));
  }

  // d1.monthly
  const month = monthKey(now);
  const monthly = (manifest?.d1?.monthly ?? []).find((item) => item?.month === month) ?? null;
  if (!manifest) lines.push(line('d1.monthly', 'red', NO_MANIFEST, fix.exportD1));
  else if (monthly) lines.push(line('d1.monthly', 'green', `monthly copy for ${month}: ${monthly.key}`));
  else lines.push(line('d1.monthly', 'amber', `no monthly copy for ${month} yet (the next export adds it)`, fix.exportD1));

  // r2.mirror
  const mirrorAgeHours = run ? hoursBetween(run.at, now) : null;
  if (!manifest) lines.push(line('r2.mirror', 'red', NO_MANIFEST, fix.mirrorR2));
  else if (!run) lines.push(line('r2.mirror', 'red', 'the R2 mirror has never run', fix.mirrorR2));
  else if (mirrorAgeHours > thresholds.mirrorMaxAgeHours) {
    lines.push(line('r2.mirror', 'red', `last mirror run is ${hours(mirrorAgeHours)} old (${run.at}; threshold ${thresholds.mirrorMaxAgeHours} h)`, fix.mirrorR2));
  } else if (run.failed > 0) {
    lines.push(line('r2.mirror', 'red', `${run.failed} copies failed in the last run (${run.at}); ${run.pending.objects} objects (${run.pending.bytes} bytes) pending`, fix.mirrorR2));
  } else if (run.pending.objects >= thresholds.mirrorPendingAmber) {
    const stop = run.stoppedBy ? `stopped by ${run.stoppedBy}` : 'budget stop';
    lines.push(line('r2.mirror', 'amber', `${run.pending.objects} objects (${run.pending.bytes} bytes) pending after the last run (${run.at}, ${stop})`, fix.mirrorR2));
  } else {
    lines.push(line('r2.mirror', 'green', `mirror up to date at ${run.at}: ${run.sourceObjects} source objects, ${run.copied.objects} copied, ${run.unchanged} unchanged`));
  }

  // r2.tombstones (informational)
  const retention = Number.isInteger(target.tombstoneDays) ? `, kept ${target.tombstoneDays} days` : '';
  if (!manifest) lines.push(line('r2.tombstones', 'red', NO_MANIFEST, fix.mirrorR2));
  else if (!run) lines.push(line('r2.tombstones', 'green', 'no mirror run yet — no tombstones', fix.copyBack));
  else lines.push(line('r2.tombstones', 'green', `${run.tombstoned} tombstoned and ${run.pruned} pruned in the last run${retention}`, fix.copyBack));

  // timeTravel
  if (timeTravel?.bookmark) lines.push(line('timeTravel', 'green', `bookmark ${timeTravel.bookmark}; window ${TIME_TRAVEL_WINDOW_NOTE}`));
  else lines.push(line('timeTravel', 'amber', `unknown: ${timeTravel?.error ?? 'no bookmark'} — run by hand`, fix.timeTravel));

  // homeLab
  const pullAgeDays = ledger?.pulledAt ? daysBetween(ledger.pulledAt, now) : null;
  if (!ledger) lines.push(line('homeLab', 'amber', 'never pulled on this machine', fix.pull));
  else if (ledger.error) lines.push(line('homeLab', 'amber', `pull ledger unreadable (${ledger.error})`, fix.pull));
  else if (pullAgeDays > thresholds.homeLabMaxAgeDays) {
    lines.push(line('homeLab', 'amber', `last pull on this machine is ${days(pullAgeDays)} old (${ledger.pulledAt}; threshold ${thresholds.homeLabMaxAgeDays} d)`, fix.pull));
  } else {
    const newer = latest && ledger.dumpTs !== latest.ts ? `; a newer dump (${latest.ts}) exists` : '';
    lines.push(line('homeLab', 'green', `pulled ${days(pullAgeDays)} ago (${ledger.pulledAt}): dump ${ledger.dumpTs}, ${ledger.objects} objects${newer}`));
  }

  return {
    label: target.label,
    env: target.env,
    checkedAt: now.toISOString(),
    status: worstOf(lines),
    unverified,
    lines,
    data: {
      dump: latest ? { ts: latest.ts, ageHours: round1(dumpAgeHours), bytes: latest.bytes, sha256: latest.sha256 } : null,
      previousBytes: previous?.bytes ?? null,
      drill: drill
        ? { at: drill.at, ok: drill.ok, dumpTs: drill.dumpTs, ageDays: round1(drillAgeDays), mismatches: (drill.mismatches ?? []).length, error: drill.error ?? null }
        : null,
      mirror: run
        ? {
            at: run.at,
            ageHours: round1(mirrorAgeHours),
            pending: { objects: run.pending.objects, bytes: run.pending.bytes },
            failed: run.failed,
            tombstoned: run.tombstoned,
            pruned: run.pruned,
            sourceObjects: run.sourceObjects,
            stoppedBy: run.stoppedBy,
          }
        : null,
      timeTravel: { bookmark: timeTravel?.bookmark ?? null, windowNote: TIME_TRAVEL_WINDOW_NOTE },
      homeLab: {
        pulledAt: ledger?.pulledAt ?? null,
        ageDays: pullAgeDays === null ? null : round1(pullAgeDays),
        dumpTs: ledger?.dumpTs ?? null,
        objects: ledger?.objects ?? null,
      },
    },
  };
}

/** 0 all green, 1 any red, 2 amber only (the `mapExitCode` convention). */
export function exitCodeOf(status) {
  if (status === 'red') return 1;
  if (status === 'amber') return 2;
  return 0;
}

/** The human report: header, one line per check with its fix, footer with the overall status. */
export function render(report) {
  const lines = [`${report.label} — ${report.env} backups (checked ${report.checkedAt})`];
  for (const item of report.lines) {
    lines.push(`  ${ICON[item.status]} ${item.id.padEnd(14)} ${item.detail}`);
    if (item.fix) lines.push(`        → ${item.fix}`);
  }
  const reds = report.lines.filter((item) => item.status === 'red').length;
  const ambers = report.lines.filter((item) => item.status === 'amber').length;
  lines.push('');
  lines.push(
    `Status: ${report.status.toUpperCase()} — ${reds} red, ${ambers} amber` +
      `${report.unverified ? '; the latest dump is UNVERIFIED (no passing drill of its own)' : ''}.  Exit ${exitCodeOf(report.status)}.`,
  );
  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// I/O: collect
// ════════════════════════════════════════════════════════════════════════════

function defaultReadLedger(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/**
 * Gather the three inputs for `evaluate`. Only reads: `store.getText` for the
 * manifest, `run(bookmarkCommand)` for Time Travel, `readLedger(path)` for
 * the local pull ledger. A corrupt manifest throws (as everywhere else); a
 * failing Time Travel call and a corrupt ledger are reported, not thrown.
 */
export function collect(target, { store = null, run = runCaptured, readLedger = defaultReadLedger, ledgerFile = null } = {}) {
  const objects = store ?? wranglerObjectStore(target.bucket, { run });

  const text = objects.getText(MANIFEST_KEY);
  const manifest = text === null ? null : parseManifest(text);
  if (manifest && manifest.label !== target.label) throw new Error(`manifest.json belongs to label "${manifest.label}", not "${target.label}"`);

  let timeTravel;
  const result = run(bookmarkCommand(target));
  if (result.error) timeTravel = { bookmark: null, error: result.error.message };
  else if (result.status !== 0) timeTravel = { bookmark: null, error: `exited with status ${result.status}: ${firstLine(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)}` };
  else {
    try {
      timeTravel = { bookmark: parseBookmark(result.stdout), error: null };
    } catch (error) {
      timeTravel = { bookmark: null, error: error.message };
    }
  }

  let ledger = null;
  const ledgerText = readLedger(ledgerFile ?? ledgerPath(target.label, target.env));
  if (ledgerText !== null) {
    try {
      ledger = parseLedger(ledgerText);
    } catch (error) {
      ledger = { error: error.message };
    }
  }

  return { manifest, timeTravel, ledger };
}

function usage() {
  console.error('Usage: node scripts/backup/status.mjs --label <label> -e production [--json]');
}

/**
 * `deps` exists for the tests: `profiles`, `run`, `store`, `now`, `readLedger`,
 * `out` (stdout writer). Returns the exit code (0 green, 1 red, 2 amber), or
 * throws on a refusal or a corrupt manifest.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { profiles = null, run = runCaptured, store = null, now = new Date(), readLedger = defaultReadLedger, out = console.log } = deps;
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return 0;
  }

  // Refusals first: no wrangler call happens before these pass.
  const all = profiles ?? loadAllProfiles();
  const resolved = resolveBackupTarget({ label: args.label, env: args.env, profiles: all });
  const tombstoneDays = all[args.label]?.environments?.production?.backup?.retention?.tombstoneDays;
  const target = { ...resolved, tombstoneDays: Number.isInteger(tombstoneDays) ? tombstoneDays : null };

  const inputs = collect(target, { run, store, readLedger });
  const report = evaluate({ target, ...inputs, now });
  out(args.json ? JSON.stringify(report, null, 2) : render(report));
  return exitCodeOf(report.status);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      log.fail(error.message);
      process.exit(1);
    },
  );
}
