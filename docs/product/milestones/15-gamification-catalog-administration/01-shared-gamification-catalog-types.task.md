# Task 01 — Backend: Shared gamification catalog types (Phase 0)

**Status:** 📝 Open
**Milestone:** [15 — Gamification Catalog Administration](./milestone.md)
**RFC:** [RFC 0009](../../RFCs/0009-gamification-catalog-administration.md)
**Team:** Backend API

## Summary

Promote the gamification catalog record shapes into the `Entities.Gamification`
namespace so the API and the web client share a single canonical definition
instead of re-declaring Zod-inferred shapes per file. This task adds `Badge`,
`QuestDefinition`, and `Mission` alongside the already-present `LevelDefinition`,
mirroring the columns of the `badges`, `quest_definitions`, and `missions`
tables, and refactors the existing `admin-badges` and `admin-missions` routers
to import these shared types rather than their local declarations. No schema, no
endpoint, and no behaviour changes — this is a pure type-promotion that every
later task in the milestone (the new quests/levels endpoints in 02/03 and the
typed web client in 04) builds on.

## Dependencies

- None — independent. This is the foundation task; tasks 02, 03, and 04 depend
  on the shared types it introduces.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/types/entities.ts` — add `Badge`, `QuestDefinition`, and
    `Mission` to the `Entities.Gamification` namespace, matching the existing
    `LevelDefinition` style and the corresponding table columns.
  - `apps/api/src/routes/admin/badges.ts`, `apps/api/src/routes/admin/missions.ts`,
    and `apps/api/src/controllers/admin-badges.controller.ts`,
    `apps/api/src/controllers/admin-missions.controller.ts` — refactor only to
    import the shared types in place of locally re-declared record shapes.
  - `apps/api/test/**` — adjust any badge/mission specs whose fixtures reference
    the moved type names.
- **No schema change.** This task adds no migration; the catalog tables already
  exist.
- **Ports & Adapters.** Type promotion only — no D1/R2 symbol enters
  `packages/shared`; the entity types stay provider-agnostic plain shapes.
- **No behaviour change.** Request/response payloads, validation, and statuses
  for the existing badge/mission endpoints are byte-for-byte unchanged; this is a
  refactor verified by the existing tests staying green.

## Scope

In:
- `Entities.Gamification.Badge`, `Entities.Gamification.QuestDefinition`, and
  `Entities.Gamification.Mission` added to the shared entities namespace.
- The `admin-badges` and `admin-missions` routers/controllers refactored to
  consume the shared types.
- Existing badge/mission Vitest specs updated only where they referenced the
  former local type names, kept green.

Out:
- Any new endpoint, migration, or repository write method — quests (task 02) and
  levels (task 03) own those.
- Any frontend change — the web client (task 04) consumes these types.

## Acceptance Criteria

- [ ] `Entities.Gamification` exports `Badge`, `QuestDefinition`, and `Mission`
      whose fields match the `badges`, `quest_definitions`, and `missions`
      columns; `LevelDefinition` remains unchanged.
- [ ] `admin-badges` and `admin-missions` routers/controllers import the shared
      types; no local re-declaration of those record shapes remains.
- [ ] Existing badge/mission endpoint behaviour is unchanged — their Vitest specs
      pass without payload edits.
- [ ] No provider-specific (D1/R2) import leaks into `packages/shared`.
- [ ] Changed files lint clean; `make test-api` green for the affected specs.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — the existing badge and mission specs pass against the
   refactored imports with no payload changes.
2. `make lint` — the shared package and API compile with the promoted types and
   no unused local declarations remain.
3. Grep the badge/mission routers/controllers to confirm they reference
   `Entities.Gamification.*` and no longer carry inline record shapes.
4. `git diff --stat` confirms only scope-guardrail files changed.
