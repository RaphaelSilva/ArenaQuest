#!/usr/bin/env node
/**
 * scripts/media/convert-skipped.mjs — rescue the files the importer refused.
 *
 * `import-media.mjs` writes a JSONL report of everything it would not upload
 * (`.arenaquest/skipped-<label>-<env>.jsonl`): unsupported extensions and files
 * over the API's size limit, each carrying the `topicId` it was meant to land
 * in. This CLI takes that report plus a REFERENCE FOLDER holding the same
 * files, locates each entry on disk by name, and converts it into a format the
 * API accepts:
 *
 *   .mov  -> .mp4   (ffmpeg — remuxed when already H.264/AAC, else transcoded)
 *   .docx -> .pdf   (LibreOffice headless)
 *
 * Output is a MIRROR of the report's `relPath` tree under `--out`, so the
 * result can be fed straight back to the importer:
 *
 *   node scripts/content/import-media.mjs --label budo -e production \
 *        --source .arenaquest/converted/budo-production
 *
 * Topics reconcile on `(parentId, title)`, so re-importing the mirror reuses
 * the topics the first run created instead of duplicating them. The manifest
 * (`--manifest`) additionally carries each converted file's `topicId`, for a
 * publish pass that wants to attach media without re-deriving the tree.
 *
 * The run is IDEMPOTENT and RESUMABLE: a JSONL ledger records every outcome and
 * a re-run skips what is already converted, unless the matched source file
 * changed (size+mtime) or `--force` is passed. Conversions land on a `.part`
 * file and are renamed into place, so a kill never leaves a truncated output
 * that a later run would mistake for finished work.
 *
 * PURELY LOCAL: no network, no ArenaQuest credential, no deployed environment
 * is touched. Nothing inside the reference folder is ever modified.
 *
 * stdlib only, ESM, zero dependencies. Pure exported functions plus a
 * side-effecting CLI at the bottom (asserted by convert-skipped.test.mjs).
 *
 * Exit codes: 0 all good, 1 hard gap (missing tool, failed conversion).
 */

import { parseArgs as nodeParseArgs } from 'node:util';
import readline from 'node:readline';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CONTENT_TYPE_BY_EXTENSION, SIZE_LIMIT_BYTES, formatBytes, runPool } from '../lib/api-client.mjs';
import { DEFAULT_CRF, convertDocument, convertVideo, resolveTools } from '../lib/convert.mjs';
import log from '../lib/log.mjs';

// The tool detection, the ffmpeg ladder and the two converters live in
// scripts/lib/convert.mjs since M28 (shared with aq-mcp). They are re-exported
// here so every existing importer of this module keeps working.
export {
  TOOLS,
  DEFAULT_CRF,
  findExecutable,
  resolveTools,
  run,
  ffprobeArgs,
  parseProbe,
  canRemux,
  ffmpegRemuxArgs,
  ffmpegTranscodeArgs,
  videoAttempts,
  sofficeArgs,
  convertVideo,
  convertDocument,
} from '../lib/convert.mjs';

/**
 * The conversion registry — the one place a new rescue path is declared.
 *
 * `tool` names an entry in `TOOLS`; `targetExt` must be a key of the importer's
 * `CONTENT_TYPE_BY_EXTENSION`, which is what makes the output importable.
 */
export const CONVERTERS = {
  '.mov': { tool: 'ffmpeg', targetExt: '.mp4' },
  '.docx': { tool: 'soffice', targetExt: '.pdf' },
};

/** Files the OS scatters around that must never be matched as a source. */
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** ffmpeg saturates every core it is given, so two lanes already fill a laptop. */
const DEFAULT_CONCURRENCY = 2;

// -- argument parsing ---------------------------------------------------------

/**
 * Parse the converter arguments into a normalised shape.
 * Rules: `--report` and `--source` required; `--only` limited to the registry's
 * extensions; the numeric flags positive integers. Throws a clear Error on any
 * invalid or missing input.
 */
export function parseArgs(argv) {
  let parsed;
  try {
    parsed = nodeParseArgs({
      args: argv,
      options: {
        report: { type: 'string', short: 'r' },
        source: { type: 'string', short: 's' },
        out: { type: 'string', short: 'o' },
        ledger: { type: 'string' },
        manifest: { type: 'string' },
        only: { type: 'string' },
        limit: { type: 'string' },
        concurrency: { type: 'string' },
        crf: { type: 'string' },
        'unresolved-report': { type: 'string' },
        'strict-match': { type: 'boolean' },
        force: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    });
  } catch (err) {
    throw new Error(`invalid arguments: ${err.message}`);
  }

  const { values } = parsed;
  if (values.help) return { help: true };

  const report = values.report?.trim() || null;
  if (!report) throw new Error('--report <path> is required (the importer\'s skipped-*.jsonl)');

  const source = values.source?.trim() || null;
  if (!source) throw new Error('--source <dir> is required (the folder holding the original files)');

  const name = reportName(report);

  return {
    help: false,
    report,
    source,
    out: values.out?.trim() || join('.arenaquest', 'converted', name),
    ledger: values.ledger?.trim() || join('.arenaquest', `convert-${name}.jsonl`),
    manifest: values.manifest?.trim() || join('.arenaquest', `converted-${name}.jsonl`),
    unresolvedReport: values['unresolved-report']?.trim() || join('.arenaquest', `unresolved-${name}.jsonl`),
    relaxed: !values['strict-match'],
    only: parseOnly(values.only),
    limit: positiveInt(values.limit, '--limit'),
    concurrency: positiveInt(values.concurrency, '--concurrency') ?? DEFAULT_CONCURRENCY,
    crf: positiveInt(values.crf, '--crf') ?? DEFAULT_CRF,
    force: Boolean(values.force),
    dryRun: Boolean(values['dry-run']),
    yes: Boolean(values.yes),
  };
}

/**
 * Short name for a run, derived from the report file: `skipped-budo-production
 * .jsonl` -> `budo-production`. It names the output tree, the ledger and the
 * manifest, so two labels never collide in `.arenaquest/`.
 */
export function reportName(reportPath) {
  const base = basename(reportPath).replace(/\.jsonl$/i, '').replace(/^skipped-/i, '');
  return base.trim() === '' ? 'skipped' : base;
}

/** `--only mov,docx` (dots optional) restricted to the registry's own keys. */
export function parseOnly(raw) {
  if (raw === undefined) return null;
  const wanted = String(raw)
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => (part.startsWith('.') ? part : `.${part}`));
  if (wanted.length === 0) throw new Error('--only needs at least one extension, e.g. --only mov');
  const unknown = wanted.filter((ext) => !(ext in CONVERTERS));
  if (unknown.length > 0) {
    throw new Error(`--only: no converter for ${unknown.join(', ')} (known: ${Object.keys(CONVERTERS).join(', ')})`);
  }
  return new Set(wanted);
}

function positiveInt(raw, flag) {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${flag} must be a positive integer (got "${raw}")`);
  }
  return n;
}

function usage() {
  console.log(`
  Usage: node scripts/media/convert-skipped.mjs --report <file.jsonl> --source <dir> [options]

  Converts the files the media importer skipped into formats the API accepts,
  mirroring the report's folder tree so the result can be re-imported as-is.

    .mov  -> .mp4   (ffmpeg)        .docx -> .pdf   (LibreOffice headless)

  Required
    -r, --report <path>    Importer report (.arenaquest/skipped-<label>-<env>.jsonl)
    -s, --source <dir>     Folder holding the original files (read-only, searched
                           recursively; matched by file name + extension)

  Options
    -o, --out <dir>        Output tree (default .arenaquest/converted/<name>)
    --only <exts>          Only convert these, e.g. --only mov  or  --only mov,docx
    --limit <n>            Only process the first N pending files
    --concurrency <n>      Parallel conversions (default ${DEFAULT_CONCURRENCY})
    --crf <n>              H.264 quality, lower is bigger/better (default ${DEFAULT_CRF})
    --ledger <path>        Resume ledger (default .arenaquest/convert-<name>.jsonl)
    --manifest <path>      JSONL of converted files + topicId
                           (default .arenaquest/converted-<name>.jsonl)
    --unresolved-report <p> JSONL of every report entry NOT converted, with why
                           (default .arenaquest/unresolved-<name>.jsonl)
    --strict-match         Match names byte-for-byte only. Off by default: a
                           backup that turned "Chūdan" into "Chudan" or an en
                           dash into a hyphen still matches, and the plan marks
                           every such hit as [relaxed].
    --force                Re-convert even what the ledger already has
    --dry-run              Print the plan and exit; nothing is written
    -y, --yes              Skip the "convert these N files?" confirmation
    -h, --help             Show this help

  Every run prints the files it matched and waits for confirmation before
  converting anything. The manifest it writes is an importer input:

    node scripts/content/import-media.mjs --label <label> -e <env> \\
         --source <out> --manifest <manifest>

  Each manifest row names a converted file and the topicId its original was
  headed for, so the importer uploads straight into the right topic without
  walking the tree or creating a single topic.
`);
}

// -- report -------------------------------------------------------------------

/**
 * Read the importer's skipped report. A malformed line is counted and skipped
 * rather than aborting the run — the report is machine-written, but a torn last
 * line from an interrupted import must not cost the other 250 rescues.
 */
export function readReport(path) {
  if (!existsSync(path)) throw new Error(`report not found: ${path}`);
  const records = [];
  let malformed = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      malformed += 1;
      continue;
    }
    const fileName = record?.fileName ?? (typeof record?.relPath === 'string' ? basename(record.relPath) : null);
    if (typeof fileName !== 'string' || fileName === '') {
      malformed += 1;
      continue;
    }
    records.push({
      key: record.key ?? record.relPath ?? fileName,
      relPath: typeof record.relPath === 'string' && record.relPath !== '' ? record.relPath : fileName,
      fileName,
      state: record.state ?? null,
      reason: record.reason ?? null,
      topicId: record.topicId ?? null,
      topicKey: record.topicKey ?? null,
      sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : null,
    });
  }
  return { records, malformed };
}

// -- source index -------------------------------------------------------------

/**
 * Comparable form of a file name. NFC because the report comes from Drive while
 * the folder may come from macOS, which stores `Chūdan` decomposed (NFD) — the
 * two are the same name and must match. Lower-cased because the same file is
 * routinely `.MOV` in one place and `.mov` in the other.
 */
export function normalizeName(name) {
  return name.normalize('NFC').toLowerCase();
}

/** Same normalisation for a relative path, with separators unified. */
export function normalizeRelPath(relPath) {
  return normalizeName(relPath).split(/[\\/]+/).filter(Boolean).join('/');
}

/**
 * A deliberately lossy form, used only after the exact forms have failed.
 *
 * A folder that reached the local disk through a backup, a sync tool or a
 * Windows share routinely arrives ASCII-fied: `Chūdan` becomes `Chudan`, the en
 * dash in `Ro Ryu – Taki Ryu` becomes a hyphen, and runs of spaces collapse.
 * The bytes are the same recording, but no exact comparison can see that. This
 * folds diacritics, maps the Unicode dashes and quotes onto their ASCII
 * counterparts, and squeezes whitespace — enough to reunite a name with its
 * transliteration, and nothing broader.
 *
 * A relaxed hit is always reported as such in the plan, and never resolves a
 * collision: two files that only differ by an accent stay ambiguous.
 */
export function relaxName(name) {
  return normalizeRelPath(name)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Walk the reference folder and index it twice: by relative path (the precise
 * match) and by bare file name (the match the report actually asks for). A name
 * can be indexed several times — the folder legitimately holds the same file
 * name under different topics — and that ambiguity is resolved, or reported,
 * at match time.
 *
 * Dot-directories are skipped: `.git` and friends hold no content, and walking
 * them on a large library is pure cost.
 */
export function indexSourceTree(root, { readDir = defaultReadDir } = {}) {
  const byPath = new Map();
  const byName = new Map();
  const byRelaxedPath = new Map();
  const byRelaxedName = new Map();
  let count = 0;

  const push = (map, key, value) => {
    const bucket = map.get(key);
    if (bucket) bucket.push(value);
    else map.set(key, [value]);
  };

  const walk = (relDir) => {
    for (const entry of readDir(relDir === '' ? root : join(root, relDir))) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory) {
        if (entry.name.startsWith('.')) continue;
        walk(rel);
        continue;
      }
      count += 1;
      byPath.set(normalizeRelPath(rel), rel);
      push(byName, normalizeName(entry.name), rel);
      // The relaxed maps hold LISTS even for paths: two names that differ only
      // by an accent fold onto one key, and that collision must stay visible.
      push(byRelaxedPath, relaxName(rel), rel);
      push(byRelaxedName, relaxName(entry.name), rel);
    }
  };

  walk('');
  return { byPath, byName, byRelaxedPath, byRelaxedName, count };
}

function defaultReadDir(absDir) {
  return readdirSync(absDir, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
  }));
}

/**
 * Locate one report record inside the index.
 *
 * The full relative path wins when the reference folder mirrors the imported
 * tree, because it is unambiguous. Otherwise the bare name is used, which is
 * what lets a flat "downloads" folder serve as the reference. Several files
 * sharing a name and none matching the path is reported as `ambiguous` rather
 * than guessed: converting the wrong take into a topic is worse than skipping.
 */
export function matchRecord(record, index, { relaxed = true } = {}) {
  const byPath = index.byPath.get(normalizeRelPath(record.relPath));
  if (byPath) return { state: 'matched', sourceRelPath: byPath, via: 'path' };

  const byName = index.byName.get(normalizeName(record.fileName)) ?? [];
  if (byName.length === 1) return { state: 'matched', sourceRelPath: byName[0], via: 'name' };
  if (byName.length > 1) return { state: 'ambiguous', candidates: byName };

  if (!relaxed) return { state: 'missing' };

  // Nothing matched exactly. Try again against the transliterated forms, path
  // first — it is the tier that survives a backup which stripped the macrons
  // out of every file name in the tree.
  const relaxedPath = index.byRelaxedPath?.get(relaxName(record.relPath)) ?? [];
  if (relaxedPath.length === 1) return { state: 'matched', sourceRelPath: relaxedPath[0], via: 'relaxed-path' };
  if (relaxedPath.length > 1) return { state: 'ambiguous', candidates: relaxedPath };

  const relaxedName = index.byRelaxedName?.get(relaxName(record.fileName)) ?? [];
  if (relaxedName.length === 1) return { state: 'matched', sourceRelPath: relaxedName[0], via: 'relaxed-name' };
  if (relaxedName.length > 1) return { state: 'ambiguous', candidates: relaxedName };

  return { state: 'missing' };
}

// -- planning (pure) ----------------------------------------------------------

/** Where a record's conversion lands: the report's own tree, new extension. */
export function outputRelPathFor(relPath, targetExt) {
  const segments = relPath.split(/[\\/]+/).filter(Boolean);
  const name = segments.pop();
  const converted = `${name.slice(0, name.length - extname(name).length)}${targetExt}`;
  return [...segments, converted].join('/');
}

/**
 * Reject a report path that would write outside `--out`. The report is produced
 * by our own importer, but it is still an input file: a `..` segment in it must
 * never be able to reach the filesystem above the output tree.
 */
export function isSafeRelPath(relPath) {
  if (relPath.trim() === '' || isAbsolute(relPath)) return false;
  const segments = relPath.split(/[\\/]+/).filter(Boolean);
  return segments.length > 0 && !segments.includes('..') && !segments.includes('.');
}

/**
 * Turn the report into jobs.
 *
 * Every record ends up in exactly one bucket, so the summary always accounts
 * for the whole file: `jobs` to convert, plus `unsupported` (no converter for
 * that extension), `missing` / `ambiguous` (not found in the reference folder)
 * and `unsafe` (a path that escapes the output tree).
 *
 * `--limit` is applied LAST, to the pending jobs only, so it means "convert N
 * more files" rather than "look at the first N lines".
 */
export function planJobs({ records, index, outDir, sourceRoot, entries = new Map(), only = null, force = false, limit = null, relaxed = true, stat = defaultStat }) {
  const jobs = [];
  const unsupported = [];
  const missing = [];
  const ambiguous = [];
  const unsafe = [];
  const filtered = [];

  for (const record of records) {
    const ext = extname(record.fileName).toLowerCase();
    const converter = CONVERTERS[ext];
    if (!converter) {
      unsupported.push({ ...record, ext });
      continue;
    }
    if (only && !only.has(ext)) {
      filtered.push({ ...record, ext });
      continue;
    }
    if (!isSafeRelPath(record.relPath)) {
      unsafe.push({ ...record, ext });
      continue;
    }

    const match = matchRecord(record, index, { relaxed });
    if (match.state === 'missing') {
      missing.push({ ...record, ext });
      continue;
    }
    if (match.state === 'ambiguous') {
      ambiguous.push({ ...record, ext, candidates: match.candidates });
      continue;
    }

    const absPath = join(sourceRoot, match.sourceRelPath);
    const info = stat(absPath);
    const outRelPath = outputRelPathFor(record.relPath, converter.targetExt);
    const job = {
      ...record,
      ext,
      tool: converter.tool,
      targetExt: converter.targetExt,
      contentType: CONTENT_TYPE_BY_EXTENSION[converter.targetExt],
      sizeLimit: SIZE_LIMIT_BYTES[CONTENT_TYPE_BY_EXTENSION[converter.targetExt]] ?? null,
      sourceRelPath: match.sourceRelPath,
      matchedVia: match.via,
      absPath,
      sourceSizeBytes: info.size,
      sourceRevision: `${info.size}:${Math.floor(info.mtimeMs)}`,
      outRelPath,
      outPath: join(outDir, ...outRelPath.split('/')),
    };
    job.action = force ? 'convert' : nextAction(entries.get(job.key), job);
    jobs.push(job);
  }

  const pending = jobs.filter((job) => job.action !== 'skip');
  const done = jobs.filter((job) => job.action === 'skip');
  return {
    jobs: limit === null ? pending : pending.slice(0, limit),
    pendingTotal: pending.length,
    done,
    unsupported,
    missing,
    ambiguous,
    unsafe,
    filtered,
  };
}

function defaultStat(absPath) {
  return statSync(absPath);
}

/**
 * Resume state machine: a file is skipped only when the ledger says it
 * converted, the matched source has not changed since, and the output is still
 * on disk. Anything else is converted again — cheaper than shipping a stale or
 * vanished file.
 */
export function nextAction(entry, job, { exists = existsSync } = {}) {
  if (!entry || entry.state !== 'converted') return 'convert';
  if (entry.sourceRevision !== job.sourceRevision) return 'convert';
  if (!exists(job.outPath)) return 'convert';
  return 'skip';
}

// -- ledger + manifest --------------------------------------------------------

/** Read the append-only JSONL ledger into a `key -> record` map; last write wins. */
export function readLedger(path) {
  const entries = new Map();
  if (!existsSync(path)) return entries;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      if (typeof record?.key === 'string') entries.set(record.key, record);
    } catch {
      // A torn last line from an interrupted run — ignore it and move on.
    }
  }
  return entries;
}

/** Append one outcome. Written per file so a kill is recoverable. */
export function appendLedger(path, record) {
  mkdirSync(dirname(resolvePath(path)), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Build the manifest rows: everything that is converted and within the API's
 * limits, carrying the `topicId` the original was headed for. This is the
 * hand-off to a publish pass — `relPath` is the path INSIDE `--out`, so the
 * rows line up with what the importer would walk.
 */
export function buildManifest(records) {
  return records
    .filter((record) => record.state === 'converted' && record.withinLimit !== false)
    .map((record) => ({
      key: record.key,
      relPath: record.outRelPath,
      fileName: basename(record.outRelPath),
      contentType: record.contentType,
      sizeBytes: record.outSizeBytes,
      topicId: record.topicId,
      topicKey: record.topicKey,
      sourceRelPath: record.sourceRelPath,
    }));
}

/**
 * Every report entry that did NOT become a converted file, and why.
 *
 * This is the counterpart to the manifest: the manifest answers "what can I
 * import now", this one answers "what is still owed". Without it the buckets
 * only ever exist as terminal output, and a run over 233 files scrolls the
 * answer away long before it finishes — which is exactly when the question
 * gets asked.
 *
 * Each row keeps the identity and the `topicId` from the source report, so it
 * is also a valid input for a narrower re-run once the cause is fixed.
 */
export function buildUnresolvedRows(plan) {
  const rows = [];
  const push = (items, state, describe) => {
    for (const item of items) {
      rows.push({
        key: item.key,
        relPath: item.relPath,
        fileName: item.fileName,
        state,
        reason: describe(item),
        topicId: item.topicId,
        topicKey: item.topicKey,
        sizeBytes: item.sizeBytes,
        ...(item.candidates ? { candidates: item.candidates } : {}),
      });
    }
  };

  push(plan.missing, 'not-found', (item) => `no file named "${item.fileName}" under the source folder`);
  push(plan.ambiguous, 'ambiguous', (item) => `${item.candidates.length} files share this name and none matches the report's path`);
  push(plan.unsupported, 'no-converter', (item) => `no converter for "${item.ext || '(no extension)'}" — original reason: ${item.reason ?? 'unknown'}`);
  push(plan.unsafe, 'unsafe-path', (item) => `relPath "${item.relPath}" is not a safe relative path`);
  // An oversized conversion is unresolved too: it exists on disk but the
  // manifest deliberately leaves it out, so it would otherwise vanish silently.
  push(plan.oversize ?? [], 'over-limit', (item) => item.reason);

  return rows;
}

/** Replace the unresolved report: it describes the CURRENT run, not a history. */
export function writeUnresolvedReport(path, rows) {
  mkdirSync(dirname(resolvePath(path)), { recursive: true });
  writeFileSync(path, rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '', 'utf8');
  return rows.length;
}

/** Replace the manifest: it describes the CURRENT output tree, not a history. */
export function writeManifest(path, rows) {
  mkdirSync(dirname(resolvePath(path)), { recursive: true });
  writeFileSync(path, rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '', 'utf8');
  return rows.length;
}

// -- conversion ---------------------------------------------------------------

/** Dispatch one job to its converter, after making sure its output dir exists. */
export async function convertJob(job, ctx) {
  mkdirSync(dirname(job.outPath), { recursive: true });
  if (job.tool === 'ffmpeg') return convertVideo(job, ctx);
  if (job.tool === 'soffice') return convertDocument(job, ctx);
  throw new Error(`no converter implementation for tool "${job.tool}"`);
}

// -- CLI ----------------------------------------------------------------------

/**
 * Group the matched jobs by the topic they will be uploaded into, so the list a
 * human reads before confirming is organised the way the content actually is —
 * one block per topic — instead of 233 flat lines.
 */
export function groupJobsByTopic(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    const key = job.topicKey ?? '(source root)';
    const group = groups.get(key);
    if (group) group.jobs.push(job);
    else groups.set(key, { topicKey: key, topicId: job.topicId, jobs: [job] });
  }
  return [...groups.values()];
}

/** `c77c375e-3287-…` — enough of a uuid to recognise, short enough to scan. */
function shortId(id) {
  return typeof id === 'string' && id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : (id ?? 'none');
}

/**
 * Print exactly what the run would convert: destination paths, sizes and the
 * topic each file is bound to. This is the review surface — it runs before the
 * confirmation on a real run, not just under `--dry-run`.
 */
function printPlan(plan, { report, sourceRoot, outDir, ledgerPath, manifestPath }) {
  log.heading('Plan');
  log.info(`Report:    ${report}`);
  log.info(`Source:    ${sourceRoot}`);
  log.info(`Output:    ${outDir}`);
  log.info(`Ledger:    ${ledgerPath}`);
  log.info(`Manifest:  ${manifestPath}`);

  log.heading(`Files matched for conversion (${plan.jobs.length})`);
  for (const group of groupJobsByTopic(plan.jobs)) {
    console.log(`  ${group.topicKey}  ${group.jobs.length} file(s) · topic ${shortId(group.topicId)}`);
    for (const job of group.jobs) {
      const note =
        job.matchedVia === 'path'
          ? ''
          : job.matchedVia === 'name'
            ? `   [matched by name at ${job.sourceRelPath}]`
            : `   [relaxed: ${job.sourceRelPath}]`;
      console.log(
        `      ${basename(job.relPath)}  ->  ${basename(job.outRelPath)}   ${formatBytes(job.sourceSizeBytes)}${note}`,
      );
    }
    console.log('');
  }
  if (plan.jobs.length < plan.pendingTotal) {
    log.hint(`… and ${plan.pendingTotal - plan.jobs.length} more pending (raise or drop --limit)`);
  }
}

/**
 * Ask before converting. Every run shows its plan and stops here, because a
 * mismatched `--source` produces a plausible-looking list of the WRONG files
 * and the cost of noticing that after two hours of transcoding is the whole
 * run. `--yes` (or `CONFIRM=1`) bypasses it for CI, matching `confirmProduction`
 * in the deploy CLI.
 */
export async function confirmConversion({ count, yes = false, isTTY, promptFn, env = process.env } = {}) {
  if (yes || env.CONFIRM === '1') return;

  const tty = isTTY ?? Boolean(process.stdin.isTTY);
  if (!tty) {
    throw new Error(
      `converting ${count} file(s) requires confirmation: re-run with --yes or set CONFIRM=1 ` +
        '(no TTY available to type the confirmation).',
    );
  }

  const ask = promptFn ?? defaultPrompt;
  const answer = String(await ask(`Convert these ${count} file(s)? [y/N] `)).trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') {
    throw new Error(`aborted: answered "${answer || 'nothing'}" — nothing was converted.`);
  }
}

function defaultPrompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function reportBucket(items, label, describe) {
  if (items.length === 0) return;
  log.heading(label);
  for (const item of items) {
    log.warn(item.relPath);
    log.hint(describe(item));
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    usage();
    log.die(err.message);
    return;
  }
  if (args.help) {
    usage();
    return;
  }

  const sourceRoot = resolvePath(args.source);
  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    log.die(`--source is not a directory: ${sourceRoot}`);
    return;
  }

  let report;
  try {
    report = readReport(args.report);
  } catch (err) {
    log.die(err.message);
    return;
  }
  if (report.malformed > 0) log.warn(`${report.malformed} unreadable line(s) in the report were ignored.`);
  if (report.records.length === 0) {
    log.warn(`Nothing to do: ${args.report} lists no files.`);
    return;
  }

  const outDir = resolvePath(args.out);
  const index = indexSourceTree(sourceRoot);
  const entries = readLedger(args.ledger);
  const plan = planJobs({
    records: report.records,
    index,
    outDir,
    sourceRoot,
    entries,
    only: args.only,
    force: args.force,
    limit: args.limit,
    relaxed: args.relaxed,
  });

  log.info(`${report.records.length} skipped file(s) in the report · ${index.count} file(s) indexed under the source.`);

  reportBucket(plan.missing, 'Not found in the source folder', (item) => `no file named "${item.fileName}" under ${sourceRoot}`);
  reportBucket(plan.ambiguous, 'Ambiguous — several files share this name', (item) => `candidates: ${item.candidates.join(', ')} — pass a source folder that mirrors the tree`);
  reportBucket(plan.unsupported, 'No converter for this type', (item) => `${item.ext || '(no extension)'} — ${item.reason ?? 'not in the conversion registry'}`);
  reportBucket(plan.unsafe, 'Refused — path escapes the output tree', (item) => `relPath "${item.relPath}" is not a safe relative path`);

  const relaxedHits = plan.jobs.filter((job) => job.matchedVia.startsWith('relaxed'));
  if (relaxedHits.length > 0) {
    log.warn(`${relaxedHits.length} file(s) matched only after folding accents, dashes and spacing — marked [relaxed] below.`);
    log.hint('Their bytes come from a source whose name is a transliteration of the report\'s. Pass --strict-match to refuse them.');
  }

  if (plan.filtered.length > 0) log.warn(`${plan.filtered.length} file(s) excluded by --only.`);
  if (plan.done.length > 0) log.ok(`${plan.done.length} file(s) already converted — skipping.`);

  if (plan.jobs.length === 0) {
    log.warn('No file left to convert.');
    const rows = buildUnresolvedRows(plan);
    if (rows.length > 0) {
      if (!args.dryRun) writeUnresolvedReport(args.unresolvedReport, rows);
      log.hint(
        `${rows.length} unresolved entr(ies) ${args.dryRun ? 'would be written to' : 'written to'} ${args.unresolvedReport} — every file NOT converted, and why.`,
      );
    }
    // Nothing converted, nothing converted before, yet files were looked for:
    // that is a wrong --source, not a finished run.
    if (plan.done.length === 0 && plan.missing.length + plan.ambiguous.length > 0) {
      log.hint('Nothing in the report could be located — check that --source points at the right folder.');
      process.exitCode = 1;
    }
    return;
  }

  const { resolved: tools, missing: missingTools } = resolveTools(new Set(plan.jobs.map((job) => job.tool)));
  const describeMissingTool = (tool) =>
    `${tool.candidates.join(' / ')} not found on PATH — needed to convert ` +
    Object.keys(CONVERTERS).filter((ext) => CONVERTERS[ext].tool === tool.tool).join(', ');

  // The plan is printed on EVERY run, not only under --dry-run: it is the list
  // the operator reads before the confirmation below.
  printPlan(plan, { report: args.report, sourceRoot, outDir, ledgerPath: args.ledger, manifestPath: args.manifest });
  const totalBytes = plan.jobs.reduce((sum, job) => sum + job.sourceSizeBytes, 0);
  log.info(`${plan.jobs.length} file(s), ${formatBytes(totalBytes)} of input -> ${outDir}`);

  if (args.dryRun) {
    // A missing tool is only a warning here: a dry run's job is to show the
    // whole plan, and the operator may well be checking it before installing.
    for (const tool of missingTools) {
      log.warn(describeMissingTool(tool));
      log.hint(`Install it with: ${tool.fix}`);
    }
    const unresolved = buildUnresolvedRows(plan);
    if (unresolved.length > 0) {
      log.hint(`${unresolved.length} unresolved entr(ies) would be written to ${args.unresolvedReport}.`);
    }
    log.ok('Dry run — nothing was written.');
    return;
  }

  if (missingTools.length > 0) {
    log.heading('Missing tools');
    for (const tool of missingTools) {
      log.fail(describeMissingTool(tool));
      log.hint(`Install it with: ${tool.fix}`);
    }
    log.hint('Or restrict this run to what you can convert, e.g. --only mov');
    process.exitCode = 1;
    return;
  }

  try {
    await confirmConversion({ count: plan.jobs.length, yes: args.yes });
  } catch (err) {
    log.die(err.message);
    return;
  }

  log.heading(`Converting ${plan.jobs.length} file(s) -> ${outDir}`);
  const outcomes = [];
  let started = 0;
  const results = await runPool(plan.jobs, args.concurrency, async (job) => {
    const result = await convertJob(job, {
      tools,
      crf: args.crf,
      onAttempt: (target, attempt, attemptIndex) => {
        // A single transcode is minutes of silence; say what is running.
        if (attemptIndex === 0) log.info(`[${++started}/${plan.jobs.length}] ${target.relPath} — ${attempt.label}`);
        else log.hint(`${target.relPath}: over the size limit — retrying with ${attempt.label}`);
      },
    });
    const record = {
      key: job.key,
      relPath: job.relPath,
      sourceRelPath: job.sourceRelPath,
      sourceRevision: job.sourceRevision,
      outRelPath: job.outRelPath,
      outPath: job.outPath,
      contentType: job.contentType,
      topicId: job.topicId,
      topicKey: job.topicKey,
      state: 'converted',
      ...result,
    };
    appendLedger(args.ledger, record);
    outcomes.push(record);

    if (result.withinLimit) {
      log.ok(`${job.outRelPath}  (${formatBytes(job.sourceSizeBytes)} -> ${formatBytes(result.outSizeBytes)}, ${result.strategy})`);
    } else {
      log.warn(`${job.outRelPath}  (${formatBytes(result.outSizeBytes)} still exceeds the ${formatBytes(job.sizeLimit)} API limit)`);
      log.hint('Kept on disk, but left out of the manifest — trim or split it before importing.');
    }
    return record;
  });

  const failures = results.filter((result) => !result.ok);
  for (const failure of failures) {
    appendLedger(args.ledger, {
      key: failure.item.key,
      relPath: failure.item.relPath,
      sourceRelPath: failure.item.sourceRelPath,
      sourceRevision: failure.item.sourceRevision,
      outRelPath: failure.item.outRelPath,
      state: 'failed',
      error: failure.error.message,
    });
  }

  // The manifest describes the whole output tree, so it is rebuilt from the
  // ledger — not just this run's outcomes — or a resumed run would drop
  // everything an earlier one converted.
  const manifestRows = buildManifest([...readLedger(args.ledger).values()]);
  writeManifest(args.manifest, manifestRows);

  // Everything this run owes an answer for, in one file: what was never found,
  // what was ambiguous, what has no converter, and what converted but is still
  // too big to import.
  plan.oversize = outcomes
    .filter((record) => !record.withinLimit)
    .map((record) => ({
      key: record.key,
      relPath: record.relPath,
      fileName: basename(record.relPath),
      topicId: record.topicId,
      topicKey: record.topicKey,
      sizeBytes: record.outSizeBytes,
      reason: `converted to ${record.outRelPath} (${formatBytes(record.outSizeBytes)}) but still over the API limit`,
    }));
  const unresolvedRows = buildUnresolvedRows(plan);
  writeUnresolvedReport(args.unresolvedReport, unresolvedRows);

  log.heading('Summary');
  const converted = outcomes.filter((record) => record.withinLimit).length;
  log.ok(`${converted} file(s) converted and within the API limits.`);
  if (plan.oversize.length > 0) log.warn(`${plan.oversize.length} file(s) converted but still over the limit.`);
  // Counted apart on purpose: "not found" points at the wrong source folder,
  // "ambiguous" points at a source folder that does not mirror the tree. They
  // are different problems with different fixes.
  if (plan.missing.length > 0) log.warn(`${plan.missing.length} file(s) not found in the source folder.`);
  if (plan.ambiguous.length > 0) log.warn(`${plan.ambiguous.length} file(s) matched several source files and were skipped.`);
  if (plan.unsupported.length > 0) log.warn(`${plan.unsupported.length} file(s) have no converter.`);
  log.hint(`Manifest:   ${args.manifest} (${manifestRows.length} row(s), each with its topicId)`);
  if (unresolvedRows.length > 0) {
    log.hint(`Unresolved: ${args.unresolvedReport} (${unresolvedRows.length} row(s) — every file NOT converted, and why)`);
  }
  log.hint(`Ledger:     ${args.ledger}`);

  if (failures.length > 0) {
    log.heading('Failures');
    for (const failure of failures) {
      log.fail(failure.item.relPath);
      log.hint(failure.error.message);
    }
    log.hint('Re-run the same command — converted files are skipped and failures are retried.');
    process.exitCode = 1;
    return;
  }

  log.heading('Next step');
  log.info('Import the converted files into the topics their originals belonged to:');
  log.cmd(
    `node scripts/content/import-media.mjs --label <label> -e <env> \\\n` +
      `          --source ${args.out} --manifest ${args.manifest}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    log.fail(error.message);
    process.exitCode = 1;
  });
}
