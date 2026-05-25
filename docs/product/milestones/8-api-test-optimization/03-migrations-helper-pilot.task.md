# Task 03 — Introduce `apply-migrations` helper + pilot 5 files (P4 phase 1)

**Status:** ⏳ Pending
**Milestone:** [8 — `apps/api` Test Suite Optimization](./milestone.md)
**RFC:** [0001 §P4](../../RFCs/0001-apps-api-test-suite-optimization.md)

## Summary

Create a shared test helper that applies migrations to a D1 binding so that specs stop redeclaring `CREATE TABLE IF NOT EXISTS …` inline. Roll it out on 5 representative spec files as a pilot; the remaining files are migrated in Task 10.

## Dependencies

None — can run in parallel with Task 01. Unblocks Task 10.

## Technical Constraints

- **Scope guardrail:** new code limited to `apps/api/test/helpers/**`; edits limited to the 5 pilot spec files. **No edits to `apps/api/migrations/**`** — those are the source of truth.
- The helper reads SQL from the canonical `apps/api/migrations/**` folder so any future migration is reflected automatically. A curated subset selector (by feature name) is acceptable as a secondary mode, as long as the default reads the real migrations.
- The helper must work inside the `workers` Vitest project (D1 binding via `cloudflare:test`).
- No new runtime dependency in `apps/api/package.json`.

## Scope

In:
- New file `apps/api/test/helpers/apply-migrations.ts` exposing a single entry point that applies migrations against a provided D1 binding, with an optional argument to restrict to a named feature subset.
- Pilot adoption in 5 spec files chosen across feature areas (suggested: one per area — users, topics, media, gamification, comments). Each must replace its inline `CREATE TABLE` block with a single helper call.
- Brief usage notes appended to (or seeded into) `apps/api/test/README.md` if it exists; otherwise leave full docs to Task 05.

Out:
- Migrating the remaining ~24 spec files (Task 10).
- Refactoring the migrations folder structure.

## Acceptance Criteria

- [ ] Helper file exists and is unit-tested at least implicitly by the pilot specs running green.
- [ ] All 5 pilot specs use the helper and no longer contain inline `CREATE TABLE` text.
- [ ] Helper reads migrations from `apps/api/migrations/**` by default; adding a new migration there is reflected automatically in the pilot specs without code changes in tests.
- [ ] `make test-api` and `make lint` pass.
- [ ] No diff outside `apps/api/test/helpers/**` and the 5 pilot spec files.

## Verification Plan

1. Run the 5 pilot specs in isolation and confirm green.
2. Add a temporary no-op migration in a sandbox branch and verify the pilot specs still pass without edits (sanity for auto-discovery).
3. Run the full suite and confirm green.
