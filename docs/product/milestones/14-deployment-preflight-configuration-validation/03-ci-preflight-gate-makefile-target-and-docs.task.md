# Task 03 — Backend: CI preflight gate, Makefile target, and docs (Phase 3)

**Status:** 📝 Open
**Milestone:** [14 — Deployment preflight & configuration validation](./milestone.md)
**RFC:** [RFC 0007](../../RFCs/0007-deployment-preflight-and-config-validation.md)
**Team:** Backend API

## Summary

Wire the validator built in Tasks 01–02 into the two run sites that make it
operationally useful and document the workflow. This task adds a `preflight` gate
job to `.github/workflows/deploy-web.yml` and `deploy-api.yml`, placed between the
existing `verify` job and the `deploy-*` jobs, running inside the target GitHub
`environment:` so `CF_API_TOKEN` / `CF_ACCOUNT_ID` and environment `vars` are in
scope; it runs `node scripts/preflight.mjs --env <staging|production>` and the
`deploy-*` jobs gain `needs:` it, so a failed preflight blocks the deploy with an
explicit checklist instead of a green deploy that 500s at runtime. The
`--check-drift` mode is added to the `verify` job so manifest/`wrangler.jsonc`/
`*.example` divergence is caught early. In CI, a skipped secret-listing
(missing credentials) is treated as a hard failure per the milestone decision. An
additive `make preflight` target (`ENV` defaulting to `local`) is added without
altering any existing deploy target, and the runbook/README documents the rule:
"adding a new env var → add it to the manifest **and** the relevant `*.example`."
No deploy behaviour changes on a healthy environment — the gate passes silently.

## Dependencies

- [Task 02 — Coherence, policy, and drift checks](./02-coherence-policy-and-drift-checks.task.md)
  — hard dependency: CI invokes the full validator (env mode + `--check-drift`),
  which only exists after Tasks 01–02.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `.github/workflows/deploy-web.yml`, `.github/workflows/deploy-api.yml` — add a
    `preflight` gate job inside the target `environment:`, add `needs:` on the
    `deploy-*` jobs, and add `--check-drift` to `verify`. No other pipeline step
    is altered.
  - `Makefile` — add an **additive** `preflight` target; do not touch existing
    `deploy-*` / `dev-*` / `db-*` targets.
  - `docs/product/RFCs/README.md` and/or a runbook doc — the "new env var →
    manifest + `*.example`" workflow note and RFC index/status update.
  - Does not touch `scripts/preflight.mjs`, the manifest, `apps/api/src`, or the
    `apps/web` app (the validator is finished in Tasks 01–02; this task only
    invokes and documents it).
- **No deploy-path behaviour change on green.** The gate only *adds* a `needs:`
  dependency and a check job; a fully-configured environment deploys exactly as
  today.
- **CI hard-fails on skipped secret-listing.** In the deploy environment CF
  credentials are always present, so exit `2` from a skipped secret list must fail
  the job (configure the invocation/flag so `2` blocks in CI).
- **Same implementation, both sites.** Local (`make preflight`) and CI invoke the
  identical `scripts/preflight.mjs`; no logic is duplicated into YAML.
- **`ci-secrets` best-effort.** The GitHub-environment secret check degrades to a
  skipped-with-notice when `gh` is absent/unauthenticated, per the milestone
  decision.

## Scope

In:
- `preflight` gate job in both deploy workflows, in the correct `environment:`,
  supplying `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` from `CF_API_TOKEN` /
  `CF_ACCOUNT_ID`.
- `deploy-*` jobs updated to `needs: [verify, preflight]`.
- `--check-drift` added to the `verify` job.
- Additive `make preflight` target (`ENV` defaulting to `local`).
- Runbook/README documentation of the "add a var → manifest + `*.example`"
  workflow and RFC 0007 status/index update.

Out:
- Any change to the validator logic or manifest (done in Tasks 01–02).
- Building, deploying, or altering existing deploy steps beyond the `needs:` gate.
- Post-deploy smoke tests (deferred, separate RFC).

## Acceptance Criteria

- [ ] `deploy-web.yml` and `deploy-api.yml` each have a `preflight` job in the
      target `environment:` that the `deploy-*` job `needs:`; a failing preflight
      blocks the deploy (deploy job does not run).
- [ ] A fully-configured environment passes preflight silently and deploys exactly
      as before (no behaviour change on green).
- [ ] In CI, a skipped secret-listing (missing CF credentials) fails the job, not
      a false green.
- [ ] `verify` runs `--check-drift` and fails on manifest/`wrangler.jsonc`/
      `*.example` divergence.
- [ ] `make preflight ENV=staging` (and `production`, `local`) runs the validator;
      existing deploy targets are unchanged.
- [ ] The runbook/README documents the "new env var → manifest + `*.example`" rule.
- [ ] `make lint`, `make test-api`, and `make test-web` stay green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Open a PR / push to a branch and confirm the `preflight` job appears between
   `verify` and `deploy-*` in both workflows and gates the deploy (inspect the
   Actions run graph).
2. Force a preflight failure (e.g. a deliberately broken staging var on a test
   branch) and confirm the `deploy-*` job is skipped/blocked with the checklist.
3. `make preflight ENV=local` and `ENV=staging` run the validator from the
   Makefile; confirm existing `deploy-*` targets are untouched (`git diff` the
   Makefile).
4. `make lint`, `make test-api`, `make test-web` — all green.
5. `git diff --stat` confirms only the two workflows, `Makefile`, and the
   doc/README changed.
