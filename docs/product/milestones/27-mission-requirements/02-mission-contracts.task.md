# Task 02 — Backend: Mission contracts — requirement kinds, params, entities, ports (Phase 1)

**Status:** 📝 Open
**Milestone:** [27 — Mission requirements](./milestone.md)
**RFC:** [RFC 0022](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md)
**Team:** Backend API

## Summary

Lays down the shared contracts every other M27 task builds on, with no runtime behaviour yet. A new
`packages/shared/domain/missions/requirements.ts` declares the five requirement kinds
(`submissions_on_topic`, `topic_visited`, `video_watched`, `manual_check`,
`event_participation`), the limits (at most 20 steps per mission, step title 1…120 characters,
`minCount` 1…50, manual-check instructions ≤ 500), the **per-kind params schemas** in Zod — strict
objects, so an unknown key is rejected — with their defaults (`requireDescription` false,
`visibility` `any`, `countModerated` **false**, empty params for `topic_visited` and
`event_participation`), the discriminated requirement input (title, `xpReward ≥ 0`, `topicId` for
the three topic kinds, `eventId` for `event_participation`, neither for `manual_check`), and the
helper that derives a step's target count (`minCount` for the two counting kinds, 1 otherwise).
`Entities.Gamification` gains the mission `mode` (`parallel` | `sequential`) and
`enrollmentMode` (`auto` | `open` | `assigned`), marks `predicateKind` / `predicateParams` as
deprecated legacy fields, and adds `MissionRequirement`, `MissionEnrollment` (source
`auto` | `self` | `admin`, `joinedAt`, `countsFrom`, `leftAt`) and `MissionRequirementProgress`
(`currentCount`, `targetCount`, `checkedAt`, write-once `completedAt`, `completedBy` `hook` |
`reconcile`). `DashboardMissionEntry` gains `enrollment`, `joinable`, `locked` (teaser:
`reason: 'assigned'` and group names) and `steps`, with a new `MissionStepView` (state `locked` |
`open` | `completed`, current/required, target view, XP, `completedAt`) — additive, the existing
`mission` and `progress` fields keep their shape. `IMissionRepository` is extended with requirement
and audience reads/writes; two new ports are added: `IMissionParticipationRepository`
(enrollments, step progress, captured evidence) and `IMissionEvidenceRepository` (set-based
counting per requirement, returning per user the qualifying count and the instant of the
target-th item). `XpAction` gains `mission_step_reward` with 0 default points. RFC 0022 §1, §2,
§6.

## Dependencies

None — independent; it is the root of the backend chain (Tasks 03 and 04 depend on it).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/domain/missions/requirements.ts` (new).
  - `packages/shared/domain/mission.ts` — re-exports of the new mission types.
  - `packages/shared/types/entities.ts` — only the `Entities.Gamification` mission types.
  - `packages/shared/types/dashboard.ts` — `DashboardMissionEntry` additions and
    `MissionStepView`.
  - `packages/shared/ports/i-mission-repository.ts` (extended),
    `packages/shared/ports/i-mission-participation-repository.ts` (new),
    `packages/shared/ports/i-mission-evidence-repository.ts` (new), `packages/shared/ports/index.ts`.
  - `packages/shared/domain/gamification/xp-config.ts` — one `XpAction` appended.
  - `packages/shared/domain/missions/requirements.spec.ts` (new) — colocated, like
    `domain/submissions/limits.spec.ts`.
  - Compile-only adjustments in `apps/api/src/adapters/db/d1-mission-repository.ts` (stub
    methods throwing "not implemented") **only if** the new port methods break the build; the real
    implementation is Task 04.
- **Ports & Adapters.** Ports name no D1, R2 or Cloudflare type; method contracts are described in
  domain terms (instants as ISO strings, users and requirements by id).
- **Params are validated at every boundary.** The schemas are the only definition of a kind's
  params; the API (Task 05) and the web (Task 09) both import them.
- **Additive types.** No existing field of `Mission`, `MissionProgress` or `DashboardMissionEntry`
  is renamed or removed; the legacy predicate fields stay, marked deprecated.
- No change to `quest-evaluator.ts`, `badge-engine.ts`, `xp-engine.ts` or `streak-engine.ts`.

## Scope

In:
- Requirement kinds, limits, per-kind params schemas and the target-count helper.
- Entity, dashboard and port additions listed above; `mission_step_reward` action.
- Tests: each kind accepts its minimal valid params; `minCount` 0 and 51 are refused; an extra key
  is refused; `topicId` on `manual_check` and `eventId` on a topic kind are refused; defaults are
  applied; target count per kind.

Out:
- Evaluator logic — Task 03. Migration and adapters — Task 04. Routes — Tasks 05 and 07.
- Any frontend change.

## Acceptance Criteria

- [ ] Parsing a `submissions_on_topic` requirement with only `minCount: 3` yields
      `requireDescription: false`, `visibility: 'any'`, `countModerated: false`.
- [ ] An unknown `kind`, `minCount: 0`, `minCount: 51`, an extra params key, a 121-character title,
      a `topicId` on `manual_check` and an `eventId` on `video_watched` are each rejected by the
      schema (unit tests).
- [ ] The target-count helper returns `minCount` for `submissions_on_topic` and `video_watched` and
      1 for the other three kinds.
- [ ] `DashboardMissionEntry` still type-checks against the current `me-missions.controller.ts`
      output once the new fields are filled with neutral values (`enrollment: null`,
      `joinable: false`, `locked: null`, `steps: []`).
- [ ] No D1, R2 or Cloudflare symbol appears in any file under `packages/shared/`.
- [ ] `make build` passes; `pnpm --filter @arenaquest/shared test` green; changed files lint
      clean; `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `pnpm --filter @arenaquest/shared test` — the new `requirements.spec.ts` passes.
2. `make build` — API and web still compile.
3. `make test-api`; `make lint`.
4. `git grep -n "D1Database\|R2Bucket" -- packages/shared` returns nothing.
5. `git diff --stat` confirms only guardrail files changed.
