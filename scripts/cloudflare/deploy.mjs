#!/usr/bin/env node
/**
 * scripts/cloudflare/deploy.mjs — the Cloudflare ENTRYPOINT + adapter (RFC 0011).
 *
 * An operator runs this. It imports the cloud-agnostic core, runs its pipeline
 * (parse → resolve → preflight → provider-neutral plan) and maps each plan step
 * `kind` to a concrete `wrangler`/`pnpm` command, invoking wrangler through the
 * repo pin (`pnpm --filter api exec wrangler …`) via `node:child_process`.
 *
 *   migrate       → wrangler d1 migrations apply <d1Name> --env <env> --remote
 *   deploy-worker → wrangler deploy --env <env>
 *   build-web     → pnpm --filter web pages:build   (NEXT_PUBLIC_* from resolved)
 *   deploy-pages  → wrangler pages deploy .vercel/output/static --project-name=<project>
 *
 * Candidate previews of staging (`--preview <name>`, RFC 0021 §1):
 *
 *   lint-migrations       → node scripts/db/check-migrations.mjs --base origin/main
 *   bookmark              → wrangler d1 time-travel info <d1Name> --env <env> --json
 *   deploy-worker-preview → wrangler preview --env <env> --name <name> --json --secrets-file <tmp>
 *                           (the Preview URL is captured by `parsePreviewUrl`; the
 *                           secrets file is written for that command and removed)
 *   deploy-pages-branch   → wrangler pages deploy … --project-name=<p> --branch=<name>
 *   report                → both URLs + the bookmark and its restore command
 *   delete-worker-preview → wrangler preview delete --env <env> --name <name> --skip-confirmation
 *   delete-pages-branch   → wrangler pages deployment list/delete, for that branch only
 *
 * `--dry-run` prints the exact commands (including the guard preflight) and
 * executes NOTHING — and never requires a credential or a confirmation.
 *
 * A real execute runs an ordered pipeline before touching Cloudflare:
 *   guard-no-dev-seed → resolveCredential → confirmProduction → execute.
 * The Cloudflare credential is resolved purely by context — an env token
 * (`CF_API_TOKEN`, RFC-canonical) or an existing `wrangler login` session — and
 * is never prompted for. App runtime secrets (JWT_SECRET, R2_*, …) are never
 * read; they persist on the Worker across deploys. A candidate preview is the
 * exception: its deployment carries its own secrets (see `previewSecretSpec`
 * in the core) — a freshly generated JWT_SECRET plus any `AQ_PREVIEW_<NAME>`
 * the operator exported — in a 0600 file that exists only while
 * `wrangler preview` runs. No value is ever put in argv or logged.
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import {
  run, parseArgs, confirmProduction, PREVIEW_SECRET_ENV_PREFIX, PREVIEW_SECRET_IMPACT,
} from '../deploy/core.mjs';
import { listSecretNames } from '../label.mjs';
import { formatCommand, parseBookmark, restoreCommand } from '../db/reset-remote.mjs';
import log from '../lib/log.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(dirname(__filename))); // scripts/cloudflare/.. → repo root

const API_WRANGLER = ['pnpm', '--filter', 'api', 'exec', 'wrangler'];
const WEB_WRANGLER = ['pnpm', '--filter', 'web', 'exec', 'wrangler'];
const PAGES_OUTPUT = '.vercel/output/static';

/** Placeholders a dry run prints where a real run substitutes a captured value. */
export const PLACEHOLDER = {
  apiUrl: '<API preview URL captured from wrangler preview>',
  bookmark: '<bookmark>',
  secretsFile: '<secrets file>',
};

/**
 * Map one provider-neutral plan step to a concrete command. `ctx` carries the
 * values captured by earlier steps of a preview run (`apiUrl`); a dry run
 * passes nothing and gets the placeholder instead. `report` is not a command:
 * it returns `null`.
 */
export function stepToCommand(step, ctx = {}) {
  switch (step.kind) {
    case 'build-shared':
      return {
        title: 'Build shared package',
        argv: ['pnpm', 'turbo', 'build', '--filter', '@arenaquest/shared'],
      };
    case 'lint-migrations':
      return {
        title: `Lint new migrations against ${step.base}`,
        argv: ['node', 'scripts/db/check-migrations.mjs', '--base', step.base],
      };
    case 'bookmark':
      return {
        title: `Record the D1 Time Travel bookmark (${step.d1Name})`,
        argv: [...API_WRANGLER, 'd1', 'time-travel', 'info', step.d1Name, '--env', step.wranglerEnv, '--json'],
        capture: true,
      };
    case 'migrate':
      return {
        title: `Apply D1 migrations (${step.d1Name})`,
        argv: [...API_WRANGLER, 'd1', 'migrations', 'apply', step.d1Name, '--env', step.wranglerEnv, '--remote'],
      };
    case 'deploy-worker':
      return {
        title: 'Deploy API worker',
        argv: [...API_WRANGLER, 'deploy', '--env', step.wranglerEnv],
      };
    case 'deploy-worker-preview':
      return {
        title: `Deploy API Workers Preview "${step.previewName}"`,
        argv: [
          ...API_WRANGLER, 'preview', '--env', step.wranglerEnv, '--name', step.previewName,
          ...(step.message ? ['--message', step.message] : []),
          '--json',
          ...(step.secrets ? ['--secrets-file', ctx.secretsFile ?? PLACEHOLDER.secretsFile] : []),
        ],
        capture: true,
      };
    case 'build-web': {
      const env = { ...step.brandVars };
      if (step.apiUrlFrom) env.NEXT_PUBLIC_API_URL = ctx.apiUrl ?? PLACEHOLDER.apiUrl;
      return {
        title: 'Build web (brand-parametrised)',
        argv: ['pnpm', '--filter', 'web', 'pages:build'],
        env,
      };
    }
    case 'deploy-pages':
      return {
        title: `Deploy web Pages (${step.pagesProject})`,
        argv: [...WEB_WRANGLER, 'pages', 'deploy', PAGES_OUTPUT, `--project-name=${step.pagesProject}`],
      };
    case 'deploy-pages-branch':
      return {
        title: `Deploy web Pages branch "${step.branch}" (${step.pagesProject})`,
        argv: [
          ...WEB_WRANGLER, 'pages', 'deploy', PAGES_OUTPUT,
          `--project-name=${step.pagesProject}`, `--branch=${step.branch}`,
        ],
      };
    case 'delete-worker-preview':
      return {
        title: `Delete API Workers Preview "${step.previewName}"`,
        argv: [...API_WRANGLER, 'preview', 'delete', '--env', step.wranglerEnv, '--name', step.previewName, '--skip-confirmation'],
      };
    case 'delete-pages-branch':
      return {
        title: `List web Pages deployments of branch "${step.branch}" (${step.pagesProject})`,
        argv: pagesListCommand(step.pagesProject),
        capture: true,
      };
    case 'report':
      return null;
    default:
      throw new Error(`unknown plan step kind: ${step.kind}`);
  }
}

/**
 * The values of a preview's secrets file: each `generated` name gets 32 fresh
 * random bytes (hex); each `external` one is read from `AQ_PREVIEW_<NAME>` in
 * `env`, or listed in `missing` when unset.
 */
export function previewSecretValues(secrets, env, random = () => randomBytes(32).toString('hex')) {
  const values = {};
  const missing = [];
  for (const name of secrets.generated) values[name] = random();
  for (const name of secrets.external) {
    const value = env[`${PREVIEW_SECRET_ENV_PREFIX}${name}`];
    if (value) values[name] = value;
    else missing.push(name);
  }
  return { values, missing };
}

/**
 * Write `values` to a fresh 0600 JSON file in its own temp dir; the returned
 * `remove()` deletes the dir. wrangler reads the file, nothing else does.
 */
function writeSecretsFile(values) {
  const dir = mkdtempSync(join(tmpdir(), 'aq-preview-secrets-'));
  const path = join(dir, 'secrets.json');
  writeFileSync(path, JSON.stringify(values), { mode: 0o600 });
  return { path, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** `wrangler pages deployment list` for the preview environment, as JSON. */
export function pagesListCommand(pagesProject) {
  return [...WEB_WRANGLER, 'pages', 'deployment', 'list', `--project-name=${pagesProject}`, '--environment=preview', '--json'];
}

/** `wrangler pages deployment delete` — `--force` because a branch's latest deployment holds its alias. */
export function pagesDeleteCommand(pagesProject, id) {
  return [...WEB_WRANGLER, 'pages', 'deployment', 'delete', id, `--project-name=${pagesProject}`, '--force'];
}

// ── wrangler output parsing (ONE place per output shape) ─────────────────────

/**
 * The first top-level JSON value in `stdout` that opens at the start of a line
 * with `open` (`{` or `[`), tolerating banner lines before it and noise after.
 */
function firstJson(stdout, open, what) {
  const text = String(stdout ?? '');
  const startRe = open === '{' ? /^\{/m : /^\[/m;
  const start = text.search(startRe);
  if (start < 0) throw new Error(`${what} printed no JSON`);
  const body = text.slice(start);
  const close = open === '{' ? '}' : ']';
  // Try every line that closes at column 0, shortest first (the pretty-printed
  // root closes at column 0; nested values are indented).
  const ends = [];
  const endRe = new RegExp(`^\\${close}`, 'gm');
  for (let m = endRe.exec(body); m; m = endRe.exec(body)) ends.push(m.index + 1);
  if (ends.length === 0) ends.push(body.length);
  let lastError;
  for (const end of ends) {
    try {
      return JSON.parse(body.slice(0, end));
    } catch (error) {
      lastError = error;
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${what} printed invalid JSON: ${lastError?.message ?? 'unparseable'}`);
  }
}

/**
 * The Preview URL from `wrangler preview --json` (wrangler 4.144,
 * `src/preview/preview.ts` → `runPreview`, which logs
 * `JSON.stringify({ preview, deployment }, null, 2)`):
 *
 *   { "preview":    { "id", "name", "slug", "urls": ["https://<slug>-<worker>.<sub>.workers.dev"], … },
 *     "deployment": { "id", "urls": ["https://<id8>-<worker>.<sub>.workers.dev"], … } }
 *
 * The web is built against `preview.urls[0]` — the preview's stable URL, which
 * a redeploy of the same preview name keeps — never the per-deployment URL.
 * Anything else (no JSON, no preview URL, not https) throws with the raw output
 * attached, so a change in wrangler's output fails loudly instead of building
 * the web against a wrong API.
 */
export function parsePreviewUrl(stdout) {
  let parsed;
  try {
    parsed = firstJson(stdout, '{', 'wrangler preview --json');
  } catch (error) {
    throw new Error(`${error.message}\n--- wrangler output ---\n${String(stdout ?? '').trim()}`);
  }
  const url = parsed?.preview?.urls?.[0];
  if (typeof url !== 'string' || !/^https:\/\/[^/\s]+\/?$/.test(url)) {
    throw new Error(
      'wrangler preview --json returned no preview.urls[0] https URL (are workers.dev preview URLs enabled for this Worker?)' +
        `\n--- wrangler output ---\n${String(stdout ?? '').trim()}`,
    );
  }
  return url.replace(/\/$/, '');
}

/**
 * Deployment ids of `branch` from `wrangler pages deployment list --json`
 * (wrangler 4.144, `src/pages/deployments.ts`: an array of
 * `{ Id, Environment, Branch, Source, Deployment, Status, Build }`).
 * Only PREVIEW deployments are ever returned — the production branch is never
 * a deletion target, whatever its name.
 */
export function branchDeploymentIds(stdout, branch) {
  const rows = firstJson(stdout, '[', 'wrangler pages deployment list --json');
  if (!Array.isArray(rows)) throw new Error('wrangler pages deployment list --json did not print an array');
  return rows
    .filter((row) => row && row.Branch === branch && String(row.Environment).toLowerCase() === 'preview')
    .map((row) => row.Id)
    .filter((id) => typeof id === 'string' && id !== '');
}

// ── report ────────────────────────────────────────────────────────────────────

/** The restore command for a bookmark, rendered for a human (and a job summary). */
export function renderRestore(step, bookmark) {
  return formatCommand(restoreCommand({ database: step.d1Name, wranglerEnv: step.wranglerEnv }, bookmark));
}

/** The report's lines: `[key, value]` pairs, printed and summarised alike. */
export function reportLines(step, ctx = {}) {
  const lines = [];
  if (step.webUrl) lines.push(['Web preview', step.webUrl]);
  const apiUrl = step.apiUrl ?? (step.apiUrlFrom ? ctx.apiUrl ?? PLACEHOLDER.apiUrl : null);
  if (apiUrl) lines.push(['API preview', apiUrl]);
  if (step.bookmarkFrom) {
    const bookmark = ctx.bookmark ?? PLACEHOLDER.bookmark;
    lines.push(['D1 bookmark', `${bookmark} (${step.d1Name}, before this preview's migrations)`]);
    lines.push(['Restore', renderRestore(step, bookmark)]);
  }
  return lines;
}

/** Markdown for `--summary-file` (e.g. `$GITHUB_STEP_SUMMARY`). */
export function summaryMarkdown(step, ctx = {}) {
  const rows = reportLines(step, ctx).map(([k, v]) => `| ${k} | ${k === 'Restore' ? `\`${v}\`` : v} |`);
  return [`### Preview \`${step.previewName}\` — ${step.label}`, '', '| | |', '|---|---|', ...rows, ''].join('\n') + '\n';
}

// ── rendering / environment ──────────────────────────────────────────────────

/** Human-readable one-liner for a command (with any env-var prefix). */
function renderCommand(c) {
  const prefix = c.env && Object.keys(c.env).length
    ? Object.entries(c.env).map(([k, v]) => `${k}=${JSON.stringify(String(v ?? ''))}`).join(' ') + ' '
    : '';
  return prefix + c.argv.join(' ');
}

/**
 * The wrangler/deploy-target env name, mirroring the core's convention:
 * `staging` → `<label>-staging`, `production` → `<label>`.
 */
function wranglerEnvName(label, env) {
  return env === 'production' ? label : `${label}-staging`;
}

/**
 * Build the guard-no-dev-seed preflight command. Runs
 * `apps/api/scripts/check-no-dev-seed.ts` against the resolved D1 database.
 * `--env` is passed only for staging (matching the Makefile, which omits it for
 * production). `--target` is always passed explicitly: in `production` mode the
 * guard also rejects demo accounts (RFC 0021 §3.6), which staging may hold.
 */
function guardCommand({ d1Name, env, wranglerEnv }) {
  const argv = [
    'pnpm', '--filter', 'api', 'exec', 'tsx', 'scripts/check-no-dev-seed.ts',
    '--db', d1Name, '--target', env,
  ];
  if (env === 'staging') argv.push('--env', wranglerEnv);
  const what = env === 'production' ? 'dev-seed or demo accounts' : 'dev-seed';
  return { title: `Guard (${env}): no ${what} in ${d1Name}`, argv };
}

/** One read of the checkout: `git <args>` trimmed, or `''` when git fails. */
function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout).trim() : '';
}

/**
 * The current branch, for the `--preview` default. A detached checkout (CI)
 * falls back to `GITHUB_REF_NAME`.
 */
function currentBranch() {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return branch && branch !== 'HEAD' ? branch : process.env.GITHUB_REF_NAME || '';
}

/**
 * Resolve the Cloudflare credential by context — NEVER prompted for:
 *   1. `CF_API_TOKEN` (RFC-canonical) or a pre-set native `CLOUDFLARE_API_TOKEN`
 *      → use it, exporting `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` for the
 *      wrangler spawns (honours `CF_ACCOUNT_ID`/`CLOUDFLARE_ACCOUNT_ID`).
 *   2. else an existing `wrangler login` OAuth session (`wrangler whoami` exits 0).
 *   3. else `null` — the caller aborts with an actionable message.
 * App runtime secrets are intentionally not read.
 */
function resolveCredential() {
  const token = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
  if (token) {
    const env = { CLOUDFLARE_API_TOKEN: token };
    const accountId = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
    if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;
    return { source: 'env-token', env };
  }

  const who = spawnSync(
    'pnpm', ['--filter', 'api', 'exec', 'wrangler', 'whoami'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  // NB: `wrangler whoami` exits 0 even when unauthenticated (it just prints
  // "You are not authenticated"), so exit code alone is not enough — inspect
  // the output to confirm a real session before trusting it (fail closed).
  const output = `${who.stdout ?? ''}${who.stderr ?? ''}`;
  const unauthenticated = /not authenticated|please run\s+`?wrangler login/i.test(output);
  if (who.status === 0 && !unauthenticated) {
    // Existing `wrangler login` session — wrangler reads ~/.wrangler itself.
    return { source: 'wrangler-session', env: {} };
  }

  return null;
}

// ── execution ─────────────────────────────────────────────────────────────────

/** Default runner: spawnSync from the repo root; `capture` pipes stdout (stderr still shows). */
function spawnRunner(c, env) {
  return spawnSync(c.argv[0], c.argv.slice(1), {
    cwd: ROOT,
    stdio: c.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: c.capture ? 'utf8' : undefined,
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
}

function checkStatus(res, title) {
  if (res.error) throw new Error(`Step "${title}" could not start: ${res.error.message}`);
  if (res.status !== 0) {
    if (res.stdout) process.stderr.write(String(res.stdout));
    const err = new Error(`Step "${title}" failed (exit ${res.status ?? 'signal'}).`);
    err.exitCode = res.status || 1;
    throw err;
  }
  return res;
}

/**
 * Execute a plan. `runner(command, env)` returns spawnSync's shape (injected by
 * the tests); `baseEnv` is the environment every command inherits (credential
 * included). Returns the captured context `{ apiUrl, bookmark }`. Throws on the
 * first failing step; once a bookmark exists, the error names its restore
 * command.
 */
export function executePlan(plan, { runner = spawnRunner, baseEnv = process.env, summaryFile = null, append = appendFileSync } = {}) {
  const ctx = {};
  let bookmarkStep = null;
  const withRestore = (error) => {
    if (ctx.bookmark && bookmarkStep) {
      error.message += `\n     restore the pre-preview data with: ${renderRestore(bookmarkStep, ctx.bookmark)}`;
    }
    return error;
  };

  for (const step of plan) {
    if (step.kind === 'report') {
      log.heading(`Preview "${step.previewName}" (${step.label}) is up`);
      for (const [k, v] of reportLines(step, ctx)) log.ok(`${k}: ${v}`);
      if (summaryFile) append(summaryFile, summaryMarkdown(step, ctx));
      continue;
    }

    let secretsFile = null;
    if (step.kind === 'deploy-worker-preview' && step.secrets) {
      const { values, missing } = previewSecretValues(step.secrets, baseEnv);
      for (const name of missing) {
        log.warn(`${name} not passed to the preview (${PREVIEW_SECRET_ENV_PREFIX}${name} unset) — ${PREVIEW_SECRET_IMPACT[name] ?? 'the feature using it is off'}`);
      }
      log.ok(`preview secrets: ${Object.keys(values).join(', ')} (${step.secrets.generated.join(', ')} generated for this deployment)`);
      secretsFile = writeSecretsFile(values);
    }

    const c = stepToCommand(step, secretsFile ? { ...ctx, secretsFile: secretsFile.path } : ctx);
    log.info(c.title);
    log.cmd(renderCommand(c));
    try {
      const res = checkStatus(runner(c, { ...baseEnv, ...(c.env || {}) }), c.title);

      if (step.kind === 'bookmark') {
        ctx.bookmark = parseBookmark(res.stdout);
        bookmarkStep = step;
        log.ok(`bookmark ${ctx.bookmark}`);
        log.hint(`undo this preview's migrations with: ${renderRestore(step, ctx.bookmark)}`);
      } else if (step.kind === 'deploy-worker-preview') {
        ctx.apiUrl = parsePreviewUrl(res.stdout);
        log.ok(`API preview: ${ctx.apiUrl}`);
      } else if (step.kind === 'delete-pages-branch') {
        deletePagesBranch(step, res.stdout, { runner, baseEnv });
      }
    } catch (error) {
      if (step.kind === 'bookmark') {
        error.message = `aborted before migrating: could not record a Time Travel bookmark (${error.message})`;
      }
      throw withRestore(error);
    } finally {
      secretsFile?.remove();
    }
  }
  return ctx;
}

/**
 * Delete every preview deployment of `step.branch`. The list is re-read after
 * each round, because the API pages its results; bounded so a deletion that
 * silently does nothing cannot loop forever.
 */
function deletePagesBranch(step, firstListing, { runner, baseEnv }) {
  let listing = firstListing;
  let deleted = 0;
  for (let round = 0; round < 20; round++) {
    const ids = branchDeploymentIds(listing, step.branch);
    if (ids.length === 0) {
      log.ok(`${deleted} deployment(s) of branch "${step.branch}" deleted — none left`);
      return;
    }
    for (const id of ids) {
      const del = { title: `Delete Pages deployment ${id}`, argv: pagesDeleteCommand(step.pagesProject, id) };
      log.cmd(renderCommand(del));
      checkStatus(runner(del, baseEnv), del.title);
      deleted++;
    }
    const list = { title: 'List Pages deployments', argv: pagesListCommand(step.pagesProject), capture: true };
    listing = checkStatus(runner(list, baseEnv), list.title).stdout;
  }
  throw new Error(`deployments of branch "${step.branch}" are still listed after 20 rounds of deletion`);
}

/** What a dry run prints for the steps that are not a single command. */
function dryRunExtras(step) {
  if (step.kind === 'bookmark') {
    return [`prints the restore command: ${renderRestore(step, PLACEHOLDER.bookmark)}`];
  }
  if (step.kind === 'deploy-worker-preview') {
    const lines = ['captures preview.urls[0] from the JSON output as the API preview URL'];
    if (step.secrets) {
      lines.push(`secrets file (0600, removed after): ${step.secrets.generated.join(', ')} generated`);
      for (const name of step.secrets.external) {
        lines.push(`  ${name} from ${PREVIEW_SECRET_ENV_PREFIX}${name} if set — otherwise ${PREVIEW_SECRET_IMPACT[name] ?? 'the feature using it is off'}`);
      }
    }
    return lines;
  }
  if (step.kind === 'delete-pages-branch') {
    return [
      `for each deployment with Branch == "${step.branch}" and Environment == Preview:`,
      `  ${pagesDeleteCommand(step.pagesProject, '<deployment-id>').join(' ')}`,
    ];
  }
  return [];
}

async function main() {
  const argv = process.argv.slice(2);
  const branch = currentBranch();

  // Parse once up front (pure, cheap) so we know whether this is a --dry-run
  // before deciding to touch a credential. `run()` re-parses the same argv.
  let preArgs;
  try {
    preArgs = parseArgs(argv, { branch });
  } catch (err) {
    log.die(err.message);
    return;
  }

  // Secret presence is verified by NAME against Cloudflare's own secret store —
  // never from the repository, and no secret value is ever read, compared or
  // logged. That lookup needs a credential, so:
  //   - `--dry-run` is contractually credential-free → skip it (secrets stay
  //     `skip`, which is not a hard gap).
  //   - `--skip-secret-check` → first-time provisioning, where the external
  //     secrets do not exist yet by design.
  //   - no credential → also skip, and let step 2 below emit the existing
  //     "no credential" error, preserving the current failure ordering.
  let cred = null;
  let fetchSecretNames;
  if (!preArgs.dryRun) {
    cred = resolveCredential();
    if (cred) {
      // Export the resolved credential so the wrangler spawn inside
      // listSecretNames() sees it (it inherits process.env). The same values
      // are merged per-command at step 4.
      Object.assign(process.env, cred.env);
      // A preview carries its own secrets: the Worker's are not its concern.
      if (!preArgs.skipSecretCheck && !preArgs.delete && preArgs.preview === null) fetchSecretNames = listSecretNames;
    }
  }

  let result;
  try {
    result = run(argv, {
      fetchSecretNames,
      branch,
      commitSha: preArgs.preview ? git(['rev-parse', '--short', 'HEAD']) : '',
    });
  } catch (err) {
    log.die(err.message);
    return;
  }

  const { args } = result;

  // Fail closed: a preflight hard gap aborts before any command, naming keys.
  if (!result.ok) {
    log.fail(`Preflight failed for ${args.label} (${args.env}) — aborting before any deploy step.`);
    for (const r of result.preflight.results) {
      if (r.status === 'fail') log.fail(r.detail);
    }
    // A secret row carries its own fix command; only the rest live in the profile.
    const failed = result.preflight.results.filter((r) => r.status === 'fail');
    if (failed.some((r) => r.group !== 'api-secrets')) {
      log.hint('Fix the offending key(s) in config/labels/<label>.jsonc, then re-run.');
    } else {
      log.hint('Set the missing secret(s) with the command(s) above, then re-run.');
    }
    process.exit(1);
  }

  const wranglerEnv = wranglerEnvName(args.label, args.env);
  // Deleting a preview reads no data, so it is not gated by the data guard.
  const guard = args.delete
    ? null
    : guardCommand({ d1Name: result.envConfig.d1.name, env: args.env, wranglerEnv });

  const what = args.preview
    ? `${args.delete ? 'Delete preview' : 'Preview'} "${args.preview}" of ${args.label} → staging`
    : `Deploy ${args.label} → ${args.env}`;
  log.heading(`${what} (scope: ${args.scope})${args.dryRun ? '  [dry-run]' : ''}`);

  // --dry-run: print the guard preflight + the exact commands, execute nothing.
  // No credential and no confirmation are required to preview.
  if (args.dryRun) {
    log.info('Dry run — these commands would run (nothing is executed):');
    if (guard) {
      log.ok(guard.title);
      log.cmd(renderCommand(guard));
    }
    for (const step of result.plan) {
      if (step.kind === 'report') {
        log.ok(step.title);
        for (const [k, v] of reportLines(step)) log.hint(`${k}: ${v}`);
        continue;
      }
      const c = stepToCommand(step);
      log.ok(c.title);
      log.cmd(renderCommand(c));
      for (const line of dryRunExtras(step)) log.hint(line);
    }
    process.exit(0);
  }

  // ── Real execution pipeline: guard → credential → confirm → execute ─────────

  // 1. guard-no-dev-seed preflight — a tainted target aborts before any deploy.
  if (guard) {
    log.info(guard.title);
    log.cmd(renderCommand(guard));
    const g = spawnSync(guard.argv[0], guard.argv.slice(1), { cwd: ROOT, stdio: 'inherit' });
    if (g.status !== 0) {
      log.die(
        `Preflight guard failed (exit ${g.status ?? 'signal'}) — aborting before any deploy step.`,
        g.status || 1,
      );
    }
  }

  // 2. Cloudflare credential (resolved above, never prompted for).
  if (!cred) {
    log.die('No Cloudflare credential found — run `wrangler login`, or set CF_API_TOKEN.');
  }

  // 3. Production confirmation gate (typing the label; --yes / CONFIRM=1 bypass).
  try {
    await confirmProduction({ env: args.env, label: args.label, yes: args.yes });
  } catch (err) {
    log.die(err.message);
  }

  // 4. Execute each plan step, passing the resolved credential to wrangler.
  try {
    executePlan(result.plan, {
      baseEnv: { ...process.env, ...cred.env },
      summaryFile: args.summaryFile,
    });
  } catch (err) {
    log.die(err.message, err.exitCode || 1);
  }

  if (args.preview) {
    log.ok(`${args.delete ? 'Preview deleted' : 'Preview deployed'}: ${args.label} → staging "${args.preview}".`);
  } else {
    log.ok(`Deploy complete: ${args.label} → ${args.env}.`);
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) main();
