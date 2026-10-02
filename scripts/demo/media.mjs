/**
 * media.mjs — the demo media: keys, cache, verified download, R2 upload
 * (RFC 0021 §3.3).
 *
 * Every topic of the dataset gets the manifest files `media.assign` names. One
 * (topic, file) pair is one `media` row and one object:
 *
 *   id   demoId(label, 'media', demoMediaKey(topicKey, manifestKey))
 *   key  topics/<topicId>/<mediaId>-<sanitizeFileName(fileName)>
 *
 * — the upload path's own shape (`admin-media.controller.ts`), so the RFC 0018
 * storage audit classifies the object as `linked`.
 *
 * Resolution per object:
 *   1. exists   the key is already in the bucket with the manifest's SHA-256 →
 *               nothing is uploaded (a key holding other bytes is `stale` and
 *               is overwritten — it is a demo key, never a foreign object);
 *   2. cached   `.arenaquest/demo-media/<sha256>` (gitignored) holds the file;
 *   3. download fetched from the manifest URL, SHA-256 verified, then cached.
 *
 * Every file passes `validateMediaFile` — the importer's single preflight over
 * the API limits — and must carry the manifest's declared type. Any download,
 * checksum, validation or upload failure throws, and the CLI runs the SQL only
 * after this module resolved: a `ready` row never exists without its object.
 * Only keys this module derives are ever read or written; nothing else in the
 * bucket is listed, linked or touched.
 *
 * The bucket is reached through `{ get, put }`: `createR2` spawns `wrangler r2
 * object` (remote), `openLocalR2` serves the local store in-process through
 * wrangler's `getPlatformProxy` (much faster than one process per object).
 *
 * I/O goes through injectable functions so the tests stub them:
 *   run(argv)   → Promise<{ status, stdout: Buffer, stderr: string }>  (wrangler)
 *   getPlatformProxy(options) → { env: { R2 }, dispose }  (local)
 *   fetchImpl   the global `fetch` (Node honours HTTPS_PROXY only with
 *               NODE_USE_ENV_PROXY=1; set it behind a proxy).
 *
 * Stdlib only, plus the api package's wrangler for the local bucket (imported
 * lazily, only when a local seed opens it); the module itself loads on Node 20.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateMediaFile } from '../content/import-media.mjs';
import { parseJsonc } from '../label.mjs';
import { demoMediaKey } from './ids.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE)); // repo root (scripts/demo/..)

export const DEFAULT_CONCURRENCY = 4;

// ════════════════════════════════════════════════════════════════════════════
// PURE: keys and plan
// ════════════════════════════════════════════════════════════════════════════

/**
 * Port of `sanitizeFileName` in `packages/shared/utils/sanitize-file-name.ts`
 * (parity pinned by media.test.mjs against the TS source itself).
 */
export function sanitizeFileName(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return slug || 'file';
}

/** `topics/<topicId>/<mediaId>-<name>` — the key the upload path would pick. */
export function mediaStorageKey(topicId, mediaId, fileName) {
  return `topics/${topicId}/${mediaId}-${sanitizeFileName(fileName)}`;
}

/**
 * Every (topic, manifest file) pair of `dataset`, in topic order:
 * `{ id, topicKey, topicId, manifestKey, file, key, uploadedBy }`.
 * `ctx.id(entity, key)` is the seed's deterministic id (see sql.mjs).
 */
export function buildMediaPlan(dataset, ctx) {
  const manifest = new Map(dataset.media.manifest.map((file) => [file.key, file]));
  const uploadedBy = ctx.id('user', dataset.media.uploadedBy);
  const plan = [];
  for (const topic of dataset.topics) {
    const topicId = ctx.id('topic', topic.key);
    for (const manifestKey of dataset.media.assign[topic.key] ?? []) {
      const file = manifest.get(manifestKey);
      if (!file) throw new Error(`media.assign["${topic.key}"]: "${manifestKey}" is not in the manifest`);
      const id = ctx.id('media', demoMediaKey(topic.key, manifestKey));
      plan.push({ id, topicKey: topic.key, topicId, manifestKey, file, key: mediaStorageKey(topicId, id, file.fileName), uploadedBy });
    }
  }
  return plan;
}

/**
 * Throws, naming the manifest entry, unless `validateMediaFile` accepts the file
 * and its extension maps to the declared type. `sizeBytes` defaults to the
 * declared size; pass the real byte count once the file is at hand.
 */
export function assertValidMedia(file, sizeBytes = file.sizeBytes) {
  const where = `media.manifest["${file.key}"] (${file.fileName})`;
  const check = validateMediaFile({ fileName: file.fileName, sizeBytes });
  if (!check.ok) throw new Error(`${where}: refused by validateMediaFile — ${check.reason}`);
  if (check.contentType !== file.type) {
    throw new Error(`${where}: declared type ${file.type} but the file name maps to ${check.contentType}`);
  }
  return check.contentType;
}

/** The row stores the declared `sizeBytes`: it must be the real byte count. */
export function assertDeclaredSize(file, actual) {
  if (actual !== file.sizeBytes) {
    throw new Error(`media.manifest["${file.key}"]: sizeBytes is ${file.sizeBytes} but the file has ${actual} bytes`);
  }
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function cachePath(cacheDir, sha256) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`not a SHA-256: ${sha256}`);
  return join(cacheDir, sha256);
}

/** Per-object plan lines: `<state>  <topicKey>  <manifestKey>  <key>`. */
export function formatMediaPlan(resolved) {
  const width = Math.max(0, ...resolved.map((entry) => entry.topicKey.length));
  return resolved.map((entry) => {
    const state = entry.state === 'exists' ? 'exists' : `${entry.state === 'stale' ? 'stale→' : ''}${entry.source}`;
    return `${state.padEnd(15)} ${entry.topicKey.padEnd(width)}  ${entry.manifestKey.padEnd(12)}  ${entry.key}`;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Target
// ════════════════════════════════════════════════════════════════════════════

/** The bucket bound as `R2` at the top level of `apps/api/wrangler.jsonc` — what `make dev-api` serves. */
export function localBucketName(repoRoot = ROOT) {
  const config = parseJsonc(readFileSync(join(repoRoot, 'apps', 'api', 'wrangler.jsonc'), 'utf8'));
  const bucket = (config.r2_buckets ?? []).find((entry) => entry.binding === 'R2')?.bucket_name;
  if (!bucket) throw new Error('apps/api/wrangler.jsonc has no top-level R2 bucket binding');
  return bucket;
}

/**
 * `{ bucket, args, concurrency, local }` for the seed target (`resolveTarget` in
 * seed-demo.mjs). A local target is served in-process by `openLocalR2` (one
 * Miniflare over the same on-disk store), so it runs as parallel as a remote
 * one; `args` still names the equivalent wrangler flags, for the log line.
 */
export function mediaTarget(target, { repoRoot = ROOT } = {}) {
  if (!target.remote) {
    const persist = target.persistTo ? ['--persist-to', target.persistTo] : [];
    return { bucket: localBucketName(repoRoot), args: ['--local', ...persist], concurrency: DEFAULT_CONCURRENCY, local: true, persistTo: target.persistTo ?? null };
  }
  if (!target.bucket) throw new Error(`the ${target.env} target has no R2 bucket (environments.${target.env}.r2.bucket)`);
  return { bucket: target.bucket, args: ['--remote'], concurrency: DEFAULT_CONCURRENCY, local: false };
}

// ════════════════════════════════════════════════════════════════════════════
// I/O
// ════════════════════════════════════════════════════════════════════════════

/** Default `run`: `pnpm --filter api exec wrangler …` (the api package's pinned wrangler). */
export function runWrangler(argv, { cwd = ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['--filter', 'api', 'exec', 'wrangler', ...argv], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout: Buffer.concat(out), stderr: err }));
  });
}

const MISSING_KEY = /specified key does not exist|NoSuchKey|object not found/i;

/** wrangler's stderr without its log-file pointer and blank lines. */
function errorText(stderr) {
  return stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.includes('Logs were written'))
    .join(' ');
}

/** `get(key)` → Buffer | null, `put(key, file, contentType)`; errors other than "no such key" throw. */
export function createR2({ bucket, args }, run = runWrangler) {
  return {
    async get(key) {
      const result = await run(['r2', 'object', 'get', `${bucket}/${key}`, ...args, '--pipe']);
      if (result.status === 0) return result.stdout;
      if (MISSING_KEY.test(result.stderr)) return null;
      throw new Error(`wrangler r2 object get ${bucket}/${key} failed (status ${result.status}): ${errorText(result.stderr)}`);
    },
    async put(key, file, contentType) {
      const result = await run(['r2', 'object', 'put', `${bucket}/${key}`, ...args, '--file', file, '--content-type', contentType]);
      if (result.status !== 0) {
        throw new Error(`wrangler r2 object put ${bucket}/${key} failed (status ${result.status}): ${errorText(result.stderr)}`);
      }
    },
  };
}

/**
 * The state root `wrangler … --local` uses when no `--persist-to` is given: it is
 * resolved next to `apps/api/wrangler.jsonc` (what `make dev-api` serves).
 */
export function defaultLocalPersistTo(repoRoot = ROOT) {
  return join(repoRoot, 'apps', 'api', '.wrangler', 'state');
}

/** wrangler's `getPlatformProxy`, from the api package's pinned wrangler. */
export async function loadGetPlatformProxy(repoRoot = ROOT) {
  const apiRequire = createRequire(join(repoRoot, 'apps', 'api', 'package.json'));
  const wrangler = await import(pathToFileURL(apiRequire.resolve('wrangler')).href);
  if (typeof wrangler.getPlatformProxy !== 'function') throw new Error('the installed wrangler no longer exports getPlatformProxy');
  return wrangler.getPlatformProxy;
}

/**
 * The api Worker's local bindings (`env.DB`, `env.R2`, …) in this process —
 * wrangler's `getPlatformProxy` over the same on-disk store `wrangler … --local
 * --persist-to <persistTo>` reads and writes (`<persistTo>/v3`). Returns the
 * proxy; call `dispose()` before another wrangler process opens the store.
 * Remote bindings are off and the `Request.cf` download is skipped (R2/D1 never
 * need it), so starting it makes no network request.
 */
export async function localPlatformProxy({ persistTo = null, repoRoot = ROOT, getPlatformProxy = null } = {}) {
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= 'false';
  const start = getPlatformProxy ?? (await loadGetPlatformProxy(repoRoot));
  const root = resolve(persistTo ?? defaultLocalPersistTo(repoRoot));
  return start({
    configPath: join(repoRoot, 'apps', 'api', 'wrangler.jsonc'),
    persist: { path: join(root, 'v3') },
    remoteBindings: false,
  });
}

/** The `createR2` interface over an R2 binding (`env.R2` of the platform proxy). */
export function bindingR2(binding) {
  return {
    async get(key) {
      const object = await binding.get(key);
      return object ? Buffer.from(await object.arrayBuffer()) : null;
    },
    async put(key, file, contentType) {
      await binding.put(key, readFileSync(file), { httpMetadata: { contentType } });
    },
  };
}

/**
 * The local bucket in-process: the `createR2` interface plus `dispose()`. One
 * Miniflare replaces a `wrangler r2 object` process per object (27 objects took
 * ~1.5 min to check and ~4 min to upload serially). `bucket` must be the one
 * bound as `R2` — the only local bucket the seed writes.
 */
export async function openLocalR2({ bucket, persistTo = null, repoRoot = ROOT, getPlatformProxy = null }) {
  if (bucket !== localBucketName(repoRoot)) throw new Error(`the local bucket is "${localBucketName(repoRoot)}", not "${bucket}"`);
  const proxy = await localPlatformProxy({ persistTo, repoRoot, getPlatformProxy });
  if (!proxy.env?.R2) {
    await proxy.dispose();
    throw new Error('the local platform proxy has no R2 binding');
  }
  return { ...bindingR2(proxy.env.R2), dispose: () => proxy.dispose() };
}

/** Run `fn` over `items`, at most `limit` at a time; rejects on the first failure. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next++;
      results[at] = await fn(items[at], at);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function cachedBytes(cacheDir, file) {
  const path = cachePath(cacheDir, file.sha256);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  return sha256Hex(bytes) === file.sha256 ? bytes : null; // a corrupt cache entry is re-downloaded
}

/**
 * Where each object stands, without writing anything: adds `state`
 * (`exists` | `stale` | `missing`) and, unless it exists, `source`
 * (`cached` | `download`). Every manifest file is validated first.
 */
export async function resolveMediaPlan(plan, { r2, cacheDir, concurrency = DEFAULT_CONCURRENCY }) {
  for (const file of new Map(plan.map((entry) => [entry.manifestKey, entry.file])).values()) assertValidMedia(file);
  return pool(plan, concurrency, async (entry) => {
    const existing = await r2.get(entry.key);
    if (existing && sha256Hex(existing) === entry.file.sha256) {
      assertDeclaredSize(entry.file, existing.length);
      return { ...entry, state: 'exists' };
    }
    const source = cachedBytes(cacheDir, entry.file) ? 'cached' : 'download';
    return { ...entry, state: existing ? 'stale' : 'missing', source };
  });
}

/** The file's bytes into the cache (downloading + verifying if needed); returns the cache path. */
export async function ensureCached(file, { cacheDir, fetchImpl = fetch }) {
  const path = cachePath(cacheDir, file.sha256);
  if (cachedBytes(cacheDir, file)) return path;
  const where = `media.manifest["${file.key}"]`;
  let response;
  try {
    response = await fetchImpl(file.url);
  } catch (error) {
    throw new Error(`${where}: download failed from ${file.url}: ${error.cause?.message ?? error.message}`);
  }
  if (!response.ok) throw new Error(`${where}: download failed from ${file.url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256Hex(bytes);
  if (actual !== file.sha256) {
    throw new Error(`${where}: SHA-256 mismatch for ${file.url} (expected ${file.sha256}, got ${actual}) — nothing cached`);
  }
  mkdirSync(cacheDir, { recursive: true });
  const partial = `${path}.part`;
  writeFileSync(partial, bytes);
  renameSync(partial, path);
  return path;
}

/**
 * Make every object of `resolved` exist: fetch what is missing into the cache,
 * validate the real bytes, upload, then read each uploaded key back and check
 * its SHA-256. Throws on the first failure — the caller must not run the SQL.
 * Returns `{ uploaded, skipped }`.
 */
export async function materialiseMedia(resolved, { r2, cacheDir, fetchImpl = fetch, concurrency = DEFAULT_CONCURRENCY, onUpload = () => {} }) {
  const todo = resolved.filter((entry) => entry.state !== 'exists');
  const files = new Map(todo.map((entry) => [entry.manifestKey, entry.file]));
  const paths = new Map();
  for (const [manifestKey, file] of files) {
    const path = await ensureCached(file, { cacheDir, fetchImpl });
    const size = readFileSync(path).length;
    assertDeclaredSize(file, size);
    assertValidMedia(file, size);
    paths.set(manifestKey, path);
  }
  await pool(todo, concurrency, async (entry) => {
    await r2.put(entry.key, paths.get(entry.manifestKey), entry.file.type);
    const stored = await r2.get(entry.key);
    if (!stored || sha256Hex(stored) !== entry.file.sha256) {
      throw new Error(`upload of ${entry.key} could not be confirmed (object ${stored ? 'differs' : 'missing'} after put)`);
    }
    onUpload(entry);
  });
  return { uploaded: todo.length, skipped: resolved.length - todo.length };
}

/** `.arenaquest/demo-media` under the repo root. */
export function defaultCacheDir(repoRoot = ROOT) {
  return join(repoRoot, '.arenaquest', 'demo-media');
}
