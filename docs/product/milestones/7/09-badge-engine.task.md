# Task 09 — Badge Unlock Engine

**Status:** ⏳ Pending
**Milestone:** [7](./milestone.md)

## Summary

Evaluate badge unlock rules after each XP event. Award unlocked badges idempotently and record an associated XP reward (if the badge specifies one) through the XP engine.

## Dependencies

Tasks 01, 04, 06, 07 (streak input).

## Technical Constraints

- `BadgeEngine` in `packages/shared/domain/gamification/`. Reads the badge catalog from `IBadgeRepository`, evaluates each active badge's rule against current user state, awards if newly-met.
- Rule kinds in M7: `streak_days`, `topic_completed`, `videos_watched_in_period`, `total_xp`, `mission_completed`.
- Award is idempotent at the DB level (unique on `(user_id, badge_id)`); the engine still checks before inserting to avoid noisy errors.
- Awarding emits an `xp_event` with `source_kind = 'badge_award'` when `xp_reward > 0`.

## Scope

In:
- `BadgeEngine.evaluate(userId)` invoked from the post-XP-event hook chain.
- Rule evaluators for the five supported kinds.
- Tests for each rule kind plus the idempotency contract.

Out:
- Admin authoring UI; admin CRUD is in Task 04.

## Acceptance Criteria

- [ ] Reaching `streak_days = 7` awards "Semana Perfeita" exactly once.
- [ ] Completing topic X awards a `topic_completed` badge targeting X; re-completing X does not re-award.
- [ ] A `total_xp ≥ 500` badge awards at the moment the threshold is crossed.
- [ ] Disabling a badge (`active = 0`) excludes it from future evaluations but does not revoke prior awards.

## Verification Plan

1. Vitest specs for each rule kind including the threshold-crossing transition.
2. Integration test: streak reaches 7 via simulated logins → award row appears + XP reward credited.
3. `make lint` and `make test-api` pass.
