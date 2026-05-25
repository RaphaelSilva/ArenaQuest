# Task 08 — Refactor `admin-users` controller/router pair (P2)

**Status:** ✅ Done
**Milestone:** [8 — `apps/api` Test Suite Optimization](./milestone.md)
**RFC:** [0001 §P2 / §D2](../../RFCs/0001-apps-api-test-suite-optimization.md)

## Summary

Apply the Task 05 convention to the `admin-users` pair. The router spec is the slowest file in the suite (8.8 s / 53 tests) so the speed-up impact is meaningful here.

## Dependencies

Task 05. Task 04 (auth-enforcement consolidation) must already have removed the 401/403 loops from this file.

## Technical Constraints

- **Scope guardrail:** `apps/api/test/**` only.
- Admin-lockout-guard scenarios (cannot delete last active admin, no self-lockout) live in the controller spec; the router spec keeps an HTTP smoke per endpoint only.
- Keep ≥ 1 HTTP smoke per endpoint in the router spec.

## Scope

In:
- Cross-reference `admin-users.router.spec.ts` against `admin-users.controller.spec.ts`.
- Backfill missing controller-spec coverage for admin-lockout, role-change, deactivation, etc.
- Trim the router spec to HTTP smokes.

Out:
- Other pairs.

## Acceptance Criteria

- [x] `admin-users.router.spec.ts` reduced to HTTP smokes (≥ 1 per endpoint).
- [x] `admin-users.controller.spec.ts` covers every removed business-rule branch (lockout guards explicitly listed in PR).
- [x] `make test-api` and `make lint` pass.
- [x] No diff outside `apps/api/test/**`.

## Verification Plan

1. PR description: before/after scenario list, calling out admin-lockout-guard coverage explicitly.
2. Full suite green.
