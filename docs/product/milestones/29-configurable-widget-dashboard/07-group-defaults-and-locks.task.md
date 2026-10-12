# Task 07 — Backend: Group defaults, priority, locks and new-default notice (Phase 2)

**Status:** 📝 Open
**Milestone:** [29 — Configurable Widget Dashboard](./milestone.md)
**RFC:** [RFC 0008](../../RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-layout-storage-and-student-routes.task.md), [Task 03](./03-layout-driven-dashboard-aggregate.task.md)

## Summary

Adds the **group tier**, **locks** and the **new-default notice**. Admin routes on
`dashboard_group_layouts` (created in Task 02): `GET /v1/admin/groups/{groupId}/dashboard-layout`
(`admin`, `content_creator`; `404` when the group has none), `PUT` with `{ priority, layout }` and
`DELETE` (`admin` only; `403` for `content_creator`); an unknown group is `404`. The resolver now
picks, among the student's groups that have a default, the **highest `priority`**, ties broken by
`group_id` ascending — never merging. An instance with `locked: true` in the applicable default must
stay in the student copy: a `PUT` that removes it is **`409 WIDGET_LOCKED`** (moving it is allowed),
and a locked instance added to the default after the copy was made is appended to the copy **on
read** until the student saves. `layoutSource.newDefault` is `true` when the default that would
apply now is a different source than the copy's `based_on`, or the same source with a later
`updated_at` than recorded. Group deletion cascades its default; affected students fall back to the
next tier. Task 08 builds the backoffice and the student-side lock/restore UI; Task 11 adds
recommendation items to group defaults.

## Dependencies

- [Task 02](./02-layout-storage-and-student-routes.task.md) — the table, port and student routes.
- [Task 03](./03-layout-driven-dashboard-aggregate.task.md) — the resolver used by the aggregate.
- Ordering preference after [Task 06](./06-label-default-layout.task.md) (same resolver file); not
  a hard dependency.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/routes/admin/dashboard-layouts.ts` (group routes added next to Task 06's read),
    its controller, `apps/api/src/core/dashboard/**` (priority resolution, locks, `newDefault`),
    `apps/api/src/adapters/db/d1-dashboard-layout-repository.ts` and its port (group methods),
    `apps/api/src/controllers/me-dashboard-layout.controller.ts` (lock enforcement on `PUT`).
  - `apps/api/openapi.json`, `apps/api/src/openapi/components/**` (regenerated) and `apps/api/test/**`.
  - `apps/api/src/routes/admin/groups.ts` — no change unless the sub-path must be registered there;
    if so, registration only.
- **Role split (M27 precedent).** Writes carry `requireRole(ROLES.ADMIN)` in their own chain; the
  `/admin/*` umbrella keeps admitting `content_creator` for reads. `routes/admin/index.ts`'s umbrella
  guard is not changed.
- **Group defaults use `group` scope.** A `PUT` validates with the strict parser at `group` scope
  (so `recommendations` instances are allowed there and refused in a student `PUT`).
- **Membership is read, never written.** `user_group_members` and enrollments are untouched.

## Scope

In:
- Admin group routes, resolver priority and tie-break, lock enforcement and read-time append,
  `newDefault`, cascade behaviour.
- Tests: groups A (10) and B (20) → B; equal priorities → lower `group_id`; student in no group with
  a default → label/code tier; remove locked → `409 WIDGET_LOCKED`, move locked → `200`; lock added
  later → appended on read; B edited after the copy → `newDefault: true`, then `DELETE` → B's new
  layout and `false`; student moved from B to A → `newDefault: true`; group deleted → row gone,
  fallback applies; role matrix (`admin` all, `content_creator` reads only, student `403`); unknown
  group `404`.

Out:
- Backoffice and student UI — Task 08. Recommendation item validation — Task 11.

## Acceptance Criteria

- [ ] Each case in Scope is covered by a passing test.
- [ ] No change to `user_group_members`, enrollment code or the admin umbrella guard.
- [ ] `openapi.json` documents the group routes and the `409 WIDGET_LOCKED` response.
- [ ] Changed files lint clean; `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — resolver, lock and route specs pass.
2. `make dev-api`; as admin, `PUT` defaults on two groups of a demo student; `curl` the student's
   dashboard and layout; try removing a locked widget.
3. `git diff --stat` confirms only scope-guardrail files changed.
