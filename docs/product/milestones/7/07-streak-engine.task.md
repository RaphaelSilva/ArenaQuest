# Task 07 — Streak Engine

**Status:** ⏳ Pending
**Milestone:** [7](./milestone.md)

## Summary

Track consecutive-day engagement per user. Triggered by qualifying actions (login, any XP event); compares the user's local date today to `user_streak.last_active_local_date` and increments / resets accordingly.

## Dependencies

Task 01 (`user_streak` table + repository).

## Technical Constraints

- Pure-domain service `StreakEngine` in `packages/shared/domain/gamification/`. Receives a clock + the user's `timezone` (already on profile).
- Update is idempotent within the same local day — calling it twice on the same day must not double-increment.
- Increment when `today_local - last_active_local_date === 1`; reset to 1 when greater; no-op when equal.
- Invoked alongside the XP engine in shared call sites (login, stage check-in, topic complete, comment, video-watched).

## Scope

In:
- `StreakEngine.recordActivity(userId, nowUtc)` reading the user's timezone.
- Hooks in the same controllers as Task 06.
- Tests covering the three transitions (same day, +1 day, >1 day gap) and time-zone correctness near midnight.

Out:
- Read endpoint (delivered with Task 10's `/me/streak`).
- Best-streak rewards (Task 09 evaluates the badge rule `streak_days`).

## Acceptance Criteria

- [ ] Two activities on the same local day keep `current_days` unchanged.
- [ ] Activity on day N+1 increments `current_days` and updates `last_active_local_date`.
- [ ] Activity after a 2-day gap resets `current_days` to 1.
- [ ] `best_days` only moves forward (never decreases).
- [ ] A user in `America/Sao_Paulo` who acts at 23:30 local and again at 00:30 local crosses the day boundary correctly.

## Verification Plan

1. Vitest unit specs covering each transition plus the two timezone edge cases.
2. Integration test: login flow updates the streak.
3. `make lint` and `make test-api` pass.
