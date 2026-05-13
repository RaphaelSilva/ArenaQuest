# Task 02 — Quest Data Layer

**Status:** ⏳ Pending
**Milestone:** [7](./milestone.md)

## Summary

Persist the catalog of daily and weekly quests plus per-user progress. Quest definitions are seeded; per-user progress is upserted as events fire.

## Dependencies

None for the data layer itself. Consumed by Task 08 (evaluator) and Task 10 (read API).

## Technical Constraints

- New port `IQuestRepository` in `packages/shared/ports/`. D1 adapter under `apps/api/src/adapters/db/`.
- Quest definitions are seeded JSON-like rows: `kind ∈ {daily, weekly}`, `predicate_kind`, `predicate_params`, `xp_reward`, `active`.
- Per-user `quest_progress` is keyed by `(user_id, quest_id, period_key)` where `period_key` is the local-date for daily or ISO-week for weekly, computed from the user's timezone.
- No business logic about *when* progress increments — only storage primitives.

## Scope

In:
- Migrations for `quest_definitions` and `quest_progress`.
- Seed migration with the daily/weekly quests visible in `Dashboard.html`.
- `IQuestRepository`: list active definitions by kind, read/upsert per-user progress, mark a period as completed.
- Unit tests.

Out:
- Missions (Task 03), the evaluator (Task 08), and any HTTP route.

## Acceptance Criteria

- [ ] Migrations apply cleanly; seed creates ≥ 4 daily and ≥ 3 weekly quests aligned with the wireframe copy.
- [ ] Repeated upserts on the same `(user_id, quest_id, period_key)` are idempotent and never duplicate rows.
- [ ] Querying "active quests for user U on date D" filters by `active = 1` and returns each definition with the user's current progress for the local period.
- [ ] No provider-specific imports outside the adapter folder.

## Verification Plan

1. `make db-migrations-dev` succeeds.
2. Vitest covers upsert idempotency and period-key derivation for two distinct user time zones.
3. `make lint` and `make test-api` pass.
