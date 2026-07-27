# Task 02 — Backend: Cloud-agnostic core and Cloudflare adapter with preflight and dry-run (Phase 1)

**Status:** 📝 Open
**Milestone:** [17 — Branded deploy CLI - label-parametrized CI-independent release script](./milestone.md)
**RFC:** [RFC 0011](../../RFCs/0011-branded-deploy-cli-label-parametrized-ci-independent-release.md)
**Team:** Backend API

## Summary

Build the heart of the deploy CLI: a cloud-agnostic core that resolves *what* to
deploy and a Cloudflare entrypoint that executes *how*. `scripts/deploy/core.mjs`
(new, stdlib-only Node) parses the CLI arguments (`--label`, `-e|--env`,
`--scope`, `--yes`, `--dry-run`), loads and parses `config/labels/<label>.jsonc`,
and resolves every deploy value by calling the existing pure resolvers in
`scripts/label.mjs` (`deriveExpected`, `buildResolved`); it then runs a
fail-closed preflight (`checkPresence`/`checkCoherence`/`checkPolicy`/`mapExitCode`)
that aborts before any mutation on a hard config gap, printing the offending key,
and emits a **provider-neutral deploy plan**. `scripts/cloudflare/deploy.mjs`
(new) is the entrypoint an operator runs: it imports the core, and — when not a
dry run — turns the plan into `wrangler` invocations (`d1 migrations apply`,
`deploy`, `pages deploy`) via `node:child_process`, running the repo-pinned
wrangler through `pnpm --filter api exec wrangler`. `scripts/lib/log.mjs` (new)
mirrors the `ok`/`warn`/`fail`/`die`/`heading` vocabulary of `scripts/lib/log.sh`.
This task stops at reading credentials from the environment only and printing the
plan under `--dry-run`; interactive credential resolution and the production
confirmation gate are Task 03. The invariant later tasks and a future second
cloud depend on: `core.mjs` imports no `wrangler` and no cloud SDK.

## Dependencies

- None — independent of Task 01 (that is a CI hotfix). It is the foundation Tasks
  03 and 04 build on.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/deploy/core.mjs` — new, cloud-agnostic: arg parse, profile load,
    resolve via `label.mjs`, preflight gate, provider-neutral plan builder.
  - `scripts/cloudflare/deploy.mjs` — new, Cloudflare entrypoint/adapter with a
    `#!/usr/bin/env node` shebang: imports the core, turns the plan into
    `wrangler` calls (`d1 migrations apply`, `deploy`, `pages deploy`), and honors
    `--dry-run` by printing the exact commands without executing.
  - `scripts/lib/log.mjs` — new JS logging module mirroring `scripts/lib/log.sh`.
  - `scripts/**` test files (e.g. `scripts/deploy/core.test.mjs`) — `node:test`
    unit tests, mirroring `scripts/label.test.mjs`.
- **Reuse, do not fork.** `scripts/label.mjs`, `config/labels/<label>.jsonc`, and
  `config/deployment.schema.jsonc` are consumed as-is; their logic and shape are
  not modified. No new per-brand config format is introduced.
- **Cloud-agnostic core.** `scripts/deploy/core.mjs` must import no `wrangler` and
  no cloud SDK — the provider boundary is the module graph, not an `if (cloud …)`
  branch. This is asserted by a unit test so a future `scripts/<cloud>/deploy.mjs`
  reuses the core unchanged.
- **Fully Node, stdlib only.** `node:util` (args), `node:fs`/`node:path` (profile),
  `node:child_process` (spawn wrangler). No bash step layer; no third-party deps.
- **Fail closed.** A preflight hard gap (`mapExitCode` → 1) aborts with a non-zero
  exit before any migration or deploy; the offending key is printed.
- **No secret handling here.** Credentials are read from the environment only;
  interactive resolution and prod confirmation are Task 03. No app runtime secret
  (`JWT_SECRET`, `R2_*`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`) is read.

## Scope

In:
- The argument parser for `--label` (required), `-e|--env` (`staging|production`
  only), `--scope` (`api|web|all`, default `all`), `--yes`, `--dry-run`.
- Profile load + resolution via `label.mjs`; the provider-neutral plan builder
  keyed off `resolved.<worker|pagesProject|d1.name|bucket>` and brand vars.
- The preflight gate reusing `checkPresence`/`checkCoherence`/`checkPolicy`/
  `mapExitCode`, aborting before mutation on a hard gap.
- The Cloudflare executor turning the plan into `wrangler` commands, plus the
  `--dry-run` path that prints those exact commands and mutates nothing.
- `scripts/lib/log.mjs` and the `node:test` unit tests for the arg parser and the
  plan builder, including the assertion that `core.mjs` has no `wrangler`/cloud import.

Out:
- Interactive credential resolution, `wrangler login` session detection, and the
  production confirm-by-typing-the-label gate (Task 03).
- `guard-no-dev-seed` preflight wiring (Task 03).
- Makefile targets and CI matrix changes (Task 04).
- Any change to `label.mjs`, the label profiles, or the deployment schema.

## Acceptance Criteria

- [ ] `node scripts/cloudflare/deploy.mjs --label <label> -e <env> --dry-run`
      prints the exact `wrangler` commands (per `--scope`) and mutates nothing.
- [ ] A deploy against a label with a missing required key **or** a wildcard
      `ALLOWED_ORIGINS` in staging/production aborts before any mutation with a
      non-zero exit, printing the offending key.
- [ ] Values are resolved solely from `config/labels/<label>.jsonc` via `label.mjs`
      — no brand value is read from or written to any other location.
- [ ] A `node:test` unit test asserts `scripts/deploy/core.mjs` imports no
      `wrangler` and no cloud SDK.
- [ ] `node:test` unit tests cover the arg parser and the plan builder; `make lint`
      passes green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/deploy/` (or the repo's `node:test` runner) — the arg
   parser, plan builder, and the no-cloud-import assertion pass.
2. `node scripts/cloudflare/deploy.mjs --label spaziord -e staging --dry-run` —
   inspect the printed `wrangler` commands (d1 migrate, worker deploy, pages
   deploy) against `config/labels/spaziord.jsonc`; confirm nothing is executed.
3. Run the CLI against a deliberately incomplete/wildcard-`ALLOWED_ORIGINS`
   profile and confirm it aborts non-zero, naming the offending key, before any
   `wrangler` call.
4. `make lint` — green.
5. `git diff --stat` confirms only scope-guardrail files under `scripts/` changed.
