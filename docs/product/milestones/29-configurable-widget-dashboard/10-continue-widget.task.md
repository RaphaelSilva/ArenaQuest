# Task 10 — Backend: Last visited topic and continue widget (Phase 3)

**Status:** 📝 Open
**Milestone:** [29 — Configurable Widget Dashboard](./milestone.md)
**RFC:** [RFC 0008](../../RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md)
**Team:** Backend API
**Depends On:** [Task 03](./03-layout-driven-dashboard-aggregate.task.md)

## Summary

Gives the dashboard a **continue where you left off** signal. Migration `0034` adds a nullable
`topic_progress.last_visited_at` and an index on `(user_id, last_visited_at)`; existing rows stay
`NULL` (no backfill — the signal starts from the deploy). Every successful
`POST /v1/me/topics/{id}/visit` stamps it — **including a visit to a completed topic**, which today
returns before touching the row; the status rules do not change (a completed topic stays completed,
a visit still moves a new topic to `in_progress`). The `continue` widget's data is the accessible,
published, non-archived topic with the latest `last_visited_at`: `{ topicId, title, status }`, or an
empty answer when the student has no visit yet or the last visited topic is no longer accessible
(in which case the next most recent accessible one is used). Backlog `user-experience/10` (visit on
page mount) is independent; until it ships, a visit is recorded on media interaction as today. Task
12 renders the widget.

## Dependencies

- [Task 03](./03-layout-driven-dashboard-aggregate.task.md) — the provider slot in the aggregate.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/0034_add_topic_progress_last_visited_at.sql` (new; renumber if needed) —
    one `ADD COLUMN` (nullable, no default) and one index; rollback is dropping the index (the
    column is inert).
  - `apps/api/src/core/progress/progress-service.ts` and
    `apps/api/src/adapters/db/d1-progress-repository.ts` (+ its port) — stamp `last_visited_at` on
    visit; **no change to status transitions, `completed_at` or the complete route**.
  - `apps/api/src/core/dashboard/**` — the continue provider.
  - `apps/api/test/**`.
- **Monotonic status preserved.** The completed-topic path updates only `last_visited_at`.
- **Mission hooks unaffected.** The visit route's `runMissionHook` call and its `changed` semantics
  stay exactly as M27 left them (a timestamp-only update is not a status change).
- **Access before projection** for the continue topic, like Task 09.

## Scope

In:
- Migration, visit stamp, continue provider.
- Tests: visiting a new topic sets `in_progress` and `last_visited_at`; visiting a completed topic
  sets `last_visited_at`, keeps `completed` and `completed_at`, and reports no status change; the
  continue widget returns the latest visited accessible topic; when that topic becomes inaccessible
  the next one is returned; no visit → empty; mission hook behaviour on visit unchanged (existing
  M27 specs green).

Out:
- Web — Task 12. Visit on page mount — backlog `user-experience/10`. Media resume position — out of
  the milestone.

## Acceptance Criteria

- [ ] `make db-migrate-local` applies `0034`; the column and index exist.
- [ ] Each case in Scope is covered by a passing test; the M27 mission specs still pass.
- [ ] `git diff` shows no change to status transitions in `progress-service.ts`.
- [ ] Changed files lint clean; `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-migrate-local`; inspect `topic_progress`.
2. `make test-api`.
3. `make dev-api`; as a demo student, visit a completed topic and check the dashboard's continue
   data.
4. `git diff --stat` confirms only scope-guardrail files changed.
