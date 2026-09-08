#!/usr/bin/env node
/**
 * scripts/content/import-media.mjs — bulk media importer (local tree to topics).
 *
 * Mirrors a local folder tree into the ArenaQuest topic hierarchy and uploads
 * every media file through the PUBLIC API — the same endpoints the backoffice
 * uses (`POST /v1/admin/topics`, then presign -> PUT -> finalize). No new write
 * path into a deployed environment is introduced: every existing validation,
 * guard and business rule still applies.
 *
 *   directory  -> a topic node (created as `draft`)
 *   file       -> media attached to the topic of its containing directory
 *
 * The run is IDEMPOTENT and RESUMABLE. Topics reconcile on `(parentId, title)`
 * against `GET /v1/admin/topics`; files are tracked in a JSONL ledger so a
 * re-run skips what is already `ready` and recovers whatever was interrupted.
 *
 * `--dry-run` prints the full plan and executes NOTHING — no credential, no
 * confirmation, no mutation, matching the contract of the other CLIs here.
 *
 * Credentials come ONLY from the environment (`AQ_ADMIN_EMAIL`,
 * `AQ_ADMIN_PASSWORD`), never from argv — no secret value reaches argv, disk or
 * a log line. The account needs role `admin` or `content_creator`.
 *
 * stdlib only, ESM, zero dependencies. Pure exported functions plus a
 * side-effecting CLI at the bottom (asserted by import-media.test.mjs).
 *
 * Exit codes: 0 all good, 1 hard gap (validation, upload or auth failure).
 */

import { parseArgs as nodeParseArgs } from 'node:util';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

import { confirmProduction, loadProfile } from '../deploy/core.mjs';
import { deriveExpected } from '../label.mjs';
import log from '../lib/log.mjs';
import {
  createDriveSource,
  driveClientFromEnv,
  extractFolderId,
  isGoogleAppsFile as isGoogleAppsMime,
} from './drive-source.mjs';

const ENVS = ['staging', 'production'];

/**
 * Accepted extensions and their content types.
 *
 * SOURCE OF TRUTH: apps/api/src/controllers/admin-media.controller.ts (its
 * `ALLOWED_TYPES` / `SIZE_LIMIT_BYTES` constants). They are duplicated here on
 * purpose so an oversized or unsupported file is reported locally, before the
 * first write, instead of surfacing as a 422 halfway through the run. Keep the
 * two in sync when the API limits change.
 */
export const CONTENT_TYPE_BY_EXTENSION = {
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export const SIZE_LIMIT_BYTES = {
  'application/pdf': 25 * 1024 * 1024,
  'video/mp4': 100 * 1024 * 1024,
  'image/jpeg': 5 * 1024 * 1024,
  'image/png': 5 * 1024 * 1024,
  'image/webp': 5 * 1024 * 1024,
};

/** Files the OS scatters around that must never become media. */
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** Created topics are drafts: nothing reaches students before a human review. */
const TOPIC_STATUS = 'draft';

/** `media.original_name` is validated as `z.string().min(1).max(255)`. */
const MAX_FILE_NAME_LENGTH = 255;

/** Access tokens live 900 s (apps/api/src/container.ts); re-login early. */
const TOKEN_LIFETIME_MS = 900_000;
const TOKEN_REFRESH_MARGIN_MS = 180_000;

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_ATTEMPTS = 3;

// -- argument parsing ---------------------------------------------------------

/**
 * Parse the importer arguments into a normalised shape.
 * Rules: `--label` and `--source` required; `-e|--env` in {staging, production};
 * `--limit` and `--concurrency` positive integers. Throws a clear Error on any
 * invalid or missing input.
 */
export function parseArgs(argv) {
  let parsed;
  try {
    parsed = nodeParseArgs({
      args: argv,
      options: {
        label: { type: 'string' },
        env: { type: 'string', short: 'e' },
        source: { type: 'string' },
        'drive-folder': { type: 'string' },
        'root-topic': { type: 'string' },
        ledger: { type: 'string' },
        'skipped-report': { type: 'string' },
        limit: { type: 'string' },
        concurrency: { type: 'string' },
        'skip-invalid': { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        yes: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    });
  } catch (err) {
    throw new Error(`invalid arguments: ${err.message}`);
  }

  const { values } = parsed;
  if (values.help) return { help: true };

  const label = values.label;
  if (!label || String(label).trim() === '') {
    throw new Error('--label <label> is required');
  }

  const env = values.env;
  if (!ENVS.includes(env)) {
    const got = env === undefined ? 'nothing' : `"${env}"`;
    throw new Error(`-e/--env must be one of ${ENVS.join('|')} (got ${got})`);
  }

  const source = values.source?.trim() || null;
  const driveFolderRaw = values['drive-folder']?.trim() || null;
  if (!source && !driveFolderRaw) {
    throw new Error('one of --source <dir> or --drive-folder <id|url> is required');
  }
  if (source && driveFolderRaw) {
    throw new Error('--source and --drive-folder are mutually exclusive — pass exactly one');
  }

  return {
    help: false,
    label,
    env,
    source,
    driveFolderId: driveFolderRaw ? extractFolderId(driveFolderRaw) : null,
    rootTopicId: values['root-topic'] ?? null,
    ledger: values.ledger ?? null,
    skippedReport: values['skipped-report'] ?? null,
    limit: positiveInt(values.limit, '--limit'),
    concurrency: positiveInt(values.concurrency, '--concurrency') ?? DEFAULT_CONCURRENCY,
    skipInvalid: Boolean(values['skip-invalid']),
    dryRun: Boolean(values['dry-run']),
    yes: Boolean(values.yes),
  };
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
  Usage: node scripts/content/import-media.mjs --label <label> -e <env> --source <dir> [options]

  Mirrors a local folder tree into the topic hierarchy and uploads its media
  through the public API. Directories become draft topics; files become media on
  the topic of their containing directory.

  Required
    --label <label>        Tenant label (config/labels/<label>.jsonc)
    -e, --env <env>        Target environment: staging | production
    and exactly one source:
    --source <dir>         Local root folder to mirror
    --drive-folder <id>    Google Drive folder id or URL to mirror

  Options
    --root-topic <uuid>    Attach the whole tree under an existing topic
    --limit <n>            Only process the first N files still pending
    --concurrency <n>      Parallel uploads (default ${DEFAULT_CONCURRENCY})
    --ledger <path>        Resume ledger (default .arenaquest/import-<label>-<env>.jsonl)
    --skipped-report <p>   JSONL of skipped files with their target topicId
                           (default .arenaquest/skipped-<label>-<env>.jsonl)
    --skip-invalid         Report unsupported/oversized files and continue
    --dry-run              Print the plan and exit; no credential, no mutation
    --yes                  Skip the production confirmation (same as CONFIRM=1)
    -h, --help             Show this help

  Credentials (environment only, never argv)
    AQ_ADMIN_EMAIL         Admin or content_creator account
    AQ_ADMIN_PASSWORD      Its password

  With --drive-folder, additionally:
    AQ_GDRIVE_CLIENT_ID / AQ_GDRIVE_CLIENT_SECRET / AQ_GDRIVE_REFRESH_TOKEN
    Mint the refresh token once with:
      node scripts/content/drive-source.mjs --login
`);
}

// -- plan building (pure) -----------------------------------------------------

/**
 * Leading ordering prefix, e.g. `01 - Intro`, `02_setup`, `3. Warm up`.
 * A punctuation separator is REQUIRED so a title that merely starts with a year
 * ("2024 Retrospectiva") keeps its number.
 */
const ORDER_PREFIX = /^(\d{1,4})\s*[-_.)]+\s*/;

/** Split a raw file/folder name into its ordering hint and the remaining text. */
export function parseOrderPrefix(rawName) {
  const match = ORDER_PREFIX.exec(rawName);
  if (!match) return { order: null, rest: rawName };
  const rest = rawName.slice(match[0].length);
  // A name that is nothing but its prefix ("01 -") has no title left to use.
  if (rest.trim() === '') return { order: null, rest: rawName };
  return { order: Number(match[1]), rest };
}

/** Human title for a topic: drop the ordering prefix, turn separators into spaces. */
export function titleFromName(rawName) {
  const { rest } = parseOrderPrefix(rawName);
  const title = rest.replace(/[-_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return title || rawName;
}

/** Content type for a file name, or null when the extension is not supported. */
export function contentTypeFor(fileName) {
  return CONTENT_TYPE_BY_EXTENSION[extname(fileName).toLowerCase()] ?? null;
}

/**
 * Sibling ordering: explicit numeric prefixes first and in order, then the rest
 * naturally sorted. Topics are created in this order and the API appends each
 * new node to the end of its sibling group, so creation order IS display order.
 */
export function compareSiblings(a, b) {
  if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
  if (a.order !== null && b.order === null) return -1;
  if (a.order === null && b.order !== null) return 1;
  return a.rawName.localeCompare(b.rawName, 'en', { numeric: true, sensitivity: 'base' });
}

function isIgnored(name) {
  return name.startsWith('.') || IGNORED_NAMES.has(name);
}

/**
 * Why a file was skipped, as a stable machine-readable tag.
 *
 * The reason prose is for a human reading the run; this is what a later
 * conversion pass filters on, so it must not drift with the wording.
 */
export const SKIP_STATES = {
  INVALID_TYPE: 'invalid-type',
  GOOGLE_DOC: 'google-doc',
  TOO_LARGE: 'too-large',
  EMPTY: 'empty',
  NAME_TOO_LONG: 'name-too-long',
  NO_TOPIC: 'no-topic',
};

/** True for the per-folder instructions file, whatever its casing. */
export function isReadme(name) {
  return /^readme\.md$/i.test(name.trim());
}

/**
 * Walk a source listing and produce the import plan.
 *
 * The listing is source-agnostic — `listLocal()` and `listDrive()` both emit it —
 * so this function holds all the shared naming, ordering and preflight rules and
 * knows nothing about filesystems or Drive:
 *
 *   dir  -> { type: 'dir',  name, id, children[] }
 *   file -> { type: 'file', name, id, sizeBytes, revision, mimeType?, absPath? }
 *
 * Returns `{ topics, files, violations }` where `topics` is in creation order
 * (depth-first, siblings sorted) and every file carries the `topicKey` of the
 * directory that holds it. A `README.md` never becomes media: it is attached to
 * its folder's topic as `readme` and later resolved into the topic content.
 * `rootTopicId` is the existing topic the tree hangs from; without it, files
 * sitting at the listing root have no topic to attach to and are reported.
 */
export function buildPlan(listing, { rootTopicId = null } = {}) {
  const topics = [];
  const files = [];
  const violations = [];
  let rootReadme = null;

  const walk = (nodes, parentKey, parentTopic) => {
    const entries = nodes
      .filter((node) => !isIgnored(node.name))
      .map((node) => ({ node, rawName: node.name, order: parseOrderPrefix(node.name).order }))
      .sort(compareSiblings);

    // Files before subdirectories: media lands on its topic before the tree
    // descends, which keeps the printed plan readable.
    for (const { node, rawName } of entries) {
      if (node.type !== 'file') continue;

      const relPath = parentKey === null ? rawName : `${parentKey}/${rawName}`;

      // The folder's instructions become topic content, not media. At the
      // listing root that content belongs to --root-topic: pointing the importer
      // at a folder and naming the topic it maps to is the whole point of that
      // flag, so the README beside it describes exactly that topic.
      if (isReadme(rawName)) {
        if (parentTopic) parentTopic.readme = node;
        else if (rootTopicId) rootReadme = node;
        else {
          violations.push({
            key: node.id,
            relPath,
            fileName: rawName,
            state: SKIP_STATES.NO_TOPIC,
            reason: 'README.md at the listing root describes the root topic — pass --root-topic <uuid> to apply it',
            topicKey: null,
            sizeBytes: node.sizeBytes ?? 0,
            revision: node.revision ?? null,
          });
        }
        continue;
      }

      // Everything a later pass needs to find this file again and know where it
      // was meant to land: the source identity, the size/revision to match a
      // converted copy against, and the folder whose topic it belongs to.
      const skip = (state, reason) => {
        violations.push({
          key: node.id,
          relPath,
          fileName: rawName,
          state,
          reason,
          topicKey: parentKey,
          sizeBytes: node.sizeBytes ?? 0,
          revision: node.revision ?? null,
        });
      };

      if (parentKey === null && rootTopicId === null) {
        skip(SKIP_STATES.NO_TOPIC, 'file sits at the source root — pass --root-topic <uuid> to attach it');
        continue;
      }

      const contentType = contentTypeFor(rawName);
      if (!contentType) {
        if (isGoogleAppsMime(node.mimeType)) {
          skip(SKIP_STATES.GOOGLE_DOC, 'Google Docs/Sheets/Slides cannot be uploaded as media — export it to PDF in Drive first');
        } else {
          skip(
            SKIP_STATES.INVALID_TYPE,
            `unsupported extension "${extname(rawName) || '(none)'}" — the API accepts ${Object.keys(CONTENT_TYPE_BY_EXTENSION).join(', ')}`,
          );
        }
        continue;
      }

      if (node.sizeBytes === 0) {
        skip(SKIP_STATES.EMPTY, 'file is empty (sizeBytes must be positive)');
        continue;
      }

      const maxBytes = SIZE_LIMIT_BYTES[contentType];
      if (node.sizeBytes > maxBytes) {
        skip(
          SKIP_STATES.TOO_LARGE,
          `${formatBytes(node.sizeBytes)} exceeds the API limit of ${formatBytes(maxBytes)} for ${contentType}`,
        );
        continue;
      }

      if (rawName.length > MAX_FILE_NAME_LENGTH) {
        skip(SKIP_STATES.NAME_TOO_LONG, `file name is ${rawName.length} characters (max ${MAX_FILE_NAME_LENGTH})`);
        continue;
      }

      files.push({
        // `key` is the ledger identity: a path locally, a Drive file id remotely.
        // Drive files can be renamed or moved, so the id is what stays stable.
        key: node.id,
        // `id` and `absPath` are how a source fetches the bytes back; both are
        // carried through so `readBytes` needs nothing but the plan entry.
        id: node.id,
        relPath,
        absPath: node.absPath,
        fileName: rawName,
        title: titleFromName(basename(rawName, extname(rawName))),
        contentType,
        sizeBytes: node.sizeBytes,
        revision: node.revision,
        topicKey: parentKey,
      });
    }

    for (const { node, rawName } of entries) {
      if (node.type !== 'dir') continue;
      const key = parentKey === null ? rawName : `${parentKey}/${rawName}`;
      const topic = {
        key,
        parentKey,
        rawName,
        title: titleFromName(rawName),
        depth: key.split('/').length - 1,
        readme: null,
      };
      topics.push(topic);
      walk(node.children, key, topic);
    }
  };

  walk(listing, null, null);
  return { topics, files, violations, rootReadme, root: null };
}

// -- sources ------------------------------------------------------------------

/**
 * Recursively list a local directory into the shared listing shape.
 *
 * `revision` is what `nextAction` compares to notice a changed file; size plus
 * mtime is the cheapest reliable signal the filesystem offers.
 */
export function listLocal(dir) {
  const root = resolvePath(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`--source is not a directory: ${dir}`);
  }

  const walk = (dirPath) =>
    readdirSync(dirPath, { withFileTypes: true }).map((entry) => {
      const absPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return { type: 'dir', name: entry.name, id: relative(root, absPath), children: walk(absPath) };
      }
      if (!entry.isFile()) return { type: 'other', name: entry.name };
      const stat = statSync(absPath);
      return {
        type: 'file',
        name: entry.name,
        id: relative(root, absPath),
        absPath,
        sizeBytes: stat.size,
        revision: `${stat.size}:${Math.floor(stat.mtimeMs)}`,
      };
    });

  return walk(root);
}

/** The importer's source contract, backed by the local filesystem. */
export function createLocalSource(dir) {
  return {
    kind: 'local',
    describe: async () => `Local folder: ${resolvePath(dir)}`,
    list: async () => listLocal(dir),
    readBytes: async (file) => readFileSync(file.absPath),
    readText: async (node) => readFileSync(node.absPath, 'utf8'),
  };
}

/** Human-readable byte size (binary units, matching the API's error wording). */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

// -- ledger (idempotency + resume) --------------------------------------------

/**
 * Default location of the skipped-files report for a label/environment pair.
 * Sits beside the ledger, and is likewise gitignored.
 */
export function skippedReportPathFor(label, env, explicit) {
  return explicit ?? join('.arenaquest', `skipped-${label}-${env}.jsonl`);
}

/**
 * Write the JSONL report of everything the plan refused to upload.
 *
 * Each record carries the source identity (`key`, `relPath`, `revision`), why it
 * was refused (`state`), and — crucially — the `topicId` the file was meant to
 * land in. That last field is what lets a later pass take a converted copy of
 * the same file and publish it into the right topic without re-deriving the
 * tree.
 *
 * The file is REPLACED, not appended: it describes the current plan, and an
 * appended history would leave entries for files that have since been fixed.
 */
export function writeSkippedReport(path, violations, { idByKey = new Map(), rootTopicId = null } = {}) {
  const lines = violations.map((violation) => {
    const topicId = violation.topicKey === null ? rootTopicId : (idByKey.get(violation.topicKey) ?? null);
    return JSON.stringify({
      key: violation.key ?? violation.relPath,
      relPath: violation.relPath,
      fileName: violation.fileName,
      state: violation.state,
      reason: violation.reason,
      topicId,
      topicKey: violation.topicKey,
      sizeBytes: violation.sizeBytes,
      revision: violation.revision,
    });
  });

  mkdirSync(dirname(resolvePath(path)), { recursive: true });
  writeFileSync(path, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  return lines.length;
}

/** Default ledger location for a label/environment pair. */
export function ledgerPathFor(label, env, explicit) {
  return explicit ?? join('.arenaquest', `import-${label}-${env}.jsonl`);
}

/**
 * Read the append-only JSONL ledger into a `key -> record` map. Later records
 * win, so the last state written for a file is the one that counts. A malformed
 * line is skipped rather than aborting a resume.
 *
 * `relPath` is accepted as the key for ledgers written before the Drive source
 * existed, when the path was the identity.
 */
export function readLedger(path) {
  const entries = new Map();
  if (!existsSync(path)) return entries;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      const key = record?.key ?? record?.relPath;
      if (typeof key === 'string') entries.set(key, record);
    } catch {
      // A torn last line from an interrupted run — ignore it and move on.
    }
  }
  return entries;
}

/** Append one state transition. Written after every step so a kill is recoverable. */
export function appendLedger(path, record) {
  mkdirSync(dirname(resolvePath(path)), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Resume state machine — what to do with a file given its ledger entry.
 *
 *   skip      already `ready` in a previous run
 *   finalize  bytes are in R2, only the finalize call is missing (idempotent)
 *   recover   presigned but the outcome is unknown; try finalize, and if the
 *             1 h URL expired before the PUT landed, replace the pending row
 *   replace   the local file changed since the ledger entry was written
 *   presign   never seen before
 */
export function nextAction(entry, file) {
  if (!entry) return 'presign';
  // One comparable token per source: size+mtime locally, md5Checksum on Drive.
  // A pre-Drive ledger has no `revision`; fall back to its size+mtime pair so an
  // existing run resumes instead of re-uploading everything.
  const recorded = entry.revision ?? (entry.mtimeMs !== undefined ? `${entry.sizeBytes}:${entry.mtimeMs}` : undefined);
  if (recorded !== file.revision) return 'replace';
  switch (entry.state) {
    case 'ready':
      return 'skip';
    case 'uploaded':
      return 'finalize';
    case 'presigned':
      return 'recover';
    default:
      return 'presign';
  }
}

// -- API client ---------------------------------------------------------------

/** Error carrying the HTTP status and the API's `{ error, ...meta }` envelope. */
export class ApiError extends Error {
  constructor(status, code, detail, body) {
    // The status is part of the message on purpose: it is what separates a rate
    // limit from a worker crash from a bad request, and without it an operator
    // reading a failure report cannot tell which happened.
    super(detail ? `HTTP ${status} ${code}: ${detail}` : `HTTP ${status} ${code}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A 5xx or a transport failure is worth retrying; a 4xx is a decision. */
function isRetryable(err) {
  if (err instanceof ApiError) return err.status >= 500 || err.status === 429;
  if (err instanceof TypeError) return false; // a programming error, not the network
  return true;
}

/**
 * Retry with exponential backoff. `attempts` is the total number of tries.
 * A 429 honours `Retry-After` when the server sends one.
 */
export async function withRetry(fn, { attempts = DEFAULT_ATTEMPTS, onRetry, sleepImpl = sleep } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !isRetryable(err)) throw err;
      const backoff = err?.retryAfterMs ?? 500 * 2 ** (attempt - 1);
      if (onRetry) onRetry(err, attempt, backoff);
      await sleepImpl(backoff);
    }
  }
  throw lastError;
}

/**
 * Authenticated client for the admin API.
 *
 * Access tokens expire in 15 minutes and `POST /v1/auth/refresh` reads the
 * refresh token from a cookie, so a plain re-login is both simpler and safe:
 * the login rate limiter only counts FAILED attempts, and a success resets it.
 */
export function createApiClient({ baseUrl, email, password, fetchImpl = fetch, now = Date.now }) {
  let token = null;
  let tokenExpiresAt = 0;

  async function login() {
    const response = await fetchImpl(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await readBody(response);
    if (!response.ok) throw toApiError(response, body);
    if (!body?.accessToken) {
      throw new ApiError(response.status, 'NoAccessToken', 'login response carried no accessToken', body);
    }
    token = body.accessToken;
    tokenExpiresAt = now() + TOKEN_LIFETIME_MS - TOKEN_REFRESH_MARGIN_MS;
    return body.user ?? null;
  }

  async function ensureToken() {
    if (!token || now() >= tokenExpiresAt) await login();
    return token;
  }

  /** One authenticated JSON call. Re-authenticates once on a 401. */
  async function request(method, path, { body, expectStatus } = {}) {
    const send = async () => {
      const accessToken = await ensureToken();
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const parsed = await readBody(response);
      if (!response.ok) throw toApiError(response, parsed);
      if (expectStatus && response.status !== expectStatus) {
        throw new ApiError(
          response.status,
          'UnexpectedStatus',
          `expected ${expectStatus} from ${method} ${path}`,
          parsed,
        );
      }
      return parsed;
    };

    try {
      return await send();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        token = null; // expired mid-run — re-login and try once more
        return send();
      }
      throw err;
    }
  }

  return { login, request };
}

/**
 * Condense an HTML error page into one line.
 *
 * A Cloudflare interstitial is hundreds of lines of boilerplate whose only
 * useful parts are its title and its `error code: NNNN`. Dumping the raw
 * doctype into a failure report buries the one detail that identifies the fault.
 */
export function summariseHtmlError(html) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim();
  const cfCode = /error code:\s*(\d+)/i.exec(html)?.[1] ?? /Error\s+(1\d{3})/.exec(html)?.[1];
  const parts = [];
  if (title) parts.push(title);
  if (cfCode) parts.push(`Cloudflare error ${cfCode}`);
  return parts.length ? parts.join(' — ') : 'an HTML error page (not JSON)';
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const looksLikeHtml = /^\s*<(!doctype|html)/i.test(text);
    return {
      error: 'NonJsonResponse',
      detail: looksLikeHtml ? summariseHtmlError(text) : text.slice(0, 200),
    };
  }
}

function toApiError(response, body) {
  const code = body?.error ?? `HTTP${response.status}`;
  const detail = body?.detail ?? body?.message ?? null;
  const err = new ApiError(response.status, code, detail, body);
  const retryAfter = response.headers?.get?.('Retry-After');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) err.retryAfterMs = seconds * 1000;
  }
  return err;
}

// -- README -> topic content --------------------------------------------------

/**
 * A README may declare topic overrides in a fenced block tagged `arenaquest`:
 *
 *     ```arenaquest
 *     { "order": 9, "status": "draft", "estimatedMinutes": 90, "title": "9 Kyu" }
 *     ```
 *
 * A fence is used rather than `---` front-matter because a Google Doc exported
 * to markdown turns a lone `---` into a horizontal rule. Every field is
 * optional, and an absent or malformed block is a warning, never a failure —
 * the content still imports.
 */
const METADATA_FENCE = /^```(?:json\s+)?arenaquest[^\n]*\n([\s\S]*?)\n```/m;

const TOPIC_STATUS_VALUES = ['draft', 'published'];

export function parseReadmeMetadata(markdown) {
  const match = METADATA_FENCE.exec(markdown ?? '');
  if (!match) return { metadata: {}, warnings: [] };

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch (err) {
    return { metadata: {}, warnings: [`metadata block is not valid JSON (${err.message}) — ignored`] };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { metadata: {}, warnings: ['metadata block must be a JSON object — ignored'] };
  }

  const metadata = {};
  const warnings = [];

  if (parsed.title !== undefined) {
    if (typeof parsed.title === 'string' && parsed.title.trim()) metadata.title = parsed.title.trim();
    else warnings.push('metadata "title" must be a non-empty string — ignored');
  }
  if (parsed.order !== undefined) {
    if (Number.isInteger(parsed.order) && parsed.order >= 0) metadata.order = parsed.order;
    else warnings.push('metadata "order" must be an integer >= 0 — ignored');
  }
  if (parsed.estimatedMinutes !== undefined) {
    if (Number.isInteger(parsed.estimatedMinutes) && parsed.estimatedMinutes >= 0) {
      metadata.estimatedMinutes = parsed.estimatedMinutes;
    } else {
      warnings.push('metadata "estimatedMinutes" must be an integer >= 0 — ignored');
    }
  }
  if (parsed.status !== undefined) {
    if (TOPIC_STATUS_VALUES.includes(parsed.status)) metadata.status = parsed.status;
    else warnings.push(`metadata "status" must be one of ${TOPIC_STATUS_VALUES.join('|')} — ignored`);
  }

  return { metadata, warnings };
}

/** Strip the machine-readable block so it never renders in the topic body. */
export function stripMetadataBlock(markdown) {
  return (markdown ?? '').replace(METADATA_FENCE, '').replace(/^\n+/, '');
}

/**
 * Resolve every topic's README into `content` plus its declared overrides.
 * Reading runs concurrently — these are small text fetches with no ordering
 * constraint, unlike topic creation.
 */
export async function resolveReadmes(plan, { readText, concurrency = 4, onWarning } = {}) {
  const withReadme = plan.topics.filter((topic) => topic.readme);

  if (plan.rootReadme) {
    try {
      const raw = await readText(plan.rootReadme);
      const { metadata, warnings } = parseReadmeMetadata(raw);
      const rootTopic = { key: '(root topic)' };
      for (const warning of warnings) if (onWarning) onWarning(rootTopic, warning);
      // `title` and `order` are deliberately not applied to the root: it was
      // identified by uuid and positioned by hand, so renaming or moving it from
      // a README would be a surprise rather than a convenience.
      for (const ignored of ['title', 'order']) {
        if (metadata[ignored] !== undefined && onWarning) {
          onWarning(rootTopic, `metadata "${ignored}" does not apply to --root-topic — ignored`);
        }
      }
      plan.root = {
        content: stripMetadataBlock(raw),
        status: metadata.status,
        estimatedMinutes: metadata.estimatedMinutes,
      };
    } catch (err) {
      if (onWarning) onWarning({ key: '(root topic)' }, `README could not be read (${err.message}) — root topic left as is`);
    }
  }

  await runPool(withReadme, concurrency, async (topic) => {
    let raw;
    try {
      raw = await readText(topic.readme);
    } catch (err) {
      if (onWarning) onWarning(topic, `README could not be read (${err.message}) — topic imported without content`);
      return null;
    }
    const { metadata, warnings } = parseReadmeMetadata(raw);
    for (const warning of warnings) if (onWarning) onWarning(topic, warning);
    topic.content = stripMetadataBlock(raw);
    if (metadata.title) topic.title = metadata.title;
    if (metadata.order !== undefined) topic.order = metadata.order;
    if (metadata.status !== undefined) topic.status = metadata.status;
    if (metadata.estimatedMinutes !== undefined) topic.estimatedMinutes = metadata.estimatedMinutes;
    return null;
  });

  return plan;
}

// -- topic reconciliation -----------------------------------------------------

/** Stable identity for a topic node: its parent plus its title. */
export function topicIndexKey(parentId, title) {
  return `${parentId ?? 'root'} ${title.trim().toLowerCase()}`;
}

/**
 * Index the existing (non-archived) topics so a re-run reuses them instead of
 * creating duplicates. Topic nodes have no slug, so `(parentId, title)` is the
 * only stable identity available. The whole record is kept so a reused topic can
 * be compared against its README without a second fetch.
 */
export function indexTopics(records) {
  const index = new Map();
  for (const record of records) {
    if (record.archived) continue;
    const key = topicIndexKey(record.parentId, record.title);
    if (!index.has(key)) index.set(key, record);
  }
  return index;
}

/** Fields a README owns. Only a real difference triggers a PATCH. */
function topicDrift(topic, record) {
  const patch = {};
  if (topic.content !== undefined && topic.content !== record.content) patch.content = topic.content;
  if (topic.status !== undefined && topic.status !== record.status) patch.status = topic.status;
  if (topic.estimatedMinutes !== undefined && topic.estimatedMinutes !== record.estimatedMinutes) {
    patch.estimatedMinutes = topic.estimatedMinutes;
  }
  return patch;
}

/**
 * Create every missing topic, SEQUENTIALLY and in plan order.
 *
 * This must not be parallelised: `D1TopicNodeRepository.create` derives
 * `sort_order` from a non-transactional `SELECT MAX(sort_order)`, so concurrent
 * siblings would collide on the same order. Sequential creation in sorted order
 * is exactly what makes creation order equal display order.
 *
 * A reused topic is PATCHed only when its README actually drifted, so a re-run
 * over unchanged content costs one GET and no writes.
 */
export async function reconcileTopics(client, plan, { rootTopicId, index, onCreate, onReuse, onUpdate }) {
  const idByKey = new Map();
  const placed = [];
  let created = 0;
  let reused = 0;
  let updated = 0;

  for (const topic of plan.topics) {
    const parentId = topic.parentKey === null ? (rootTopicId ?? null) : idByKey.get(topic.parentKey);
    if (topic.parentKey !== null && !parentId) {
      throw new Error(`internal: parent topic "${topic.parentKey}" was not created before "${topic.key}"`);
    }

    const key = topicIndexKey(parentId ?? null, topic.title);
    const existing = index.get(key);

    if (existing) {
      idByKey.set(topic.key, existing.id);
      placed.push({ topic, id: existing.id, parentId: parentId ?? null, currentOrder: existing.order });
      reused += 1;
      if (onReuse) onReuse(topic, existing.id);

      const patch = topicDrift(topic, existing);
      if (Object.keys(patch).length > 0) {
        const record = await withRetry(() =>
          client.request('PATCH', `/v1/admin/topics/${existing.id}`, { body: patch }),
        );
        index.set(key, { ...existing, ...record });
        updated += 1;
        if (onUpdate) onUpdate(topic, Object.keys(patch));
      }
      continue;
    }

    const record = await withRetry(() =>
      client.request('POST', '/v1/admin/topics', {
        body: {
          parentId: parentId ?? null,
          title: topic.title,
          status: topic.status ?? TOPIC_STATUS,
          ...(topic.content !== undefined ? { content: topic.content } : {}),
          ...(topic.estimatedMinutes !== undefined ? { estimatedMinutes: topic.estimatedMinutes } : {}),
        },
        expectStatus: 201,
      }),
    );
    idByKey.set(topic.key, record.id);
    placed.push({ topic, id: record.id, parentId: parentId ?? null, currentOrder: record.order });
    index.set(key, record);
    created += 1;
    if (onCreate) onCreate(topic, record.id);
  }

  return { idByKey, placed, created, reused, updated };
}

/**
 * Apply a listing-root README to the topic named by `--root-topic`.
 *
 * That topic already exists and is matched by uuid rather than title, so this
 * only ever updates it, and only when the README actually differs — the same
 * no-write-on-a-no-op rule the rest of the reconciliation follows.
 */
export async function applyRootReadme(client, rootTopicId, root, { onUpdate } = {}) {
  if (!rootTopicId || !root) return false;

  const record = await withRetry(() => client.request('GET', `/v1/admin/topics/${rootTopicId}`));
  const patch = topicDrift(root, record);
  if (Object.keys(patch).length === 0) return false;

  await withRetry(() => client.request('PATCH', `/v1/admin/topics/${rootTopicId}`, { body: patch }));
  if (onUpdate) onUpdate(Object.keys(patch));
  return true;
}

/**
 * Apply the `order` declared in the READMEs.
 *
 * `CreateTopicSchema` does not accept an order, so it is set afterwards with
 * `POST /v1/admin/topics/{id}/move`, which splices the node at
 * `min(newSortOrder, len)` and renumbers the sibling group gaplessly. Applying a
 * group in ascending declared order therefore lands every member correctly —
 * this is what fixes a tree whose folder names sort against their real sequence.
 */
export async function applyDeclaredOrder(client, placed, { onMove } = {}) {
  const groups = new Map();
  for (const entry of placed) {
    if (entry.topic.order === undefined) continue;
    const groupKey = entry.parentId ?? 'root';
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(entry);
  }

  let moved = 0;
  for (const group of groups.values()) {
    // A group already sitting where its READMEs ask for costs no write at all,
    // which is what keeps a no-op re-run free of side effects.
    if (group.every((entry) => entry.currentOrder === entry.topic.order)) continue;

    for (const entry of [...group].sort((a, b) => a.topic.order - b.topic.order)) {
      await withRetry(() =>
        client.request('POST', `/v1/admin/topics/${entry.id}/move`, {
          body: { newParentId: entry.parentId, newSortOrder: entry.topic.order },
        }),
      );
      moved += 1;
      if (onMove) onMove(entry.topic);
    }
  }
  return moved;
}

// -- upload lifecycle ---------------------------------------------------------

/** Best-effort removal of a stale media row (soft delete + R2 object). */
async function deleteMedia(client, topicId, mediaId) {
  if (!mediaId) return;
  try {
    await client.request('DELETE', `/v1/admin/topics/${topicId}/media/${mediaId}`);
  } catch (err) {
    // Already gone is the outcome we wanted anyway.
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  }
}

/**
 * Upload one file: presign -> PUT -> finalize, writing the ledger after each step.
 *
 * The PUT body is a Buffer, not a stream, on purpose: `getPresignedUploadUrl`
 * signs BOTH `Content-Type` and `Content-Length`, so the request must carry an
 * exact, known length — a streamed body would be sent chunked and R2 would
 * reject the signature. Files are capped at 100 MB by the API, so buffering is
 * bounded; peak memory is roughly `--concurrency x file size`.
 */
export async function uploadFile(client, { file, topicId, ledgerPath, entry, readBytes, fetchImpl = fetch }) {
  const action = nextAction(entry, file);
  if (action === 'skip') return { relPath: file.relPath, outcome: 'skipped' };

  let mediaId = entry?.mediaId ?? null;
  const write = (state, extra = {}) => {
    appendLedger(ledgerPath, {
      key: file.key,
      relPath: file.relPath, // human-readable; `key` is the identity
      state,
      mediaId,
      topicId,
      sizeBytes: file.sizeBytes,
      revision: file.revision,
      ...extra,
    });
  };

  // An interrupted record may still be recoverable without re-uploading.
  if ((action === 'finalize' || action === 'recover') && mediaId) {
    try {
      const media = await withRetry(() =>
        client.request('POST', `/v1/admin/topics/${topicId}/media/${mediaId}/finalize`),
      );
      write('ready');
      return { relPath: file.relPath, outcome: 'recovered', media };
    } catch (err) {
      const recoverable = err instanceof ApiError && (err.status === 422 || err.status === 404);
      if (!recoverable) throw err;
      // The bytes never landed (422) or the row is gone (404). Drop the stale
      // pending row so the environment does not accumulate orphans, then redo.
      if (err.status === 422) await deleteMedia(client, topicId, mediaId);
      mediaId = null;
    }
  }

  // The local file changed since the ledger entry — retire the old media row.
  if (action === 'replace' && mediaId) {
    await deleteMedia(client, topicId, mediaId);
    mediaId = null;
  }

  const presigned = await withRetry(() =>
    client.request('POST', `/v1/admin/topics/${topicId}/media/presign`, {
      body: { fileName: file.fileName, contentType: file.contentType, sizeBytes: file.sizeBytes },
      expectStatus: 201,
    }),
  );
  mediaId = presigned.media.id;
  write('presigned', { storageKey: presigned.media.storageKey });

  const bytes = await readBytes(file);
  if (bytes.byteLength !== file.sizeBytes) {
    // The file changed between the scan and the read. The signature is bound to
    // the size we declared, so the PUT could only fail with a 403.
    throw new Error(
      `${file.relPath} changed at the source during the run (${file.sizeBytes} -> ${bytes.byteLength} bytes) — re-run to pick up the new version`,
    );
  }

  await withRetry(async () => {
    const response = await fetchImpl(presigned.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.contentType, 'Content-Length': String(file.sizeBytes) },
      body: bytes,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new ApiError(response.status, 'R2PutFailed', detail, null);
    }
  });
  write('uploaded');

  const media = await withRetry(() =>
    client.request('POST', `/v1/admin/topics/${topicId}/media/${mediaId}/finalize`),
  );
  write('ready');
  return { relPath: file.relPath, outcome: 'uploaded', media };
}

/** Run `worker` over `items` with at most `limit` in flight. Never rejects. */
export async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const lane = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { ok: true, value: await worker(items[index], index), item: items[index] };
      } catch (err) {
        results[index] = { ok: false, error: err, item: items[index] };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
}

// -- CLI ----------------------------------------------------------------------

/**
 * Resolve the API base URL for a label/environment from the committed profile.
 *
 * `AQ_API_BASE_URL` overrides it for local development (`make dev-api`), but
 * ONLY when it points at the loopback interface: the target of a staging or
 * production run must come from the committed profile, never from an ambient
 * environment variable that could silently redirect an import elsewhere.
 */
export function resolveBaseUrl(label, env, { override = process.env.AQ_API_BASE_URL } = {}) {
  if (override) {
    const { hostname } = new URL(override);
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
      throw new Error(`AQ_API_BASE_URL may only point at localhost (got "${hostname}") — the deployed target comes from config/labels/${label}.jsonc`);
    }
    return override.replace(/\/$/, '');
  }

  const profile = loadProfile(label);
  const { NEXT_PUBLIC_API_URL: baseUrl } = deriveExpected(profile, env);
  if (!baseUrl || baseUrl.includes('<') || baseUrl === 'https://undefined') {
    throw new Error(`config/labels/${label}.jsonc has no usable apiHost for "${env}" — fill the anchor first`);
  }
  return baseUrl;
}

/**
 * `listAll` in D1TopicNodeRepository defaults to this many rows. A silently
 * truncated list would make reconciliation miss existing topics and create
 * duplicates, so the importer refuses to run on a partial index.
 */
const TOPIC_LIST_LIMIT = 1000;

/** Build the source the run will read from. Exactly one is configured. */
function createSource(args) {
  if (args.source) return createLocalSource(args.source);

  const credentials = driveClientFromEnv();
  if (credentials.placeholders?.length) {
    const err = new Error(
      `${credentials.placeholders.join(', ')} still hold the example value from the docs, not a real one.`,
    );
    err.hints = [
      'A snippet like GOCSPX-... or 1//0... is a placeholder — replace it with the value from',
      'the Google Cloud console (or from `node scripts/content/drive-source.mjs --login`).',
      'If they live in ~/.arenaquest-drive.env, edit that file and `source` it again.',
    ];
    throw err;
  }
  if (!credentials.ok) {
    const err = new Error(`--drive-folder needs ${credentials.missing.join(', ')} in the environment.`);
    // Refreshing an access token takes all three values, so having the refresh
    // token is not enough — and telling someone who already has one to mint
    // another sends them down the wrong path.
    err.hints = credentials.missing.includes('AQ_GDRIVE_REFRESH_TOKEN')
      ? ['Mint the refresh token once with: node scripts/content/drive-source.mjs --login']
      : [
          'The refresh token alone cannot mint an access token — the exchange is',
          'client_id + client_secret + refresh_token. Export all three.',
          'For repeat use, keep them in a file you source rather than retyping:',
          '  printf \'export AQ_GDRIVE_CLIENT_ID=...\\nexport AQ_GDRIVE_CLIENT_SECRET=...\\nexport AQ_GDRIVE_REFRESH_TOKEN=...\\n\' > ~/.arenaquest-drive.env',
          '  chmod 600 ~/.arenaquest-drive.env && source ~/.arenaquest-drive.env',
        ];
    throw err;
  }
  return createDriveSource({
    client: credentials.client,
    folderId: args.driveFolderId,
    onFolder: (path) => {
      if (path) log.hint(`listing ${path}`);
    },
  });
}

function printPlan(plan, { baseUrl, sourceLabel, ledgerEntries, rootTopicId }) {
  log.info(`Source: ${sourceLabel}`);
  log.info(`Target: ${baseUrl}${rootTopicId ? ` (under topic ${rootTopicId})` : ''}`);

  const filesByTopic = new Map();
  for (const file of plan.files) {
    if (!filesByTopic.has(file.topicKey)) filesByTopic.set(file.topicKey, []);
    filesByTopic.get(file.topicKey).push(file);
  }

  const renderFile = (file, indent) => {
    const suffix = nextAction(ledgerEntries.get(file.key), file) === 'skip' ? '  (already imported)' : '';
    console.log(`  ${indent}  - ${file.title}  ${formatBytes(file.sizeBytes)}${suffix}`);
  };

  console.log('');
  for (const file of filesByTopic.get(null) ?? []) renderFile(file, '');
  for (const topic of plan.topics) {
    const indent = '  '.repeat(topic.depth);
    const notes = [];
    if (topic.content !== undefined) notes.push(`readme ${formatBytes(Buffer.byteLength(topic.content))}`);
    if (topic.order !== undefined) notes.push(`order ${topic.order}`);
    if (topic.status !== undefined) notes.push(topic.status);
    console.log(`  ${indent}[topic] ${topic.title}${notes.length ? `  (${notes.join(', ')})` : ''}`);
    for (const file of filesByTopic.get(topic.key) ?? []) renderFile(file, indent);
  }
  console.log('');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    log.fail(err.message);
    usage();
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    usage();
    return;
  }

  let baseUrl;
  let source;
  try {
    baseUrl = resolveBaseUrl(args.label, args.env);
    source = createSource(args);
  } catch (err) {
    log.fail(err.message);
    for (const hint of err.hints ?? []) log.hint(hint);
    process.exitCode = 1;
    return;
  }

  log.heading(`Import media: ${args.label} -> ${args.env}`);

  // Listing a Drive folder needs its read-only token — that is the one thing a
  // Drive dry run cannot avoid. It still performs no writes and never touches an
  // ArenaQuest credential; a local dry run stays credential-free entirely.
  let plan;
  let sourceLabel;
  try {
    sourceLabel = await source.describe();
    plan = buildPlan(await source.list(), { rootTopicId: args.rootTopicId });
    await resolveReadmes(plan, {
      readText: source.readText,
      onWarning: (topic, message) => {
        log.warn(`${topic.key}: ${message}`);
      },
    });
  } catch (err) {
    log.die(err.message);
    return;
  }

  if (plan.violations.length > 0) {
    for (const violation of plan.violations) {
      log.fail(violation.relPath);
      log.hint(violation.reason);
    }
    if (!args.skipInvalid) {
      log.die(
        `${plan.violations.length} file(s) cannot be imported — fix them, or re-run with --skip-invalid to import the rest.`,
      );
      return;
    }
    log.warn(`${plan.violations.length} file(s) will be skipped (--skip-invalid).`);
  }

  if (plan.files.length === 0 && plan.topics.length === 0) {
    log.warn('Nothing to import: the source has no supported media and no folders.');
    return;
  }

  const ledgerPath = ledgerPathFor(args.label, args.env, args.ledger);
  const ledgerEntries = readLedger(ledgerPath);
  const isPending = (file) => nextAction(ledgerEntries.get(file.key), file) !== 'skip';

  if (args.dryRun) {
    log.info('Dry run — nothing is written and no ArenaQuest credential is read:');
    printPlan(plan, { baseUrl, sourceLabel, ledgerEntries, rootTopicId: args.rootTopicId });
    const pending = plan.files.filter(isPending);
    const totalBytes = pending.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (plan.root) {
      log.info(`Root topic ${args.rootTopicId} gets ${formatBytes(Buffer.byteLength(plan.root.content))} of README content.`);
    }
    const described = plan.topics.filter((topic) => topic.content !== undefined).length;
    log.ok(
      `${plan.topics.length} topic(s) (${described} with a README), ` +
        `${pending.length} file(s) to upload (${formatBytes(totalBytes)}).`,
    );
    log.hint(`Ledger: ${ledgerPath}`);
    if (plan.violations.length > 0) {
      // The report's whole value is the resolved topicId, and that needs the
      // authenticated topic reconciliation a dry run deliberately skips.
      log.hint(
        `${plan.violations.length} skipped file(s) will be written to ` +
          `${skippedReportPathFor(args.label, args.env, args.skippedReport)} on a real run.`,
      );
    }
    return;
  }

  const email = process.env.AQ_ADMIN_EMAIL;
  const password = process.env.AQ_ADMIN_PASSWORD;
  if (!email || !password) {
    log.fail('AQ_ADMIN_EMAIL and AQ_ADMIN_PASSWORD must be set in the environment.');
    log.hint('They are read from the environment only — never pass a password on the command line.');
    log.hint('export AQ_ADMIN_EMAIL=admin@example.com; read -rs AQ_ADMIN_PASSWORD; export AQ_ADMIN_PASSWORD');
    process.exitCode = 1;
    return;
  }

  try {
    await confirmProduction({ env: args.env, label: args.label, yes: args.yes });
  } catch (err) {
    log.die(err.message);
    return;
  }

  const client = createApiClient({ baseUrl, email, password });

  let user;
  try {
    user = await client.login();
  } catch (err) {
    log.fail(`Login failed against ${baseUrl}: ${err.message}`);
    log.hint('The account must exist in this environment and hold role admin or content_creator.');
    process.exitCode = 1;
    return;
  }
  log.ok(`Authenticated as ${user?.email ?? email}`);

  let topicResult;
  try {
    const listed = await withRetry(() => client.request('GET', '/v1/admin/topics'));
    const records = listed?.data ?? [];
    if (records.length >= TOPIC_LIST_LIMIT) {
      throw new Error(
        `GET /v1/admin/topics returned ${records.length} rows, at the repository's ${TOPIC_LIST_LIMIT} limit — ` +
          'the existing-topic index would be incomplete and this run would create duplicates. ' +
          'Import under a narrower --root-topic, or raise the listAll limit first.',
      );
    }
    topicResult = await reconcileTopics(client, plan, {
      rootTopicId: args.rootTopicId,
      index: indexTopics(records),
      onCreate: (topic) => log.ok(`topic created: ${topic.key}`),
      onUpdate: (topic, fields) => log.ok(`topic updated: ${topic.key} (${fields.join(', ')})`),
    });
  } catch (err) {
    log.fail(`Topic reconciliation failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  log.ok(
    `Topics: ${topicResult.created} created, ${topicResult.reused} reused, ${topicResult.updated} updated from README.`,
  );

  if (plan.violations.length > 0) {
    const reportPath = skippedReportPathFor(args.label, args.env, args.skippedReport);
    const written = writeSkippedReport(reportPath, plan.violations, {
      idByKey: topicResult.idByKey,
      rootTopicId: args.rootTopicId,
    });
    const byState = plan.violations.reduce((counts, v) => ({ ...counts, [v.state]: (counts[v.state] ?? 0) + 1 }), {});
    log.ok(`Skipped-file report: ${written} record(s) — ${Object.entries(byState).map(([k, n]) => `${n} ${k}`).join(', ')}`);
    log.hint(reportPath);
  }

  try {
    const updated = await applyRootReadme(client, args.rootTopicId, plan.root, {
      onUpdate: (fields) => log.ok(`root topic updated from its README (${fields.join(', ')})`),
    });
    if (!updated && plan.root) log.info('Root topic already matches its README.');
  } catch (err) {
    log.warn(`Could not apply the root README: ${err.message}`);
  }

  let moved = 0;
  try {
    moved = await applyDeclaredOrder(client, topicResult.placed);
    if (moved > 0) log.ok(`Applied the order declared in ${moved} README(s).`);
  } catch (err) {
    // Ordering is cosmetic; a failure here must not cost the media upload.
    log.warn(`Could not apply the declared topic order: ${err.message}`);
  }

  let pending = plan.files.filter(isPending);
  const alreadyDone = plan.files.length - pending.length;
  let deferred = 0;
  if (args.limit && pending.length > args.limit) {
    deferred = pending.length - args.limit;
    pending = pending.slice(0, args.limit);
  }

  if (alreadyDone > 0) log.info(`${alreadyDone} file(s) already imported — skipping.`);
  if (deferred > 0) log.warn(`--limit ${args.limit}: ${deferred} pending file(s) left for a later run.`);
  log.info(`Uploading ${pending.length} file(s) with concurrency ${args.concurrency}...`);

  const results = await runPool(pending, args.concurrency, async (file) => {
    const topicId = file.topicKey === null ? args.rootTopicId : topicResult.idByKey.get(file.topicKey);
    const outcome = await uploadFile(client, {
      file,
      topicId,
      ledgerPath,
      entry: ledgerEntries.get(file.key),
      readBytes: source.readBytes,
    });
    log.ok(`${file.relPath}  ${formatBytes(file.sizeBytes)}`);
    return outcome;
  });

  const failures = results.filter((result) => !result.ok);
  const uploadedBytes = results
    .filter((result) => result.ok)
    .reduce((sum, result) => sum + result.item.sizeBytes, 0);

  log.heading('Summary');
  log.ok(`Topics: ${topicResult.created} created, ${topicResult.reused} reused, ${topicResult.updated} updated`);
  log.ok(
    `Files: ${results.length - failures.length} imported (${formatBytes(uploadedBytes)}), ${alreadyDone} already done`,
  );
  if (deferred > 0) log.warn(`Files deferred by --limit: ${deferred}`);
  if (args.skipInvalid && plan.violations.length > 0) log.warn(`Files skipped as invalid: ${plan.violations.length}`);
  log.hint(`Ledger: ${ledgerPath}`);

  if (failures.length > 0) {
    log.heading('Failures');
    for (const failure of failures) {
      log.fail(failure.item.relPath);
      log.hint(failure.error.message);
    }
    log.hint('Re-run the same command — finished files are skipped and interrupted ones resume.');
    process.exitCode = 1;
    return;
  }

  log.ok(`Import complete: ${args.label} -> ${args.env}. Review the topics and publish them from the backoffice.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    log.fail(error.message);
    process.exitCode = 1;
  });
}
