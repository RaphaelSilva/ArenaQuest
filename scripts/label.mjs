#!/usr/bin/env node
/**
 * label.mjs — white-label environment bring-up assistant (RFC 0007).
 *
 * Subcommands:
 *   new <label>                       Write a config/labels/<label>.jsonc skeleton.
 *   scaffold <label> [--out <path>]   Generate the wrangler env block (+ printed
 *                                     workflow stanza & provisioning commands).
 *   check <label> --env <env>         Grouped preflight checklist for a label.
 *   check --schema                    Drift-guard: schema keys ⊆ *.example files.
 *
 * Design: the derivation/validation logic is a set of PURE, exported
 * functions (no I/O, no network, no `wrangler`), unit-tested directly by
 * scripts/label.test.mjs. The side-effecting CLI dispatch lives at the
 * bottom and only runs when the file is executed directly.
 *
 * Hard rules honoured here:
 *   - stdlib only, zero dependencies; JSONC parsed by a local stripper.
 *   - Secret hygiene: secret VALUES are never read, logged, compared or
 *     printed. Only `wrangler secret list` (names) is used for presence.
 *   - Missing credentials / failed `wrangler` call → ⚠️ skipped, never ✅.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename)); // repo root (scripts/..)

// ── Paths ─────────────────────────────────────────────────────────────────────
export const PATHS = {
  schema: join(ROOT, 'config', 'deployment.schema.jsonc'),
  labelsDir: join(ROOT, 'config', 'labels'),
  wrangler: join(ROOT, 'apps', 'api', 'wrangler.jsonc'),
  devVarsExample: join(ROOT, 'apps', 'api', '.dev.vars.example'),
  webEnvExample: join(ROOT, 'apps', 'web', '.env.example'),
  createSecrets: 'scripts/create-secrets.sh',
};

// ════════════════════════════════════════════════════════════════════════════
// PURE: JSONC parsing
// ════════════════════════════════════════════════════════════════════════════

/**
 * Strip `//` line comments, block comments and trailing commas from a JSONC
 * string while preserving the contents of string literals. Node's JSON.parse
 * does not accept JSONC, so we normalise to JSON first.
 */
export function stripJsonc(text) {
  let out = '';
  let inString = false;
  let quote = '';
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLine) {
      if (ch === '\n') { inLine = false; out += ch; }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') { inBlock = false; i++; }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') { out += next; i++; continue; }
      if (ch === quote) { inString = false; }
      continue;
    }
    // not in string/comment
    if (ch === '"' || ch === "'") { inString = true; quote = ch; out += ch; continue; }
    if (ch === '/' && next === '/') { inLine = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
    out += ch;
  }

  // Drop trailing commas: a comma followed by only whitespace before } or ].
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return out;
}

export function parseJsonc(text) {
  return JSON.parse(stripJsonc(text));
}

function readJsonc(path) {
  return parseJsonc(readFileSync(path, 'utf8'));
}

// ════════════════════════════════════════════════════════════════════════════
// PURE: derivation & validation
// ════════════════════════════════════════════════════════════════════════════

/**
 * Derive the cross-referencing config from a profile environment's two
 * anchors (`apiHost`, `webOrigin`) plus its `r2` block. These are coherent
 * by construction; `checkCoherence` re-derives and diffs them.
 */
export function deriveExpected(profile, env) {
  const e = profile.environments?.[env];
  if (!e) throw new Error(`profile has no environment "${env}"`);
  const apiHost = e.apiHost;
  const webOrigin = e.webOrigin;
  const allowedOrigins = env === 'production'
    ? `https://${webOrigin}`
    : `https://${webOrigin},https://*.${webOrigin},http://localhost:3000`;
  return {
    NEXT_PUBLIC_API_URL: `https://${apiHost}`,
    GOOGLE_REDIRECT_URI: `https://${apiHost}/auth/google/callback`,
    WEB_BASE_URL: `https://${webOrigin}`,
    ALLOWED_ORIGINS: allowedOrigins,
    R2_S3_ENDPOINT: e.r2?.s3Endpoint ?? '',
    R2_BUCKET_NAME: e.r2?.bucket ?? '',
    R2_PUBLIC_BASE: e.r2?.publicBase ?? '',
  };
}

/**
 * Build the resolved config map for an environment (build + api-vars),
 * combining brand values, derived anchors, non-derived profile fields, and
 * — when an env.<label> block already exists in wrangler.jsonc — its `vars`
 * as the source of truth (so coherence can diff a hand edit against the
 * derived expectation).
 */
export function buildResolved(profile, env, expected, wranglerVars = null) {
  const e = profile.environments[env];
  const resolved = {};
  Object.assign(resolved, profile.brand || {});
  Object.assign(resolved, expected);
  resolved.COOKIE_SAMESITE = e.cookieSameSite ?? '';
  if (e.mail) {
    resolved.MAIL_DRIVER = e.mail.driver ?? '';
    resolved.MAIL_FROM = e.mail.from ?? '';
  }
  // GOOGLE_CLIENT_ID has no profile/derived source — only the committed
  // env.<label> block can provide it.
  if (wranglerVars) Object.assign(resolved, wranglerVars);
  return resolved;
}

/** Is a `requiredWhen` condition (e.g. "MAIL_DRIVER=resend") active? */
export function requiredWhenActive(condition, resolved) {
  if (!condition) return false;
  const idx = condition.indexOf('=');
  if (idx === -1) return false;
  const key = condition.slice(0, idx).trim();
  const val = condition.slice(idx + 1).trim();
  return String(resolved[key] ?? '') === val;
}

function isActive(spec, resolved) {
  return Boolean(spec.required) || requiredWhenActive(spec.requiredWhen, resolved);
}

/** Names of required (or actively requiredWhen) keys missing from `resolved`. */
export function checkPresence(schemaSection, resolved) {
  const missing = [];
  for (const [key, spec] of Object.entries(schemaSection)) {
    if (!isActive(spec, resolved)) continue;
    const v = resolved[key];
    if (v === undefined || v === null || String(v).trim() === '') missing.push(key);
  }
  return missing;
}

/**
 * Derive-and-diff coherence: for every derived key present in both maps,
 * report a named mismatch. Optional keys whose expectation is empty are
 * skipped (e.g. R2_PUBLIC_BASE).
 */
export function checkCoherence(expected, actual) {
  const mismatches = [];
  for (const [key, want] of Object.entries(expected)) {
    if (want === '' || want === undefined) continue;
    if (actual[key] === undefined) continue; // absence handled by presence
    if (actual[key] !== want) {
      mismatches.push({ key, expected: want, actual: actual[key] });
    }
  }
  return mismatches;
}

/**
 * `no-wildcard-in-prod-staging`: production is exact-origin only; staging may
 * carry exactly one single-label preview wildcard (`https://*.<host>`).
 * A full `*` or a multi-label wildcard is always a violation.
 */
export function checkPolicy(allowedOrigins, env) {
  const violations = [];
  const origins = String(allowedOrigins || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const o of origins) {
    if (o === '*') {
      violations.push({ origin: o, reason: 'full wildcard "*" is forbidden' });
      continue;
    }
    if (!o.includes('*')) continue;
    if (env === 'production') {
      violations.push({ origin: o, reason: 'wildcard not allowed in production (exact-origin only)' });
      continue;
    }
    // staging: only a single leading-label wildcard is allowed.
    const host = o.replace(/^https?:\/\//, '');
    const stars = (o.match(/\*/g) || []).length;
    const singleLeadingLabel = stars === 1 && /^\*\.[^*]+$/.test(host);
    if (!singleLeadingLabel) {
      violations.push({ origin: o, reason: 'multi-label or malformed wildcard' });
    }
  }
  return violations;
}

/**
 * Map a flat list of result items to a process exit code:
 *   0 — all present, coherent and policy-compliant.
 *   1 — any hard gap (missing | incoherent | policy violation).
 *   2 — only soft items outstanding (manual confirmations / skipped checks).
 */
export function mapExitCode(results) {
  if (results.some((r) => r.status === 'fail')) return 1;
  if (results.some((r) => r.status === 'manual' || r.status === 'skip')) return 2;
  return 0;
}

const ICON = { pass: '✅', fail: '❌', skip: '⚠️', manual: '⚠️' };
const GROUP_ORDER = ['build', 'api-vars', 'api-secrets', 'cf-resources', 'external'];

/** Render the grouped checklist. Never emits a secret value — name + state only. */
export function formatChecklist(label, env, displayName, results) {
  const lines = [];
  lines.push(`${displayName || label} — ${env}`);
  for (const group of GROUP_ORDER) {
    const items = results.filter((r) => r.group === group);
    if (items.length === 0) continue;
    lines.push(`  ${group}`);
    for (const it of items) {
      const icon = ICON[it.status] || '•';
      lines.push(`    ${icon} ${it.key.padEnd(22)} ${it.detail || ''}`.trimEnd());
      if (it.fix) lines.push(`        → ${it.fix}`);
    }
  }
  const fails = results.filter((r) => r.status === 'fail').length;
  const manual = results.filter((r) => r.status === 'manual').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const exit = mapExitCode(results);
  lines.push('');
  lines.push(
    `Summary: ${fails} hard gap(s), ${manual} manual confirmation(s), ` +
      `${skipped} skipped (no creds).  Exit ${exit}.`,
  );
  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// PURE: scaffolding text generation
// ════════════════════════════════════════════════════════════════════════════

function buildEnvBlockObject(profile, env, expected) {
  const e = profile.environments[env];
  return {
    name: e.worker,
    d1_databases: [
      { binding: 'DB', database_name: e.d1.name, database_id: e.d1.id, migrations_dir: 'migrations' },
    ],
    kv_namespaces: [{ binding: e.kv?.binding || 'RATE_LIMIT_KV', id: e.kv?.id }],
    r2_buckets: [{ binding: 'R2', bucket_name: e.r2.bucket }],
    vars: {
      ALLOWED_ORIGINS: expected.ALLOWED_ORIGINS,
      COOKIE_SAMESITE: e.cookieSameSite,
      R2_S3_ENDPOINT: expected.R2_S3_ENDPOINT,
      R2_PUBLIC_BASE: expected.R2_PUBLIC_BASE,
      R2_BUCKET_NAME: expected.R2_BUCKET_NAME,
      MAIL_DRIVER: e.mail?.driver ?? '',
      MAIL_FROM: e.mail?.from ?? '',
      WEB_BASE_URL: expected.WEB_BASE_URL,
      GOOGLE_REDIRECT_URI: expected.GOOGLE_REDIRECT_URI,
      GOOGLE_CLIENT_ID: e.googleClientId || '<fill: Google OAuth client id (not a secret)>',
    },
    observability: { enabled: true, logs: { enabled: true } },
  };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function indent(text, pad) {
  return text
    .split('\n')
    .map((l) => (l.length ? pad + l : l))
    .join('\n');
}

/**
 * Idempotently insert/replace the label's generated env entries inside the
 * `"env": { … }` object of a wrangler.jsonc TEXT, between clear delimiters.
 * Existing (ArenaQuest) blocks are never touched. Pure: returns new text.
 */
export function scaffoldWranglerText(text, label, profile) {
  const startMark = `// >>> label:${label} (generated) >>>`;
  const endMark = `// <<< label:${label} <<<`;

  // 1. Remove any previous generated block for this label.
  const removeRe = new RegExp(
    `[ \\t]*${escapeRegExp(startMark)}[\\s\\S]*?${escapeRegExp(endMark)}\\n?`,
    'g',
  );
  let next = text.replace(removeRe, '');

  // 2. Build the JSON fragment for staging + production.
  const entries = {
    [`${label}-staging`]: buildEnvBlockObject(profile, 'staging', deriveExpected(profile, 'staging')),
    [label]: buildEnvBlockObject(profile, 'production', deriveExpected(profile, 'production')),
  };
  const body = Object.entries(entries)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v, null, 2)},`)
    .join('\n');
  const pad = '\t\t';
  const fragment =
    `\n${indent(startMark, pad)}\n` +
    `${indent(body, pad)}\n` +
    `${indent(endMark, pad)}`;

  // 3. Insert right after the `"env": {` opening brace.
  const envOpenRe = /("env"\s*:\s*\{)/;
  if (!envOpenRe.test(next)) {
    throw new Error('could not locate the "env" object in the wrangler config');
  }
  next = next.replace(envOpenRe, `$1${fragment}`);
  return next;
}

/** The provisioning command list a maintainer runs by hand (printed, never run). */
export function provisioningCommands(profile, schema, env) {
  const e = profile.environments[env];
  const wEnv = env === 'production' ? profile.label : `${profile.label}-staging`;
  const lines = [];
  lines.push(`# Cloudflare resources for ${profile.label} (${env}) — run these, then paste ids into the profile`);
  lines.push(`wrangler d1 create ${e.d1.name}`);
  lines.push(`wrangler kv namespace create ${e.kv?.binding || 'RATE_LIMIT_KV'} --env ${wEnv}`);
  lines.push(`wrangler r2 bucket create ${e.r2.bucket}`);
  lines.push(`# Pages project: create "${e.pagesProject}" (dashboard) or: wrangler pages project create ${e.pagesProject}`);
  lines.push(`# Google OAuth: create a Web client and register the redirect URI:`);
  lines.push(`#   https://${e.apiHost}/auth/google/callback`);
  lines.push(`# Secrets (values entered interactively — never committed):`);
  for (const name of Object.keys(schema['api-secrets'] || {})) {
    const spec = schema['api-secrets'][name];
    if (!spec.required && !requiredWhenActive(spec.requiredWhen, { MAIL_DRIVER: e.mail?.driver })) continue;
    lines.push(`${PATHS.createSecrets} ${name} --env ${wEnv}`);
  }
  return lines.join('\n');
}

/** The per-label deploy-workflow build stanza (printed for the maintainer to paste). */
export function workflowStanza(profile, env) {
  const e = profile.environments[env];
  const b = profile.brand || {};
  return [
    `# --- ${profile.label} (${env}) — deploy-web.yml build env ---`,
    `NEXT_PUBLIC_API_URL: https://${e.apiHost}`,
    `NEXT_PUBLIC_BRAND_SIGLA: ${b.NEXT_PUBLIC_BRAND_SIGLA ?? ''}`,
    `NEXT_PUBLIC_BRAND_NAME_PREFIX: ${b.NEXT_PUBLIC_BRAND_NAME_PREFIX ?? ''}`,
    `NEXT_PUBLIC_BRAND_NAME_ACCENT: ${b.NEXT_PUBLIC_BRAND_NAME_ACCENT ?? ''}`,
    `NEXT_PUBLIC_BRAND_POWERED_BY: ${b.NEXT_PUBLIC_BRAND_POWERED_BY ?? ''}`,
    `NEXT_PUBLIC_BRAND_ACCENT: ${b.NEXT_PUBLIC_BRAND_ACCENT ?? ''}`,
    `# Pages project: --project-name=${e.pagesProject}`,
    `# deploy-api.yml: wrangler deploy --env ${env === 'production' ? profile.label : profile.label + '-staging'}`,
  ].join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// SIDE-EFFECTING: loaders & wrangler probes (CLI only)
// ════════════════════════════════════════════════════════════════════════════

function loadSchema() {
  return readJsonc(PATHS.schema);
}

function profilePath(label) {
  return join(PATHS.labelsDir, `${label}.jsonc`);
}

function loadProfile(label) {
  const p = profilePath(label);
  if (!existsSync(p)) throw new Error(`profile not found: config/labels/${label}.jsonc (run: make label-new LABEL=${label})`);
  return readJsonc(p);
}

function wranglerEnvName(label, env) {
  return env === 'production' ? label : `${label}-staging`;
}

/** Return the `vars` object of an existing env.<name> block, or null. */
function readWranglerEnvVars(label, env) {
  if (!existsSync(PATHS.wrangler)) return null;
  let cfg;
  try {
    cfg = readJsonc(PATHS.wrangler);
  } catch {
    return null;
  }
  const block = cfg.env?.[wranglerEnvName(label, env)];
  return block?.vars ?? null;
}

/**
 * Run a read-only wrangler command in apps/api. Returns { ok, stdout }.
 * Never throws; any failure (missing binary, not logged in, non-zero exit)
 * yields ok:false so the caller reports ⚠️ skipped — never a false ✅.
 */
function runWrangler(args) {
  try {
    const res = spawnSync('npx', ['wrangler', ...args], {
      cwd: join(ROOT, 'apps', 'api'),
      encoding: 'utf8',
      timeout: 60000,
    });
    if (res.error || res.status !== 0) return { ok: false, stdout: '' };
    return { ok: true, stdout: res.stdout || '' };
  } catch {
    return { ok: false, stdout: '' };
  }
}

/**
 * Secret NAMES present for an env (presence only — values never requested).
 * Returns { ok, names }. ok:false → creds/command unavailable → skip.
 */
function listSecretNames(label, env) {
  const wEnv = wranglerEnvName(label, env);
  const res = runWrangler(['secret', 'list', '--env', wEnv, '--json']);
  if (!res.ok) return { ok: false, names: [] };
  try {
    const arr = JSON.parse(res.stdout);
    return { ok: true, names: arr.map((s) => s.name).filter(Boolean) };
  } catch {
    return { ok: false, names: [] };
  }
}

function resourceList(kind) {
  const map = {
    d1: ['d1', 'list', '--json'],
    kv: ['kv', 'namespace', 'list'],
    r2: ['r2', 'bucket', 'list'],
    pagesProject: ['pages', 'project', 'list'],
  };
  const args = map[kind];
  if (!args) return { ok: false, stdout: '' };
  return runWrangler(args);
}

// ════════════════════════════════════════════════════════════════════════════
// SIDE-EFFECTING: subcommands
// ════════════════════════════════════════════════════════════════════════════

function cmdCheck(label, env) {
  const schema = loadSchema();
  const profile = loadProfile(label);
  if (!profile.environments?.[env]) {
    console.error(`Error: profile "${label}" has no "${env}" environment.`);
    return 1;
  }
  const e = profile.environments[env];
  const expected = deriveExpected(profile, env);
  const wranglerVars = readWranglerEnvVars(label, env);
  const resolved = buildResolved(profile, env, expected, wranglerVars);
  const wEnv = wranglerEnvName(label, env);
  const results = [];

  // ── build keys (brand + NEXT_PUBLIC_API_URL) ──────────────────────────────
  for (const [key, spec] of Object.entries(schema.build)) {
    if (!isActive(spec, resolved)) continue;
    const v = resolved[key];
    if (v === undefined || String(v).trim() === '') {
      results.push({ group: 'build', key, status: 'fail', detail: 'missing build value', fix: `set ${key} in the profile brand block / deploy stanza` });
    } else {
      results.push({ group: 'build', key, status: 'pass', detail: spec.derivedFrom ? `derived from ${spec.derivedFrom}` : 'from brand' });
    }
  }

  // ── api-vars: presence + coherence + policy ───────────────────────────────
  const coherence = checkCoherence(expected, resolved);
  const coherentKeys = new Set(coherence.map((m) => m.key));
  for (const [key, spec] of Object.entries(schema['api-vars'])) {
    if (!isActive(spec, resolved)) continue;
    const v = resolved[key];
    if (v === undefined || String(v).trim() === '') {
      const src = wranglerVars ? `env.${wEnv}.vars` : 'profile';
      results.push({ group: 'api-vars', key, status: 'fail', detail: `missing in ${src}`, fix: key === 'GOOGLE_CLIENT_ID' ? `add GOOGLE_CLIENT_ID to env.${wEnv}.vars (run: make label-scaffold LABEL=${label})` : `set ${key}` });
      continue;
    }
    if (coherentKeys.has(key)) {
      const m = coherence.find((x) => x.key === key);
      results.push({ group: 'api-vars', key, status: 'fail', detail: `incoherent: expected ${m.expected}`, fix: `re-scaffold to re-derive ${key} from anchors` });
      continue;
    }
    if (spec.policy === 'no-wildcard-in-prod-staging') {
      const violations = checkPolicy(v, env);
      if (violations.length) {
        results.push({ group: 'api-vars', key, status: 'fail', detail: `policy: ${violations[0].reason}`, fix: 'remove the wildcard origin (exact-origin only in staging/prod)' });
        continue;
      }
      results.push({ group: 'api-vars', key, status: 'pass', detail: 'coherent, policy ok' });
      continue;
    }
    results.push({ group: 'api-vars', key, status: 'pass', detail: spec.derivedFrom ? `coherent with ${spec.derivedFrom}` : 'present' });
  }

  // ── api-secrets: presence by NAME (values never read) ─────────────────────
  const secrets = listSecretNames(label, env);
  for (const [key, spec] of Object.entries(schema['api-secrets'])) {
    if (!isActive(spec, resolved)) continue;
    if (!secrets.ok) {
      results.push({ group: 'api-secrets', key, status: 'skip', detail: `skipped (no wrangler creds for --env ${wEnv})`, fix: `${PATHS.createSecrets} ${key} --env ${wEnv}` });
      continue;
    }
    if (secrets.names.includes(key)) {
      results.push({ group: 'api-secrets', key, status: 'pass', detail: 'set' });
    } else {
      results.push({ group: 'api-secrets', key, status: 'fail', detail: 'not set', fix: `${PATHS.createSecrets} ${key} --env ${wEnv}` });
    }
  }

  // ── cf-resources: presence by unique identifier (skip when creds absent) ──
  // Match each resource on its *label-unique* identifier: the concrete name
  // for worker/pages/d1/r2, and the namespace *id* for KV (the binding name
  // "RATE_LIMIT_KV" is shared across tenants and would false-green on a match).
  const isPlaceholder = (v) => !v || String(v).includes('<');
  const resourceTargets = [
    { key: 'worker', name: e.worker, kind: null, match: e.worker, create: `wrangler deploy --env ${wEnv}` },
    { key: 'pagesProject', name: e.pagesProject, kind: 'pagesProject', match: e.pagesProject, create: `wrangler pages project create ${e.pagesProject}` },
    { key: 'd1', name: e.d1?.name, kind: 'd1', match: e.d1?.name, create: `wrangler d1 create ${e.d1?.name}` },
    { key: 'kv', name: `${e.kv?.binding} (${e.kv?.id})`, kind: 'kv', match: e.kv?.id, create: `wrangler kv namespace create ${e.kv?.binding} --env ${wEnv}  (then paste the id into the profile)` },
    { key: 'r2', name: e.r2?.bucket, kind: 'r2', match: e.r2?.bucket, create: `wrangler r2 bucket create ${e.r2?.bucket}` },
  ];
  for (const t of resourceTargets) {
    const label0 = `${t.key} ${t.name}`;
    if (!t.kind) {
      results.push({ group: 'cf-resources', key: label0, status: 'skip', detail: 'skipped (verify after first deploy)', fix: t.create });
      continue;
    }
    if (isPlaceholder(t.match)) {
      results.push({ group: 'cf-resources', key: label0, status: 'fail', detail: 'id not set in profile (resource not created yet)', fix: t.create });
      continue;
    }
    const listed = resourceList(t.kind);
    if (!listed.ok) {
      results.push({ group: 'cf-resources', key: label0, status: 'skip', detail: 'skipped (no wrangler creds)', fix: t.create });
      continue;
    }
    if (listed.stdout.includes(t.match)) {
      results.push({ group: 'cf-resources', key: label0, status: 'pass', detail: 'exists' });
    } else {
      results.push({ group: 'cf-resources', key: label0, status: 'fail', detail: 'not found', fix: t.create });
    }
  }

  // ── external: manual confirmations carrying the exact value ───────────────
  for (const [key, spec] of Object.entries(schema.external)) {
    if (spec.requiredWhen && !requiredWhenActive(spec.requiredWhen, resolved)) continue;
    const detail = String(spec.confirm || '')
      .replace('<GOOGLE_REDIRECT_URI>', resolved.GOOGLE_REDIRECT_URI || '')
      .replace('<apiHost>', e.apiHost || '')
      .replace('<webOrigin>', e.webOrigin || '')
      .replace('<MAIL_FROM>', resolved.MAIL_FROM || '');
    results.push({ group: 'external', key, status: 'manual', detail });
  }

  console.log(formatChecklist(label, env, profile.displayName, results));
  return mapExitCode(results);
}

function cmdCheckSchema() {
  const schema = loadSchema();
  const devVars = readFileSync(PATHS.devVarsExample, 'utf8');
  const webEnv = readFileSync(PATHS.webEnvExample, 'utf8');
  const has = (text, key) => new RegExp(`^\\s*${escapeRegExp(key)}=`, 'm').test(text);

  const missing = [];
  // build (required) ⊆ apps/web/.env.example
  for (const [key, spec] of Object.entries(schema.build)) {
    if (!spec.required) continue;
    if (!has(webEnv, key)) missing.push({ key, file: 'apps/web/.env.example' });
  }
  // api-secrets (required) ⊆ apps/api/.dev.vars.example
  for (const [key, spec] of Object.entries(schema['api-secrets'])) {
    if (!spec.required) continue;
    if (!has(devVars, key)) missing.push({ key, file: 'apps/api/.dev.vars.example' });
  }
  // api-vars (required, .dev.vars surface = not the wrangler-only r2 vars)
  for (const [key, spec] of Object.entries(schema['api-vars'])) {
    if (!spec.required || spec.from === 'r2') continue;
    if (!has(devVars, key)) missing.push({ key, file: 'apps/api/.dev.vars.example' });
  }

  if (missing.length === 0) {
    console.log('check --schema: ✅ every required schema key is present in its *.example template.');
    return 0;
  }
  console.log('check --schema: ❌ required schema keys missing from templates:');
  for (const m of missing) console.log(`  - ${m.key}  (add to ${m.file})`);
  return 1;
}

function cmdNew(label) {
  const p = profilePath(label);
  if (existsSync(p)) {
    console.error(`Error: config/labels/${label}.jsonc already exists — refusing to clobber.`);
    return 1;
  }
  const skeleton = `/**
 * ${label} — label profile (RFC 0007). Edit the two anchors per environment
 * (apiHost, webOrigin) and the brand block; everything else is derived by
 * scripts/label.mjs. Paste resource ids after running the printed
 * \`wrangler … create\` commands (make label-scaffold LABEL=${label}).
 */
{
  "label": "${label}",
  "displayName": "<fill: display name>",
  "brand": {
    "NEXT_PUBLIC_BRAND_SIGLA": "<fill>",
    "NEXT_PUBLIC_BRAND_NAME_PREFIX": "<fill>",
    "NEXT_PUBLIC_BRAND_NAME_ACCENT": "<fill or empty>",
    "NEXT_PUBLIC_BRAND_POWERED_BY": "",
    "NEXT_PUBLIC_BRAND_ACCENT": ""
  },
  "environments": {
    "staging": {
      "apiHost":      "<fill: api host, e.g. api-${label}-staging.<acct>.workers.dev>",
      "webOrigin":    "<fill: web origin, e.g. ${label}-web-staging.pages.dev>",
      "worker":       "api-${label}-staging",
      "pagesProject": "${label}-web-staging",
      "d1":   { "name": "${label}-db-staging", "id": "<fill after create>" },
      "kv":   { "binding": "RATE_LIMIT_KV", "id": "<fill after create>" },
      "r2":   { "bucket": "${label}-media-staging", "s3Endpoint": "https://<acct>.r2.cloudflarestorage.com" },
      "cookieSameSite": "None",
      "mail": { "driver": "resend", "from": "<fill: Display Name <noreply@example.com>>" }
    },
    "production": {
      "apiHost":      "<fill: production api host>",
      "webOrigin":    "<fill: production web origin>",
      "worker":       "api-${label}",
      "pagesProject": "${label}-web",
      "d1":   { "name": "${label}-db", "id": "<fill after create>" },
      "kv":   { "binding": "RATE_LIMIT_KV", "id": "<fill after create>" },
      "r2":   { "bucket": "${label}-media", "s3Endpoint": "https://<acct>.r2.cloudflarestorage.com" },
      "cookieSameSite": "Strict",
      "mail": { "driver": "resend", "from": "<fill: Display Name <noreply@example.com>>" }
    }
  }
}
`;
  writeFileSync(p, skeleton);
  console.log(`Created config/labels/${label}.jsonc — edit the two anchors per env + the brand block, then: make label-scaffold LABEL=${label}`);
  return 0;
}

function cmdScaffold(label, outPath) {
  const schema = loadSchema();
  const profile = loadProfile(label);
  const target = outPath || PATHS.wrangler;
  if (!existsSync(target)) {
    console.error(`Error: wrangler target not found: ${target}`);
    return 1;
  }
  const before = readFileSync(target, 'utf8');
  const after = scaffoldWranglerText(before, label, profile);
  writeFileSync(target, after);
  console.log(`Wrote env.${label}-staging / env.${label} block to ${target} (delimited, idempotent).`);
  console.log('');
  console.log('── Deploy-workflow stanzas (paste into .github/workflows/* — not auto-written) ──');
  console.log(workflowStanza(profile, 'staging'));
  console.log('');
  console.log(workflowStanza(profile, 'production'));
  console.log('');
  console.log('── Provisioning commands (run by hand — nothing below is executed) ──');
  console.log(provisioningCommands(profile, schema, 'staging'));
  console.log('');
  console.log(provisioningCommands(profile, schema, 'production'));
  return 0;
}

// ════════════════════════════════════════════════════════════════════════════
// CLI dispatch
// ════════════════════════════════════════════════════════════════════════════

function getFlag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'new': {
      if (!rest[0]) { console.error('Usage: label.mjs new <label>'); return 1; }
      return cmdNew(rest[0]);
    }
    case 'scaffold': {
      if (!rest[0]) { console.error('Usage: label.mjs scaffold <label> [--out <path>]'); return 1; }
      return cmdScaffold(rest[0], getFlag(rest, '--out'));
    }
    case 'check': {
      if (rest.includes('--schema')) return cmdCheckSchema();
      if (!rest[0] || rest[0].startsWith('--')) { console.error('Usage: label.mjs check <label> --env <staging|production>'); return 1; }
      const env = getFlag(rest, '--env') || 'staging';
      if (env !== 'staging' && env !== 'production') { console.error('--env must be staging or production'); return 1; }
      return cmdCheck(rest[0], env);
    }
    default:
      console.error('Usage: label.mjs <new|scaffold|check> …');
      return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  let code = 1;
  try {
    code = main(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    code = 1;
  }
  process.exit(code);
}
