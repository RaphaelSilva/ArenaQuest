#!/usr/bin/env node
/**
 * pull.mjs — copy a production label's backup to the operator's disk
 * (RFC 0025 §4.3, Resolved Decision 4: the off-account copy is the home lab).
 *
 *   node scripts/backup/pull.mjs --label <label> -e production [--out <dir>] [--concurrency <n>] [--dry-run]
 *
 * For one label, in a fixed order:
 *   1. manifest — `d1/production/manifest.json` is READ from the backup bucket
 *      (missing, or without `d1.latest` → nothing to pull, exit non-zero);
 *   2. index    — `r2/production/index.json`, the mirror's listing (missing →
 *      the dump alone is pulled, with a warning);
 *   3. plan     — the dump is needed unless the local copy already has the
 *      manifest's bytes and SHA-256; a mirrored object is needed unless a
 *      local file of the index's size exists. A tombstoned key is pulled
 *      too: the mirror keeps it on purpose for 90 days;
 *   4. dump     — downloaded to `<name>.part`, hashed, renamed only when the
 *      SHA-256 matches `d1.latest` (a mismatch removes the part, writes no
 *      ledger and exits non-zero);
 *   5. copies   — `manifest.json` and `index.json` are saved next to the data,
 *      so the restore can verify the dump offline;
 *   6. objects  — `--concurrency` downloads at a time (default 3), each to a
 *      `.part` renamed into place once its size matches the index;
 *   7. ledger   — `.arenaquest/backup-pull-<label>-<env>.json`,
 *      `{ pulledAt, dumpTs, objects }`, the line `status.mjs` reads. Written
 *      only once the dump is present and verified; `objects` counts what is
 *      on disk after this run, so a failed object leaves it honest.
 *
 * Resumable: a second run finds everything present and downloads nothing; an
 * interrupted run leaves `.part` files that the next run replaces. A failed
 * object exits 1 after the summary and the next run picks it up.
 *
 * **Backup bucket only.** Every call is `wrangler r2 object get
 * <backup bucket>/<key>` — the live media bucket and the live D1 are never
 * named, which is why the read-only token is enough (a test asserts both).
 * No `--yes`: the cloud is read, and the only writes land under `--out`.
 *
 * Local layout (`--out`, default `.arenaquest/backups/<label>-<env>/`):
 *   d1/<stamp>.sql.gz     the latest dump (older ones are left in place)
 *   d1/manifest.json      a copy of the manifest at pull time
 *   r2/index.json         a copy of the mirror index at pull time
 *   r2/<sourceKey>        the mirrored objects, under their source keys
 *
 * Refusals mirror export-d1's (`resolveBackupTarget`): `-e staging`, `-e local`,
 * an unknown environment or an unsafe profile exit before any wrangler call.
 * Logs carry keys, sizes and counts; no secret is handled (credentials are
 * wrangler's context: `wrangler login`, or `CF_API_TOKEN` in a shell).
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';

import log from '../lib/log.mjs';
import { formatBytes, runPool } from '../lib/api-client.mjs';
import { loadAllProfiles } from '../demo/seed-demo.mjs';
import { resolveBackupTarget } from './export-d1.mjs';
import { MANIFEST_KEY, firstLine, parseManifest, runCaptured, wranglerObjectStore } from './manifest.mjs';
import { parseIndex, quietLog } from './mirror-r2.mjs';
import { ledgerPath } from './status.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE)); // repo root (scripts/backup/..)

export const INDEX_KEY = 'r2/production/index.json';
export const MIRROR_PREFIX = 'r2/production/';
export const DEFAULT_CONCURRENCY = 3;

// ════════════════════════════════════════════════════════════════════════════
// PURE: arguments, paths, plan
// ════════════════════════════════════════════════════════════════════════════

export function parseArgs(argv) {
  let values;
  try {
    ({ values } = nodeParseArgs({
      args: argv,
      options: {
        label: { type: 'string' },
        env: { type: 'string', short: 'e' },
        out: { type: 'string' },
        concurrency: { type: 'string' },
        'dry-run': { type: 'boolean' },
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
  let concurrency = DEFAULT_CONCURRENCY;
  if (values.concurrency !== undefined) {
    if (!/^\d+$/.test(values.concurrency) || Number(values.concurrency) <= 0) {
      throw new Error(`--concurrency must be a positive integer (got ${JSON.stringify(values.concurrency)})`);
    }
    concurrency = Number(values.concurrency);
  }
  return {
    label: values.label,
    env: values.env,
    out: values.out ?? null,
    concurrency,
    dryRun: Boolean(values['dry-run']),
  };
}

/** `<root>/.arenaquest/backups/<label>-<env>` — where a pull lands unless `--out` says otherwise. */
export function defaultOutDir(label, env, root = ROOT) {
  return join(root, '.arenaquest', 'backups', `${label}-${env}`);
}

/**
 * A mirrored key is written under `<out>/r2/`; it comes from the cloud index,
 * so it must not be able to climb out of that directory. Throws on an absolute
 * key, a `.` or `..` segment, an empty segment or a backslash.
 */
export function assertSafeKey(key) {
  if (typeof key !== 'string' || key === '') throw new Error('index.json names an empty object key');
  if (key.startsWith('/') || key.includes('\\')) throw new Error(`index.json names an unsafe object key: ${JSON.stringify(key)}`);
  for (const segment of key.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') throw new Error(`index.json names an unsafe object key: ${JSON.stringify(key)}`);
  }
  return key;
}

/** The local files of one pull directory. */
export function localPaths(out) {
  return {
    dumpDir: join(out, 'd1'),
    manifestCopy: join(out, 'd1', 'manifest.json'),
    indexCopy: join(out, 'r2', 'index.json'),
    dumpPath: (key) => join(out, 'd1', basename(key)),
    objectPath: (key) => join(out, 'r2', ...assertSafeKey(key).split('/')),
  };
}

/**
 * What is needed, given the manifest's `d1.latest`, the mirror index (or
 * null) and the local state `{ dump: { bytes, sha256 } | null, objects:
 * { [key]: { size } } }`: `{ dump: { key, bytes, sha256, needed }, objects:
 * [{ key, size, etag, needed, tombstoned }], skipped, totalBytes }`.
 * `totalBytes` is what the run would download. Pure.
 */
export function planPull({ manifest, index, local }) {
  const latest = manifest?.d1?.latest;
  if (!latest) throw new Error('nothing to pull: the manifest has no d1.latest (run the export first)');
  const dumpNeeded = !local?.dump || local.dump.bytes !== latest.bytes || local.dump.sha256 !== latest.sha256;
  const dump = { key: latest.key, bytes: latest.bytes, sha256: latest.sha256, needed: dumpNeeded };

  const objects = [];
  const groups = [
    [index?.objects ?? {}, false],
    [index?.tombstones ?? {}, true],
  ];
  for (const [map, tombstoned] of groups) {
    for (const key of Object.keys(map).sort()) {
      assertSafeKey(key);
      const entry = map[key];
      const size = Number.isInteger(entry?.size) ? entry.size : null;
      const present = local?.objects?.[key];
      const needed = !present || (size !== null && present.size !== size);
      objects.push({ key, size, etag: entry?.etag ?? null, needed, tombstoned });
    }
  }
  const skipped = objects.filter((item) => !item.needed).length + (dumpNeeded ? 0 : 1);
  const totalBytes = (dumpNeeded ? latest.bytes : 0) + objects.filter((item) => item.needed).reduce((sum, item) => sum + (item.size ?? 0), 0);
  return { dump, objects, skipped, totalBytes };
}

/** The plan as log lines (what `--dry-run` prints, and the preamble of a real run). */
export function formatPullPlan(plan, { out, bucket }) {
  const needed = plan.objects.filter((item) => item.needed);
  const tombstoned = needed.filter((item) => item.tombstoned).length;
  const lines = [
    `bucket ${bucket} → ${out}`,
    plan.dump.needed
      ? `dump: ${plan.dump.key} (${formatBytes(plan.dump.bytes)}) → d1/${basename(plan.dump.key)}`
      : `dump: ${basename(plan.dump.key)} already present and verified`,
    `objects: ${needed.length} to download${tombstoned ? ` (${tombstoned} tombstoned)` : ''}, ${plan.objects.length - needed.length} already present`,
    `download: ${formatBytes(plan.totalBytes)}`,
  ];
  return lines;
}

// ════════════════════════════════════════════════════════════════════════════
// I/O
// ════════════════════════════════════════════════════════════════════════════

/** SHA-256 of a file, streamed (a dump can be hundreds of MB). */
export function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolveHash(hash.digest('hex')));
  });
}

function sizeOf(path) {
  return existsSync(path) ? statSync(path).size : null;
}

/** The local state `planPull` reads: the dump (hashed when present) and the size of every indexed object on disk. */
export async function localState(paths, latest, index) {
  const dumpPath = latest ? paths.dumpPath(latest.key) : null;
  let dump = null;
  if (dumpPath && existsSync(dumpPath)) dump = { bytes: statSync(dumpPath).size, sha256: await sha256File(dumpPath) };
  const objects = {};
  for (const key of [...Object.keys(index?.objects ?? {}), ...Object.keys(index?.tombstones ?? {})]) {
    const size = sizeOf(paths.objectPath(key));
    if (size !== null) objects[key] = { size };
  }
  return { dump, objects };
}

function writeFileAt(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Download `key` to `path` through a `.part` file; `expectedSize` (when known) must match or the part is removed. */
function download(store, key, path, expectedSize) {
  const part = `${path}.part`;
  mkdirSync(dirname(path), { recursive: true });
  rmSync(part, { force: true });
  try {
    store.getFile(key, part);
    const size = sizeOf(part);
    if (size === null) throw new Error(`r2 object get ${key} wrote no file`);
    if (expectedSize !== null && size !== expectedSize) throw new Error(`${key}: downloaded ${size} bytes, the index says ${expectedSize}`);
    renameSync(part, path);
    return size;
  } catch (error) {
    rmSync(part, { force: true });
    throw error;
  }
}

/**
 * Pull `target`'s backup into `out`. `store` is a `wranglerObjectStore` over
 * the BACKUP bucket (built from `run` when absent — the tests inject one or
 * the other); nothing else is ever reached. Returns `{ plan, pulled, skipped,
 * failed, bytes, ledger }`; throws when there is nothing to pull or the dump
 * does not match its manifest entry (no ledger is written then). With
 * `dryRun` only the manifest and the index are read. `log` is the logger
 * (`quietLog` in the tests: the child-process channel of `node --test` does
 * not survive this much raw stdout).
 */
export async function runPull(
  target,
  { store = null, run = runCaptured, out = null, concurrency = DEFAULT_CONCURRENCY, now = new Date(), dryRun = false, writeLedger = writeFileAt, ledgerFile = null, log: logger = log } = {},
) {
  const objects = store ?? wranglerObjectStore(target.bucket, { run });
  const dir = resolve(out ?? defaultOutDir(target.label, target.env));
  const paths = localPaths(dir);

  // 1. manifest — a corrupt one throws; a missing one is "nothing to pull".
  const manifestText = objects.getText(MANIFEST_KEY);
  if (manifestText === null) {
    throw new Error(`no manifest — nothing to pull: ${target.bucket} has no ${MANIFEST_KEY} (run make backup-d1-prod LABEL=${target.label} first)`);
  }
  const manifest = parseManifest(manifestText);
  if (manifest.label !== target.label) throw new Error(`manifest.json belongs to label "${manifest.label}", not "${target.label}"`);
  const latest = manifest.d1.latest;
  if (!latest) throw new Error(`nothing to pull: the manifest has no d1.latest (run make backup-d1-prod LABEL=${target.label} first)`);
  logger.info(`latest dump ${latest.key} (${formatBytes(latest.bytes)}, exported ${latest.ts})`);

  // 2. index — missing means the mirror has not run: the dump alone is pulled.
  const indexText = objects.getText(INDEX_KEY);
  const index = indexText === null ? null : parseIndex(indexText, { label: target.label, env: target.env });
  if (index === null) logger.warn(`no ${INDEX_KEY} in ${target.bucket}: the mirror has not run yet (make backup-r2-prod LABEL=${target.label}); pulling the dump only`);
  else logger.info(`mirror index: ${Object.keys(index.objects).length} objects, ${Object.keys(index.tombstones).length} tombstones`);

  // 3. plan
  const plan = planPull({ manifest, index, local: await localState(paths, latest, index) });
  for (const line of formatPullPlan(plan, { out: dir, bucket: target.bucket })) logger.info(line);
  if (dryRun) return { plan, pulled: 0, skipped: plan.skipped, failed: 0, bytes: 0, ledger: null };

  let pulled = 0;
  let bytes = 0;

  // 4. dump — verified before it gets its final name.
  const dumpPath = paths.dumpPath(latest.key);
  if (plan.dump.needed) {
    const size = download(objects, latest.key, `${dumpPath}.verify`, null);
    const sha256 = await sha256File(`${dumpPath}.verify`);
    if (size !== latest.bytes || sha256 !== latest.sha256) {
      rmSync(`${dumpPath}.verify`, { force: true });
      throw new Error(
        `dump ${latest.key} does not match its manifest entry: got ${size} bytes / ${sha256.slice(0, 12)}…, ` +
          `expected ${latest.bytes} bytes / ${latest.sha256.slice(0, 12)}… — removed, no ledger written; re-run the pull`,
      );
    }
    renameSync(`${dumpPath}.verify`, dumpPath);
    pulled += 1;
    bytes += size;
    logger.ok(`dump verified: ${basename(latest.key)} (${formatBytes(size)}, sha256 ${sha256.slice(0, 12)}…)`);
  } else {
    logger.info(`dump already present and verified: ${basename(latest.key)}`);
  }

  // 5. copies — what the restore reads offline.
  writeFileAt(paths.manifestCopy, manifestText);
  if (indexText !== null) writeFileAt(paths.indexCopy, indexText);

  // 6. objects
  const needed = plan.objects.filter((item) => item.needed);
  const results = await runPool(needed, concurrency, (item) => {
    const size = download(objects, `${MIRROR_PREFIX}${item.key}`, paths.objectPath(item.key), item.size);
    return size;
  });
  let failed = 0;
  results.forEach((result, position) => {
    const item = needed[position];
    if (result.ok) {
      pulled += 1;
      bytes += result.value;
      return;
    }
    failed += 1;
    logger.fail(`${item.key}: ${firstLine(result.error.message)}`);
  });

  // 7. ledger — the dump is present and verified at this point; objects counts what is on disk.
  const presentObjects = plan.objects.filter((item) => sizeOf(paths.objectPath(item.key)) !== null).length;
  const ledger = { pulledAt: now.toISOString(), dumpTs: latest.ts, objects: presentObjects };
  writeLedger(ledgerFile ?? ledgerPath(target.label, target.env), `${JSON.stringify(ledger, null, 2)}\n`);

  return { plan, pulled, skipped: plan.skipped, failed, bytes, ledger };
}

function usage() {
  console.log('Usage: node scripts/backup/pull.mjs --label <label> -e production [--out <dir>] [--concurrency <n>] [--dry-run]');
}

/**
 * `deps` exists for the tests: `profiles`, `run`, `store`, `now`, `writeLedger`,
 * `ledgerFile`, `log`. Returns 0, 1 when an object failed (the next run resumes), or
 * throws when nothing was pulled.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { profiles = null, run = runCaptured, store = null, now = new Date(), writeLedger = writeFileAt, ledgerFile = null, log: logger = log } = deps;
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return 0;
  }

  // Refusals first: no wrangler call happens before these pass.
  const target = resolveBackupTarget({ label: args.label, env: args.env, profiles: profiles ?? loadAllProfiles() });
  const out = resolve(args.out ?? defaultOutDir(target.label, target.env));
  logger.heading(`Backup pull — ${target.label} ${target.env}: bucket ${target.bucket} → ${out}`);

  const result = await runPull(target, { run, store, out, concurrency: args.concurrency, now, dryRun: args.dryRun, writeLedger, ledgerFile, log: logger });
  if (args.dryRun) {
    logger.ok('dry run: only the manifest and the index were read');
    return 0;
  }
  logger.info(`pulled ${result.pulled}, skipped ${result.skipped}, failed ${result.failed} — ${formatBytes(result.bytes)} downloaded`);
  logger.ok(`ledger: dump ${result.ledger.dumpTs}, ${result.ledger.objects} objects on disk (${ledgerFile ?? ledgerPath(target.label, target.env)})`);
  if (result.failed > 0) {
    logger.fail(`${result.failed} object(s) failed: re-run the pull, it resumes where it stopped`);
    return 1;
  }
  if (result.pulled === 0) logger.ok('nothing to download: the local copy is up to date');
  else logger.hint(`replay it locally: make backup-restore-local LABEL=${target.label}${args.out ? ` FROM=${out}` : ''}`);
  return 0;
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
