# Task 04 — Consolidate auth-enforcement assertions (P3)

**Status:** ✅ Completed
**Milestone:** [8 — `apps/api` Test Suite Optimization](./milestone.md)
**RFC:** [0001 §P3 / §D3](../../RFCs/0001-apps-api-test-suite-optimization.md)

## Summary

Make `test/middleware/auth-guard.spec.ts` the single source of truth for the "401 without token" and "403 with wrong role" matrix. Remove the repetitive `endpoints.forEach(…)` loops from per-router specs, keeping at most one smoke per router.

## Dependencies

None.

## Technical Constraints

- **Scope guardrail:** changes restricted to `apps/api/test/**`. No production code changes.
- `auth-guard.spec.ts` must cover the matrix generically (typed endpoint list, both unauthenticated and wrong-role cases) — extend it if any per-router loop catches a case not represented there.
- Each router spec retains **at most one** auth smoke (e.g., "admin route requires admin", "public-only route requires login").

## Scope

In:
- Audit `auth-guard.spec.ts` and extend it to cover any endpoint shape currently only exercised in per-router loops.
- Remove the `endpoints.forEach(...)` loops from `admin-users.router.spec.ts`, `admin-topics.router.spec.ts`, and any other router spec that does the same.
- Leave a single smoke per router referencing the auth-guard behaviour.

Out:
- Changing the auth guard implementation in `apps/api/src/**`.
- Touching controller specs.

## Acceptance Criteria

- [x] `auth-guard.spec.ts` covers every endpoint protection shape currently asserted in per-router loops.
- [x] No router spec contains a generic `endpoints.forEach` loop for 401/403 matrices.
- [x] Each router spec keeps at most one auth smoke.
- [x] `make test-api` and `make lint` pass.
- [x] No diff outside `apps/api/test/**`.

## Verification Plan

1. Grep for `endpoints.forEach` and similar patterns in `apps/api/test/routes/**` — expect zero hits after the task.
2. Confirm `auth-guard.spec.ts` test count grew to cover the previously per-router cases.
3. Full suite green.
