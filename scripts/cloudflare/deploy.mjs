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
 * `--dry-run` prints the exact commands (including the guard preflight) and
 * executes NOTHING — and never requires a credential or a confirmation.
 *
 * A real execute runs an ordered pipeline before touching Cloudflare:
 *   guard-no-dev-seed → resolveCredential → confirmProduction → execute.
 * The Cloudflare credential is resolved purely by context — an env token
 * (`CF_API_TOKEN`, RFC-canonical) or an existing `wrangler login` session — and
 * is never prompted for. App runtime secrets (JWT_SECRET, R2_*, …) are never
 * read; they persist on the Worker across deploys.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { run, confirmProduction } from '../deploy/core.mjs';
import log from '../lib/log.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(dirname(__filename))); // scripts/cloudflare/.. → repo root

/** Map one provider-neutral plan step to a concrete command. */
function stepToCommand(step) {
  switch (step.kind) {
    case 'build-shared':
      return {
        title: 'Build shared package',
        argv: ['pnpm', 'turbo', 'build', '--filter', '@arenaquest/shared'],
      };
    case 'migrate':
      return {
        title: `Apply D1 migrations (${step.d1Name})`,
        argv: [
          'pnpm', '--filter', 'api', 'exec', 'wrangler',
          'd1', 'migrations', 'apply', step.d1Name, '--env', step.wranglerEnv, '--remote',
        ],
      };
    case 'deploy-worker':
      return {
        title: 'Deploy API worker',
        argv: ['pnpm', '--filter', 'api', 'exec', 'wrangler', 'deploy', '--env', step.wranglerEnv],
      };
    case 'build-web':
      return {
        title: 'Build web (brand-parametrised)',
        argv: ['pnpm', '--filter', 'web', 'pages:build'],
        env: step.brandVars,
      };
    case 'deploy-pages':
      return {
        title: `Deploy web Pages (${step.pagesProject})`,
        argv: [
          'pnpm', '--filter', 'web', 'exec', 'wrangler',
          'pages', 'deploy', '.vercel/output/static', `--project-name=${step.pagesProject}`,
        ],
      };
    default:
      throw new Error(`unknown plan step kind: ${step.kind}`);
  }
}

/** Human-readable one-liner for a command (with any env-var prefix). */
function renderCommand(c) {
  const prefix = c.env && Object.keys(c.env).length
    ? Object.entries(c.env).map(([k, v]) => `${k}=${JSON.stringify(String(v))}`).join(' ') + ' '
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
 * Build the guard-no-dev-seed preflight command. Runs the existing, unmodified
 * `apps/api/scripts/check-no-dev-seed.ts` against the resolved D1 database.
 * `--env` is passed only for staging (matching the Makefile, which omits it for
 * production).
 */
function guardCommand({ d1Name, env, wranglerEnv }) {
  const argv = [
    'pnpm', '--filter', 'api', 'exec', 'tsx', 'scripts/check-no-dev-seed.ts',
    '--db', d1Name,
  ];
  if (env === 'staging') argv.push('--env', wranglerEnv);
  return { title: `Guard: no dev-seed in ${d1Name}`, argv };
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

async function main() {
  let result;
  try {
    result = run(process.argv.slice(2));
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
    log.hint('Fix the offending key(s) in config/labels/<label>.jsonc, then re-run.');
    process.exit(1);
  }

  const commands = result.plan.map(stepToCommand);
  const wranglerEnv = wranglerEnvName(args.label, args.env);
  const guard = guardCommand({
    d1Name: result.envConfig.d1.name,
    env: args.env,
    wranglerEnv,
  });

  log.heading(
    `Deploy ${args.label} → ${args.env} (scope: ${args.scope})${args.dryRun ? '  [dry-run]' : ''}`,
  );

  // --dry-run: print the guard preflight + the exact commands, execute nothing.
  // No credential and no confirmation are required to preview.
  if (args.dryRun) {
    log.info('Dry run — these commands would run (nothing is executed):');
    log.ok(guard.title);
    log.cmd(renderCommand(guard));
    for (const c of commands) {
      log.ok(c.title);
      log.cmd(renderCommand(c));
    }
    process.exit(0);
  }

  // ── Real execution pipeline: guard → credential → confirm → execute ─────────

  // 1. guard-no-dev-seed preflight — a tainted target aborts before any deploy.
  log.info(guard.title);
  log.cmd(renderCommand(guard));
  const g = spawnSync(guard.argv[0], guard.argv.slice(1), { cwd: ROOT, stdio: 'inherit' });
  if (g.status !== 0) {
    log.die(
      `Preflight guard failed (exit ${g.status ?? 'signal'}) — aborting before any deploy step.`,
      g.status || 1,
    );
  }

  // 2. Resolve the Cloudflare credential by context (never prompted for).
  const cred = resolveCredential();
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
  for (const c of commands) {
    log.info(c.title);
    log.cmd(renderCommand(c));
    const res = spawnSync(c.argv[0], c.argv.slice(1), {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...cred.env, ...(c.env || {}) },
    });
    if (res.status !== 0) {
      log.die(`Step "${c.title}" failed (exit ${res.status ?? 'signal'}).`, res.status || 1);
    }
  }

  log.ok(`Deploy complete: ${args.label} → ${args.env}.`);
}

main();
