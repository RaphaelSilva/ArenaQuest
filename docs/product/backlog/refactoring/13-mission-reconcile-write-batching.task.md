# Task 13 — Backend: Batch the mission reconciliation writes

**Status:** 📝 Open
**Kind:** Tech Debt
**Team:** Backend API
**Priority:** Low
**Found in:** Milestone 27, Task 08 (RFC 0022 section 4 step 4), 2026-10-03

## Summary

The daily mission reconciliation (`apps/api/src/jobs/reconcile-missions.ts`, called from
`scheduled()` and from `POST /v1/admin/missions/{id}/reconcile`) counts evidence set-based — one
`countForRequirement` query per requirement for every enrollment — but then applies the result one
row at a time through `MissionEvaluator.reconcileMission` → `evaluateRuns`
(`packages/shared/domain/gamification/mission-evaluator.ts`): one `listStepProgress` read per
enrollment, one conditional `completeStep` or `setPartialCount` per changed step, and one
`findProgress` / `upsertProgress` per enrollment for the mission aggregate. The writes are
write-once and change-only, so the result is correct and idempotent, but the statement count is
O(enrollments), not the O(missions × requirements) statements plus `db.batch` chunks of 100 that
RFC 0022 §4 step 4 specifies. The target state: the reconciliation path reads step progress for the
whole mission in one statement and applies completions, partial counts and aggregates in
`db.batch` chunks of 100, with identical results. No user-visible behaviour changes.

## Why It Is Worth Fixing

- D1 caps the queries one Worker invocation may run; `scheduled()` also runs billing and the
  submission sweep. A mission with a few hundred enrollments and several steps could reach the cap,
  and the run would then count the mission as `failed` and leave it to the next day.
- Evidence: M27 Task 08's closing note records the criterion as **not met** ("completions and partial
  counts are still written one row at a time … a set-based writer in the evaluator is the
  follow-up"); the M27 closeout lists it as the milestone's one known gap.
- The hook path (one user) does not have this problem and must keep its single-row writes.

## Scope

In:
- A set-based progress read for one mission (every enrollment's step rows in one statement) on
  `IMissionParticipationRepository`, and a batch writer that applies a list of completions
  (conditional on `completed_at IS NULL`, reporting which rows actually changed) and partial counts
  (change-only) in `db.batch` chunks of 100.
- `reconcileMission` uses them; step and mission rewards are still granted only for rows the batch
  reports as changed, through the same `xp_events` idempotency keys, and the badge path is unchanged.
- Specs: the existing reconciliation specs pass unchanged; a new spec reconciles a mission with more
  than 100 enrollments and asserts the outcome equals the per-row path, that a second run changes no
  row, and that the statement count stays bounded by requirements, not enrollments.

Out:
- The hook path and the manual check (`onSignal`, `check`) — single-user, they keep their writes.
- Materialising enrollments and backfilling evidence — already one set-based statement each.
- The admin participants listing's per-enrollment reads (Task 05 follow-up) — a separate task if
  rosters grow.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/domain/gamification/mission-evaluator.ts`
  - `packages/shared/ports/i-mission-participation-repository.ts`
  - `apps/api/src/adapters/db/d1-mission-participation-repository.ts`
  - `apps/api/src/jobs/reconcile-missions.ts` (only if the report needs a new count)
  - `apps/api/test/**`
- No migration: the existing primary keys and `completed_at IS NULL` guard are enough.
- Monotonic as today: a batch never clears a `completed_at` or a `completed` flag, and the
  `reconcile` origin still records no streak activity.

## Acceptance Criteria

- [ ] On a mission with 250 enrollments and 3 steps, the reconciliation issues at most a bounded
      number of statements independent of the enrollment count (asserted in the spec) and produces
      the same `mission_requirement_progress`, `mission_progress`, `xp_events` and `user_badges` rows
      as the per-row path.
- [ ] Running `scheduled()` twice in a row still changes no row the second time.
- [ ] `apps/api/test/db/reconcile-missions.spec.ts` and `apps/api/test/core/gamification/mission-evaluator.spec.ts`
      pass unchanged.
- [ ] `make test-api` and `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — existing specs pass unchanged (proves no behaviour change).
2. Demonstrate the guard: revert the evaluator to the per-row writer locally and confirm the
   statement-count assertion fails, then restore it.
3. `git diff --stat` confirms only scope-guardrail files changed.
