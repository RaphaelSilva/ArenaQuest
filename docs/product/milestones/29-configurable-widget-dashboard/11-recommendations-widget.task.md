# Task 11 — Backend: Recommendations widget (Phase 3)

**Status:** 📝 Open
**Milestone:** [29 — Configurable Widget Dashboard](./milestone.md)
**RFC:** [RFC 0008](../../RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md)
**Team:** Backend API
**Depends On:** [Task 07](./07-group-defaults-and-locks.task.md)

## Summary

Makes **instructor recommendations** work end to end on the API. A `recommendations` instance lives
in a **group default** only: an optional title and 1–10 `{ topicId, reason }` items in authored
order. On a group `PUT` (Task 07's route), every `topicId` must exist and not be archived (`400`
naming the item otherwise); duplicates and reason length are already enforced by the shared schema.
A student `PUT` cannot introduce a `recommendations` instance (scope check from Task 01) but may keep,
move or hide one inherited from the default; in the copy only the instance id is meaningful. On
read, the provider looks up the instance with that id in the group default that applies to the
student **now** and returns its items, **omitting** any topic that is not in the student's effective
access set, unpublished or archived — no placeholder, no title. If the applicable default no longer
holds that instance, or the student no longer has a group default, the widget's data is empty. An
edit to the group default reaches every member on the next uncached read, including members with a
copy. Task 13 builds the editor and the widget.

## Dependencies

- [Task 07](./07-group-defaults-and-locks.task.md) — hard dependency: group defaults, their routes
  and the resolver.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/core/dashboard/**` — the recommendations provider and live lookup.
  - `apps/api/src/controllers/` — the group-default controller from Task 07, for topic existence
    validation only.
  - `apps/api/test/**`.
- **No own table** (D13) and no new migration.
- **Omit, never redact** (milestone §6, item 25): an inaccessible item leaves no trace in the body.
- **Guidance only.** Reading recommendations never writes progress, enrollment, XP or missions.

## Scope

In:
- Write-time topic validation, live read, access filtering, copy behaviour.
- Tests: group `PUT` with an archived or unknown topic → `400` naming the item; student `PUT` adding
  a recommendations instance → `400`; a member with access to X but not Y sees only X with its
  reason, in order; the raw body contains no id or title of Y; editing the default changes the
  result for a member with a copy; member moved to a group without that instance → empty; reading
  writes no row (row counts of progress/enrollment/XP tables unchanged).

Out:
- Web — Task 13. Cross-group merging — not done by design (D6).

## Acceptance Criteria

- [ ] Each case in Scope is covered by a passing test.
- [ ] No new migration and no new table.
- [ ] Changed files lint clean; `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api`.
2. `make dev-api`; as admin, put a recommendations widget on a demo group with one accessible and one
   restricted topic; `curl` a member's dashboard.
3. `git diff --stat` confirms only scope-guardrail files changed.
