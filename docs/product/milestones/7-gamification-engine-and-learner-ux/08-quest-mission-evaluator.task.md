# Task 08 — Quest & Mission Evaluator

**Status:** ✅ Done
**Milestone:** [7](./milestone.md)

## Summary

When an XP event is recorded, evaluate the user's active daily quests, weekly quests, and missions, advancing their progress and awarding rewards on completion.

## Dependencies

Tasks 01, 02, 03, 06.

## Technical Constraints

- Pure-domain service `QuestEvaluator` in `packages/shared/domain/gamification/`.
- Receives an `XpEvent` plus repositories for quests and missions.
- Predicate kinds in M7: `watch_video`, `complete_subtopic`, `post_comment`, `check_in_stage`, `daily_login`, `complete_topic`. Anything else is silently ignored (logged at debug).
- Completion is idempotent: a quest already completed for the current period is not re-credited.
- On completion, calls back into the XP engine to record the reward as a new `xp_event` with `source_kind = 'quest_reward'` (or `'mission_reward'`) and a stable `idempotency_key`.
- Mission completion also queues the badge unlock pass (Task 09 reads the same event log).

## Scope

In:
- Evaluator service.
- Wiring into the XP engine's post-write hook chain.
- Tests covering daily reset boundary, weekly reset boundary, mission window edges, and reward idempotency.

Out:
- Badge unlocks (Task 09 owns rule evaluation).
- HTTP surfaces (Task 10).

## Acceptance Criteria

- [x] A daily quest "Complete 1 subtopic" goes from 0 → 1 on the first topic-complete event and is marked completed.
- [x] The same quest on the same local day stays completed but does not re-credit XP on subsequent events.
- [x] Crossing local midnight reopens the quest at progress 0 for the new period.
- [x] A mission with `end_at` in the past does not progress even if a matching event arrives.
- [x] Reward XP is recorded as its own `xp_event` exactly once.

## Verification Plan

1. Vitest specs exercise all predicate kinds × completion idempotency.
2. End-to-end integration test: stage check-in → daily quest progresses → reward `xp_event` appears with the right source.
3. `make lint` and `make test-api` pass.
