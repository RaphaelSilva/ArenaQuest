# Plan — 02-quest-data-layer

**Task:** [02-quest-data-layer.task.md](../02-quest-data-layer.task.md)
**Milestone:** 7
**Assigned persona:** backend-developer
**Branch:** feature/m7/02-quest-data-layer.task (from feature/m7/candidate)

## Objective

Implement the persistence layer for the Quest system, including definitions for daily/weekly tasks and per-user progress tracking. This foundation will allow the system to seed standard quests (based on the dashboard wireframe) and upsert user progress as they interact with the platform.

## Affected areas

- `packages/shared/src/ports/IQuestRepository.ts` (New port)
- `packages/shared/src/domain/quest.ts` (New domain types)
- `apps/api/src/adapters/db/D1QuestRepository.ts` (New adapter)
- `apps/api/migrations/` (New migrations for tables and seed data)
- `apps/api/test/adapters/db/D1QuestRepository.spec.ts` (New tests)

## Step-by-step

1. **Define Types:** Create `packages/shared/src/domain/quest.ts` with `QuestDefinition`, `QuestProgress`, and `QuestKind` (daily, weekly) types.
2. **Create Port:** Define `IQuestRepository` in `packages/shared/src/ports/IQuestRepository.ts` with methods for listing active definitions and upserting progress.
3. **Database Migrations:** 
    - Create a migration for `quest_definitions` and `quest_progress` tables.
    - Create a seed migration with 4 daily and 3 weekly quests from `Dashboard.html`.
4. **Implement Adapter:** Create `D1QuestRepository` in `apps/api/src/adapters/db/D1QuestRepository.ts` implementing the port using D1.
5. **Unit Testing:** Implement tests in `apps/api/test/adapters/db/D1QuestRepository.spec.ts` covering:
    - Listing active quests.
    - Idempotent upsert of progress.
    - Correct retrieval of progress for specific period keys (daily date vs weekly ISO week).
6. **Validation:** Run lint and API tests.

## Acceptance Criteria mapping

| AC | Plan step(s) | Verification |
|---|---|---|
| Migrations apply cleanly; seed creates ≥ 4 daily and ≥ 3 weekly quests | 3 | `make db-migrations-dev` and manual DB inspection |
| Repeated upserts on same (user_id, quest_id, period_key) are idempotent | 4, 5 | Vitest coverage in `D1QuestRepository.spec.ts` |
| Querying "active quests for user U on date D" filters by active = 1 and returns progress | 4, 5 | Vitest coverage in `D1QuestRepository.spec.ts` |
| No provider-specific imports outside the adapter folder | 1, 2, 4 | `make lint` and manual check |

## Risks & open questions

- **Period Key Derivation:** The task mentions computing `period_key` from the user's timezone. The repository should probably accept the `period_key` as an argument rather than computing it internally to keep the data layer pure, or we need a utility for this.
- **Predicate Params:** Quest definitions use `predicate_kind` and `predicate_params`. These should be flexible (JSON strings in DB) to support different quest types (e.g., "watch_video", "complete_topic").

## Verification

- `make db-migrations-dev`
- `make test-api` (specifically the new repository tests)
- `make lint`

## Out of scope

- Business logic for evaluating if a quest is completed (Task 08).
- HTTP endpoints (Task 10).
- Missions (Task 03).
