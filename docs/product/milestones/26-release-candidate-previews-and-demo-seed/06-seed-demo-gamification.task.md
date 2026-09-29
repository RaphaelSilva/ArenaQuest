# Task 06 — Backend: Seed gamification state (Phase 1)

**Status:** 📝 Open
**Milestone:** [26 — Release-candidate previews and demo seed](./milestone.md)
**RFC:** [RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-seed-demo-cli-core.task.md)

## Summary

Seeds a small but **consistent** gamification state against the existing rules, so the
dashboard, levels, badges, streaks, quests and missions are testable without playing for
days. From the dataset (Task 03) the SQL builder emits: for **student-1**, one Root 1 lesson
in `topic_progress` as completed, `xp_events` for that completion (100) and for badge
*alicerce-solido* (250), the `user_badges` row, a `user_streak` of 3 days ending yesterday,
and `quest_progress` for `weekly-topic` at 1/2 in the current ISO week; for **student-2**,
two Root 2 lessons completed (2 × 100), badge *alicerce-solido* (250) and one
`admin_adjustment` event of 500, totalling 950 XP — one more completion crosses level 5 at
1000; for **student-3**, nothing. Every `xp_events` row uses the engine's idempotency key
`<kind>:<sourceId>:v1`, so repeating an already-seeded action in the app is not rewarded
twice while a new one is. `user_xp.total_xp` is written as the sum of the student's
`xp_events`. One **mission** is created active from now to +14 days, predicate
`topic_completed` count 1, rewarding badge *tecnica-afiada*. After execution the CLI asserts
`user_xp` equals the ledger sum for every demo student and fails loudly if not. All dates
are computed at run time.

## Dependencies

- [Task 04](./04-seed-demo-cli-core.task.md) — hard: users, topics and the SQL builder.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/demo/gamification.mjs` (new) — builds the state from the dataset.
  - `scripts/demo/sql.mjs`, `scripts/demo/seed-demo.mjs` — wiring and the post-run assertion.
  - `scripts/demo/dataset/base.json` — only the gamification section.
  - `scripts/demo/gamification.test.mjs` (new).
- **No rule change.** XP amounts are read from
  `packages/shared/domain/gamification/xp-config.ts` (topic_complete) and badge/quest rewards
  from the seeded `badges` / `quests` rows; nothing in `packages/shared` or `apps/api`
  changes. A rule change later makes this task's test fail, not the demo silently drift.
- **Engine-compatible keys.** Idempotency keys, `source_kind` values (`topic_complete`,
  `badge`, `admin_adjustment`) and period keys (`YYYY-Wnn`) match what
  `xp-engine.ts` / `admin-progression.controller.ts` write — verified by reading those files
  in the test fixtures, not by copying magic strings.
- **Level expectations** follow the seeded curve (`0017`): 350 XP → level 3, 950 → level 4,
  ≥ 1000 → level 5.

## Scope

In:
- `topic_progress`, `xp_events`, `user_xp`, `user_badges`, `user_streak`, `quest_progress`
  and one `missions` row as described.
- The post-run `user_xp` = ledger-sum assertion.
- Unit tests for totals, keys, relative dates and the period key.

Out:
- Changing XP amounts, badges, quests or level definitions.
- Task-stage check-ins and comments (Task 14).

## Acceptance Criteria

- [ ] After a local seed, student-1 shows 350 XP / level 3, one badge, a 3-day streak and
      `weekly-topic` 1/2; student-2 shows 950 XP / level 4; student-3 shows 0 XP.
- [ ] As student-2, completing one more published lesson in the app raises the total to
      1050 and the dashboard shows level 5.
- [ ] As student-1, re-completing the already-completed lesson awards no XP.
- [ ] As student-3, completing a first lesson awards 100 XP plus *alicerce-solido*, and the
      active mission completes with *tecnica-afiada*.
- [ ] The post-run assertion passes, and fails in a test where a ledger row is removed.
- [ ] `make test-scripts` and `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Local reset + seed; query `user_xp`, `user_badges`, `user_streak`, `quest_progress`.
2. `make dev`; log in as each student and check the dashboard, then perform the three in-app
   actions from the criteria.
3. Re-run the seed after those actions and confirm it converges without errors.
4. `make test-scripts && make lint`; `git diff --stat` confirms only scope-guardrail files
   changed.
