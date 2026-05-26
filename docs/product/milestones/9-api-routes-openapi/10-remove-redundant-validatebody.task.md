# Task 10 — Remove redundant `@ValidateBody` decorators from HTTP-facing controllers (F10)

**Status:** ✅ Completed
**Milestone:** [9 — `apps/api` Route Reorganization and OpenAPI Adoption](./milestone.md)
**RFC:** [0003 §4.2 and §5 — F10](../../RFCs/0003-apps-api-route-organization-and-openapi.md)

## Summary

After F4–F7 moved request validation into the router via Zod-OpenAPI, the `@ValidateBody(schema)` + `@Body()` decorators on HTTP-facing controllers became a second validation pass: same schema, same failure mode, twice the boilerplate. This task audits every controller usage, removes the decorators where the router already validates the same shape, and keeps them only where a non-HTTP caller (jobs, CLIs, tests that bypass the router) still depends on them. The decorator implementation in `src/core/decorators.ts` stays — only the usages are pruned.

## Dependencies

Depends on Task 09 (the contract gate must be in place so any accidental relaxation of validation surfaces as a contract change). Last task of the milestone.

## Technical Constraints

- **Scope guardrail:** `apps/api/src/controllers/**` (decorator usages only — no business-logic edits), `apps/api/src/core/decorators.ts` (only if a usage audit reveals the decorator can be deleted entirely), and any specs that asserted on the decorator's specific error envelope. No changes to routes (they already validate), adapters, or `packages/shared/**`.
- **Audit-first:** before removing any decorator, produce a short table in the PR description listing each `@ValidateBody` usage, its caller path (router endpoint that hits the controller), whether a non-HTTP caller exists, and the decision (remove / keep with justification).
- The router-side `ValidationErrorBody` envelope must match the previous controller-side envelope closely enough that no existing client breaks. If shapes differ, that is itself a finding — flag it and resolve before merging (either align the router envelope to the old shape, or document a deliberate, contract-bumped change).
- Where decorators are kept (because a non-HTTP caller exists), add a one-line code comment explaining why — this is one of the rare cases that meets the "non-obvious why" bar from the CLAUDE.md comment policy.
- If the audit confirms that **no** non-HTTP caller depends on `@ValidateBody`, delete the decorator implementation as well. Otherwise leave it in place.

## Scope

In:
- Audit every `@ValidateBody` usage in `apps/api/src/controllers/**`.
- Remove the decorator (and the `@Body()` parameter decorator on the same method) where the router fully covers validation.
- Update any spec that asserted on the controller-level validation envelope to assert on the router-level envelope instead, when applicable.
- Optionally delete `src/core/decorators.ts` (or just the unused decorators within it) if the audit shows zero remaining callers.

Out:
- Changing controller business logic.
- Reworking the `ControllerResult` shape.
- Changing router-side validation behaviour (already in place from F4–F7).

## Acceptance Criteria

- [ ] PR description contains the audit table (usage × caller × decision).
- [ ] Every `@ValidateBody` usage flagged "remove" in the audit is gone from the controller.
- [ ] Every usage flagged "keep" has a one-line comment explaining the non-HTTP caller it protects.
- [ ] If the decorator is fully unused, `src/core/decorators.ts` is updated (or deleted) to reflect that; otherwise it remains.
- [ ] All existing controller and router specs pass green. Specs that asserted on the decorator-level envelope are updated to the router-level envelope (or deleted as duplicates).
- [ ] `oasdiff` reports no breaking changes between the PR and `main` (or if it does, the PR carries the `breaking-change` label and a written justification).
- [ ] `make test-api`, `make test-web`, `make lint` pass green.
- [ ] Worker bundle size stays within the milestone's recorded budget.

## Verification Plan

1. `grep -R "@ValidateBody" apps/api/src` before and after; before the change, build the audit table from the matches; after, confirm only the "keep" entries remain.
2. Send malformed requests to a handful of representative endpoints (one per HTTP module) and confirm they still respond `400` with `ValidationErrorBody`.
3. Run `make test-api` + `make test-web` and confirm green.
4. Run the dump + `oasdiff` locally to confirm no breaking-change flag.
5. If `src/core/decorators.ts` was deleted, confirm `tsc --noEmit` passes (no stale imports).
