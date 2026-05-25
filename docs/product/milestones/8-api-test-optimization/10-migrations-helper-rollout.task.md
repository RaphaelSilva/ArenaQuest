# Task 10 — Roll out migrations helper to remaining ~24 spec files (P4 phase 2)

**Status:** ✅ Done
**Milestone:** [8 — `apps/api` Test Suite Optimization](./milestone.md)
**RFC:** [0001 §P4](../../RFCs/0001-apps-api-test-suite-optimization.md)

## Summary

Migrate every remaining spec that declares inline `CREATE TABLE IF NOT EXISTS …` blocks to use the `apply-migrations` helper introduced in Task 03. After this task, no spec file should contain inline schema DDL.

## Dependencies

Task 03 (helper exists and is proven on 5 pilot files).

## Technical Constraints

- **Scope guardrail:** `apps/api/test/**` only (and conceivably `apps/api/test/helpers/**` if the helper needs small extensions discovered during rollout — but **not** `apps/api/migrations/**` or `apps/api/src/**`).
- The helper must continue to read from `apps/api/migrations/**` so any future migration is reflected automatically.
- If a spec needs a curated subset of tables for speed, use the helper's subset selector — do not reintroduce inline DDL.

## Scope

In:
- Identify all spec files (~24 remaining) that contain `CREATE TABLE IF NOT EXISTS` blocks.
- Replace each with a helper call.
- Remove now-unused `MIGRATION_SQL` constants and imports.

Out:
- Changing migration files in `apps/api/migrations/**`.
- Refactoring the helper's public surface (allowed: additive subset filters).

## Acceptance Criteria

- [x] Repo-wide grep for `CREATE TABLE IF NOT EXISTS` inside `apps/api/test/**` returns zero matches.
- [x] All migrated specs run green.
- [x] `make test-api` and `make lint` pass.
- [x] Wall-time impact (positive or neutral) recorded for the closeout.
- [x] No diff outside `apps/api/test/**`.

## Verification Plan

1. Grep before/after for the DDL pattern.
2. Run the full suite and confirm green.
3. Record wall-time delta.
