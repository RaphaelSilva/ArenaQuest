# Task 05 — Backend: Staff submissions API, tombstone and housekeeping (Phase 3)

**Status:** 📝 Open
**Milestone:** [23 — Student submissions](./milestone.md)
**RFC:** [RFC 0020](../../RFCs/0020-student-submissions.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-student-read-and-move-api.task.md)

## Summary

Gives staff their view and their tools, and closes the storage lifecycle. On the topic
listing, `scope=all` becomes available to `admin` and `content_creator`: every ready and
removed submission on the topic with author and visibility, bypassing the effective-access
check as staff do for topics; staff can also read any single submission. Under `/v1/admin`,
staff get a per-student list (every ready or removed submission by one user),
**force-unshare** (private, `moderated_at` / `moderated_by` set, sharing blocked for the
author until cleared) and **clear moderation**, both for either staff role, and `admin` alone
gets **remove**: the object is deleted first, then the row becomes a tombstone — status
`removed`, removal stamp and author, key nulled, description cleared, private — so the author
sees *"Removed by the staff"* and the quota is freed; if R2 fails, nothing changes and the
call answers `502`. Staff have no route that edits or moves a student's submission.
**Housekeeping:** a sweep job, called from the existing daily `scheduled()` handler next to
billing, deletes `pending` submissions older than 24 h and their objects in batches of 100,
logging only a count. No user hard-delete path exists (the admin delete route deactivates),
so no account-level cleanup is added (RFC §9).

## Dependencies

- [Task 04](./04-student-read-and-move-api.task.md) — the listing and single-read paths this
  task opens to staff.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/submissions.controller.ts` — staff scope and staff methods.
  - `apps/api/src/routes/submissions.router.ts` — `scope=all` accepted for staff.
  - `apps/api/src/routes/admin/submissions.ts` (new) and its mount line in
    `apps/api/src/routes/admin/index.ts`.
  - `apps/api/src/jobs/sweep-pending-submissions.ts` (new).
  - `apps/api/src/index.ts` — one sweep call inside `scheduled()`; billing untouched.
  - `apps/api/src/openapi/components/entities.ts` and the regenerated `apps/api/openapi.json`.
  - `apps/api/test/**`.
- **Validation is `@hono/zod-openapi`**; no decorators.
- **Role checks:** the `/v1/admin` umbrella already admits both staff roles; remove adds an
  `admin`-only check. Students and tutors get `403` on every admin route.
- **Staff are read-only on content.** Moderation changes visibility only; removal deletes the
  file; neither edits title or description beyond the tombstone clearing.
- **Object before row** on removal and in the sweep.
- **The sweep logs counts, never names or keys.**
- **No change to `routes/admin/users.ts`** and no hard-delete path.

## Scope

In:
- `scope=all` and staff single reads.
- `GET /v1/admin/users/{userId}/submissions?cursor=`.
- `POST /v1/admin/submissions/{id}/unshare`, `DELETE /v1/admin/submissions/{id}/moderation`,
  `DELETE /v1/admin/submissions/{id}` (admin only).
- The sweep job and its `scheduled()` call.
- Tests: both staff roles on every staff route; students and tutors `403`; remove with R2
  failing; tombstone visible to author and staff only and outside quota; moderation blocking
  re-share and surviving a move; sweep with 25 h-old and 1 h-old pending rows.

Out:
- Any frontend change — Task 09.
- Seed and docs — Task 10.

## Acceptance Criteria

- [ ] `admin` and `content_creator` receive every ready and removed submission with
      `scope=all`, on topics outside their own access set too.
- [ ] Force-unshare by either staff role hides the submission from classmates and makes the
      author's next share `409 SUBMISSION_MODERATED` until moderation is cleared.
- [ ] Only `admin` can remove; afterwards R2 has no object, the author's `scope=mine` shows a
      `removed` row with title and date, classmates cannot see it, and the author's usage no
      longer counts it; a `content_creator` gets `403`.
- [ ] With R2 failing, remove answers `502` and the row is unchanged.
- [ ] Students and tutors get `403` on every `/v1/admin/submissions*` route and on the
      per-student list.
- [ ] After `scheduled()` runs, a pending row created 25 h ago and its object are gone; a 1 h
      old one remains; billing's daily run is unaffected.
- [ ] Changed files lint clean; `make test-api` green; `pnpm dump-openapi` leaves no diff.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local` and `make dev-api`; a student uploads and shares a submission.
2. As a content creator, list the topic with `scope=all`, unshare it, and confirm the student
   cannot re-share; clear moderation and confirm they can.
3. As a content creator, try remove (`403`); as an admin, remove and confirm the object is
   gone and the student sees the tombstone.
4. Insert an old pending row, trigger the scheduled handler locally, and confirm it is swept.
5. `make test-api`; `make lint`; `pnpm dump-openapi`.
6. `git diff --stat` confirms only guardrail files changed and `routes/admin/users.ts` is
   absent.
