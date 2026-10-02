# Task 04 — Backend: Student read and move API (Phase 2)

**Status:** ✅ Done
**Milestone:** [23 — Student submissions](./milestone.md)
**RFC:** [RFC 0020](../../RFCs/0020-student-submissions.md)
**Team:** Backend API
**Depends On:** [Task 03](./03-student-upload-api.task.md)

## Summary

Adds the read side and the move to `SubmissionsController`. **Topic listing** takes a
`scope`: `mine` returns the caller's own submissions in every status (pending ones so the UI
can resume or discard, tombstones so the author sees *"Removed by the staff"*); `class`
returns the topic's shared `ready` submissions with author names, the caller's own flagged
`isMine`, and nothing at all when `SUBMISSIONS_SHARING_ENABLED` is `false`. `scope` only ever
narrows what the access table allows — `all` is staff-only and belongs to Task 05, so a
student asking for it gets `403`. Pages of 20, newest first, opaque cursor. **Single read**
returns one submission under the same rules (the direct link and the viewer use it); another
student's private, pending or removed submission is `404`, as is a shared one when the switch
is off. Every ready submission carries a signed GET URL (TTL 1 h) and responses set
`Cache-Control: private, no-store`. **My submissions** lists every submission the caller owns
across topics with the topic title and `topicAccessible`; on a topic the caller can no longer
read, edit and share are refused while delete and move still work. **Move** takes up to 10
ids and a target topic: the target must be readable (`404` otherwise), the source need not
be; the repository's batched guarded move does the work and the response lists moved and
refused items with reasons. Moved submissions become private, keep moderation, and their
file is not touched.

## Dependencies

- [Task 03](./03-student-upload-api.task.md) — the controller, router, container wiring and
  schemas it extends.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/submissions.controller.ts` — read, list and move methods; the
    lost-access rule on the Task 03 edit path.
  - `apps/api/src/routes/submissions.router.ts` — listing and single-read routes.
  - `apps/api/src/routes/me/submissions.ts` (new) and its mount line in
    `apps/api/src/routes/me/index.ts`.
  - `apps/api/src/openapi/components/entities.ts` — list, move request and move result
    schemas.
  - `apps/api/openapi.json` — regenerated.
  - `apps/api/test/**`.
- **Validation is `@hono/zod-openapi`**; no decorators.
- **Audience is decided by roles, never by parameters.** `scope` is checked against the
  caller; a cursor minted for one scope or caller does not widen another.
- **`404`, never `403`, for a submission the caller may not see**; the only `403` is
  `scope=all` requested by a non-staff caller.
- **The sharing switch is a read-time filter** — no row is rewritten when it is off.
- **Signed GET URLs only.** No `R2_PUBLIC_BASE`.
- **`tutor` is a student** here.

## Scope

In:
- `GET /v1/topics/{id}/submissions?scope=mine|class&cursor=` (and the `403` for `all` by a
  student).
- `GET /v1/topics/{id}/submissions/{sid}`.
- `GET /v1/me/submissions?cursor=` with `topicAccessible`.
- `POST /v1/me/submissions/move`.
- Lost-access behaviour on edit and share.
- Tests: the RFC §7 matrix for student and tutor across private / shared / pending / removed,
  with a crafted cursor; switch off and on again; move with partial refusal, same topic,
  pending, removed, foreign ids and an unreadable target; move out of a topic the caller lost.

Out:
- `scope=all`, staff routes and moderation — Task 05.
- Any frontend change — Tasks 07–08.

## Acceptance Criteria

- [x] `scope=mine` returns the caller's pending, ready and removed submissions; `scope=class`
      returns only shared ready ones with author names and `isMine` on the caller's own.
- [x] Another student gets `404` on a direct read of a private, pending or removed
      submission, and `scope=class` never contains them — asserted with a cursor taken from
      the author's `scope=mine`.
- [x] A student requesting `scope=all` gets `403`.
- [x] With the switch off, `scope=class` is empty and a shared submission is `404` to other
      students; turned back on, the same rows are listed unchanged.
- [x] `GET /v1/me/submissions` returns all of the caller's submissions with `topicAccessible`;
      on an inaccessible topic `PATCH` is refused while `DELETE` and move succeed.
- [x] Moving 3 submissions into a topic with 2 free slots returns 2 `moved` and 1
      `refused: quota`; moved ones are private, keep `moderated`, and their object key is
      unchanged; an unreadable target is `404`.
- [x] Responses carrying URLs set `Cache-Control: private, no-store`.
- [x] Changed files lint clean; `make test-api` green; `pnpm dump-openapi` leaves no diff.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local` and `make dev-api`; two seeded students on the same topic.
2. As student A upload one private and one shared submission; as student B list
   `scope=class` and read both by id — only the shared one is visible.
3. Toggle `SUBMISSIONS_SHARING_ENABLED=false` in `.dev.vars`, restart, repeat step 2 — nothing
   visible; toggle back and confirm it returns.
4. As student A move three submissions into a topic with room for two and inspect the result.
5. `make test-api`; `make lint`; `pnpm dump-openapi`.
6. `git diff --stat` confirms only guardrail files changed.
