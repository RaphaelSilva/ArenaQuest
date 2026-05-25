# Task 07 — Refactor `admin-media` controller/router pair (P2)

**Status:** ⏳ Pending
**Milestone:** [8 — `apps/api` Test Suite Optimization](./milestone.md)
**RFC:** [0001 §P2 / §D2](../../RFCs/0001-apps-api-test-suite-optimization.md)

## Summary

Apply the Task 05 convention to the `admin-media` pair. RFC §D2 estimates ~85 % overlap between the two specs — the highest in the list, so expect the most aggressive trim here.

## Dependencies

Task 05.

## Technical Constraints

- **Scope guardrail:** `apps/api/test/**` only.
- Every business-rule scenario removed from the router spec must be covered in the controller spec first.
- Keep ≥ 1 HTTP smoke per endpoint in the router spec, including presigned-upload lifecycle smokes (upload-begin/complete).
- Do not touch the R2 adapter spec — it is a separate concern.

## Scope

In:
- Cross-reference `admin-media.router.spec.ts` against `admin-media.controller.spec.ts`.
- Backfill any missing business-rule coverage to the controller spec.
- Trim the router spec to HTTP smokes.

Out:
- Other pairs. R2 storage adapter spec.

## Acceptance Criteria

- [ ] `admin-media.router.spec.ts` reduced to HTTP smokes; every endpoint keeps ≥ 1.
- [ ] `admin-media.controller.spec.ts` covers all removed business-rule branches.
- [ ] `make test-api` and `make lint` pass.
- [ ] No diff outside `apps/api/test/**`.

## Verification Plan

1. PR description: before/after scenario list with controller-spec pointer for each removed router-spec scenario.
2. Full suite green.
