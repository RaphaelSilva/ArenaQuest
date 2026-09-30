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
  isActive,
  derivePreview,
  PREVIEW_NAME_RE,
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

/** The ref a candidate's new migrations are linted against (RFC 0021 §2.2). */
export const MIGRATIONS_BASE = 'origin/main';

// ── argument parsing ──────────────────────────────────────────────────────────

/**
 * The preview name of a candidate branch: `feature/m<N>/candidate` → `m<N>`;
 * any other branch (or none) → `null`.
 */
export function previewNameFromBranch(branch) {
  const m = /^feature\/m(\d+)\/candidate$/.exec(String(branch ?? '').trim());
  return m ? `m${m[1]}` : null;
}

/**
 * Resolve `--preview <name>`: an empty value takes the default from the current
 * branch (`feature/m<N>/candidate` → `m<N>`); the result must match
 * `[a-z0-9-]{1,20}`. Throws with the reason otherwise.
 */
export function resolvePreviewName(raw, branch) {
  let name = String(raw ?? '').trim();
  if (name === '') {
    name = previewNameFromBranch(branch);
    if (!name) {
      throw new Error(
        `--preview needs a name: the current branch (${branch || 'unknown'}) is not feature/m<N>/candidate — pass --preview <name>`,
      );
    }
  }
  if (!PREVIEW_NAME_RE.test(name) || name.startsWith('-') || name.endsWith('-')) {
    throw new Error(`--preview name "${name}" must match ${PREVIEW_NAME_RE} and not start or end with "-" (e.g. m21)`);
  }
  return name;
}

/**
 * Parse the deploy CLI arguments into a normalised shape.
 * Rules: `--label` required; `-e|--env` ∈ {staging, production}; `--scope` ∈
 * {api, web, all} (default `all`); `--yes`, `--dry-run` and
 * `--skip-secret-check` booleans. Throws a clear Error on any invalid or
 * missing input.
 *
 * `--skip-secret-check` exists for ONE caller: first-time provisioning, where
 * the externally-valued secrets legitimately do not exist yet (the provisioner
 * reports them as follow-ups and never writes them — RFC 0012). It must not be
 * used to push past a real gap on an already-provisioned environment.
 *
 * Candidate previews (RFC 0021 §1): `--preview <name>` (staging only; an empty
 * value defaults from `ctx.branch`, see `resolvePreviewName`), `--delete`
 * (with `--preview`: remove that preview), `--api-url <url>` (required by a
 * web-only preview — the API preview it points at), `--summary-file <path>`
 * (append the report as Markdown, e.g. `$GITHUB_STEP_SUMMARY`).
 */
export function parseArgs(argv, ctx = {}) {
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
        'skip-secret-check': { type: 'boolean' },
        preview: { type: 'string' },
        delete: { type: 'boolean' },
        'api-url': { type: 'string' },
        'summary-file': { type: 'string' },
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

  const previewMode = values.preview !== undefined;
  if (!previewMode) {
    for (const flag of ['delete', 'api-url', 'summary-file']) {
      if (values[flag] !== undefined) throw new Error(`--${flag} is only valid with --preview <name>`);
    }
  }
  let preview = null;
  let apiUrl = null;
  if (previewMode) {
    // Refused before anything else about the preview is looked at.
    if (env !== 'staging') {
      throw new Error('--preview is only valid with -e staging: production never gets a candidate preview (RFC 0021 §1)');
    }
    preview = resolvePreviewName(values.preview, ctx.branch);
    if (values['api-url'] !== undefined) {
      if (values.delete || scope !== 'web') throw new Error('--api-url is only valid for a web-only preview (--scope web)');
      let url;
      try {
        url = new URL(values['api-url']);
      } catch {
        throw new Error(`--api-url must be an https URL (got "${values['api-url']}")`);
      }
      if (url.protocol !== 'https:') throw new Error(`--api-url must be an https URL (got "${values['api-url']}")`);
      apiUrl = url.origin;
    } else if (scope === 'web' && !values.delete) {
      throw new Error('a web-only preview (--scope web) needs --api-url <the API preview URL>: nothing captures it without the api steps');
    }
  }

  return {
    label,
    env,
    scope,
    yes: Boolean(values.yes),
    dryRun: Boolean(values['dry-run']),
    skipSecretCheck: Boolean(values['skip-secret-check']),
    preview,
    delete: Boolean(values.delete),
    apiUrl,
    summaryFile: values['summary-file'] ?? null,
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
 * Fail-closed preflight: presence (build + api-vars + api-secrets), coherence
 * and the ALLOWED_ORIGINS wildcard policy. Returns a flat results array, the
 * mapped `exitCode` (1 = hard gap) and the list of offending keys. A hard gap
 * must abort before any mutation and the caller prints `failedKeys`.
 *
 * `opts.secretNames` keeps this function PURE while still covering
 * `api-secrets`: listing secrets requires a cloud credential, so the provider
 * adapter fetches the NAMES (never values) and injects them here. `null` means
 * "could not look them up" and downgrades every secret row to `skip` — never a
 * false pass. `opts.label` is used only to render the fix command.
 */
export function preflight(schema, resolved, expected, env, opts = {}) {
  const { secretNames = null, label = '', previewSecrets = false } = opts;
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

  // presence — api-secrets by NAME only (values are never read, compared or
  // logged; the sole source of truth is the cloud's own secret store).
  // A candidate preview reads none of the Worker's secrets: its deployment
  // carries its own (see previewSecretSpec), so there is nothing to check here.
  for (const [key, spec] of Object.entries(schema['api-secrets'] ?? {})) {
    if (previewSecrets || !isActive(spec, resolved)) continue;
    if (secretNames === null) {
      results.push({
        status: 'skip',
        group: 'api-secrets',
        key,
        detail: `could not list secrets — ${key} unverified`,
      });
      continue;
    }
    if (secretNames.includes(key)) {
      results.push({ status: 'pass', group: 'api-secrets', key, detail: 'set' });
    } else {
      results.push({
        status: 'fail',
        group: 'api-secrets',
        key,
        detail: `missing required secret: ${key} — set it with \`${PATHS.createSecrets} ${key} --env ${targetEnvName(label, env)}\``,
      });
    }
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
 * The secrets a candidate preview's deployment carries.
 *
 * A Workers Preview deployment holds only the bindings uploaded with it: it
 * reads none of the staging Worker's secrets, and (wrangler 4.144) neither the
 * Preview base config's nor a previous preview deployment's. So every
 * `wrangler preview` gets a `--secrets-file`, rebuilt each run:
 *   - `generated` — minted fresh per run (a preview signs its own tokens, so a
 *     staging token never verifies on it — and a redeploy logs everyone out);
 *   - `external`  — values that come from outside, taken from the operator's
 *     `AQ_PREVIEW_<NAME>` env var when set; absent ones only switch off what
 *     `PREVIEW_SECRET_IMPACT` names — the preview still boots and email/password
 *     login still works.
 */
export const PREVIEW_GENERATED_SECRETS = ['JWT_SECRET'];
export const PREVIEW_SECRET_ENV_PREFIX = 'AQ_PREVIEW_';
export const PREVIEW_SECRET_IMPACT = {
  R2_ACCESS_KEY_ID: 'media presigned uploads/downloads are off',
  R2_SECRET_ACCESS_KEY: 'media presigned uploads/downloads are off',
  GOOGLE_CLIENT_SECRET: 'Google sign-in is off',
  RESEND_API_KEY: 'email is not sent',
};

/** `{ generated, external }` secret names for a preview of these resolved values. */
export function previewSecretSpec(schema, resolved) {
  const active = Object.entries(schema['api-secrets'] ?? {})
    .filter(([, spec]) => isActive(spec, resolved))
    .map(([key]) => key);
  return {
    generated: PREVIEW_GENERATED_SECRETS.filter((k) => active.includes(k)),
    external: active.filter((k) => !PREVIEW_GENERATED_SECRETS.includes(k)),
  };
}

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

/**
 * Build the PROVIDER-NEUTRAL plan of a candidate preview of staging
 * (RFC 0021 §1). Step kinds, in order:
 *
 *   lint-migrations → build-shared → bookmark → migrate → deploy-worker-preview
 *     → build-web → deploy-pages-branch → report
 *
 * `lint-migrations` is first so a destructive migration stops the run before
 * the bookmark and the migrate touch the shared staging D1. `--scope api` keeps
 * the lint/bookmark/migrate/worker steps, `--scope web` the web steps (with the
 * API URL supplied up front); `report` always closes the plan. The live staging
 * Worker and the Pages production branch are never a target: the worker step
 * creates a named preview, the pages step deploys a named branch.
 *
 * `build-web` carries `apiUrlFrom: 'deploy-worker-preview'` when the API URL is
 * only known once that step has run; the adapter fills it in.
 * `deploy-worker-preview` carries `secrets` (see previewSecretSpec): NAMES only —
 * the adapter writes the values to a secrets file for that one command.
 */
export function buildPreviewPlan({
  label, scope, resolved, envConfig, preview, apiUrl = null, commitSha = '',
  secrets = { generated: PREVIEW_GENERATED_SECRETS, external: [] },
}) {
  const wranglerEnv = targetEnvName(label, 'staging');
  const wantApi = scope === 'api' || scope === 'all';
  const wantWeb = scope === 'web' || scope === 'all';
  const name = preview.name;

  const steps = [];
  if (wantApi) {
    steps.push({
      id: 'lint-migrations',
      title: `Lint new migrations against ${MIGRATIONS_BASE} (frozen + additive)`,
      kind: 'lint-migrations',
      base: MIGRATIONS_BASE,
    });
  }
  steps.push({ id: 'build-shared', title: 'Build shared package', kind: 'build-shared' });

  if (wantApi) {
    steps.push({
      id: 'bookmark',
      title: `Record the database bookmark (${envConfig.d1.name})`,
      kind: 'bookmark',
      d1Name: envConfig.d1.name,
      wranglerEnv,
    });
    steps.push({
      id: 'migrate',
      title: `Apply database migrations (${envConfig.d1.name})`,
      kind: 'migrate',
      d1Name: envConfig.d1.name,
      wranglerEnv,
    });
    steps.push({
      id: 'deploy-worker-preview',
      title: `Deploy API preview "${name}" (${envConfig.worker})`,
      kind: 'deploy-worker-preview',
      wranglerEnv,
      previewName: name,
      message: commitSha,
      secrets,
    });
  }

  if (wantWeb) {
    const brandVars = {};
    for (const [k, v] of Object.entries(resolved)) {
      if (k.startsWith('NEXT_PUBLIC_')) brandVars[k] = v;
    }
    brandVars.NEXT_PUBLIC_API_URL = apiUrl;
    brandVars.NEXT_PUBLIC_SITE_URL = preview.siteUrl;
    brandVars.NEXT_PUBLIC_PREVIEW_NAME = name;
    brandVars.NEXT_PUBLIC_PREVIEW_SHA = commitSha;
    steps.push({
      id: 'build-web',
      title: `Build web for preview "${name}" (brand-parametrised)`,
      kind: 'build-web',
      brandVars,
      apiUrlFrom: apiUrl ? null : 'deploy-worker-preview',
    });
    steps.push({
      id: 'deploy-pages-branch',
      title: `Deploy web preview branch "${name}" (${envConfig.pagesProject})`,
      kind: 'deploy-pages-branch',
      pagesProject: envConfig.pagesProject,
      branch: name,
    });
  }

  steps.push({
    id: 'report',
    title: `Report preview "${name}"`,
    kind: 'report',
    label,
    previewName: name,
    webUrl: wantWeb ? preview.webUrl : null,
    apiUrl,
    apiUrlFrom: wantApi ? 'deploy-worker-preview' : null,
    bookmarkFrom: wantApi ? 'bookmark' : null,
    d1Name: envConfig.d1.name,
    wranglerEnv,
  });
  return steps;
}

/**
 * The neutral plan that removes a candidate preview: the Worker preview
 * (`--scope api|all`) and every deployment of the Pages branch (`web|all`).
 */
export function buildPreviewDeletePlan({ label, scope, envConfig, preview }) {
  const wranglerEnv = targetEnvName(label, 'staging');
  const steps = [];
  if (scope === 'api' || scope === 'all') {
    steps.push({
      id: 'delete-worker-preview',
      title: `Delete API preview "${preview.name}" (${envConfig.worker})`,
      kind: 'delete-worker-preview',
      wranglerEnv,
      previewName: preview.name,
    });
  }
  if (scope === 'web' || scope === 'all') {
    steps.push({
      id: 'delete-pages-branch',
      title: `Delete web preview branch "${preview.name}" deployments (${envConfig.pagesProject})`,
      kind: 'delete-pages-branch',
      pagesProject: envConfig.pagesProject,
      branch: preview.name,
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
 *
 * `opts.fetchSecretNames` is an optional `(label, env) => { ok, names }` hook
 * injected by the provider adapter. Core must stay cloud-agnostic (it may not
 * import wrangler or spawn anything), so listing secrets is a capability handed
 * IN rather than reached for. Absent or failing → secrets go unverified (`skip`),
 * which never blocks a deploy on its own.
 *
 * `opts.branch` (the current git branch, for the `--preview` default) and
 * `opts.commitSha` (the short sha a preview is labelled with) are facts the
 * adapter reads from the checkout and hands in, like `fetchSecretNames`.
 * A preview name, a production refusal or an uncovered preview origin throws
 * here — before any plan exists, so before any step can run.
 */
export function run(argv, opts = {}) {
  const args = parseArgs(argv, { branch: opts.branch });
  const profile = loadProfile(args.label);
  const { expected, resolved, envConfig } = resolve(profile, args.env);
  const preview = args.preview ? derivePreview(profile, args.preview) : null;

  if (preview && args.delete) {
    const plan = buildPreviewDeletePlan({ label: args.label, scope: args.scope, envConfig, preview });
    return { ok: true, args, preflight: null, plan, resolved, envConfig, preview };
  }

  const schema = loadSchema();

  let secretNames = null;
  if (!preview && typeof opts.fetchSecretNames === 'function') {
    const listed = opts.fetchSecretNames(args.label, args.env);
    if (listed?.ok) secretNames = listed.names;
  }

  const pf = preflight(schema, resolved, expected, args.env, {
    secretNames,
    label: args.label,
    previewSecrets: Boolean(preview),
  });
  if (pf.exitCode === 1) {
    return { ok: false, args, preflight: pf, resolved, envConfig };
  }

  const plan = preview
    ? buildPreviewPlan({
        label: args.label,
        scope: args.scope,
        resolved,
        envConfig,
        preview,
        apiUrl: args.apiUrl,
        commitSha: opts.commitSha ?? '',
        secrets: previewSecretSpec(schema, resolved),
      })
    : buildPlan({
        label: args.label,
        env: args.env,
        scope: args.scope,
        resolved,
        envConfig,
      });
  return { ok: true, args, preflight: pf, plan, resolved, envConfig, preview };
}
