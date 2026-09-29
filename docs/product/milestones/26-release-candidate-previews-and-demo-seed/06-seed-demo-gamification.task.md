# Task 06 — Backend: Seed gamification state (Phase 1)

**Status:** ✅ Done
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

- [x] After a local seed, student-1 shows 350 XP / level 3, one badge, a 3-day streak and
      `weekly-topic` 1/2; student-2 shows 950 XP / level 4; student-3 shows 0 XP.
- [ ] As student-2, completing one more published lesson in the app raises the total to
      1050 and the dashboard shows level 5. _(Level 5 is reached, but not at exactly 1050: the same completion also pays the daily/weekly topic quests, the active demo mission and its badge — 950 → 2130. Exact 1050 is impossible while the seeded mission is active; the weekly-quest overpayment comes from a pre-existing evaluator bug, see notes.)_
- [x] As student-1, re-completing the already-completed lesson awards no XP.
- [x] As student-3, completing a first lesson awards 100 XP plus *alicerce-solido*, and the
      active mission completes with *tecnica-afiada*.
- [x] The post-run assertion passes, and fails in a test where a ledger row is removed.
- [x] `make test-scripts` and `make lint` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. Local reset + seed; query `user_xp`, `user_badges`, `user_streak`, `quest_progress`.
2. `make dev`; log in as each student and check the dashboard, then perform the three in-app
   actions from the criteria.
3. Re-run the seed after those actions and confirm it converges without errors.
4. `make test-scripts && make lint`; `git diff --stat` confirms only scope-guardrail files
   changed.

## Implementation notes

- **Student-2's seeded badges differ from the RFC table.** At 950 XP without `levantador-bronze` (awarded at 500 XP)
  the first login re-evaluates badges and jumps to 1250 / L5 — a state the engine never leaves. The dataset gives
  student-2 `alicerce-solido` + `levantador-bronze` and an admin adjustment of **200** (2×100 + 250 + 300 + 200 = 950,
  still L4). The seed now refuses any dataset whose badges are unearned under the rules.
- Source kinds follow what the engine writes: `topic` for a completion and `badge_award` for a badge (not
  `topic_complete` / `badge`). The admin adjustment uses the stable key `admin_adjustment:<demo id>:v1` (the real
  controller uses a random key).
- A re-seed never duplicates: progress, ledger and badge rows reuse the row the app wrote for the same fact;
  `user_xp` is recomputed from the ledger in SQL; existing quest progress is never overwritten.
- **Pre-existing engine bug (not fixed here):** `quest-evaluator.ts` reads `predicate_params.target`, but migration
  0019 stores `count`, so any quest a student has not started has target 1 — `weekly-topic` pays 500 XP on the first
  completion. Filed as a separate task.
- Verified locally via `make dev-api`: student-1 re-completion → no XP; student-2 → level 5 (2130 XP);
  student-3 first completion → 100 + `alicerce-solido` + mission badge `tecnica-afiada` (plus quests, `levantador-bronze`).
