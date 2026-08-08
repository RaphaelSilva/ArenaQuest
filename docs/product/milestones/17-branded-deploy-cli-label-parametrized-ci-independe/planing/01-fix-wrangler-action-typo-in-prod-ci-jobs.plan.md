# Plan — Task 01: Fix wrangler-action typo in prod CI jobs (Phase 0)

**Task:** [01-fix-wrangler-action-typo-in-prod-ci-jobs.task.md](../01-fix-wrangler-action-typo-in-prod-ci-jobs.task.md)
**Persona:** Backend/infra (CI workflows). No app code.
**Branch:** `feature/m17/01-fix-wrangler-action-typo-in-prod-ci-jobs.task`

## Confirmed current state

`grep -rn "v3raphael" .github/workflows/` returns exactly two hits, both in
`deploy-api.yml`:
- `deploy-api.yml:167` — `uses: cloudflare/wrangler-action@v3raphael`
- `deploy-api.yml:209` — `uses: cloudflare/wrangler-action@v3raphael`

`deploy-web.yml` has no `@v3raphael` occurrence (all four refs already `@v3`).
Every other `wrangler-action` reference in `deploy-api.yml` is already `@v3`.

## Change

Replace `cloudflare/wrangler-action@v3raphael` → `cloudflare/wrangler-action@v3`
at both occurrences in `.github/workflows/deploy-api.yml`. Nothing else: no job
restructure, no matrix, no database-name change (that is Task 04).

## Files (scope guardrail)

- `.github/workflows/deploy-api.yml` — the only file changed (2 lines).
- `.github/workflows/deploy-web.yml` — inspected only; no change needed.

## Verification

1. `grep -rn "v3raphael" .github/workflows/` → zero matches.
2. All `wrangler-action` refs read `@v3`.
3. YAML still parses (structure unchanged apart from the version pin).
4. `git diff --stat` shows only `deploy-api.yml`, 2 lines changed.

## Notes for the next tasks

Task 04 later collapses the duplicated per-brand prod jobs (`deploy-prod-spaziord`,
`deploy-prod-budo`) into a single `matrix.label` job, removing these stanzas
entirely — so this fix is a bridge that keeps multi-brand prod runnable until then.
