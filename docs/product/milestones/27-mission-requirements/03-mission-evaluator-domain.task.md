# Task 03 — Backend: Mission evaluator — windowing, sequential unlock, write-once rewards, streak (Phase 1)

**Status:** 📝 Open
**Milestone:** [27 — Mission requirements](./milestone.md)
**RFC:** [RFC 0022](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-mission-contracts.task.md)

## Summary

Implements the pure `MissionEvaluator` in `packages/shared/domain/gamification/mission-evaluator.ts`
— the single routine the hooks (Task 06), the manual check (Task 07) and the daily reconciliation
(Task 08) all call. Given a mission, its ordered requirements and one or more enrollments, it
decides each step's state against the counts the evidence port returns. **Windowing** (RFC §3.3):
an enrollment's floor is the later of the mission's `start_at` and the enrollment's `counts_from`;
in `parallel` mode every step is open from that floor; in `sequential` mode step 1 opens at the
floor and step N opens at step N−1's `completed_at`, later steps being `locked` and not counted;
evidence counts only up to the earlier of `end_at` and now. **Completion** (RFC §3.4–§3.5): a step
completes when the target-th qualifying item exists, and its `completed_at` is **that item's
instant**, never the evaluation wall clock, so the hook and the cron produce the same value; a
completed step is never recounted and never un-completed; an incomplete step's count is rewritten
and may go down. When every step is complete the mission completes with the latest step instant.
**Rewards**, each granted only when the completion actually changed a row: step XP as
`mission_step_reward` keyed by requirement id, mission XP as `mission_reward` keyed by mission id
(the M7 key, unchanged), and the mission badge through the badge port plus that badge's own XP as
`badge_award` — the badge is finally granted (today `badge_id` is never read). **Streak**: when a
call made with origin `hook` or `manual_check` closes at least one step, the evaluator records one
streak activity for the user at `now`; a step closed with origin `reconcile` records **no** streak
activity, because the cron runs on a day the student may not have acted. **Signals**: the hook
entry point takes a typed signal (submission on topics, topic visit, video watch, event charge),
asks the repositories for candidate requirements on active missions, ensures implicit enrollments
(`auto` only for non-staff users whose effective access set contains every topic target of the
mission; `assigned` for covered users; `counts_from = start_at`), captures visit and watch
evidence only for a step open right now, then evaluates. Nothing is ever revoked.

## Dependencies

- [Task 02](./02-mission-contracts.task.md) — hard code dependency: kinds, target-count helper,
  entity types and the three ports.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/domain/gamification/mission-evaluator.ts` (new).
  - `apps/api/test/core/gamification/mission-evaluator.spec.ts` (new) — beside the existing
    `quest-evaluator.spec.ts`, `badge-engine.spec.ts`, `streak-engine.spec.ts`, using in-memory
    fakes of the ports.
- **Pure domain.** The evaluator depends only on the ports (`IMissionRepository`,
  `IMissionParticipationRepository`, `IMissionEvidenceRepository`, `IBadgeRepository`), on
  `XpEngine` and on `StreakEngine`, all injected; no D1, R2, Hono or `env` symbol; the clock is a
  parameter.
- **Write-once is a contract on the ports**: the evaluator relies on "complete if not yet complete"
  and "set partial count unless complete" port methods that report whether a row changed, and
  grants rewards only on a change. XP idempotency keys are the second guard.
- **No revocation path.** The evaluator never calls anything that deletes or negates an XP event
  or a badge.
- **Staff detection** uses the role constants in `packages/shared/constants/roles.ts`
  (`admin`, `content_creator`); the effective-access check is a port call, never a re-implementation
  of `getEffectiveAccessTopicIds`.
- **Unchanged engines.** `XpEngine`, `StreakEngine`, `BadgeEngine` and `QuestEvaluator` are used as
  they are; the legacy narrowing of `QuestEvaluator` is Task 08.

## Scope

In:
- The evaluator: signal entry point, enrollment evaluation, manual-check entry point (sets the
  check, then evaluates), set-based reconcile entry point over a mission's enrollments (consumes
  per-user counts from the evidence port), and their result types (steps closed, missions closed).
- Unit tests over in-memory fakes covering: parallel vs sequential opening; a late `open` join
  ignoring earlier evidence; evidence on the window edges; completion instant equal to the
  target-th item's instant; regression before completion and none after; mission completion and
  badge grant once; step and mission XP keys; streak recorded for `hook` and `manual_check`
  origins and **not** for `reconcile`; `auto` enrollment skipped for staff and for a user missing
  one topic target; `open` missions not auto-enrolled; left enrollments skipped.

Out:
- SQL and adapters — Task 04. Hook placement — Task 06. HTTP — Tasks 05 and 07. The cron job and
  legacy narrowing — Task 08.

## Acceptance Criteria

- [ ] In a sequential mission, evidence dated before step 1's `completed_at` does not count for
      step 2 and evidence dated after it does (unit test).
- [ ] For a step with `minCount: 3` whose qualifying items are at t1 < t2 < t3 < t4, the step's
      `completed_at` is t3, whether the evaluation runs at t3 or a day later.
- [ ] Re-evaluating a completed mission after its evidence disappears leaves every `completed_at`
      and the mission completion untouched, and issues no XP or badge call; an incomplete step's
      count drops.
- [ ] Two evaluations of the same completion grant exactly one `mission_step_reward`, one
      `mission_reward` and one badge (fakes record calls).
- [ ] A step closed with origin `hook` or `manual_check` triggers exactly one streak activity call;
      a step closed with origin `reconcile` triggers none.
- [ ] An `auto` mission is never enrolled for an `admin` or `content_creator`, nor for a student
      whose access set lacks one topic target; an `open` mission is never enrolled implicitly.
- [ ] No D1, R2 or Hono import in `mission-evaluator.ts`.
- [ ] Changed files lint clean; `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `cd apps/api && pnpm test test/core/gamification/mission-evaluator.spec.ts`.
2. Read the coverage report for the evaluator: every branch of windowing, completion, rewards and
   streak is hit.
3. `make test-api`; `make lint`.
4. `git diff --stat` confirms only the two guardrail files changed.
