# Task 11 — Audit and lower PBKDF2 iterations in remaining test setups (P6)

**Status:** ✅ Done
**Milestone:** [8 — `apps/api` Test Suite Optimization](./milestone.md)
**RFC:** [0001 §P6](../../RFCs/0001-apps-api-test-suite-optimization.md)

## Summary

Audit the test setup of every spec that instantiates the JWT auth adapter (or otherwise drives a password hash) and ensure the PBKDF2 iteration count is the test-friendly value (≤ 1 000), not the production default (100 000). `register.router.spec.ts` is the known offender; others may exist.

## Dependencies

None. Best run after Tasks 05–09 so the surviving controller/router specs are stable.

## Technical Constraints

- **Scope guardrail:** changes restricted to `apps/api/test/**`. **No edit to production hashing parameters** — the production default stays at 100 000 iterations as documented in `CLAUDE.md`.
- The lowered count is acceptable only in test setup (passed via adapter construction options or env-style overrides exposed for tests). Do not introduce a global mutable default.

## Scope

In:
- Grep all test setups for places that build the JWT/auth adapter without an explicit low iteration count.
- Update each to pass ≤ 1 000 iterations.
- Note any spec where the iteration count cannot be lowered (e.g., the test specifically validates production parameters) and leave it untouched.

Out:
- Changing production code in `apps/api/src/**`.
- Changing the test scaffold for adapters other than the auth/JWT hashing path.

## Acceptance Criteria

- [x] Every spec that exercises password hashing in setup uses ≤ 1 000 PBKDF2 iterations (or has a documented justification otherwise).
- [x] No production code change.
- [x] `make test-api` and `make lint` pass.
- [x] Wall-time impact recorded for the closeout.
- [x] No diff outside `apps/api/test/**`.

## Verification Plan

1. Grep for `pbkdf2Iterations` (and synonyms) under `apps/api/test/**`; every hit either uses ≤ 1 000 or carries an inline justification.
2. Confirm production default in `apps/api/src/**` is unchanged.
3. Full suite green.
