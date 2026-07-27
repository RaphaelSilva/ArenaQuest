# Task 01 — Backend: Fix wrangler-action typo in prod CI jobs (Phase 0)

**Status:** 📝 Open
**Milestone:** [17 — Branded deploy CLI - label-parametrized CI-independent release script](./milestone.md)
**RFC:** [RFC 0011](../../RFCs/0011-branded-deploy-cli-label-parametrized-ci-independent-release.md)
**Team:** Backend API

## Summary

The multi-brand production deploy is silently broken today: the SpazioRD and Budo
prod jobs in `.github/workflows/deploy-api.yml` reference a non-existent action,
`cloudflare/wrangler-action@v3raphael` (a typo), which fails at runtime. This task
replaces every occurrence of `@v3raphael` with the correct `@v3` across the deploy
workflows so that multi-brand prod is functional while the CLI (Task 02+) lands.
It is a standalone, immediately shippable fix and depends on nothing; Task 04
later collapses these per-brand jobs into a single matrix, at which point the
duplicated stanzas disappear entirely — but this task keeps the existing shape
and only corrects the version pin.

## Dependencies

- None — independent. This is the Phase 0 hotfix and can ship ahead of the CLI.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `.github/workflows/deploy-api.yml` — replace `cloudflare/wrangler-action@v3raphael`
    with `cloudflare/wrangler-action@v3` in every job that references it.
  - `.github/workflows/deploy-web.yml` — same correction if the typo appears there too.
- **Minimal, surgical change.** Only the action version pin is touched; do not
  restructure jobs, rename steps, change database names, alter matrix strategy,
  or collapse the duplicated per-brand jobs — that is Task 04's scope.
- **No behavioural drift.** The corrected jobs must otherwise run exactly as
  authored (same triggers, same inputs, same secrets); the only difference is
  that the referenced action now exists.

## Scope

In:
- Correct the `@v3raphael` → `@v3` typo in all affected `deploy-api.yml` jobs
  (`deploy-prod-spaziord`, `deploy-prod-budo`, and any other occurrence).
- Grep the whole `.github/workflows/` tree to confirm no other `@v3raphael`
  reference remains anywhere.

Out:
- Collapsing the per-brand jobs into a matrix (Task 04).
- Any change to the deploy CLI, Makefile, or config profiles.
- Any change to hardcoded database names (Task 04 removes those via the CLI).

## Acceptance Criteria

- [ ] `grep -rn "@v3raphael" .github/workflows/` returns zero matches.
- [ ] Every `cloudflare/wrangler-action` reference in `deploy-api.yml` (and
      `deploy-web.yml` if present) pins `@v3`.
- [ ] The workflow YAML remains valid (jobs, steps, and matrix unchanged apart
      from the version pin) — confirmed by a YAML lint / GitHub Actions parse.
- [ ] `make lint` passes green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `grep -rn "wrangler-action@" .github/workflows/` — confirm all references read
   `@v3` and none read `@v3raphael`.
2. Validate the workflow files parse as valid YAML (e.g. `actionlint` or the
   editor's Actions schema) — no structural change beyond the version pin.
3. `make lint` — green.
4. `git diff --stat` confirms only `.github/workflows/deploy-api.yml` (and
   `deploy-web.yml` if it had the typo) changed.
