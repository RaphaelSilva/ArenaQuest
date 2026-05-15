# Plan — 01-gamification-data-layer

**Task:** [01-gamification-data-layer.task.md](../01-gamification-data-layer.task.md)
**Milestone:** 7
**Assigned persona:** backend-developer
**Branch:** feature/m7/01-gamification-data-layer.task (from feature/m7/candidate)

## Objective

Add the persistence foundation for XP, levels, and streaks in ArenaQuest. Four D1 migrations introduce `xp_events` (append-only idempotent log), `user_xp` (denormalized read model), `user_streak` (read model), and `level_definitions` (seeded with 30 levels). A new `IGamificationRepository` port is added to `packages/shared/ports`, a `LevelTable` value object lands in shared domain, and a `D1GamificationRepository` adapter implements the port. No HTTP routes or controllers are introduced — those come in Tasks 06–10.

## Affected Areas

**New files:**
- `apps/api/migrations/0014_create_xp_events.sql`
- `apps/api/migrations/0015_create_user_xp.sql`
- `apps/api/migrations/0016_create_user_streak.sql`
- `apps/api/migrations/0017_seed_level_definitions.sql`
- `packages/shared/ports/i-gamification-repository.ts`
- `packages/shared/domain/gamification/level-table.ts`
- `apps/api/src/adapters/db/d1-gamification-repository.ts`
- `apps/api/test/db/d1-gamification-repository.spec.ts`

**Modified files:**
- `packages/shared/types/entities.ts` — append `Entities.Gamification` namespace
- `packages/shared/ports/index.ts` — barrel-export the new port

**Explicitly out of scope:**
- `apps/api/src/index.ts` — wiring deferred to Task 10 (no consumer yet)
- `apps/api/src/routes/` — routes deferred to Task 10
- XP-awarding logic (Task 06), streak evaluator (Task 07)

## Step-by-Step

1. **`Entities.Gamification` namespace** — append to `packages/shared/types/entities.ts`: `XpEvent`, `UserXp`, `UserStreak`, `LevelDefinition` interfaces.

2. **Port `IGamificationRepository`** — create `packages/shared/ports/i-gamification-repository.ts` with flat record DTOs (`XpEventRecord`, `UserXpRecord`, `UserStreakRecord`, `LevelDefinitionRecord`) and the interface with five methods: `appendXpEvent` (idempotent), `getUserXp`, `getUserStreak`, `upsertUserStreak`, `listLevelDefinitions`. Re-export from `ports/index.ts`.

3. **`LevelTable` value object** — create `packages/shared/domain/gamification/level-table.ts`; pure class, no DB dependency; `forXp(totalXp)` returns `{ definition, xpToNext }`.

4. **Migrations 0014–0017** — one logical change per file; idempotent (`IF NOT EXISTS`, `INSERT OR IGNORE`); `xp_events` unique index on `(user_id, source_kind, idempotency_key)`; `level_definitions` seeded with 30 rows (quadratic XP curve, Portuguese rank titles).

5. **D1 adapter** — `apps/api/src/adapters/db/d1-gamification-repository.ts`; private snake_case row types; row→record converters; idempotency via `INSERT OR IGNORE` + `meta.changes` check + conditional `user_xp` update; read-after-write on every mutating method.

6. **Vitest spec** — `apps/api/test/db/d1-gamification-repository.spec.ts`; Layer 2 (real D1); inline `MIGRATION_STATEMENTS`; `beforeAll` schema + seed; `beforeEach` fresh userId; covers idempotency, XP accumulation, streak upsert, level listing.

## Acceptance Criteria Mapping

| AC | Plan step(s) | Verification |
|---|---|---|
| All four migrations apply cleanly | Step 4 | `make db-migrations-dev` |
| Same `(user_id, source_kind, idempotency_key)` twice → 1 row, 1 XP credit | Steps 5 + 6 | Vitest idempotency test |
| `user_xp.total_xp = SUM(xp_events.points)` | Steps 5 + 6 | Vitest accumulation test |
| Given `total_xp` → level, rank_title, XP delta | Steps 3 + 4 | `LevelTable.forXp()` + Vitest level listing |
| No provider-specific imports outside `apps/api/src/adapters/db/` | Step 5 | `make lint` |

## Risks & Open Questions

- **`meta.changes` on D1 `INSERT OR IGNORE`**: confirmed supported by Workers D1. If `meta.changes === 0` (duplicate), skip the `user_xp` update entirely.
- **Rank titles**: using "Aspirante", "Treinador Júnior", "Treinador", "Treinador Sênior", "Especialista", "Mestre", "Grão-Mestre" based on task description; verify against `docs/product/web/wire/Dashboard.html` if needed.

## Verification

```bash
make db-migrations-dev   # migrations apply without error
make test-api            # all gamification spec tests pass
make lint                # TypeScript strict, no cross-boundary imports
```

## Out of Scope

- XP-awarding decisions (Task 06)
- Streak evaluator logic (Task 07)
- Any read endpoint (Task 10)
- Wiring into `buildApp(env)` / `AppRouter` (Task 10)
