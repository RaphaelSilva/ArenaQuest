/**
 * scripts/deploy/core.mjs — the CLOUD-AGNOSTIC heart of the deploy CLI (RFC 0011).
 *
 * Resolves *what* to deploy for a `<label>/<env>`: it parses the CLI arguments,
 * loads and resolves the label profile through the existing pure resolvers in
 * `scripts/label.mjs`, runs a fail-closed preflight, and emits a
 * PROVIDER-NEUTRAL deploy plan (an ordered array of `{ kind, … }` steps with
 * neutral parameters). The provider adapter (e.g. `scripts/cloudflare/deploy.mjs`)
 * turns those step kinds into concrete commands.
 *
 * HARD INVARIANT (asserted by scripts/deploy/core.test.mjs): this module imports
 * NO `wrangler` and NO cloud SDK — the provider boundary is the module graph,
 * not an `if (cloud …)` branch. Everything here is stdlib-only Node plus the
 * pure, side-effect-free resolvers re-used from `label.mjs`.
 */

import { parseArgs as nodeParseArgs } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';

import {
  PATHS,
  parseJsonc,
  deriveExpected,
  buildResolved,
  checkPresence,
  checkCoherence,
  checkPolicy,
  mapExitCode,
} from '../label.mjs';

const ENVS = ['staging', 'production'];
const SCOPES = ['api', 'web', 'all'];

/**
 * Keys that are supplied only by the committed `env.<label>` block in
 * wrangler.jsonc and read directly by the deploy step — the deploy resolver
 * deliberately carries values from the profile only, so these are out of scope
 * for this preflight (their presence is the domain of `label check`).
 */
const DEPLOY_BLOCK_ONLY_VARS = new Set(['GOOGLE_CLIENT_ID']);

// ── argument parsing ──────────────────────────────────────────────────────────

/**
 * Parse the deploy CLI arguments into a normalised shape.
 * Rules: `--label` required; `-e|--env` ∈ {staging, production}; `--scope` ∈
 * {api, web, all} (default `all`); `--yes` and `--dry-run` booleans. Throws a
 * clear Error on any invalid or missing input.
 */
export function parseArgs(argv) {
  let parsed;
  try {
    parsed = nodeParseArgs({
      args: argv,
      options: {
        label: { type: 'string' },
        env: { type: 'string', short: 'e' },
        scope: { type: 'string' },
        yes: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
      },
      allowPositionals: false,
    });
  } catch (err) {
    throw new Error(`invalid arguments: ${err.message}`);
  }

  const { values } = parsed;

  const label = values.label;
  if (!label || String(label).trim() === '') {
    throw new Error('--label <label> is required');
  }

  const env = values.env;
  if (!ENVS.includes(env)) {
    const got = env === undefined ? 'nothing' : `"${env}"`;
    throw new Error(`-e/--env must be one of ${ENVS.join('|')} (got ${got})`);
  }

  const scope = values.scope ?? 'all';
  if (!SCOPES.includes(scope)) {
    throw new Error(`--scope must be one of ${SCOPES.join('|')} (got "${scope}")`);
  }

  return {
    label,
    env,
    scope,
    yes: Boolean(values.yes),
    dryRun: Boolean(values['dry-run']),
  };
}

// ── profile / schema loading ──────────────────────────────────────────────────

/** Load and parse `config/labels/<label>.jsonc`. Throws if the file is absent. */
export function loadProfile(label) {
  const path = join(PATHS.labelsDir, `${label}.jsonc`);
  if (!existsSync(path)) {
    throw new Error(`profile not found: config/labels/${label}.jsonc`);
  }
  return parseJsonc(readFileSync(path, 'utf8'));
}

/** Load and parse the shared deployment schema. */
export function loadSchema() {
  return parseJsonc(readFileSync(PATHS.schema, 'utf8'));
}

/**
 * Resolve every deploy value for `env` from the profile only (no wrangler read
 * at resolve time), using the pure resolvers from `label.mjs`.
 */
export function resolve(profile, env) {
  const expected = deriveExpected(profile, env);
  const resolved = buildResolved(profile, env, expected);
  const envConfig = profile.environments[env];
  return { expected, resolved, envConfig };
}

// ── preflight (fail closed) ───────────────────────────────────────────────────

/**
 * Fail-closed preflight: presence (build + api-vars), coherence and the
 * ALLOWED_ORIGINS wildcard policy. Returns a flat results array, the mapped
 * `exitCode` (1 = hard gap) and the list of offending keys. A hard gap must
 * abort before any mutation and the caller prints `failedKeys`.
 */
export function preflight(schema, resolved, expected, env) {
  const results = [];

  // presence — build section (brand tokens + NEXT_PUBLIC_API_URL)
  for (const key of checkPresence(schema.build, resolved)) {
    results.push({ status: 'fail', group: 'build', key, detail: `missing required build value: ${key}` });
  }

  // presence — api-vars, minus the deploy-block-only keys the resolver omits
  const apiVars = Object.fromEntries(
    Object.entries(schema['api-vars']).filter(([k]) => !DEPLOY_BLOCK_ONLY_VARS.has(k)),
  );
  for (const key of checkPresence(apiVars, resolved)) {
    results.push({ status: 'fail', group: 'api-vars', key, detail: `missing required api var: ${key}` });
  }

  // coherence — derived anchors must match their re-derived expectation
  for (const m of checkCoherence(expected, resolved)) {
    results.push({
      status: 'fail',
      group: 'coherence',
      key: m.key,
      detail: `incoherent ${m.key}: expected ${m.expected}, got ${m.actual}`,
    });
  }

  // policy — no wildcard ALLOWED_ORIGINS in staging/production
  for (const v of checkPolicy(resolved.ALLOWED_ORIGINS, env)) {
    results.push({
      status: 'fail',
      group: 'policy',
      key: 'ALLOWED_ORIGINS',
      detail: `ALLOWED_ORIGINS policy: ${v.reason} (${v.origin})`,
    });
  }

  const exitCode = mapExitCode(results);
  const failedKeys = results.filter((r) => r.status === 'fail').map((r) => r.key);
  return { results, exitCode, failedKeys };
}

// ── provider-neutral plan builder ─────────────────────────────────────────────

/**
 * The deploy-target env name, by the same convention `label scaffold` writes:
 * `staging` → `<label>-staging`, `production` → `<label>`.
 */
function targetEnvName(label, env) {
  return env === 'production' ? label : `${label}-staging`;
}

/**
 * Build a PROVIDER-NEUTRAL ordered plan. Step kinds:
 *   build-shared → migrate → deploy-worker → build-web → deploy-pages
 * `build-shared` is always first; `--scope` filters the api (migrate/worker)
 * and web (build/pages) steps. Parameters are neutral (`d1Name`, `wranglerEnv`,
 * `pagesProject`, `brandVars`) — no provider command strings live here.
 */
export function buildPlan({ label, env, scope, resolved, envConfig }) {
  const wranglerEnv = targetEnvName(label, env);

  const brandVars = {};
  for (const [k, v] of Object.entries(resolved)) {
    if (k.startsWith('NEXT_PUBLIC_')) brandVars[k] = v;
  }

  const wantApi = scope === 'api' || scope === 'all';
  const wantWeb = scope === 'web' || scope === 'all';

  const steps = [{ id: 'build-shared', title: 'Build shared package', kind: 'build-shared' }];

  if (wantApi) {
    steps.push({
      id: 'migrate',
      title: `Apply database migrations (${envConfig.d1.name})`,
      kind: 'migrate',
      d1Name: envConfig.d1.name,
      wranglerEnv,
    });
    steps.push({
      id: 'deploy-worker',
      title: `Deploy API (${envConfig.worker})`,
      kind: 'deploy-worker',
      wranglerEnv,
    });
  }

  if (wantWeb) {
    steps.push({
      id: 'build-web',
      title: 'Build web (brand-parametrised)',
      kind: 'build-web',
      brandVars,
    });
    steps.push({
      id: 'deploy-pages',
      title: `Deploy web (${envConfig.pagesProject})`,
      kind: 'deploy-pages',
      pagesProject: envConfig.pagesProject,
      wranglerEnv,
    });
  }

  return steps;
}

// ── production confirmation gate (cloud-agnostic, stdlib only) ────────────────

/**
 * Default interactive prompt backed by `node:readline` over stdin/stdout.
 * Resolves with the raw line the operator typed. Only ever reached on a real
 * TTY-backed execute; unit tests inject their own `promptFn` instead.
 */
function defaultPrompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Production safety gate. When `env === 'production'` and neither `yes` nor
 * `CONFIRM=1` is set, require the operator to type the label name before any
 * mutation. A mismatch throws (the caller maps that to a non-zero abort).
 *
 * Fail-closed: if there is no TTY and no bypass, throw immediately rather than
 * hang waiting for input. Pure stdlib (`node:readline`) — no cloud symbol.
 *
 * Injectable for tests: `promptFn(question) → string|Promise<string>` replaces
 * the readline prompt and `isTTY` overrides the auto-detected stdin TTY flag.
 */
export async function confirmProduction({ env, label, yes, promptFn, isTTY } = {}) {
  // Only production is gated; staging proceeds without confirmation.
  if (env !== 'production') return;

  // Explicit bypass: `--yes` flag or `CONFIRM=1` in the environment.
  if (yes || process.env.CONFIRM === '1') return;

  const tty = isTTY ?? Boolean(process.stdin.isTTY);
  if (!tty) {
    // Non-interactive and not bypassed → abort rather than block forever.
    throw new Error(
      `production deploy for "${label}" requires confirmation: ` +
        're-run with --yes or set CONFIRM=1 (no TTY available to type the confirmation).',
    );
  }

  const ask = promptFn ?? defaultPrompt;
  const answer = String(await ask(`Type the label "${label}" to confirm the production deploy: `)).trim();
  if (answer !== label) {
    throw new Error(
      `production deploy aborted: expected to type "${label}" to confirm, got "${answer}".`,
    );
  }
}

// ── orchestration ─────────────────────────────────────────────────────────────

/**
 * Full pipeline: parse → load → resolve → preflight → plan. On a preflight hard
 * gap it returns `{ ok: false, preflight }` WITHOUT building a plan, so no
 * executable plan ever escapes past a hard gap. The provider adapter consumes
 * the result and decides how to print/execute.
 */
export function run(argv) {
  const args = parseArgs(argv);
  const profile = loadProfile(args.label);
  const { expected, resolved, envConfig } = resolve(profile, args.env);
  const schema = loadSchema();

  const pf = preflight(schema, resolved, expected, args.env);
  if (pf.exitCode === 1) {
    return { ok: false, args, preflight: pf, resolved, envConfig };
  }

  const plan = buildPlan({
    label: args.label,
    env: args.env,
    scope: args.scope,
    resolved,
    envConfig,
  });
  return { ok: true, args, preflight: pf, plan, resolved, envConfig };
}
