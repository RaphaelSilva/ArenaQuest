# Task 08 — Backend: Daily reconciliation, admin reconcile endpoint and legacy loop narrowing (Phase 4)

**Status:** ✅ Done
**Milestone:** [27 — Mission requirements](./milestone.md)
**RFC:** [RFC 0022](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md)
**Team:** Backend API
**Depends On:** [Task 03](./03-mission-evaluator-domain.task.md), [Task 04](./04-schema-and-d1-adapters.task.md), [Task 05](./05-admin-missions-api.task.md)

## Summary

Adds the daily safety net and the legacy hand-off. A new job, `apps/api/src/jobs/reconcile-missions.ts`,
runs from the existing `scheduled()` handler **after** the submission sweep, isolated so a billing
or sweep failure never skips it and its own failure affects neither. Its scope is missions that are
active, use requirements, have started, and ended no more than **48 hours** ago (so a hook that
failed in a mission's last hours is still caught). For each it: materialises implicit enrollments
in one statement — for `auto`, every active user **without** the `admin` or `content_creator` role
whose effective access set contains every topic target; for `assigned`, direct users and members of
the audience groups; `counts_from = start_at`; backfills captured evidence the sources still prove
(first video watches from `xp_events` joined to the target topic's media, visits from
`topic_progress` creation and, for in-progress rows, last update) inside the mission window without
overwriting hook rows; recomputes every requirement in position order with the set-based counting
of Task 04 for all enrollments; and writes completions and partial counts in batches of 100 with
`completed_by = 'reconcile'`. It may **close** a step or a mission and grant its XP and badge, but
**never reopens** anything, and it records **no streak activity**. It logs counts only. The same
routine is exposed as `POST /v1/admin/missions/{id}/reconcile` (admin only) for one mission — one
routine, two callers, as billing does. Finally the M7 mission loop in
`packages/shared/domain/gamification/quest-evaluator.ts` is **narrowed to legacy missions**
(`predicate_kind` other than `requirements`), so new missions are evaluated only by the mission
evaluator while legacy ones run out on the old path until their `end_at`.

## Dependencies

- [Task 03](./03-mission-evaluator-domain.task.md) — hard code dependency: the reconcile entry
  point.
- [Task 04](./04-schema-and-d1-adapters.task.md) — hard code dependency: set-based counting,
  backfill and batched writes.
- [Task 05](./05-admin-missions-api.task.md) — hard code dependency: the admin missions router the
  reconcile route joins.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/jobs/reconcile-missions.ts` (new).
  - `apps/api/src/index.ts` — one call in `scheduled()` after `sweepPendingSubmissions`; billing
    and the sweep are untouched.
  - `apps/api/src/routes/admin/missions.ts` and `apps/api/src/controllers/admin-missions.controller.ts`
    — the `POST …/reconcile` route (admin only) and its controller method.
  - `packages/shared/domain/gamification/quest-evaluator.ts` — only the mission loop
    (legacy filter); `packages/shared/ports/i-mission-repository.ts` and
    `apps/api/src/adapters/db/d1-mission-repository.ts` — only the legacy-listing method if Task 04
    did not add it.
  - `apps/api/openapi.json` regenerated; `apps/api/test/**`.
- **Monotonic.** The job never clears `completed_at` or a mission's completed flag and never
  deletes an XP event or badge.
- **Bounded cost.** Statements grow with missions × requirements, never with users, keeping the run
  within D1's per-invocation query cap; writes are batched by 100.
- **Quests untouched.** The daily and weekly quest loop of `quest-evaluator.ts`, `quest_definitions`
  and `0019_seed_quests.sql` are not edited.
- **No streak** from this path; ids-only, count-only logging.

## Scope

In:
- The job, its wiring in `scheduled()`, the admin reconcile route, the legacy narrowing.
- Specs: a mission whose hook was skipped is completed by `scheduled()` with
  `completed_by = 'reconcile'` and the same `completed_at` the hook would have written; a second
  run changes no row; a completed mission whose evidence was deleted stays completed; a mission
  ended 47 h ago is reconciled and one ended 49 h ago is not; implicit enrollments exclude staff
  and gated-out students; backfill inserts a pre-existing first watch inside the window and skips
  one outside it; no streak update from the job; legacy missions still progress through
  `QuestEvaluator` and a requirements mission does not; the reconcile route is `403` for a content
  creator.

Out:
- Hooks — Task 06. Admin UI for *Reconcile now* — Task 10.

## Acceptance Criteria

- [x] With hooks bypassed, three qualifying submissions inside the window lead `scheduled()` to
      complete the step and mission with `completed_by = 'reconcile'`, one
      `mission_step_reward` and one `mission_reward`, and `completed_at` equal to the third
      submission's `created_at`.
- [x] Running `scheduled()` twice in a row changes no row the second time.
- [x] After evidence of a completed mission is deleted, `scheduled()` leaves every `completed_at`,
      `xp_events` and `user_badges` row unchanged; `user_streak` is never written by the job.
- [x] No `admin` or `content_creator` is enrolled in an `auto` mission by the job; a student lacking
      access to one topic target is not enrolled.
- [x] `POST /v1/admin/missions/{id}/reconcile` returns the run's counts for an admin and `403` for
      a content creator.
- [x] A legacy mission still advances on a mapped quest source; a `requirements` mission is not
      touched by `QuestEvaluator`.
- [x] A thrown error in the job does not prevent billing or the sweep from running (spec).
- [x] Changed files lint clean; `make test-api` green.
- [x] No diff outside the scope guardrail.
      _Closed 2026-10-03. Authorized additions: `materializeImplicitEnrollments` and `backfillEvidence` on `IMissionParticipationRepository`, each one set-based `INSERT … SELECT … ON CONFLICT DO NOTHING` (the access rule mirrors `getEffectiveAccessTopicIds`, with a parity spec). **Not met, follow-up filed in Task 14:** completions and partial counts are still written one row at a time through the evaluator's `reconcileMission` (write-once and change-only, but O(enrollments) statements), not in `db.batch` chunks of 100 — a set-based writer in the evaluator is the follow-up. `reconcileOneMission` (admin route) ignores the 48 h window; a failure inside it answers `200` with `failed: 1`._

## Verification Plan

1. `make db-reset-local`; create a mission and insert qualifying submissions directly in the local
   D1 (no hook).
2. Trigger the scheduled handler locally (`wrangler dev --test-scheduled` and
   `curl "http://localhost:8787/__scheduled"`); read the participants endpoint.
3. Trigger it again and diff the mission tables — identical.
4. `make test-api`; `make lint`.
5. `git diff --stat` confirms only guardrail files changed.
