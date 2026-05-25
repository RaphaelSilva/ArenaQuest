# Task 06 — Refactor `admin-topics` controller/router pair (P2)

**Status:** ✅ Done
**Milestone:** [8 — `apps/api` Test Suite Optimization](./milestone.md)
**RFC:** [0001 §P2 / §D2](../../RFCs/0001-apps-api-test-suite-optimization.md)

## Summary

Apply the convention documented in Task 05 to the `admin-topics` pair: trim `admin-topics.router.spec.ts` to HTTP-only smokes; ensure `admin-topics.controller.spec.ts` covers the business-rule matrix (404 unknown parent, 422 UNKNOWN_PREREQ, sanitisation, WOULD_CYCLE, etc.).

## Dependencies

Task 05 (convention + auth pair pilot).

## Technical Constraints

- **Scope guardrail:** `apps/api/test/**` only. No edits to controllers or routes in `apps/api/src/**`.
- Every business-rule scenario removed from the router spec must already be covered in the controller spec; if missing, add it to the controller spec **before** removing from the router spec.
- Keep ≥ 1 HTTP smoke per endpoint in the router spec.

## Scope

In:
- Cross-reference each scenario in `admin-topics.router.spec.ts` against `admin-topics.controller.spec.ts`.
- Add any missing business-rule coverage to the controller spec.
- Remove duplicates from the router spec, keeping HTTP smokes (status, DTO shape, headers, auth) only.

Out:
- Other pairs.

## Acceptance Criteria

- [x] `admin-topics.router.spec.ts` test count drops; every remaining test is HTTP-shaped.
- [x] `admin-topics.controller.spec.ts` covers every business-rule branch removed from the router spec.
- [x] `make test-api` and `make lint` pass.
- [x] No diff outside `apps/api/test/**`.

## Verification Plan

1. PR description: before/after scenario list with controller-spec pointer for each removed router-spec scenario.
2. Full suite green.
