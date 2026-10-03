# Task 12 — Backend: Remove the legacy predicate mission path

**Status:** 📝 Open
**Kind:** Refactor
**Team:** Backend API
**Priority:** Low
**Found in:** Milestone 27, Task 08, 2026-10-03

## Summary

Since Milestone 27 (RFC 0022) every new mission is defined by typed requirements and written with
`predicate_kind = 'requirements'`; a mission with any other `predicate_kind` is a *legacy* M7
predicate mission, still evaluated by the mission loop of
`packages/shared/domain/gamification/quest-evaluator.ts` through
`IMissionRepository.listActiveLegacyMissions`, still listed to students by
`apps/api/src/controllers/me-missions.controller.ts` (`steps: []`), and still special-cased by the
admin API (`409 MISSION_LEGACY` on `PUT …/requirements`, `404` on `POST …/reconcile`). No legacy
mission can be created any more, so this path only serves missions that existed before M27 and
ends with the last one's `end_at`. The target state: the quest evaluator evaluates quests only,
the port and its D1 adapter lose `listActiveLegacyMissions`, and the student list reads
requirements missions only. User-visible behaviour must stay identical **provided** no legacy
mission is active — this task may only start once that holds on every label and environment.

## Why It Is Worth Fixing

- Two evaluators own missions: a reader of `quest-evaluator.ts` sees a mission loop that only
  applies to rows nobody can create, and every mission read site carries a branch on
  `predicateKind` (`me-missions.controller.ts`, `admin-missions.controller.ts`,
  `jobs/reconcile-missions.ts`, `mission-evaluator.ts`).
- The legacy loop reads `predicate_params.target` like the quests do, so it shares the
  seed-mismatch trap filed as [Task 11](./11-quest-seed-predicate-mismatch.task.md).
- Evidence: M27 Task 08 narrowed the loop to legacy missions instead of deleting it, because
  missions created before M27 were still running (RFC 0022 §3.7, Resolved Decision 16).

## Scope

In:
- A precondition check, recorded in the PR: for each label, staging and production,
  `SELECT COUNT(*) FROM missions WHERE active = 1 AND predicate_kind <> 'requirements' AND
  datetime(end_at) >= datetime('now')` returns 0. If it does not, the task waits.
- Delete the mission loop from `QuestEvaluator` (and its `IMissionRepository` constructor
  dependency); the quest loop is untouched.
- Remove `listActiveLegacyMissions` from `IMissionRepository` and `D1MissionRepository`; the student
  list (`GET /v1/me/missions` and the dashboard) reads `listActiveRequirementMissions` only.
- Specs: the quest evaluator spec drops its legacy-mission cases; the me-missions router spec asserts that an
  active legacy row is no longer listed; every other mission spec passes unchanged.

Out:
- Dropping `predicate_kind` / `predicate_params` from `missions`: `predicate_kind = 'requirements'`
  is still the discriminator the admin API, the evaluator and the reconciliation read, and a column
  drop on D1 means a table rebuild — a separate decision, not part of this refactor.
- The admin API's `MISSION_LEGACY` guard and the deprecated `predicateKind` / `predicateParams`
  response fields: they protect an ended legacy row an admin may still open, and removing response
  fields is an API contract change.
- The web's legacy rendering (the single progress bar in `MissionsList`, the *legacy* label on
  `/admin/missions`): it simply stops being reached; removing it is a frontend follow-up.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/domain/gamification/quest-evaluator.ts`
  - `packages/shared/ports/i-mission-repository.ts`
  - `apps/api/src/adapters/db/d1-mission-repository.ts`
  - `apps/api/src/controllers/me-missions.controller.ts`
  - `apps/api/src/container.ts` (the `QuestEvaluator` construction only)
  - `apps/api/test/**`
- No migration, no route or schema change, no `openapi.json` change.
- No behaviour change for quests, for requirements missions, or for any admin route.

## Acceptance Criteria

- [ ] The precondition query returns 0 on every label × environment, and the PR records it.
- [ ] `grep -rn "listActiveLegacyMissions" apps packages` (excluding `dist/`) returns nothing, and
      `QuestEvaluator` no longer takes a mission repository.
- [ ] `GET /v1/me/missions` returns the same entries as before for a student with requirements
      missions (router spec), and quest progress is unchanged (quest evaluator spec).
- [ ] `make test-api` and `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Run the precondition query against each label's staging and production D1 (read-only).
2. `make test-api` — the remaining specs pass unchanged (proves no behaviour change for quests and
   requirements missions); `make lint`.
3. Demonstrate the guard: re-add a legacy branch to `getMissions` locally and confirm the router
   spec that asserts "no legacy entry" fails, then revert.
4. `git diff --stat` confirms only scope-guardrail files changed.
