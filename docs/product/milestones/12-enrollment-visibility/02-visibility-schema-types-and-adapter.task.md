# Task 02 — Backend: `visibility` column, enum, ports, and adapter read/write (Phase 1)

**Status:** ✅ Done
**Milestone:** [12 — Enrollment enforcement and node visibility](./milestone.md)
**RFC:** [0005 — Enrollment enforcement and node visibility, Phase 1](../../RFCs/0005-enrollment-exclusions-and-visibility.md)
**Team:** Backend API

## Summary

Introduce the per-node `visibility` primitive end-to-end at the persistence and type layers: a new `visibility` column on `topic_nodes` (default `restricted`, backfilled, `CHECK`-constrained, indexed), a `TopicVisibility` enum in `Entities.Config` (`public` / `restricted` / `private`), the field added to `TopicNodeRecord` and the create / update inputs, and `D1TopicNodeRepository` reading and writing the column. This task delivers the data foundation; the resolver rewrite (Task 03) and controller / route exposure (Task 04) build on it.

## Dependencies

- Task 01 (catalog enforcement) should land first so visibility is layered on a catalog that actually gates. Not a hard code dependency, but the milestone ordering assumes Phase 0 precedes Phase 1.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/**` — one new additive migration (next sequential number, e.g. `0025_*`) adding the `visibility` column with `DEFAULT 'restricted'`, a backfill of existing rows to `'restricted'`, a `CHECK` constraint limiting values to the three enum strings, and an index on `topic_nodes(visibility)`.
  - `packages/shared/types/entities.ts` — add `TopicVisibility` to `Entities.Config`.
  - `packages/shared/ports/i-topic-node-repository.ts` — add `visibility` to `TopicNodeRecord` (required) and to the create / update inputs (optional).
  - `apps/api/src/adapters/db/d1-topic-node-repository.ts` — read the column on every projection that returns a `TopicNodeRecord`; write it on create and partial update.
  - `apps/api/test/**` — adapter-level tests.
- **Additive, non-breaking migration.** One nullable-with-default column + a `CHECK` + an index. No data rewrite. Backfill all existing rows to `'restricted'` to preserve today's intended (grant-gated) behaviour. Rollback is `ALTER TABLE DROP COLUMN`.
- **`RESTRICTED` is the default, not `PUBLIC`.** Defaulting to `PUBLIC` would open every existing topic to every authenticated user — a security regression. Admins opt into `PUBLIC` per node.
- **Ports & Adapters.** Visibility semantics belong to `ITopicNodeRepository`; the enum lives in shared types. The D1 adapter is the only place that knows the column exists. No Cloudflare-specific symbol leaks into the port or any controller.
- **Partial-patch safety.** The update path already handles partial patches; an update that omits `visibility` must leave the stored value untouched.
- **Enum string values are the contract.** The DB stores the lowercase enum strings (`public` / `restricted` / `private`); the `CHECK` constraint and the enum must agree exactly.

## Scope

In:
- Add the `TopicVisibility` enum to `Entities.Config` with the three documented values and doc comments.
- Add `visibility: Entities.Config.TopicVisibility` (required) to `TopicNodeRecord`; add `visibility?` to the create and update input types.
- Write the migration (column + default + backfill + `CHECK` + index).
- Update `D1TopicNodeRepository` to select, insert, and partially update the column.
- Update any test fixture / factory that builds a `TopicNodeRecord` to include `visibility` (defaulting to `restricted`).
- Add adapter tests: create with explicit visibility, create defaulting to `restricted`, partial update that changes visibility, partial update that omits it (value preserved).

Out:
- The resolver `(allow ∪ public) − private` rewrite (Task 03).
- Controller bypass and admin `PATCH` schema (Task 04).
- Any frontend change (Tasks 05–07).

## Acceptance Criteria

- [x] `Entities.Config.TopicVisibility` exists with `PUBLIC = 'public'`, `RESTRICTED = 'restricted'`, `PRIVATE = 'private'`.
- [x] `TopicNodeRecord.visibility` is required; create / update inputs carry `visibility?`.
- [x] The migration adds the column with `DEFAULT 'restricted'`, backfills existing rows to `'restricted'`, enforces a `CHECK` over the three values, and indexes `topic_nodes(visibility)`.
- [x] The migration applies cleanly via the test loader (`apply-migrations` globs `migrations/*.sql`; the adapter spec's `beforeAll` applies `0025` and all 22 cases pass). _`make db-migrations-dev` against a live local D1 not run in this headless flow._
- [x] `D1TopicNodeRepository` returns `visibility` on every `TopicNodeRecord` projection (`rowToRecord` + `listAll` mapper) and persists it on create and partial update; omitting it on update preserves the stored value.
- [x] Adapter tests cover create-with-value, create-default, update-changes, and update-omits cases (4 new cases green).
- [x] No D1-specific import leaks into `ITopicNodeRepository` or any controller.
- [x] Changed files lint clean; shared package builds; the affected specs (71 tests across the adapter + 3 controller specs) pass. _Caveats unchanged from Task 01: repo-wide `make lint` red on pre-existing out-of-scope `generate-bruno.ts`; full `make test-api` unstable on this WSL2 host; strict `tsc --noEmit` is pre-red project-wide (Hono/OpenAPI handler-type friction + a pre-existing `User.timezone`/`updatedAt` drift) — my change adds zero new type errors and no `visibility`-literal errors._
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-migrations-dev` and confirm the migration applies without error against a fresh local D1.
2. Inspect the local DB schema and confirm the column default, `CHECK`, and index exist, and that pre-existing rows read back as `restricted`.
3. `make test-api` — adapter tests green.
4. `make dev-api`: create a topic with `visibility = public`, read it back, confirm the value round-trips; partial-update an unrelated field and confirm `visibility` is preserved.
5. `make cf-typegen` if bindings change (none expected) and confirm types still build.
6. `git diff --stat` confirms only the scope-guardrail files changed.
