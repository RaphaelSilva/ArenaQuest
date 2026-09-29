# Task 01 — Backend: Wrangler 4.135 and staging deploys through the CLI (Phase 0)

**Status:** 📝 Open
**Milestone:** [26 — Release-candidate previews and demo seed](./milestone.md)
**RFC:** [RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md)
**Team:** Backend API

## Summary

Makes the repo able to create Workers Previews and puts every staging release on the one
release path. Wrangler moves from `^4.82.2` to `>= 4.135.0` in both `apps/api` and
`apps/web` (Workers Previews require it; the lockfile is regenerated with pnpm, never by
hand), and the existing deploy CLI, provisioner and migration commands are re-verified on
the new version. The staging jobs of `.github/workflows/deploy-api.yml` and
`deploy-web.yml`, which today call wrangler directly against the legacy hand-written
`staging` env block with a hard-coded API URL and skip the no-dev-seed guard, are rewritten
to call `node scripts/cloudflare/deploy.mjs --label arenaquest -e staging --yes
--scope api|web`, so staging goes through the same guard, migration and brand derivation as
production. Task 11 builds the `previews` block on the new wrangler; Task 12 adds the
`--preview` mode to the CLI these jobs now call.

## Dependencies

- None — independent.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/package.json`, `apps/web/package.json`, `pnpm-lock.yaml` — the wrangler range
    only (the `apps/web/` touch is a devDependency bump, not frontend work; no file under
    `apps/web/src/` changes).
  - `.github/workflows/deploy-api.yml`, `.github/workflows/deploy-web.yml` — the staging jobs
    only; production matrix jobs unchanged.
  - `docs/onboarding.md` — the one line naming the staging CI path.
- **Single release path.** No wrangler command string is added to a workflow; the staging job
  invokes the deploy CLI exactly as the production matrix does (same secrets:
  `CF_API_TOKEN`, `CF_ACCOUNT_ID`, GitHub Environment `staging`).
- **Legacy `staging` env block stays** in `wrangler.jsonc` for now (removing it is not in this
  milestone); the CLI targets `arenaquest-staging`.
- **No behaviour change for production.** The production matrix jobs are untouched.

## Scope

In:
- Bump wrangler in both apps and regenerate the lockfile with `pnpm install`.
- Confirm `wrangler preview --help` is available from `pnpm --filter api exec`.
- Re-run `make test-scripts` and a `deploy.mjs --dry-run` for each label/env on the new
  version; fix any output-parsing drift the bump causes inside `scripts/deploy/core.mjs`
  only if a test proves it.
- Rewrite both staging jobs to call the deploy CLI with `--scope api` / `--scope web`.

Out:
- The `previews` block (Task 11) and the `--preview` mode (Task 12).
- Deploying other labels' staging from CI (the preview workflow in Task 12 covers labels).

## Acceptance Criteria

- [ ] `pnpm --filter api exec wrangler --version` and the web equivalent report `>= 4.135.0`.
- [ ] `pnpm --filter api exec wrangler preview --help` exits 0.
- [ ] `make test-scripts` green; `deploy.mjs --label <l> -e staging --dry-run` prints the same
      plan as before the bump for all three labels.
- [ ] The staging jobs in both workflows contain no direct `wrangler deploy` / `d1 migrations
      apply` / `pages deploy` call and invoke `scripts/cloudflare/deploy.mjs`.
- [ ] The staging API job's log shows the "Guard: no dev-seed" step.
- [ ] `make lint`, `make test-api` and `make test-web` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `pnpm install` then the two `wrangler --version` calls and `wrangler preview --help`.
2. `make test-scripts`; `node scripts/cloudflare/deploy.mjs --label budo -e staging --dry-run`
   (and for arenaquest, spaziord) — compare with the pre-bump output.
3. Push the branch and run the staging workflow (or `act`) — confirm the guard step and a
   successful deploy.
4. `make lint && make test-api && make test-web`.
5. `git diff --stat` confirms only scope-guardrail files changed.
