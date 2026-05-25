# Task 02 — Remove low-signal and duplicate specs (P5)

**Status:** ⏳ Pending
**Milestone:** [8 — `apps/api` Test Suite Optimization](./milestone.md)
**RFC:** [0001 §P5 / §D5](../../RFCs/0001-apps-api-test-suite-optimization.md)

## Summary

Delete or shrink test files that test constants, literal returns, or otherwise duplicate coverage already present elsewhere. The list is enumerated in RFC §P5.

## Dependencies

None.

## Technical Constraints

- **Scope guardrail:** only files under `apps/api/test/**` are touched. No production code edits.
- For every removal, the cited "covered elsewhere" location in the RFC must be verified to actually cover the same behaviour before deletion.
- If a removal would drop coverage of an HTTP smoke for an endpoint, retain a single smoke instead of deleting outright.

## Scope

In:
- Remove `test/shared-roles.spec.ts` (constants-only).
- Remove `test/controllers/health.controller.spec.ts` (literals; covered by `test/index.spec.ts`).
- Remove the "unit style" `/health` block from `test/index.spec.ts` (kept "integration style").
- Remove the `GET /health (regression)` block from `test/routes/auth.router.spec.ts`.
- Reduce `test/routes/parse-cookie-samesite.spec.ts` to 4 tests: `Strict`, `Lax`, `None`/default, and "invalid value → None + warn".
- Reduce `test/routes/cors.router.spec.ts` to HTTP-only smokes (Origin echo, credentials, preflight), leaving the parser/matcher coverage to `test/core/cors/origin-policy.spec.ts`.

Out:
- Any change to the production code these tests target.
- Removing the `origin-policy.spec.ts` unit suite — it must remain the source of truth for the CORS matcher.

## Acceptance Criteria

- [ ] All deletions/reductions listed above are applied; the suite still runs green.
- [ ] No reference (import or otherwise) is left dangling to any deleted file.
- [ ] Total test count drops in line with RFC §P5 expectations.
- [ ] `make test-api` and `make lint` pass.
- [ ] No diff outside `apps/api/test/**`.

## Verification Plan

1. Before removing, grep for any cross-file imports of the files to be deleted.
2. After removal, run `pnpm --filter @arenaquest/api test` and confirm green.
3. Diff the test count against the baseline (737) and note the new total for the closeout.
