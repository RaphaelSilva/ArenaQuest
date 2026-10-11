#!/usr/bin/env node
/**
 * drill.mjs — prove that a production label's latest D1 dump restores
 * (RFC 0025 §4.4). The weekly job of `.github/workflows/backup.yml`.
 *
 *   node scripts/backup/drill.mjs --label <label> -e production [--dry-run] [--yes] [--keep]
 *
 * For one label, in a fixed order where each step runs only if the previous
 * one succeeded:
 *   1. fetch    — `d1/production/manifest.json` is READ (missing, or without a
 *      `d1.latest`, means there is nothing to drill: exit non-zero, no write);
 *   2. download — `latest.key` to a temp dir;
 *   3. verify   — bytes and SHA-256 against `latest` — a mismatch ABORTS
 *      before anything is applied and leaves the manifest untouched (a dump
 *      that does not match its manifest is not evidence of anything);
 *   4. gunzip;
 *   5. apply    — `wrangler d1 execute arenaquest-db --local --persist-to <tmp>/d1
 *      --file <tmp>/dump.sql`: the throwaway local D1 of the *Demo seed check*
 *      job, on an EMPTY store — the dump carries its own `CREATE TABLE`s (and
 *      `d1_migrations`), so no migration runs first. The local name is only a
 *      handle into the persist dir; a `budo-db` dump applies to it fine;
 *   6. count    — the table list, then ONE `UNION ALL` `SELECT COUNT(*)`
 *      (export-d1's own statements) on the local store;
 *   7. compare  — against `latest.rowCounts`, per table, both directions;
 *   8. record   — `drill: { at, ok, dumpTs, dumpKey, mismatches, durationMs }`
 *      written back to the manifest.
 *
 * The result is the evidence: a mismatch (or a dump that fails to apply) is
 * still RECORDED, with `ok: false`, and the process exits non-zero so the job
 * fails — that is the alert. Only step 3 refuses to write anything.
 *
 * Offline after the download: the throwaway D1 is local and discarded in
 * `finally` (`--keep` leaves it for inspection), and no remote database is
 * ever written. Refusals mirror export-d1's (`resolveBackupTarget`): `-e
 * staging`, `-e local`, an unknown environment or an unsafe profile exit
 * before any wrangler call.
 *
 * `--dry-run` prints the plan and stops: no wrangler call, no credentials.
 * `--yes` is how a real drill is acknowledged (it writes the manifest); the
 * script never prompts. Credentials are wrangler's context (`wrangler login`
 * locally, `CF_API_TOKEN` in CI), as for the deploy CLI.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

import log from '../lib/log.mjs';
import { LOCAL_DATABASE, loadAllProfiles, parseD1Json } from '../demo/seed-demo.mjs';
import { LIST_TABLES_QUERY, buildCountSql, formatPlan, resolveBackupTarget, rowCountsFrom, tableNames } from './export-d1.mjs';
import { MANIFEST_KEY, firstLine, getObjectCommand, parseManifest, putObjectCommand, runCaptured, serializeManifest, setDrill, wranglerObjectStore } from './manifest.mjs';

const WRANGLER = ['pnpm', '--filter', 'api', 'exec', 'wrangler'];

export const MANIFEST_CONTENT_TYPE = 'application/json';

// ════════════════════════════════════════════════════════════════════════════
// PURE: arguments, commands, plan, compare
// ════════════════════════════════════════════════════════════════════════════

export function parseArgs(argv) {
  let values;
  try {
    ({ values } = nodeParseArgs({
      args: argv,
      options: {
        label: { type: 'string' },
        env: { type: 'string', short: 'e' },
        'dry-run': { type: 'boolean' },
        yes: { type: 'boolean' },
        keep: { type: 'boolean' },
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
  return {
    label: values.label,
    env: values.env,
    dryRun: Boolean(values['dry-run']),
    yes: Boolean(values.yes),
    keep: Boolean(values.keep),
  };
}

/** `wrangler d1 execute <local> --local --persist-to <dir> --file <sql>` — the restore itself. */
export function applyCommand(persistTo, sqlPath) {
  return [...WRANGLER, 'd1', 'execute', LOCAL_DATABASE, '--local', '--persist-to', persistTo, '--file', sqlPath];
}

/** A read-only statement on the throwaway store, JSON out. */
export function localQueryCommand(persistTo, sql) {
  return [...WRANGLER, 'd1', 'execute', LOCAL_DATABASE, '--local', '--persist-to', persistTo, '--command', sql, '--json'];
}

/**
 * Per-table differences between the manifest's counts and the restored ones:
 * `[{ table, expected, actual }]`, sorted by table, where a table present on
 * one side only carries `null` on the other. Empty means the drill passed.
 */
export function compareCounts(expected, actual) {
  const tables = new Set([...Object.keys(expected ?? {}), ...Object.keys(actual ?? {})]);
  const out = [];
  for (const table of [...tables].sort()) {
    const left = Object.hasOwn(expected ?? {}, table) ? expected[table] : null;
    const right = Object.hasOwn(actual ?? {}, table) ? actual[table] : null;
    if (left !== right) out.push({ table, expected: left, actual: right });
  }
  return out;
}

/**
 * The ordered steps of one drill: `{ id, title, argv?, note }`. `latest` may be
 * null (the dry run reads nothing); the key is then a placeholder. `tmpDir`
 * only names the paths the plan prints; the run makes its own.
 */
export function buildDrillPlan(target, latest = null, { tmpDir = '<tmp>' } = {}) {
  const key = latest?.key ?? '<d1.latest.key>';
  const gzPath = join(tmpDir, 'dump.sql.gz');
  const sqlPath = join(tmpDir, 'dump.sql');
  const persistTo = join(tmpDir, 'd1');
  const manifestPath = join(tmpDir, 'manifest.json');
  return [
    {
      id: 'fetch',
      title: `read ${MANIFEST_KEY} from bucket ${target.bucket}`,
      argv: getObjectCommand(target.bucket, MANIFEST_KEY, manifestPath),
      note: 'no manifest, or no d1.latest → nothing to drill (exit non-zero, no write)',
    },
    {
      id: 'download',
      title: `download the latest dump ${key}`,
      argv: getObjectCommand(target.bucket, key, gzPath),
      note: latest ? `${latest.bytes} bytes expected` : 'the key named by d1.latest',
    },
    { id: 'verify', title: 'compare bytes + SHA-256 with d1.latest', note: 'a mismatch aborts before any apply; the manifest stays untouched' },
    { id: 'gunzip', title: 'gunzip the dump', note: `→ ${sqlPath}` },
    {
      id: 'apply',
      title: `apply the dump to a throwaway local D1 (${LOCAL_DATABASE} in ${persistTo})`,
      argv: applyCommand(persistTo, sqlPath),
      note: 'an empty store: the dump carries its own CREATE TABLEs; no remote database is written',
    },
    {
      id: 'count',
      title: 'count rows per table on the local store',
      argv: localQueryCommand(persistTo, LIST_TABLES_QUERY),
      note: "then ONE statement: SELECT '<t>' AS t, COUNT(*) AS n FROM \"<t>\" UNION ALL …",
    },
    { id: 'compare', title: 'compare with d1.latest.rowCounts', note: 'every table, both directions' },
    {
      id: 'record',
      title: `write drill { at, ok, dumpTs, dumpKey, mismatches, durationMs } to ${MANIFEST_KEY}`,
      argv: putObjectCommand(target.bucket, MANIFEST_KEY, manifestPath, MANIFEST_CONTENT_TYPE),
      note: 'written on ok and on a mismatch alike (the result is the evidence); exit non-zero unless ok',
    },
  ];
}

// ════════════════════════════════════════════════════════════════════════════
// I/O
// ════════════════════════════════════════════════════════════════════════════

function check(result, what) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.status !== 0) {
    const output = firstLine(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    throw new Error(`${what} exited with status ${result.status}${output ? `: ${output}` : ''}`);
  }
  return result;
}

function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Restore the dump into an empty local store and count its tables; throws when the dump does not apply. */
function restoreAndCount(run, persistTo, sqlPath) {
  mkdirSync(persistTo, { recursive: true });
  check(run(applyCommand(persistTo, sqlPath)), 'wrangler d1 execute --file (local restore)');
  const tables = tableNames(parseD1Json(check(run(localQueryCommand(persistTo, LIST_TABLES_QUERY)), 'listing the restored tables').stdout));
  if (tables.length === 0) return {};
  return rowCountsFrom(parseD1Json(check(run(localQueryCommand(persistTo, buildCountSql(tables))), 'counting the restored rows').stdout), tables);
}

/**
 * Execute the drill against an already-resolved `target`. `run(argv)` returns
 * spawnSync's shape and is the only way out of the process (the tests inject
 * it); `store` defaults to `wranglerObjectStore(target.bucket, { run })`. Temp
 * files live under `mkdtempSync(join(tmpDir, 'aq-drill-'))` and are removed
 * unless `keep`. Returns `{ drill, manifest, dir }` — `drill.ok` says whether
 * the restore matched; the caller turns `false` into a non-zero exit. Throws
 * (manifest untouched) when there is nothing to drill or the dump does not
 * match its manifest entry.
 */
export async function runDrill(target, { run = runCaptured, store = null, now = new Date(), tmpDir = tmpdir(), keep = false } = {}) {
  const objects = store ?? wranglerObjectStore(target.bucket, { run });

  // 1. fetch — a corrupt manifest throws here; a missing one or no latest is "nothing to drill".
  const text = objects.getText(MANIFEST_KEY);
  if (text === null) throw new Error(`nothing to drill: ${target.bucket} has no ${MANIFEST_KEY} (run the export first)`);
  const manifest = parseManifest(text);
  if (manifest.label !== target.label) throw new Error(`manifest.json belongs to label "${manifest.label}", not "${target.label}"`);
  const latest = manifest.d1.latest;
  if (!latest) throw new Error('nothing to drill: the manifest has no d1.latest (run the export first)');
  log.info(`latest dump ${latest.key} (${latest.bytes} bytes, ${Object.keys(latest.rowCounts).length} tables, exported ${latest.ts})`);

  const dir = mkdtempSync(join(tmpDir, 'aq-drill-'));
  const started = performance.now();
  try {
    // 2. download
    const gzPath = join(dir, 'dump.sql.gz');
    objects.getFile(latest.key, gzPath);

    // 3. verify — abort before any apply.
    const bytes = statSync(gzPath).size;
    const sha256 = sha256Of(gzPath);
    if (bytes !== latest.bytes || sha256 !== latest.sha256) {
      throw new Error(
        `dump ${latest.key} does not match its manifest entry: got ${bytes} bytes / ${sha256.slice(0, 12)}…, ` +
          `expected ${latest.bytes} bytes / ${latest.sha256.slice(0, 12)}… — nothing applied, manifest untouched`,
      );
    }
    log.ok(`downloaded and verified: ${bytes} bytes, sha256 ${sha256.slice(0, 12)}…`);

    // 4. gunzip
    const sqlPath = join(dir, 'dump.sql');
    writeFileSync(sqlPath, gunzipSync(readFileSync(gzPath)));

    // 5–7. apply, count, compare — a dump that does not apply is recorded, not hidden.
    let mismatches = [];
    let error = null;
    try {
      const actual = restoreAndCount(run, join(dir, 'd1'), sqlPath);
      mismatches = compareCounts(latest.rowCounts, actual);
      log.ok(`restored locally: ${Object.keys(actual).length} tables counted`);
    } catch (failure) {
      error = failure.message;
      log.fail(`restore failed: ${error}`);
    }

    // 8. record
    const durationMs = Math.round(performance.now() - started);
    const drill = {
      at: now.toISOString(),
      ok: error === null && mismatches.length === 0,
      dumpTs: latest.ts,
      dumpKey: latest.key,
      mismatches,
      durationMs,
      ...(error ? { error } : {}),
    };
    const next = setDrill(manifest, drill);
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, serializeManifest(next));
    objects.putFile(MANIFEST_KEY, manifestPath, MANIFEST_CONTENT_TYPE);
    log.ok(`manifest updated: drill.ok = ${drill.ok} at ${drill.at}`);
    return { drill, manifest: next, dir };
  } finally {
    if (keep) log.hint(`kept ${dir} (--keep)`);
    else rmSync(dir, { recursive: true, force: true });
  }
}

function usage() {
  console.log('Usage: node scripts/backup/drill.mjs --label <label> -e production [--dry-run] [--yes] [--keep]');
}

/**
 * `deps` exists for the tests: `profiles`, `run`, `store`, `now`, `tmpDir`.
 * Returns 0 when the drill passed, 1 when it was recorded as failed; throws
 * when nothing was drilled.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { profiles = null, run = runCaptured, store = null, now = new Date(), tmpDir = tmpdir() } = deps;
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return 0;
  }

  // Refusals first: no wrangler call happens before these pass.
  const target = resolveBackupTarget({ label: args.label, env: args.env, profiles: profiles ?? loadAllProfiles() });
  const steps = buildDrillPlan(target);

  log.heading(`Restore drill — ${args.label} production: latest dump of bucket ${target.bucket} → throwaway local D1`);
  for (const line of formatPlan(steps)) log.info(line);

  if (args.dryRun) {
    log.ok('dry run: no wrangler call was made');
    return 0;
  }
  if (!args.yes) throw new Error("a real drill needs --yes (it writes the manifest's drill field)");

  const { drill } = await runDrill(target, { run, store, now, tmpDir, keep: args.keep });
  for (const item of drill.mismatches) {
    log.fail(`table ${item.table}: expected ${item.expected ?? 'absent'}, restored ${item.actual ?? 'absent'}`);
  }
  if (drill.ok) {
    log.ok(`drill ok: ${drill.dumpKey} restored with matching row counts in ${drill.durationMs} ms`);
    return 0;
  }
  log.fail(drill.error ? `drill FAILED (dump did not restore: ${drill.error})` : `drill FAILED (${drill.mismatches.length} mismatches)`);
  return 1;
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
