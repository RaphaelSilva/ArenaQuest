## Summary

One dense paragraph describing what this task delivers end-to-end at the
data / API layer, plus one sentence on what later tasks build on it. Describe the
**contract**, not the implementation — no code (no SQL, no TypeScript, no Zod).
Lift the behaviour from the milestone's Functional Requirements and the source
RFC; name the entities, endpoints, and invariants this task owns.

## Dependencies

- Sibling tasks that must land first, linked as `./NN-<slug>.task.md`. If a hard
  code dependency, say so; if it is only an ordering preference, say that. If the
  task is independent, write "None — independent."

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/**` — one additive, sequential migration (if schema
    changes). State the default, backfill, and rollback in one line.
  - `packages/shared/types/entities.ts` and `packages/shared/ports/**` — the
    entity / port additions this task introduces.
  - `apps/api/src/{adapters,controllers,routes}/**` — the adapter that owns the
    new persistence, the controller returning `ControllerResult<T>`, the route
    that only handles HTTP concerns.
  - `apps/api/test/**` — adapter and controller tests.
- **Ports & Adapters.** State how provider independence is preserved: the new
  behaviour belongs to an `I*Repository` port; only the adapter knows the
  concrete store. No Cloudflare/D1/R2 symbol leaks into a port or controller.
- **Cloud-agnostic.** No provider SDK call outside `apps/api/src/adapters/`.
- **Validation & results.** Input validated via `@ValidateBody(schema)` / `@Body()`;
  the controller returns `ControllerResult<T>` with explicit error branches
  (validation, auth, not-found, conflict).
- **Migration safety** (if any) — additive and non-breaking; name the safe
  default and the rollback. Security-sensitive defaults stated explicitly.

## Scope

In:
- The concrete deliverables — entity/port additions, the migration, the
  adapter read/write, the controller logic, the route, and the tests that prove
  each branch. One bullet per deliverable, no code.

Out:
- Any frontend change — that lives in a separate Frontend task that depends on
  this one.
- Anything named in a later task or fenced out by the milestone guardrail.

## Acceptance Criteria

- [ ] <Observable assertion naming the exact signal that proves it — a specific
      endpoint response, a migrated row, a passing test case.>
- [ ] No provider-specific (D1/R2) import leaks into a port or controller.
- [ ] Validation, auth, not-found, and conflict branches each return the correct
      `ControllerResult` status and are covered by a test.
- [ ] Changed files lint clean; `make test-api` green for the affected specs.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-migrations-dev` (if a migration) and confirm it applies cleanly to a
   fresh local D1; inspect the schema for the default / constraint / index.
2. `make test-api` — the affected adapter and controller specs pass.
3. `make dev-api` — exercise the endpoint (Bruno or curl), including the error
   cases (invalid input, missing auth, not found, conflict).
4. `git diff --stat` confirms only scope-guardrail files changed.
