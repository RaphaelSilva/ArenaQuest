# Task 05 — Document router-vs-controller convention + refactor `auth` pair (P2 pilot)

**Status:** ⏳ Pending
**Milestone:** [8 — `apps/api` Test Suite Optimization](./milestone.md)
**RFC:** [0001 §P2](../../RFCs/0001-apps-api-test-suite-optimization.md)

## Summary

Author `apps/api/test/README.md` codifying the **router vs controller** test convention from RFC §P2, then apply it as a pilot to the `auth` controller/router pair. Subsequent pair refactors (Tasks 06–09) follow the same recipe.

## Dependencies

Task 01 (the controller spec lands in the `node` project so it benefits from the speed-up). Task 04 (auth-enforcement consolidation) recommended first so the convention reflects the already-consolidated guard rules.

## Technical Constraints

- **Scope guardrail:** changes restricted to `apps/api/test/**`. No edits to controllers or routes in `apps/api/src/**`.
- README must state the convention verbatim from RFC §P2: router specs cover HTTP concerns only (status codes, body/cookie parsing, Zod validation, DTO shape, headers, rate-limit, CORS, auth); controller specs own the business-rule matrix with mocks.
- The pilot refactor on the `auth` pair must keep **≥ 1 HTTP smoke per endpoint** in the router spec to guard against wiring regressions.
- Removed router-spec scenarios that previously covered business rules must already be (or become) covered in `auth.controller.spec.ts`.

## Scope

In:
- Write `apps/api/test/README.md` with: (a) the router-vs-controller convention, (b) when to add to `auth-guard.spec.ts` instead of a router spec, (c) how to use the migrations helper from Task 03.
- Refactor the `auth` pair: trim `auth.router.spec.ts` to HTTP smokes only; ensure `auth.controller.spec.ts` covers the business-rule branches that were removed.

Out:
- The other 8 pairs (Tasks 06–09).

## Acceptance Criteria

- [ ] `apps/api/test/README.md` exists and documents the convention, auth-guard rule, and migrations helper.
- [ ] `auth.router.spec.ts` contains only HTTP-shaped assertions (≥ 1 smoke per endpoint).
- [ ] Every business-rule branch removed from the router spec is present in `auth.controller.spec.ts` (cross-list in the PR description).
- [ ] `make test-api` and `make lint` pass.
- [ ] No diff outside `apps/api/test/**`.

## Verification Plan

1. PR description includes a before/after list of router-spec scenarios per endpoint and a pointer to the controller-spec case that covers each removed scenario.
2. Full suite green.
