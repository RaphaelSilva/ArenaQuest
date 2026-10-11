/**
 * scripts/lib/api-client.mjs — the ArenaQuest admin API client and media
 * upload lifecycle shared by the operational scripts.
 *
 * One upload lifecycle, several callers: `scripts/content/import-media.mjs`
 * (the bulk importer) and `aq-mcp` (the local MCP server) both upload media
 * through exactly this code — login, authenticated JSON calls with retry,
 * the media preflight, the resume ledger and `presign -> PUT -> finalize`.
 * Nothing here opens a second write path into a deployed environment: every
 * call goes through the PUBLIC API, so every validation, guard and business
 * rule still applies.
 *
 * Rules for this module:
 *   - stdlib only, ESM, zero dependencies;
 *   - it never imports from `scripts/content/` or `scripts/media/` (the CLIs
 *     import it, not the other way round — no cycles). The single exception
 *     is the Google-Apps mime predicate from `../content/drive-source.mjs`,
 *     which itself depends on nothing but `../lib/log.mjs`;
 *   - credentials are received as values, never read from argv, and no
 *     secret value ever reaches a log line.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve as resolvePath } from 'node:path';

import { isGoogleAppsFile as isGoogleAppsMime } from '../content/drive-source.mjs';
import { loadProfile } from '../deploy/core.mjs';
import { deriveExpected } from '../label.mjs';

/** Deployed environments a script may target. */
export const API_ENVS = ['staging', 'production'];

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

/** `media.original_name` is validated as `z.string().min(1).max(255)`. */
export const MAX_FILE_NAME_LENGTH = 255;

/** Access tokens live 900 s (apps/api/src/container.ts); re-login early. */
const TOKEN_LIFETIME_MS = 900_000;
const TOKEN_REFRESH_MARGIN_MS = 180_000;

/** Total tries for a retried API call (`withRetry`). */
export const DEFAULT_ATTEMPTS = 3;

// -- media preflight ----------------------------------------------------------

/** Content type for a file name, or null when the extension is not supported. */
export function contentTypeFor(fileName) {
  return CONTENT_TYPE_BY_EXTENSION[extname(fileName).toLowerCase()] ?? null;
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
  // Manifest-only: the row names a file that is not under --source.
  MISSING: 'missing',
};

/**
 * The API's preflight for one media file, in one place.
 *
 * Shared by `buildPlan` (tree sources) and `buildManifestPlan` (converter
 * manifests) so both refuse exactly the same files for exactly the same
 * reasons — a manifest is not a way around a limit, only a different way to
 * arrive at the upload.
 */
export function validateMediaFile({ fileName, sizeBytes, mimeType = null }) {
  const contentType = contentTypeFor(fileName);
  if (!contentType) {
    if (isGoogleAppsMime(mimeType)) {
      return {
        ok: false,
        state: SKIP_STATES.GOOGLE_DOC,
        reason: 'Google Docs/Sheets/Slides cannot be uploaded as media — export it to PDF in Drive first',
      };
    }
    return {
      ok: false,
      state: SKIP_STATES.INVALID_TYPE,
      reason: `unsupported extension "${extname(fileName) || '(none)'}" — the API accepts ${Object.keys(CONTENT_TYPE_BY_EXTENSION).join(', ')}`,
    };
  }

  if (sizeBytes === 0) {
    return { ok: false, state: SKIP_STATES.EMPTY, reason: 'file is empty (sizeBytes must be positive)' };
  }

  const maxBytes = SIZE_LIMIT_BYTES[contentType];
  if (sizeBytes > maxBytes) {
    return {
      ok: false,
      state: SKIP_STATES.TOO_LARGE,
      reason: `${formatBytes(sizeBytes)} exceeds the API limit of ${formatBytes(maxBytes)} for ${contentType}`,
    };
  }

  if (fileName.length > MAX_FILE_NAME_LENGTH) {
    return {
      ok: false,
      state: SKIP_STATES.NAME_TOO_LONG,
      reason: `file name is ${fileName.length} characters (max ${MAX_FILE_NAME_LENGTH})`,
    };
  }

  return { ok: true, contentType };
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
 * Default ledger location for a label/environment pair.
 *
 * A manifest run shares it with the tree run that produced the manifest, on
 * purpose: it is one ledger per environment, and the keys never collide —
 * a skipped file goes to the skipped report, never to the ledger, so the row a
 * manifest import writes for it is its first.
 */
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

// -- target resolution --------------------------------------------------------

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
