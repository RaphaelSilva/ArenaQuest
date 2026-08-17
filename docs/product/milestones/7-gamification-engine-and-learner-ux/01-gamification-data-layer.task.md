# Task 01 — Gamification Data Layer

**Status:** ✅ Completed
**Milestone:** [7](./milestone.md)

## Summary

Add the persistence foundation for XP, levels, and streaks: append-only `xp_events`, denormalized `user_xp` read model, `user_streak` read model, and a seeded `level_definitions` table. Expose access through a new `IGamificationRepository` port plus a `LevelTable` value object in shared domain.

## Dependencies

None. Independent of other M7 tasks; unblocks 06, 07, 08, 09, 10.

## Technical Constraints

- D1 schema lives in `apps/api/migrations/`; types in `packages/shared/types/entities.ts` under a new `Entities.Gamification` namespace.
- Port `IGamificationRepository` in `packages/shared/ports/`; D1 implementation in `apps/api/src/adapters/db/`. No D1 types leak through the port.
- Level table seeded via SQL migration. Replacing the level curve must require no code change in callers.
- `xp_events.idempotency_key` is a unique index together with `user_id, source_kind` so the same source event can never grant XP twice.
- Local-date helpers consumed from `packages/shared/domain/time/`; no `Date.now()` in domain code.

## Scope

In:
- Migrations for `xp_events`, `user_xp`, `user_streak`, `level_definitions`.
- Seed the level curve (level 1..30 minimum) and rank titles aligned with the Dashboard wireframe ("Aspirante", "Treinador Júnior", …).
- Port `IGamificationRepository` with operations: append XP event (idempotent), read aggregated user XP, read/upsert streak, list level definitions.
- Adapter implementation against D1.
- Unit tests for the adapter using `@cloudflare/vitest-pool-workers`.

Out:
- The XP-awarding decisions themselves (Task 06).
- The streak evaluator logic (Task 07).
- Any read endpoint (delivered with Task 10).

## Acceptance Criteria

- [x] All four migrations apply cleanly with `make db-migrations-dev`.
- [x] Inserting the same `(user_id, source_kind, idempotency_key)` twice yields exactly one `xp_events` row and a single XP credit on `user_xp`.
- [x] `user_xp.total_xp` equals `SUM(xp_events.points)` after any sequence of awards (test enforced).
- [x] `level_definitions` exposes a stable lookup: given a `total_xp`, the repository returns `level`, `rank_title`, and the XP delta to next level.
- [x] No provider-specific imports outside `apps/api/src/adapters/db/`.

## Verification Plan

1. `make db-migrations-dev` succeeds locally.
2. New Vitest spec asserts idempotency and aggregate consistency for `IGamificationRepository`.
3. `make lint` and `make test-api` pass.
