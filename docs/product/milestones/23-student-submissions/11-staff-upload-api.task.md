# Task 11 — Backend: Staff upload and author rights on their own submissions (Phase 6)

**Status:** ✅ Done
**Milestone:** [23 — Student submissions](./milestone.md)
**RFC:** [RFC 0020](../../RFCs/0020-student-submissions.md) — §7 as amended on 2026-10-01 ("Staff also upload")
**Team:** Backend API
**Depends On:** [Task 05](./05-staff-api-and-housekeeping.task.md)

## Summary

The product owner decided that `admin` and `content_creator` also post demonstrations. Today
`SubmissionsController` refuses staff on **presign** (`403`) and on **move** (`403`). This task
lifts both refusals so staff are authors like anyone else on **their own** submissions: they
presign, finalize, edit, share, move and hard-delete what they uploaded, under the same type,
size, quota, rate-limit and sharing-switch rules. The topic gate for staff stays "published and
not archived" (they bypass the effective-access set, as for every staff read). `scope=mine` and
the summary's `usage` work for staff exactly as for a student, and the summary keeps
`totalCount` for staff. Nothing changes for a submission someone else authored: staff keep
`403` on edit / move / hard delete of another user's submission and keep force-unshare,
clear-moderation and admin-only remove.

## Dependencies

- [Task 05](./05-staff-api-and-housekeeping.task.md) — the staff scope and moderation paths this
  task must leave intact.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/submissions.controller.ts` — drop the staff refusal on presign
    and move; keep every other rule.
  - `apps/api/src/routes/submissions.router.ts`, `apps/api/src/routes/me/submissions.ts` — only
    route descriptions / documented responses that mention the staff `403`.
  - `apps/api/openapi.json` — regenerated if the descriptions change.
  - `apps/api/test/**` — flip the tests that pinned the old `403` and add the new cases.
- **No schema or repository change.** The quota, the key layout and the tombstone are reused.
- **Validation is `@hono/zod-openapi`**; no decorators.
- **A staff author is an author.** The "someone else's submission → `403` for staff" rule is
  unchanged.

## Scope

In:
- Staff presign → PUT → finalize to `ready` on a published, non-archived topic, including one
  they are not enrolled in.
- Staff edit / share / move / hard delete of their own submission.
- `scope=mine` and summary `usage` for staff.
- Tests for both staff roles, plus regression tests that staff still get `403` on another
  user's submission and that moderation / admin removal are unchanged.

Out:
- Any frontend change — Task 12.

## Acceptance Criteria

- [x] An `admin` and a `content_creator` can each presign, upload and finalize to `ready` on a
      published topic they are not enrolled in; a draft or archived topic is `404`.
- [x] Quota, size, type, rate-limit and sharing-switch rules apply to staff uploads as to
      students'.
- [x] Staff can edit, share, move and hard-delete their own submission; their own shows in
      `scope=mine` and in `GET /v1/me/submissions`.
- [x] Staff still get `403` on `PATCH`, `DELETE` and move of a submission another user
      authored; force-unshare, clear moderation and admin-only remove behave as before.
- [x] A staff upload shared on a topic appears in students' `scope=class` with the staff
      author's name, and in `scope=all`.
- [x] `make lint` and `make test-api` green; `pnpm dump-openapi` leaves no diff.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` (run alone); `make lint`; `cd apps/api && pnpm dump-openapi`.
2. `make dev-api`; log in as `admin@arenaquest.dev`, presign + finalize on
   *Demonstrations Sandbox → Kihon Demonstrations*, then list `scope=mine` and `scope=all`.
3. `git diff --stat` confirms only guardrail files changed and no schema or repository file is touched.
