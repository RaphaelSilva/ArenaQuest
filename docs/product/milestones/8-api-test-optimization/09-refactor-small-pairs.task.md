# Task 09 — Refactor small pairs: `register`, `password`, `account`, `activate`, `topics` (P2)

**Status:** ⏳ Pending
**Milestone:** [8 — `apps/api` Test Suite Optimization](./milestone.md)
**RFC:** [0001 §P2 / §D2](../../RFCs/0001-apps-api-test-suite-optimization.md)

## Summary

Apply the Task 05 convention to the remaining smaller controller/router pairs in a single task: `register`, `password`, `account`, `activate`, and `topics` (participant-facing). Each is small enough that bundling avoids PR-churn overhead.

## Dependencies

Task 05.

## Technical Constraints

- **Scope guardrail:** `apps/api/test/**` only.
- Each pair gets the same treatment: backfill controller spec where needed, then trim the router spec to HTTP smokes (≥ 1 per endpoint).
- The PR description must include a per-pair before/after summary so reviewers can audit one pair at a time.

## Scope

In:
- Refactor all 5 pairs listed in the title.
- One commit per pair recommended (not required), to keep the diff reviewable.

Out:
- Pairs covered in Tasks 05–08.

## Acceptance Criteria

- [ ] Each of the 5 router specs is reduced to HTTP smokes (≥ 1 per endpoint).
- [ ] Each controller spec covers all removed business-rule branches for its pair.
- [ ] `make test-api` and `make lint` pass.
- [ ] No diff outside `apps/api/test/**`.

## Verification Plan

1. PR description has 5 sections (one per pair) with before/after scenario lists.
2. Full suite green.
