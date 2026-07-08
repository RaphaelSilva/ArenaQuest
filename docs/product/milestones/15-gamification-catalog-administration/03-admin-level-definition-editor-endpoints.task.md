# Task 03 — Backend: Admin level-definition editor endpoints (Phase 1)

**Status:** ✅ Done
**Milestone:** [15 — Gamification Catalog Administration](./milestone.md)
**RFC:** [RFC 0009](../../RFCs/0009-gamification-catalog-administration.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-shared-gamification-catalog-types.task.md)

## Summary

Deliver the admin editing surface for `level_definitions`, which today has no
admin controller or router. The level curve is a small, contiguous, monotonic
table, so rather than per-row CRUD this task exposes a `GET /admin/levels` read
(ordered by `level`) and a single transactional `PUT /admin/levels` whole-table
upsert. The controller validates the submitted curve — `min_xp` strictly
increasing, no gaps, exactly one final row with `max_xp = NULL` — and rejects a
non-monotonic, gapped, or open-row-count-wrong curve with `400 BadRequest`
before committing; the upsert and validation run in one transaction so the table
never lands in an invalid intermediate state. Because the curve is economy-
affecting, the entire `/admin/levels` surface is `ADMIN`-gated end to end (not
`CONTENT_CREATOR`). The web client (task 04) and the levels grid (task 05)
consume this contract.

## Dependencies

- [Task 01 — Shared gamification catalog types](./01-shared-gamification-catalog-types.task.md)
  — ordering dependency: the controller types its responses against the existing
  `Entities.Gamification.LevelDefinition`; landing after 01 keeps the namespace
  consistent.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/admin-levels.controller.ts` — new controller with
    `list` and `replaceAll`, returning `ControllerResult<T>`; owns the curve
    validation (strict monotonicity, no gaps, exactly one `max_xp = NULL`).
  - `apps/api/src/routes/admin/levels.ts` — new OpenAPIHono router
    (`GET`/`PUT`) handling only HTTP concerns and the OpenAPI schema.
  - `apps/api/src/routes/admin/index.ts` — mount the router; gate it to `ADMIN`
    only (stricter than the `requireRole(ADMIN, CONTENT_CREATOR)` umbrella).
  - `apps/api/src/adapters/db/**` — a level-definition repository exposing the
    ordered read and a single-transaction whole-table upsert; its port interface.
  - `apps/api/test/**` — controller and router specs (Workers pool).
- **No schema change.** `level_definitions` already exists
  (`migrations/0017_seed_level_definitions.sql`); no migration is added.
- **Transactional invariant.** The `PUT` upsert + validation execute in one D1
  transaction; a rejected curve commits nothing.
- **Ports & Adapters.** The ordered read and transactional upsert belong to the
  level-definition repository port; only the D1 adapter knows the concrete store.
  No D1 symbol leaks into the controller or router.
- **Validation & results.** `PUT` body validated via `@ValidateBody` / `@Body()`
  (an array of `{ level, rankTitle, minXp, maxXp }` rows). Curve-shape violations
  return `400 BadRequest`; the `ADMIN` gate returns `403` for any other role.
- **Role gate.** `/admin/levels` is `ADMIN`-only end to end — `CONTENT_CREATOR`
  is rejected from both `GET` and `PUT`.

## Scope

In:
- Level-definition repository port + D1 adapter: ordered `list` read and a
  single-transaction whole-table upsert.
- `AdminLevelsController` with `list` and `replaceAll`, owning curve validation.
- `/admin/levels` OpenAPIHono router (`GET`/`PUT`) mounted `ADMIN`-gated and
  present in the OpenAPI document.
- Vitest coverage: the happy-path round-trip plus a `400` each for a
  non-monotonic curve, a gapped curve, and a curve without exactly one
  `max_xp = NULL` row, plus a `403` for a `CONTENT_CREATOR`.

Out:
- Any frontend change — the levels grid (task 05) consumes this endpoint.
- Per-row level PATCH (deferred fallback per RFC 0009), quest endpoints
  (task 02), and per-user `user_xp` (RFC 0010).

## Acceptance Criteria

- [x] `GET /admin/levels` returns rows ordered by `level`; both operations appear
      in the OpenAPI doc.
- [x] `PUT /admin/levels` persists a valid curve and returns `400` for (a) a
      non-monotonic `min_xp`, (b) a gapped curve, and (c) a curve without exactly
      one `max_xp = NULL` row — each asserted by a Vitest case.
- [x] A rejected `PUT` commits nothing (the prior curve is intact), asserted by a
      follow-up `GET`.
- [x] A `CONTENT_CREATOR` is rejected from `GET` and `PUT /admin/levels` with
      `403`, asserted by a guard test.
- [x] No provider-specific (D1) import leaks into the controller or router.
- [x] Changed files lint clean; `make test-api` green for the affected specs.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — the level controller/router specs pass, including the three
   `400` curve-shape cases, the no-partial-commit assertion, and the `403` gate.
2. `make dev-api` — `GET /admin/levels` returns the seeded curve ordered by
   level; `PUT` a valid curve succeeds and an invalid one returns `400` without
   mutating the table.
3. Confirm both operations render in the OpenAPI document and that a
   `CONTENT_CREATOR` token is rejected.
4. `git diff --stat` confirms only scope-guardrail files changed.
