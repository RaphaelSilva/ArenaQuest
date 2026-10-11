/**
 * manifest.mjs — the backup manifest of a production label (RFC 0025 §4.1).
 *
 * One object per label, `d1/production/manifest.json` in the label's backup
 * bucket, is the contract shared by the D1 export (Task 02), the R2 mirror
 * (Task 03), the restore drill (Task 04) and the backup status (Task 11). Its
 * shape is versioned so a reader can refuse what it does not understand:
 *
 *   {
 *     manifestVersion: 1,
 *     label: 'budo',
 *     env: 'production',
 *     d1: {
 *       latest: Entry | null,                       // the newest successful export
 *       history: Entry[],                           // newest LAST, capped at HISTORY_MAX
 *       monthly: [{ month: 'YYYY-MM', key, ts }],   // one per calendar month, newest last
 *     },
 *     r2: null | { lastRun: R2Run },           // Task 03: the R2 mirror's last run
 *     drill: null | Drill,                     // Task 04: the restore drill's last result
 *   }
 *
 *   Drill = {                                      // written by scripts/backup/drill.mjs
 *     at: '2026-10-12T09:30:00.000Z',              // start of the drill, ISO 8601 UTC
 *     ok: true,                                    // restored AND every row count matched
 *     dumpTs: '2026-10-11T07:30:02.000Z',          // d1.latest.ts of the dump that was drilled
 *     dumpKey: 'd1/production/daily/…/….sql.gz',   // d1.latest.key of that dump
 *     mismatches: [{ table, expected, actual }],   // per-table count differences; a table on
 *                                                  //   one side only has null on the other
 *     durationMs: 12345,                           // download → compare
 *     error?: 'wrangler d1 execute exited …',      // only when the dump did not restore at all
 *   }
 *
 *   R2Run = {                                      // written by scripts/backup/mirror-r2.mjs
 *     at: '2026-10-11T06:30:00.000Z',              // start of the run, ISO 8601 UTC
 *     durationMs: 81234,
 *     copied:  { objects: 12, bytes: 734003200 },  // copied in this run
 *     pending: { objects: 3, bytes: 150000000 },   // still owed: budget stop + failed copies
 *     failed: 0,                                   // copies that errored (a subset of pending)
 *     tombstoned: 1,                               // gone from the source, kept in the mirror
 *     pruned: 0,                                   // tombstones past retention.tombstoneDays, deleted
 *     unchanged: 340,
 *     sourceObjects: 353,                          // objects listed in the media bucket
 *     stoppedBy: null | 'maxBytes' | 'maxSeconds',
 *   }
 *
 *   Entry = {
 *     ts: '2026-10-11T06:15:02.000Z',               // ISO 8601, UTC
 *     key: 'd1/production/daily/2026/10/11/2026-10-11T06-15-02Z.sql.gz',
 *     bytes: 123456,                                // size of the gzipped dump
 *     sha256: '<64 hex chars>',                     // SHA-256 of the gzipped dump
 *     rowCounts: { users: 12, topic_nodes: 340 },   // SELECT COUNT(*) per table at export time
 *     durationMs: 4123,                             // the `d1 export` call alone
 *     monthlyKey?: 'd1/production/monthly/2026/10/2026-10-11T06-15-02Z.sql.gz',
 *   }
 *
 * Key layout — reconciled with the lifecycle prefixes Task 01 installs on the
 * bucket (`backupLifecycleRules` in scripts/cloudflare/provision-label.mjs):
 *   daily    d1/<env>/daily/YYYY/MM/DD/<stamp>.sql.gz   expires after retention.dailyDays
 *   monthly  d1/<env>/monthly/YYYY/MM/<stamp>.sql.gz    expires after retention.monthlyMonths
 *   manifest d1/<env>/manifest.json                     outside both prefixes: never expires
 * `<stamp>` is the ISO timestamp with its colons replaced by `-` and no
 * milliseconds (`2026-10-11T06-15-02Z`), so a key is valid on every filesystem
 * a dump is downloaded to.
 *
 * The pure part (schema, parse, append, serialize, keys) has no I/O and is
 * unit-tested directly; `wranglerObjectStore` is the one side-effecting export,
 * built on `wrangler r2 object get/put … --remote` through an injectable runner.
 * No credential is read here: wrangler resolves its own context (`wrangler
 * login` locally, `CF_API_TOKEN` in CI), exactly like the deploy CLI.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE)); // repo root (scripts/backup/..)
const WRANGLER = ['pnpm', '--filter', 'api', 'exec', 'wrangler'];

export const MANIFEST_VERSION = 1;
/** Roughly 13 months of daily entries: enough to answer "what did we have a year ago". */
export const HISTORY_MAX = 400;
export const MANIFEST_KEY = 'd1/production/manifest.json';

const SHA256_RE = /^[0-9a-f]{64}$/;

// ════════════════════════════════════════════════════════════════════════════
// PURE: schema
// ════════════════════════════════════════════════════════════════════════════

export function emptyManifest(label, env = 'production') {
  if (typeof label !== 'string' || label.trim() === '') throw new Error('emptyManifest: label is required');
  return {
    manifestVersion: MANIFEST_VERSION,
    label,
    env,
    d1: { latest: null, history: [], monthly: [] },
    r2: null,
    drill: null,
  };
}

/**
 * Parse the text of a stored manifest. Throws on empty text, invalid JSON, a
 * different `manifestVersion` (the message names both versions) or a `d1`
 * block that does not hold the three fields. A MISSING manifest is the caller's
 * decision, not this function's: the first run of a label has none (fine), a
 * corrupt one is an error.
 */
export function parseManifest(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('manifest.json is empty');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`manifest.json is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('manifest.json is not a JSON object');
  if (parsed.manifestVersion !== MANIFEST_VERSION) {
    throw new Error(
      `manifest.json has manifestVersion ${JSON.stringify(parsed.manifestVersion)}; this tool reads version ${MANIFEST_VERSION}`,
    );
  }
  if (typeof parsed.label !== 'string' || parsed.label === '') throw new Error('manifest.json has no label');
  const d1 = parsed.d1;
  if (!d1 || typeof d1 !== 'object' || !Array.isArray(d1.history) || !Array.isArray(d1.monthly) || !('latest' in d1)) {
    throw new Error('manifest.json: d1 must hold { latest, history: [], monthly: [] }');
  }
  if (parsed.r2 !== null && parsed.r2 !== undefined) {
    if (!parsed.r2 || typeof parsed.r2 !== 'object' || Array.isArray(parsed.r2) || !('lastRun' in parsed.r2)) {
      throw new Error('manifest.json: r2 must be null or { lastRun }');
    }
  }
  if (parsed.drill !== null && parsed.drill !== undefined) {
    const drill = parsed.drill;
    if (!drill || typeof drill !== 'object' || Array.isArray(drill) || typeof drill.at !== 'string' || typeof drill.ok !== 'boolean') {
      throw new Error('manifest.json: drill must be null or { at, ok, … }');
    }
  }
  return parsed;
}

// ════════════════════════════════════════════════════════════════════════════
// PURE: r2 section (Task 03 — the mirror's last run)
// ════════════════════════════════════════════════════════════════════════════

function nonNegativeInt(value, name) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`r2 run: ${name} must be a non-negative integer`);
}

function validateCounter(value, name) {
  if (!value || typeof value !== 'object') throw new Error(`r2 run: ${name} must be { objects, bytes }`);
  nonNegativeInt(value.objects, `${name}.objects`);
  nonNegativeInt(value.bytes, `${name}.bytes`);
}

export const R2_STOPPED_BY = [null, 'maxBytes', 'maxSeconds'];

/** Throws unless `run` has the R2Run shape documented in the header. */
export function validateR2Run(run) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) throw new Error('r2 run must be an object');
  if (typeof run.at !== 'string' || Number.isNaN(new Date(run.at).getTime())) throw new Error('r2 run: at must be an ISO timestamp');
  if (typeof run.durationMs !== 'number' || !Number.isFinite(run.durationMs) || run.durationMs < 0) {
    throw new Error('r2 run: durationMs must be a non-negative number');
  }
  validateCounter(run.copied, 'copied');
  validateCounter(run.pending, 'pending');
  for (const name of ['failed', 'tombstoned', 'pruned', 'unchanged', 'sourceObjects']) nonNegativeInt(run[name], name);
  if (!R2_STOPPED_BY.includes(run.stoppedBy)) throw new Error(`r2 run: stoppedBy must be one of ${R2_STOPPED_BY.map(String).join('|')}`);
}

/** A new manifest (the input is never mutated) whose `r2.lastRun` is `run`. */
export function setR2LastRun(manifest, run) {
  validateR2Run(run);
  return { ...manifest, r2: { ...(manifest.r2 ?? {}), lastRun: { ...run } } };
}

// ════════════════════════════════════════════════════════════════════════════
// PURE: drill section (Task 04 — the restore drill's last result)
// ════════════════════════════════════════════════════════════════════════════

function isIsoTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function validateMismatch(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`drill: mismatches[${index}] must be an object`);
  if (typeof item.table !== 'string' || item.table === '') throw new Error(`drill: mismatches[${index}].table is required`);
  for (const side of ['expected', 'actual']) {
    const n = item[side];
    if (n !== null && (!Number.isInteger(n) || n < 0)) throw new Error(`drill: mismatches[${index}].${side} must be null or a non-negative integer`);
  }
  if (item.expected === null && item.actual === null) throw new Error(`drill: mismatches[${index}] has no count on either side`);
}

/** Throws unless `drill` has the Drill shape documented in the header. */
export function validateDrill(drill) {
  if (!drill || typeof drill !== 'object' || Array.isArray(drill)) throw new Error('drill must be an object');
  if (!isIsoTimestamp(drill.at)) throw new Error('drill: at must be an ISO timestamp');
  if (typeof drill.ok !== 'boolean') throw new Error('drill: ok must be a boolean');
  if (!isIsoTimestamp(drill.dumpTs)) throw new Error('drill: dumpTs must be an ISO timestamp');
  if (typeof drill.dumpKey !== 'string' || drill.dumpKey === '') throw new Error('drill: dumpKey is required');
  if (!Array.isArray(drill.mismatches)) throw new Error('drill: mismatches must be an array');
  drill.mismatches.forEach(validateMismatch);
  if (typeof drill.durationMs !== 'number' || !Number.isFinite(drill.durationMs) || drill.durationMs < 0) {
    throw new Error('drill: durationMs must be a non-negative number');
  }
  if (drill.error !== undefined && drill.error !== null && (typeof drill.error !== 'string' || drill.error === '')) {
    throw new Error('drill: error must be a non-empty string when present');
  }
  if (drill.ok && (drill.mismatches.length > 0 || drill.error)) throw new Error('drill: ok cannot be true with mismatches or an error');
}

/** A new manifest (the input is never mutated) whose `drill` is `drill`. */
export function setDrill(manifest, drill) {
  validateDrill(drill);
  const stored = { ...drill, mismatches: drill.mismatches.map((item) => ({ ...item })) };
  if (stored.error === undefined || stored.error === null) delete stored.error;
  return { ...manifest, drill: stored };
}

/** `YYYY-MM` of a Date or ISO string, in UTC. */
export function monthKey(ts) {
  const date = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid timestamp: ${String(ts)}`);
  return date.toISOString().slice(0, 7);
}

/** True when `d1.monthly` holds no copy for the calendar month of `ts`. */
export function monthlyCopyNeeded(manifest, ts) {
  const month = monthKey(ts);
  return !(manifest?.d1?.monthly ?? []).some((item) => item?.month === month);
}

function validateEntry(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('manifest entry must be an object');
  if (typeof entry.ts !== 'string' || Number.isNaN(new Date(entry.ts).getTime())) throw new Error('manifest entry: ts must be an ISO timestamp');
  if (typeof entry.key !== 'string' || entry.key === '') throw new Error('manifest entry: key is required');
  if (!Number.isInteger(entry.bytes) || entry.bytes < 0) throw new Error('manifest entry: bytes must be a non-negative integer');
  if (typeof entry.sha256 !== 'string' || !SHA256_RE.test(entry.sha256)) throw new Error('manifest entry: sha256 must be 64 lowercase hex chars');
  if (!entry.rowCounts || typeof entry.rowCounts !== 'object' || Array.isArray(entry.rowCounts)) {
    throw new Error('manifest entry: rowCounts must be an object');
  }
  if (typeof entry.durationMs !== 'number' || !Number.isFinite(entry.durationMs) || entry.durationMs < 0) {
    throw new Error('manifest entry: durationMs must be a non-negative number');
  }
}

/**
 * A new manifest (the input is never mutated) with `entry` as `latest`,
 * appended to `history` (oldest entries dropped past HISTORY_MAX) and, when
 * `monthlyKey` is given, a `monthly` item for the entry's calendar month.
 */
export function appendD1Entry(manifest, entry, { monthlyKey = null } = {}) {
  validateEntry(entry);
  const stored = { ...entry, ...(monthlyKey ? { monthlyKey } : {}) };
  const history = [...manifest.d1.history, stored].slice(-HISTORY_MAX);
  const monthly = monthlyKey
    ? [...manifest.d1.monthly, { month: monthKey(entry.ts), key: monthlyKey, ts: entry.ts }]
    : [...manifest.d1.monthly];
  return { ...manifest, d1: { ...manifest.d1, latest: stored, history, monthly } };
}

/**
 * Pretty JSON with a fixed top-level key order and a trailing newline, so two
 * manifests holding the same data are byte-identical whatever built them.
 */
export function serializeManifest(manifest) {
  const { manifestVersion, label, env, d1, r2, drill, ...rest } = manifest;
  const ordered = {
    manifestVersion,
    label,
    env,
    d1: { latest: d1.latest, history: d1.history, monthly: d1.monthly },
    r2,
    drill,
    ...rest,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

// ════════════════════════════════════════════════════════════════════════════
// PURE: object keys
// ════════════════════════════════════════════════════════════════════════════

/** `2026-10-11T06-15-02Z` — the ISO instant with filesystem-safe separators. */
export function isoStamp(ts) {
  const date = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid timestamp: ${String(ts)}`);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replaceAll(':', '-');
}

/** The three keys of one export at instant `ts`: `{ daily, monthly, manifest }`. */
export function objectKeys(env, ts) {
  const date = ts instanceof Date ? ts : new Date(ts);
  const iso = date.toISOString();
  const [yyyy, mm, dd] = [iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10)];
  const stamp = isoStamp(date);
  return {
    daily: `d1/${env}/daily/${yyyy}/${mm}/${dd}/${stamp}.sql.gz`,
    monthly: `d1/${env}/monthly/${yyyy}/${mm}/${stamp}.sql.gz`,
    manifest: `d1/${env}/manifest.json`,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Object store over `wrangler r2 object` (side effects through `run`)
// ════════════════════════════════════════════════════════════════════════════

export function getObjectCommand(bucket, key, path) {
  return [...WRANGLER, 'r2', 'object', 'get', `${bucket}/${key}`, '--file', path, '--remote'];
}

export function putObjectCommand(bucket, key, path, contentType) {
  return [...WRANGLER, 'r2', 'object', 'put', `${bucket}/${key}`, '--file', path, '--remote', '--content-type', contentType, '-y'];
}

/** The first non-empty line of a command's output — enough to name a failure, never the whole dump. */
export function firstLine(text) {
  return (
    String(text ?? '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

/**
 * Does wrangler's output say the object is absent (as opposed to any other
 * failure: auth, network, a missing bucket)? R2 answers a missing key with
 * "The specified key does not exist." (code 10007); the phrasing is matched
 * loosely so a wording change degrades to "throw", never to "silently empty".
 */
export function isMissingObjectOutput(text) {
  return /does not exist|no such key|object not found|\b10007\b/i.test(String(text ?? ''));
}

/** Default runner: captured spawnSync from the repo root (pnpm --filter resolves there). */
export function runCaptured(argv) {
  return spawnSync(argv[0], argv.slice(1), {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function outputOf(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function check(result, what) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${what} exited with status ${result.status}: ${firstLine(outputOf(result))}`);
  return result;
}

/**
 * `{ getText, putFile, getFile }` against one bucket. `run(argv)` returns
 * spawnSync's shape (`{ status, stdout, stderr, error }`); the tests inject it,
 * the CLI uses `runCaptured`. Each call runs one wrangler command.
 */
export function wranglerObjectStore(bucket, { run = runCaptured } = {}) {
  if (typeof bucket !== 'string' || bucket === '') throw new Error('wranglerObjectStore: bucket is required');
  return {
    /** The object's text, or null ONLY when wrangler reports it does not exist. Any other failure throws. */
    getText(key) {
      const dir = mkdtempSync(join(tmpdir(), 'aq-manifest-'));
      try {
        const path = join(dir, 'object');
        const result = run(getObjectCommand(bucket, key, path));
        if (result.error) throw new Error(`r2 object get ${key}: ${result.error.message}`);
        if (result.status !== 0) {
          if (isMissingObjectOutput(outputOf(result))) return null;
          throw new Error(`r2 object get ${key} exited with status ${result.status}: ${firstLine(outputOf(result))}`);
        }
        return readFileSync(path, 'utf8');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    /** Upload `path` under `key`; throws on any failure. */
    putFile(key, path, contentType) {
      check(run(putObjectCommand(bucket, key, path, contentType)), `r2 object put ${key}`);
    },
    /** Download `key` to `path`; throws on any failure (a missing object included). */
    getFile(key, path) {
      check(run(getObjectCommand(bucket, key, path)), `r2 object get ${key}`);
    },
  };
}
