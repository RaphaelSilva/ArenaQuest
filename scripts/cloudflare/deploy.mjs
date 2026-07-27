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
 * `--dry-run` prints the exact commands and executes NOTHING. Real execution
 * reads the Cloudflare credential from `process.env` only — no prompting, no
 * `wrangler login` session detection, no production confirmation (Task 03).
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { run } from '../deploy/core.mjs';
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

function main() {
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

  log.heading(
    `Deploy ${args.label} → ${args.env} (scope: ${args.scope})${args.dryRun ? '  [dry-run]' : ''}`,
  );

  // --dry-run: print the exact commands, execute nothing.
  if (args.dryRun) {
    log.info('Dry run — these commands would run (nothing is executed):');
    for (const c of commands) {
      log.ok(c.title);
      log.cmd(renderCommand(c));
    }
    process.exit(0);
  }

  // Real execution: credential must be in the environment (Task 02 scope).
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    log.die(
      'CLOUDFLARE_API_TOKEN is not set — cannot execute wrangler. ' +
        'Interactive credential resolution is Task 03; re-run with --dry-run to preview.',
    );
  }

  for (const c of commands) {
    log.info(c.title);
    log.cmd(renderCommand(c));
    const res = spawnSync(c.argv[0], c.argv.slice(1), {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...(c.env || {}) },
    });
    if (res.status !== 0) {
      log.die(`Step "${c.title}" failed (exit ${res.status ?? 'signal'}).`, res.status || 1);
    }
  }

  log.ok(`Deploy complete: ${args.label} → ${args.env}.`);
}

main();
