#!/usr/bin/env node
/**
 * Provision Cloudflare resources for a white-label profile.
 *
 * Staging is the default. Production is opt-in and has its own confirmation
 * gate, so a normal `make set-new-label LABEL=x` cannot create production
 * resources accidentally.
 *
 * The script deliberately does not use Wrangler's --update-config option.
 * Resource IDs belong in config/labels/<label>.jsonc, which is the profile
 * source of truth; apps/api/wrangler.jsonc is regenerated from that profile.
 *
 * Both the data plane and the backend are provisioned, so a new label comes up
 * with a Worker that actually serves authenticated traffic:
 *
 *   d1 → kv → r2 → subdomain → write profile+wrangler → cors → pages
 *      → secrets → worker → [domain] → report
 *
 * Two ordering constraints carry the design:
 *   1. The profile/wrangler write MUST precede every `--env <wranglerEnv>`
 *      command — wrangler resolves the target script name from the generated
 *      env block, and without it `secret put --env x` fails or (worse) targets
 *      the top-level `api` Worker.
 *   2. Secrets MUST precede the first deploy. `wrangler secret put` creates a
 *      draft Worker when none exists and deploys never delete secrets, so
 *      setting JWT_SECRET first means the first real deploy boots with a valid
 *      signing key. The reverse order leaves a live Worker returning 500 on
 *      every authenticated route (JwtAuthAdapter throws without it).
 *
 * Secret hygiene: JWT_SECRET is generated here and handed to wrangler over
 * stdin. Secret VALUES are never logged, never placed in argv, and never
 * written to disk. Externally-valued secrets (R2_*, GOOGLE_CLIENT_SECRET,
 * RESEND_API_KEY) are only ever *detected* by name and reported.
 */

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  PATHS,
  parseJsonc,
  scaffoldWranglerText,
  deriveCorsRules,
  renderCorsFile,
  workersDevHost,
  kvNamespaceName,
  requiredWhenActive,
} from '../label.mjs';
import { confirmProduction } from '../deploy/core.mjs';
import log from '../lib/log.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const PROFILE_DIR = join(ROOT, 'config', 'labels');
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const ACCOUNT_RESOURCE_ID_RE = /\b[0-9a-f]{32}\b/i;
const CF_API = 'https://api.cloudflare.com/client/v4';

/** `--only` groups. `all` runs the full pipeline. */
export const ONLY_STEPS = ['all', 'cors', 'secrets', 'worker', 'domain'];

function usage() {
  console.log(`Usage: node scripts/cloudflare/provision-label.mjs <label> [options]

Options:
  --production    Provision production after staging and a second confirmation
  --yes           Bypass the production prompt (or use CONFIRM=1)
  --with-domain   Attach the apiHost custom domain when its zone is in the account
  --only <step>   Run one group only: ${ONLY_STEPS.join(' | ')} (default: all)
  --dry-run       Print the planned commands without changing Cloudflare or files`);
}

export function parseArgs(argv) {
  const args = {
    label: null,
    production: false,
    yes: false,
    dryRun: false,
    withDomain: false,
    only: 'all',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--production' || arg === '-p') args.production = true;
    else if (arg === '--yes') args.yes = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--with-domain') args.withDomain = true;
    else if (arg === '--only') {
      const value = argv[++i];
      if (!ONLY_STEPS.includes(value)) {
        throw new Error(`--only must be one of: ${ONLY_STEPS.join(', ')}`);
      }
      args.only = value;
    } else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else if (args.label) throw new Error(`unexpected argument: ${arg}`);
    else args.label = arg;
  }

  if (!args.help && !args.label) throw new Error('label is required');
  return args;
}

// ════════════════════════════════════════════════════════════════════════════
// Command plumbing
// ════════════════════════════════════════════════════════════════════════════

/** Full argv for a wrangler invocation through the repo pin. */
function wranglerArgv(scope, ...args) {
  return ['pnpm', '--filter', scope, 'exec', 'wrangler', ...args];
}

export function renderCommand(argv) {
  return argv.join(' ');
}

function childEnv() {
  const env = { ...process.env };
  if (env.CF_ACCOUNT_ID && !env.CLOUDFLARE_ACCOUNT_ID) env.CLOUDFLARE_ACCOUNT_ID = env.CF_ACCOUNT_ID;
  if (env.CF_API_TOKEN && !env.CLOUDFLARE_API_TOKEN) env.CLOUDFLARE_API_TOKEN = env.CF_API_TOKEN;
  return env;
}

function runCommand(argv, { allowFailure = false } = {}) {
  log.cmd(renderCommand(argv));
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: ROOT,
    encoding: 'utf8',
    env: childEnv(),
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`command failed (exit ${result.status ?? 'signal'}): ${renderCommand(argv)}\n${output.trim()}`);
  }
  return { ...result, output };
}

function resourceId(value) {
  const text = String(value || '');
  return text.match(UUID_RE)?.[0] || text.match(ACCOUNT_RESOURCE_ID_RE)?.[0] || null;
}

function parseJsonOutput(output) {
  const text = String(output || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function findJsonResource(value, name, idKeys) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJsonResource(item, name, idKeys);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  const names = [value.name, value.title, value.project_name, value.projectName, value['Project Name']];
  if (names.includes(name)) {
    for (const key of idKeys) {
      const id = resourceId(value[key]);
      if (id) return id;
    }
  }
  for (const child of Object.values(value)) {
    const found = findJsonResource(child, name, idKeys);
    if (found) return found;
  }
  return null;
}

function hasJsonResource(value, name) {
  if (Array.isArray(value)) return value.some((item) => hasJsonResource(item, name));
  if (!value || typeof value !== 'object') return false;
  const names = [value.name, value.title, value.project_name, value.projectName, value['Project Name']];
  if (names.includes(name)) return true;
  return Object.values(value).some((child) => hasJsonResource(child, name));
}

function findTextResource(output, names) {
  const lines = String(output || '').split(/\r?\n/);
  for (const name of names) {
    const line = lines.find((candidate) => candidate.includes(name));
    const id = resourceId(line);
    if (line && id) return id;
  }
  return null;
}

export function isPlaceholder(value) {
  return !value || /<[^>]+>/.test(String(value));
}

function accountId() {
  const id = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!id) {
    throw new Error('Cloudflare account ID is missing; export CF_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID first.');
  }
  if (!ACCOUNT_RESOURCE_ID_RE.test(id)) {
    throw new Error('Cloudflare account ID must be a 32-character hexadecimal ID.');
  }
  return id;
}

function profilePath(label) {
  return join(PROFILE_DIR, `${label}.jsonc`);
}

function loadProfile(label) {
  const path = profilePath(label);
  if (!existsSync(path)) throw new Error(`profile not found: config/labels/${label}.jsonc`);
  const text = readFileSync(path, 'utf8');
  const profile = parseJsonc(text);
  if (profile.label !== label) throw new Error(`profile label mismatch: expected ${label}`);
  for (const env of ['staging', 'production']) {
    if (!profile.environments?.[env]) throw new Error(`profile has no ${env} environment`);
  }
  return { path, text, profile };
}

export function wranglerEnvName(label, env) {
  return env === 'production' ? label : `${label}-staging`;
}

export function pagesProductionBranch(env) {
  return env === 'production' ? 'main' : 'develop';
}

/**
 * Deterministic temp path for the derived CORS document, so the command the
 * plan PRINTS is byte-identical to the one it RUNS. Absolute, because wrangler
 * runs with cwd=apps/api under `pnpm --filter api exec`.
 */
function corsFilePath(label, env) {
  return join(tmpdir(), `aq-cors-${label}-${env}.json`);
}

// ════════════════════════════════════════════════════════════════════════════
// PURE: the provisioning plan
// ════════════════════════════════════════════════════════════════════════════

/**
 * The ordered list of steps for one label/environment.
 *
 * Both `--dry-run` (which prints it) and the executor (which walks it) consume
 * this one array, so a step can never be executed without appearing in the
 * dry run. Commands are the *planned* ones — an `ensure*` step skips its
 * create command when the resource already exists.
 */
export function buildProvisionPlan(profile, env, options = {}) {
  const { withDomain = false, only = 'all' } = options;
  const label = profile.label;
  const e = profile.environments[env];
  const wEnv = wranglerEnvName(label, env);
  const origins = deriveCorsRules(profile, env)[0].allowed.origins;

  const all = [
    {
      id: 'd1',
      title: `D1 database ${e.d1.name}`,
      commands: [
        wranglerArgv('api', 'd1', 'list', '--json'),
        wranglerArgv('api', 'd1', 'create', e.d1.name),
      ],
    },
    {
      id: 'kv',
      title: `KV namespace ${kvNamespaceName(label, env)}`,
      commands: [
        wranglerArgv('api', 'kv', 'namespace', 'list'),
        wranglerArgv('api', 'kv', 'namespace', 'create', kvNamespaceName(label, env)),
      ],
    },
    {
      id: 'r2',
      title: `R2 bucket ${e.r2.bucket}`,
      commands: [
        wranglerArgv('api', 'r2', 'bucket', 'list'),
        wranglerArgv('api', 'r2', 'bucket', 'create', e.r2.bucket),
      ],
    },
    {
      id: 'subdomain',
      title: 'Resolve the account workers.dev subdomain',
      commands: [],
      note: `GET ${CF_API}/accounts/<account>/workers/subdomain (resolves the <acct> placeholder in apiHost)`,
    },
    {
      id: 'profile',
      title: 'Write resource ids back to the profile and regenerate wrangler.jsonc',
      commands: [],
      note: `config/labels/${label}.jsonc + apps/api/wrangler.jsonc (env.${wEnv})`,
    },
    {
      id: 'cors',
      title: `R2 CORS for ${e.r2.bucket}`,
      commands: [
        wranglerArgv('api', 'r2', 'bucket', 'cors', 'list', e.r2.bucket),
        wranglerArgv('api', 'r2', 'bucket', 'cors', 'set', e.r2.bucket, '--file', corsFilePath(label, env), '-y'),
      ],
      note: `rules derived from webOrigin — origins: ${origins.join(', ')}`,
    },
    {
      id: 'pages',
      title: `Pages project ${e.pagesProject}`,
      commands: [
        wranglerArgv('web', 'pages', 'project', 'list', '--json'),
        wranglerArgv('web', 'pages', 'project', 'create', e.pagesProject,
          '--production-branch', pagesProductionBranch(env)),
      ],
    },
    {
      id: 'secrets',
      title: `Worker secrets for env.${wEnv}`,
      commands: [
        wranglerArgv('api', 'secret', 'list', '--env', wEnv, '--format', 'json'),
        wranglerArgv('api', 'secret', 'put', 'JWT_SECRET', '--env', wEnv),
      ],
      note: 'JWT_SECRET generated here (32 random bytes) and piped over stdin — never logged, never on disk. Set only when absent.',
    },
    {
      id: 'worker',
      title: `Deploy the Worker for ${label}/${env}`,
      commands: [
        ['node', 'scripts/cloudflare/deploy.mjs', '--label', label, '-e', env, '--scope', 'api', '--yes'],
      ],
      note: 'the deploy CLI runs guard-no-dev-seed → d1 migrations apply → wrangler deploy, in that order',
    },
  ];

  if (withDomain) {
    all.push({
      id: 'domain',
      title: `Custom domain ${e.apiHost}`,
      commands: [
        wranglerArgv('api', 'deploy', '--env', wEnv, '--domain', e.apiHost),
      ],
      note: `only when a zone matching ${e.apiHost} exists in the account; otherwise skipped with a follow-up`,
    });
  }

  if (only === 'all') return all;
  return all.filter((step) => step.id === only);
}

// ════════════════════════════════════════════════════════════════════════════
// PURE: profile text surgery
// ════════════════════════════════════════════════════════════════════════════

function findObjectRange(text, property, start = 0) {
  const propertyRe = new RegExp(`(["']${property}["']\\s*:\\s*\\{)`);
  const match = propertyRe.exec(text.slice(start));
  if (!match) return null;
  const open = start + match.index + match[0].lastIndexOf('{');
  let depth = 0;
  let inString = false;
  let quote = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return { start: open, end: i + 1 };
  }
  throw new Error(`unclosed object: ${property}`);
}

/**
 * Rewrite the resolved resource identifiers inside ONE environment object of a
 * profile jsonc, leaving comments, formatting and the sibling environment
 * untouched.
 *
 * `apiHost` is a scalar on the environment itself rather than a field of a
 * nested object, so it takes the `objectName === null` branch.
 */
export function updateProfileResourceIds(text, env, { d1Id, kvId, s3Endpoint, apiHost } = {}) {
  const envRange = findObjectRange(text, env);
  if (!envRange) throw new Error(`could not locate profile environment: ${env}`);
  let body = text.slice(envRange.start, envRange.end);

  const replacements = [
    ['d1', 'id', d1Id],
    ['kv', 'id', kvId],
    ['r2', 's3Endpoint', s3Endpoint],
    [null, 'apiHost', apiHost],
  ];
  for (const [objectName, field, value] of replacements) {
    if (!value) continue;
    const fieldRe = new RegExp(`(["']${field}["']\\s*:\\s*)["'][^"']*["']`);

    if (objectName === null) {
      if (!fieldRe.test(body)) throw new Error(`could not locate ${env}.${field}`);
      body = body.replace(fieldRe, `$1"${value}"`);
      continue;
    }

    const objectRange = findObjectRange(body, objectName);
    if (!objectRange) throw new Error(`could not locate ${env}.${objectName}`);
    const objectText = body.slice(objectRange.start, objectRange.end);
    if (!fieldRe.test(objectText)) throw new Error(`could not locate ${env}.${objectName}.${field}`);
    const nextObjectText = objectText.replace(fieldRe, `$1"${value}"`);
    body = body.slice(0, objectRange.start) + nextObjectText + body.slice(objectRange.end);
  }
  return text.slice(0, envRange.start) + body + text.slice(envRange.end);
}

/**
 * Record that a custom domain is attached for one environment. The flag lives
 * in the profile because `scaffoldWranglerText` regenerates the whole env block
 * on every run — a `routes` key not derivable from the profile would be silently
 * stripped on the next provision.
 */
export function setProfileCustomDomain(text, env, value = true) {
  const envRange = findObjectRange(text, env);
  if (!envRange) throw new Error(`could not locate profile environment: ${env}`);
  let body = text.slice(envRange.start, envRange.end);

  const existingRe = /(["']customDomain["']\s*:\s*)(true|false)/;
  if (existingRe.test(body)) {
    body = body.replace(existingRe, `$1${value}`);
  } else {
    const apiHostRe = /(^[ \t]*["']apiHost["']\s*:\s*["'][^"']*["'],?[ \t]*$)/m;
    if (!apiHostRe.test(body)) throw new Error(`could not locate ${env}.apiHost to anchor customDomain`);
    body = body.replace(apiHostRe, (line) => {
      const indent = line.match(/^[ \t]*/)[0];
      const withComma = line.trimEnd().endsWith(',') ? line : `${line.trimEnd()},`;
      return `${withComma}\n${indent}"customDomain": ${value},`;
    });
  }
  return text.slice(0, envRange.start) + body + text.slice(envRange.end);
}

// ════════════════════════════════════════════════════════════════════════════
// Cloudflare API probes (no wrangler equivalent exists for these)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Call the Cloudflare REST API with the env token. Returns null when no token
 * is available — an OAuth `wrangler login` session exposes no bearer token, so
 * these probes degrade to a printed follow-up rather than failing the run.
 */
async function cfApi(path) {
  const token = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${CF_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.success ? body.result : null;
  } catch {
    return null;
  }
}

/** The account's workers.dev subdomain, or null when undeterminable. */
async function resolveWorkersSubdomain() {
  const result = await cfApi(`/accounts/${accountId()}/workers/subdomain`);
  return result?.subdomain || null;
}

/** The zone whose name is the longest matching suffix of `host`, or null. */
async function findZoneForHost(host) {
  const zones = await cfApi(`/zones?account.id=${accountId()}&per_page=50`);
  if (!Array.isArray(zones)) return null;
  const matches = zones.filter((z) => z.name && (host === z.name || host.endsWith(`.${z.name}`)));
  matches.sort((a, b) => b.name.length - a.name.length);
  return matches[0] || null;
}

// ════════════════════════════════════════════════════════════════════════════
// Steps: data-plane resources (unchanged behaviour)
// ════════════════════════════════════════════════════════════════════════════

function listD1(name) {
  const result = runCommand(wranglerArgv('api', 'd1', 'list', '--json'));
  return findJsonResource(parseJsonOutput(result.stdout || result.output), name, ['uuid', 'id']);
}

function listKv(names) {
  const result = runCommand(wranglerArgv('api', 'kv', 'namespace', 'list'));
  const parsed = parseJsonOutput(result.stdout);
  for (const name of names) {
    const existing = findJsonResource(parsed, name, ['id', 'namespace_id', 'namespaceId']);
    if (existing) return existing;
  }
  return findTextResource(result.output, names);
}

function listR2(name) {
  const result = runCommand(wranglerArgv('api', 'r2', 'bucket', 'list'));
  return hasJsonResource(parseJsonOutput(result.stdout), name) || Boolean(
    String(result.output).split(/\r?\n/).some((line) => {
      const trimmed = line.trim();
      return trimmed === name || trimmed.replace(/^name:\s*/, '') === name;
    }),
  );
}

function listPages(name) {
  const result = runCommand(wranglerArgv('web', 'pages', 'project', 'list', '--json'));
  return hasJsonResource(parseJsonOutput(result.stdout || result.output), name);
}

function ensureD1(profileEnv) {
  if (!isPlaceholder(profileEnv.d1?.id)) return profileEnv.d1.id;

  const existing = listD1(profileEnv.d1.name);
  if (existing) {
    log.ok(`D1 ${profileEnv.d1.name} already exists`);
    return existing;
  }

  const created = runCommand(wranglerArgv('api', 'd1', 'create', profileEnv.d1.name));
  const id = resourceId(created.output) || listD1(profileEnv.d1.name);
  if (!id) throw new Error(`could not determine the ID of D1 ${profileEnv.d1.name}`);
  log.ok(`D1 ${profileEnv.d1.name} provisioned`);
  return id;
}

function ensureKv(label, env, profileEnv) {
  if (!isPlaceholder(profileEnv.kv?.id)) return profileEnv.kv.id;

  const namespace = kvNamespaceName(label, env);
  const existing = listKv([namespace]);
  if (existing) {
    log.ok(`KV ${namespace} already exists`);
    return existing;
  }

  const created = runCommand(wranglerArgv('api', 'kv', 'namespace', 'create', namespace));
  const id = resourceId(created.output) || listKv([namespace]);
  if (!id) throw new Error(`could not determine the ID of KV ${namespace}`);
  log.ok(`KV ${namespace} provisioned`);
  return id;
}

function ensureR2(profileEnv) {
  const bucket = profileEnv.r2.bucket;
  if (listR2(bucket)) {
    log.ok(`R2 ${bucket} already exists`);
    return;
  }
  runCommand(wranglerArgv('api', 'r2', 'bucket', 'create', bucket));
  log.ok(`R2 ${bucket} provisioned`);
}

function ensurePages(profileEnv, env) {
  const project = profileEnv.pagesProject;
  if (listPages(project)) {
    log.ok(`Pages ${project} already exists`);
    return;
  }
  runCommand(wranglerArgv(
    'web', 'pages', 'project', 'create', project,
    '--production-branch', pagesProductionBranch(env),
  ));
  log.ok(`Pages ${project} provisioned`);
}

// ════════════════════════════════════════════════════════════════════════════
// Steps: backend
// ════════════════════════════════════════════════════════════════════════════

/** Do the bucket's current CORS origins already match the derived set? */
function corsMatches(output, rules) {
  const parsed = parseJsonOutput(output);
  const current = parsed?.rules ?? parsed;
  if (!Array.isArray(current)) return false;
  const flatten = (list) => list
    .flatMap((r) => r?.allowed?.origins ?? [])
    .map(String)
    .sort()
    .join(',');
  return flatten(current) === flatten(rules);
}

/**
 * Apply the derived CORS rules to the label's bucket.
 *
 * `cors set` replaces the whole configuration, so re-applying is a no-op in
 * effect; the `cors list` pre-check only saves the write and gives an honest
 * "already correct" line.
 */
function ensureR2Cors(profile, env) {
  const profileEnv = profile.environments[env];
  const bucket = profileEnv.r2.bucket;
  const rules = deriveCorsRules(profile, env);

  const current = runCommand(
    wranglerArgv('api', 'r2', 'bucket', 'cors', 'list', bucket),
    { allowFailure: true },
  );
  if (current.status === 0 && corsMatches(current.stdout, rules)) {
    log.ok(`R2 CORS for ${bucket} already correct`);
    return;
  }

  const file = corsFilePath(profile.label, env);
  writeFileSync(file, renderCorsFile(rules), { mode: 0o600 });
  try {
    runCommand(wranglerArgv('api', 'r2', 'bucket', 'cors', 'set', bucket, '--file', file, '-y'));
  } finally {
    rmSync(file, { force: true });
  }
  log.ok(`R2 CORS applied to ${bucket} (${rules[0].allowed.origins.length} origin(s))`);
}

/** A 32-byte random secret, hex-encoded — the same shape scripts/setup-local.sh generates. */
export function generateSecretValue(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

/**
 * Secret NAMES set on a Worker env, or null when they cannot be determined.
 *
 * null is deliberately distinct from []: a failed list must never be read as
 * "absent", or a re-run would overwrite a perfectly good JWT_SECRET.
 */
function listSecretNames(wranglerEnv) {
  const res = runCommand(
    wranglerArgv('api', 'secret', 'list', '--env', wranglerEnv, '--format', 'json'),
    { allowFailure: true },
  );
  if (res.status !== 0) return null;
  const parsed = parseJsonOutput(res.stdout);
  if (!Array.isArray(parsed)) return null;
  return parsed.map((s) => s?.name).filter(Boolean);
}

/**
 * Hand a secret value to wrangler over stdin.
 *
 * Deliberately not routed through `runCommand`: that helper echoes the command
 * line and interpolates captured output into its error message. Nothing here
 * may carry the value.
 */
function putSecret(wranglerEnv, name, value) {
  const argv = wranglerArgv('api', 'secret', 'put', name, '--env', wranglerEnv);
  log.cmd(`${renderCommand(argv)}   # value generated, read from stdin`);
  const res = spawnSync(argv[0], argv.slice(1), {
    cwd: ROOT,
    input: `${value}\n`,
    encoding: 'utf8',
    env: childEnv(),
  });
  if (res.status !== 0) {
    throw new Error(`failed to set ${name} for env.${wranglerEnv} (exit ${res.status ?? 'signal'})`);
  }
}

/**
 * Generate and set JWT_SECRET when the Worker env does not already have one.
 *
 * The value is per label AND per env by construction — `<label>` and
 * `<label>-staging` are two different Workers with two different secret lists,
 * so no two tenants can share a signing key. That matters: a shared JWT_SECRET
 * means an access token minted for tenant A verifies on tenant B.
 *
 * `wrangler secret put` creates a draft Worker when none exists, so this may
 * (and should) run before the first deploy.
 */
function ensureWorkerSecrets(wranglerEnv) {
  const names = listSecretNames(wranglerEnv);
  if (names === null) {
    log.warn(`Could not list secrets for env.${wranglerEnv} — skipping JWT_SECRET rather than risk overwriting one.`);
    log.hint(`Check it by hand: pnpm --filter api exec wrangler secret list --env ${wranglerEnv} --format json`);
    return;
  }
  if (names.includes('JWT_SECRET')) {
    log.ok(`JWT_SECRET already set for env.${wranglerEnv}`);
    return;
  }
  putSecret(wranglerEnv, 'JWT_SECRET', generateSecretValue());
  log.ok(`JWT_SECRET generated and set for env.${wranglerEnv} (32 random bytes)`);
}

/**
 * Report — never write — the secrets whose values come from outside the system.
 * A missing one is a warning here (this is bootstrap: the values come from
 * outside and cannot exist yet), but it is NOT harmless.
 *
 * JWT_SECRET is not the only load-bearing one. `buildContainer()` constructs
 * R2StorageAdapter eagerly on every request, and its constructor throws when
 * R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are absent — so a Worker provisioned
 * without them answers 500 on EVERY route, not just the media ones. Treat the
 * warnings below as release-blocking follow-ups, not optional polish.
 */
function reportExternalSecrets(profile, env, wranglerEnv) {
  const schema = parseJsonc(readFileSync(PATHS.schema, 'utf8'));
  const section = schema['api-secrets'] || {};
  const mailDriver = profile.environments[env].mail?.driver;
  const names = listSecretNames(wranglerEnv);

  if (names === null) {
    log.warn(`Could not list secrets for env.${wranglerEnv} — external secret status unknown.`);
    return;
  }

  for (const [name, spec] of Object.entries(section)) {
    if (name === 'JWT_SECRET') continue;
    if (!spec.required && !requiredWhenActive(spec.requiredWhen, { MAIL_DRIVER: mailDriver })) continue;
    if (names.includes(name)) {
      log.ok(`${name} set for env.${wranglerEnv}`);
    } else {
      log.warn(`${name} not set for env.${wranglerEnv}`);
      log.hint(`bash ${PATHS.createSecrets} ${name} --env ${wranglerEnv}`);
    }
  }
}

/**
 * Bring the Worker into existence by running the real deploy CLI.
 *
 * Spawned, not imported: deploy.mjs calls process.exit() on its failure paths
 * and is written as an entrypoint, not a library. Going through it (rather than
 * calling `wrangler deploy` here) keeps a single release code path and inherits
 * its fail-closed preflight, the no-dev-seed guard, and — crucially — the
 * `migrate` step that runs before `deploy-worker`.
 *
 * `--yes` is safe here only because provisionEnvironment() already passed
 * confirmProduction() before reaching a production environment.
 *
 * `--skip-secret-check` is the bootstrap exemption: the deploy CLI hard-gaps on
 * a missing `api-secrets` entry, but at first provisioning the externally-valued
 * secrets legitimately do not exist yet — this run is what creates the Worker
 * they will be attached to. reportExternalSecrets() below names every one that
 * is still missing. Regular deploys do NOT pass this flag and do hard-gap.
 */
function ensureWorker(label, env) {
  const argv = ['node', 'scripts/cloudflare/deploy.mjs',
    '--label', label, '-e', env, '--scope', 'api', '--yes', '--skip-secret-check'];
  log.cmd(renderCommand(argv));
  const res = spawnSync(process.execPath, argv.slice(1), {
    cwd: ROOT,
    stdio: 'inherit',
    env: childEnv(),
  });
  if (res.status !== 0) {
    throw new Error(`initial Worker deploy failed for ${label}/${env} (exit ${res.status ?? 'signal'})`);
  }
  log.ok(`Worker deployed for ${label}/${env}`);
}

/**
 * Attach the apiHost custom domain when its zone is already in the account.
 *
 * Opt-in and fail-soft by design: the fallback (keep the workers.dev host and
 * print a follow-up) is the path every default run exercises, so it is the
 * well-tested one.
 */
async function ensureCustomDomain(state, env) {
  const profileEnv = state.profile.environments[env];
  const host = profileEnv.apiHost;
  const wEnv = wranglerEnvName(state.profile.label, env);

  if (isPlaceholder(host)) {
    log.warn(`apiHost is still a placeholder for ${env} — cannot attach a custom domain.`);
    return;
  }
  if (host.endsWith('.workers.dev')) {
    log.warn(`apiHost ${host} is a workers.dev host — nothing to attach.`);
    log.hint('Set a real apiHost in the profile first, then re-run with --with-domain.');
    return;
  }

  const zone = await findZoneForHost(host);
  if (!zone) {
    log.warn(`No Cloudflare zone in this account matches ${host} — skipping custom domain.`);
    log.hint(`Add the zone in the dashboard and delegate its nameservers, then re-run with --with-domain.`);
    return;
  }
  if (zone.status && zone.status !== 'active') {
    log.warn(`Zone ${zone.name} is "${zone.status}", not active — skipping custom domain.`);
    log.hint('Complete the nameserver delegation, then re-run with --with-domain.');
    return;
  }

  try {
    runCommand(wranglerArgv('api', 'deploy', '--env', wEnv, '--domain', host));
  } catch (error) {
    log.warn(`Could not attach ${host}: ${error.message.split('\n')[0]}`);
    log.hint('Attach it by hand: Workers → the Worker → Settings → Domains & Routes.');
    return;
  }

  state.text = setProfileCustomDomain(state.text, env, true);
  state.profile = parseJsonc(state.text);
  writeProfileAndWrangler(state, state.profile);
  log.ok(`Custom domain ${host} attached and recorded in the profile`);
  log.warn(`apiHost is now ${host} — re-register the Google redirect URI or OAuth login will fail silently.`);
  log.hint(`https://${host}/auth/google/callback`);
}

// ════════════════════════════════════════════════════════════════════════════
// Orchestration
// ════════════════════════════════════════════════════════════════════════════

function writeProfileAndWrangler(state, profile) {
  writeFileSync(state.path, state.text);
  const wranglerText = readFileSync(PATHS.wrangler, 'utf8');
  writeFileSync(PATHS.wrangler, scaffoldWranglerText(wranglerText, profile.label, profile));
}

/**
 * Resolve the account workers.dev subdomain and substitute it into a
 * placeholder apiHost. An operator-chosen host (api.budo.app) is never touched.
 */
async function resolveApiHost(profile, env) {
  const e = profile.environments[env];
  if (!isPlaceholder(e.apiHost)) return null;

  const subdomain = await resolveWorkersSubdomain();
  if (!subdomain) {
    log.warn(`Could not resolve the account workers.dev subdomain — apiHost keeps its placeholder for ${env}.`);
    log.hint('Set CF_API_TOKEN (an OAuth session carries no bearer token), or edit apiHost by hand.');
    return null;
  }
  const host = workersDevHost(e.worker, subdomain);
  log.ok(`apiHost for ${env} resolved to ${host}`);
  log.warn('apiHost changed — register the Google redirect URI for the new host before enabling OAuth login.');
  log.hint(`https://${host}/auth/google/callback`);
  return host;
}

function printManualFollowups(profile, environments) {
  log.heading('Manual follow-up items');
  for (const env of environments) {
    const e = profile.environments[env];
    const wranglerEnv = wranglerEnvName(profile.label, env);
    log.info(`${env}: ${e.apiHost}`);
    log.hint(`Register the Google redirect: https://${e.apiHost}/auth/google/callback`);
    log.hint(`Set GOOGLE_CLIENT_ID in env.${wranglerEnv}.vars`);
    if (!e.customDomain) log.hint(`Attach DNS/custom domains for ${e.apiHost} and ${e.webOrigin}`);
    else log.hint(`Attach the Pages custom domain for ${e.webOrigin} (separate from the Worker domain)`);
    if (e.mail?.driver === 'resend') log.hint(`Verify the Resend sender domain used by ${e.mail.from}`);
  }
}

function printPlan(profile, env, options) {
  log.info(`${env} plan`);
  for (const step of buildProvisionPlan(profile, env, options)) {
    log.ok(step.title);
    for (const argv of step.commands) log.cmd(renderCommand(argv));
    if (step.note) log.hint(step.note);
  }
}

async function provisionEnvironment(state, env, options) {
  const { withDomain, only } = options;
  const label = state.profile.label;
  const wEnv = wranglerEnvName(label, env);
  const plan = buildProvisionPlan(state.profile, env, options);
  const has = (id) => plan.some((step) => step.id === id);

  log.heading(`Provision ${label} → ${env}${only === 'all' ? '' : `  [only: ${only}]`}`);

  if (has('d1') || has('kv') || has('r2') || has('subdomain') || has('profile')) {
    const e = state.profile.environments[env];
    const d1Id = ensureD1(e);
    const kvId = ensureKv(label, env, e);
    ensureR2(e);

    const apiHost = await resolveApiHost(state.profile, env);
    const s3Endpoint = isPlaceholder(e.r2.s3Endpoint)
      ? `https://${accountId()}.r2.cloudflarestorage.com`
      : e.r2.s3Endpoint;

    state.text = updateProfileResourceIds(state.text, env, { d1Id, kvId, s3Endpoint, apiHost });
    state.profile = parseJsonc(state.text);
    writeProfileAndWrangler(state, state.profile);
    log.ok(`Profile and wrangler.jsonc updated for ${env}`);
  }

  if (has('cors')) ensureR2Cors(state.profile, env);
  if (has('pages')) ensurePages(state.profile.environments[env], env);
  if (has('secrets')) ensureWorkerSecrets(wEnv);
  if (has('worker')) ensureWorker(label, env);
  if (has('domain') && withDomain) await ensureCustomDomain(state, env);
  if (has('secrets') || has('worker')) reportExternalSecrets(state.profile, env, wEnv);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { usage(); return 0; }
  const state = loadProfile(args.label);
  const options = { withDomain: args.withDomain, only: args.only };

  // A full run is a bring-up: staging first, then production behind its gate.
  // A `--only` run is a targeted repair of ONE environment, so `--production`
  // there means production *instead of* staging — otherwise `make r2-cors-prod`
  // would quietly rewrite staging too, against the Makefile's naming rule.
  const environments = args.only === 'all'
    ? (args.production ? ['staging', 'production'] : ['staging'])
    : (args.production ? ['production'] : ['staging']);

  if (args.dryRun) {
    log.heading(`Dry run: ${args.label}`);
    for (const env of environments) printPlan(state.profile, env, options);
    log.info('Nothing was executed and no file was changed.');
    return 0;
  }

  accountId();

  for (const env of environments) {
    if (env === 'production') {
      await confirmProduction({ env, label: args.label, yes: args.yes });
    }
    await provisionEnvironment(state, env, options);
  }

  printManualFollowups(state.profile, environments);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    log.fail(error.message);
    process.exitCode = 1;
  });
}
