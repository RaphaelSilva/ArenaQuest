# Task 06 — XP Engine & Controller Hooks

**Status:** ⏳ Pending
**Milestone:** [7](./milestone.md)

## Summary

Introduce a small domain service `XpEngine` that decides how many XP a given event is worth and records it idempotently via `IGamificationRepository`. Wire it into the existing controllers that emit gamifiable events: stage check-in (M5), topic completion (M5), and a new "video watched" signal exposed as `POST /topics/:id/videos/:videoId/watched`.

## Dependencies

Task 01 (data layer).

## Technical Constraints

- `XpEngine` is a pure-domain service in `packages/shared/domain/gamification/`; takes an `IGamificationRepository` by interface and a clock from `domain/time`. No HTTP concerns.
- The XP table (action → points) is config-driven, loaded from the `Env` or a constants module — never hard-coded inside the engine.
- Each call constructs an `idempotency_key` derived from `(source_kind, source_id, version)` so retries credit once.
- Hooks live in existing controllers (`tasks`, `topics`) and emit XP after the primary write succeeds. The hook must not fail the parent operation if the XP write itself throws — log + continue.

## Scope

In:
- `XpEngine` with `award(action, user, source)`.
- New `POST /topics/:id/videos/:videoId/watched` route + controller (validates the topic is granted to the caller).
- Hooks in `tasks/check-in`, `topics/complete`, `comments/create` (Task 11 will call back into this engine).
- Tests covering action→points mapping and idempotency.

Out:
- Streak handling (Task 07) and quest progression (Task 08), although their hooks may share the same call site — the awarder emits an internal "xp event observed" notification consumed by 07/08/09.

## Acceptance Criteria

- [ ] Replaying a stage check-in produces one XP event regardless of retries.
- [ ] Completing a topic awards XP exactly once per topic per user.
- [ ] The video-watched endpoint requires the topic to be granted (existing access-aware filter from M5) and awards XP once per `(user, video)` pair.
- [ ] Disabling the engine in the env (`GAMIFICATION_ENABLED=false`) makes all calls no-op without errors.
- [ ] No provider-specific imports outside `apps/api/src/adapters/`.

## Verification Plan

1. New Vitest unit specs for `XpEngine`.
2. Integration tests verify XP table side-effects on the three existing controllers.
3. `make lint` and `make test-api` pass.
