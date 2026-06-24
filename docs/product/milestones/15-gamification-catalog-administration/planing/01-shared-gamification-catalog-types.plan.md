# Plan — Task 01: Shared gamification catalog types

**Task:** [01-shared-gamification-catalog-types.task.md](../01-shared-gamification-catalog-types.task.md)
**Persona:** `backend-developer` (touches `packages/shared` + `apps/api` only)
**Branch:** `feature/m15/01-shared-gamification-catalog-types.task`

## Goal

Promote the gamification catalog record shapes into the `Entities.Gamification`
namespace (`packages/shared/types/entities.ts`) so the API and the upcoming web
client (task 04) share one canonical definition. `LevelDefinition` already lives
there; add `Badge`, `QuestDefinition`, and `Mission`. Pure type-promotion +
refactor — no schema, no endpoint, no behaviour change.

## Current state (verified)

- `LevelDefinition` is already in `Entities.Gamification`
  (`packages/shared/types/entities.ts`).
- `QuestDefinition` + `QuestKind` live in `packages/shared/domain/quest.ts`.
- `Mission` lives in `packages/shared/domain/mission.ts`.
- The badge record shape is `BadgeRecord` declared inline in
  `packages/shared/ports/i-badge-repository.ts` (no domain file).
- Consumers of these types in `apps/api/src`:
  `controllers/me-quests.controller.ts`, `controllers/admin-missions.controller.ts`,
  `controllers/admin-badges.controller.ts`, `routes/admin/badges.ts`,
  `adapters/db/d1-quest-repository.ts`, `adapters/db/d1-badge-repository.ts`,
  `adapters/db/d1-mission-repository.ts`.

## Approach

1. **Add canonical types to `Entities.Gamification`** in
   `packages/shared/types/entities.ts`:
   - `Badge` — mirror `BadgeRecord` (id, slug, name, iconEmoji, description,
     xpReward, ruleKind, ruleParams, active, createdAt, updatedAt).
   - `QuestDefinition` — mirror `domain/quest.ts` (id, kind, title, description,
     predicateKind, predicateParams, xpReward, active, createdAt, updatedAt).
     Keep the `QuestKind` enum where it is (`daily`/`weekly`); the namespace type
     references it (or a `'daily' | 'weekly'` union) to avoid a behaviour change.
   - `Mission` — mirror `domain/mission.ts`.
2. **Make the existing locations re-export the canonical types** rather than
   duplicating: `domain/quest.ts`, `domain/mission.ts`, and the `BadgeRecord`
   interface in `i-badge-repository.ts` become thin re-exports/aliases pointing
   at `Entities.Gamification.*`. This preserves every existing import path
   (`@arenaquest/shared/domain/mission`, `BadgeRecord`, etc.) so no consumer
   breaks, while establishing the single source of truth. Keep `QuestProgress`,
   `MissionProgress`, `QuestWithProgress`, `UserBadgeRecord` exactly where they
   are (out of scope — RFC 0010 progress types).
3. **Refactor `admin-badges` and `admin-missions`** (routers/controllers) to
   import the shared `Entities.Gamification.*` types as the AC requires, where it
   does not change any payload. Do not touch the participant `me-quests`
   controller beyond what compilation requires.
4. **No payload/behaviour change.** The inline OpenAPI Zod schemas in the routers
   (`MissionSchema`, `BadgeRecordSchema`) stay as-is — they describe the wire
   shape and must not change. Only TypeScript type references move.

## Files in scope

- `packages/shared/types/entities.ts` — add the three interfaces.
- `packages/shared/domain/quest.ts`, `packages/shared/domain/mission.ts` —
  re-export aliases.
- `packages/shared/ports/i-badge-repository.ts` — `BadgeRecord` aliases the
  shared `Badge`.
- `apps/api/src/controllers/admin-badges.controller.ts`,
  `apps/api/src/controllers/admin-missions.controller.ts`,
  `apps/api/src/routes/admin/badges.ts` — import shared types.
- `apps/api/test/**` — adjust only if a fixture references a moved name.

## Out of scope

- Any new endpoint, migration, or repository write method (tasks 02/03).
- Progress types (`QuestProgress`, `MissionProgress`) — RFC 0010.
- Any `apps/web` change.

## Verification

- `make lint` — shared + api compile with the promoted types; no unused inline
  declarations remain.
- `make test-api` — existing badge/mission/quest specs green with no payload edit.
- `git diff --stat` — only scope-guardrail files changed.
