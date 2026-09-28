# Task 04 — Backend: Staff notes API — per-student list and moderation (Phase 3)

**Status:** ✅ Done
**Milestone:** [21 — Student notes — private and shared topic notes with staff moderation](./milestone.md)
**RFC:** [RFC 0016](../../RFCs/0016-student-notes.md)
**Team:** Backend API
**Depends On:** [Task 03](./03-student-notes-api.task.md)

## Summary

Adds the three staff routes under `/v1/admin`, whose umbrella guard already admits both
`admin` and `content_creator`, so no new role check is introduced. A per-student listing
returns every note one student wrote — private included — newest `updatedAt` first with
topic titles, feeding the user backoffice. **Force-unshare** sets a shared note private,
records who moderated it and when, and increments its `revision`, so an author editing
the note in an open tab gets `409 NOTE_STALE` on the next autosave instead of silently
re-sharing it; it never alters the body. **Clear moderation** removes the flag so the
author may share again — without re-sharing on their behalf. Once flagged, the author's
share attempts are refused with `409 NOTE_MODERATED` (the rule itself lives in Task 03's
save path; this task makes the flag reachable). There is deliberately no staff route that
edits or deletes another user's note. Task 07 renders these actions.

## Dependencies

- [Task 03](./03-student-notes-api.task.md) — hard code dependency: the controller, the
  note schemas, the container wiring and the cursor helper this task extends.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/routes/admin/notes.ts` (new) and its mount line in
    `apps/api/src/routes/admin/index.ts`.
  - `apps/api/src/controllers/notes.controller.ts` — the staff methods.
  - `apps/api/src/openapi/components/entities.ts` — only if a staff-specific schema is
    needed.
  - `apps/api/openapi.json` — regenerated.
  - `apps/api/test/**` — route and controller specs.
- **Validation is `@hono/zod-openapi`** (`createRoute` + Zod); no `@ValidateBody` /
  `@Body()` decorators.
- **No new role gate.** Both staff roles moderate (RFC 0016 Resolved Decisions); the
  umbrella `requireRole(ADMIN, CONTENT_CREATOR)` already applies. Adding an `ADMIN`-only
  guard here contradicts the decision.
- **Moderation changes visibility and flag only.** `body` is byte-identical before and
  after; `revision` increments.
- **Unshare on a private note** is idempotent in effect (it becomes/stays private and
  flagged); unshare or clear on an unknown id is `404`.
- **No edit or delete path for staff** on any note.
- **Comments, enrollment and topics code are untouched.**

## Scope

In:
- `GET /v1/admin/users/{userId}/notes?cursor=` — every note by that user, private
  included, with topic title and visibility.
- `POST /v1/admin/notes/{id}/unshare` — returns the updated note.
- `DELETE /v1/admin/notes/{id}/moderation` — `204`.
- Specs: each staff role can call all three; student and tutor get `403`; body unchanged
  and revision bumped on unshare; author's share returns `409 NOTE_MODERATED` while
  flagged and succeeds after clearing; an author `PUT` holding the pre-moderation revision
  gets `409 NOTE_STALE`; `404` on unknown ids.

Out:
- Any frontend change — Task 07.
- The seed and documentation — Task 08.

## Acceptance Criteria

- [x] An `admin` token and a `content_creator` token each list a student's notes (private
      included), unshare a shared note, and clear its moderation.
- [x] A student token and a tutor token calling any of the three routes receive `403`.
- [x] After unshare the note's `body` is byte-identical, `visibility` is `private`,
      `moderated` is true and `revision` is one higher; it is absent from the student
      class listing.
- [x] The author's `PUT` with `visibility: shared` returns `409 NOTE_MODERATED` until the
      flag is cleared, then succeeds.
- [x] An author `PUT` sent with the pre-moderation `revision` returns `409 NOTE_STALE`.
- [x] No route in the diff lets staff change a note's body or delete it.
- [x] No provider-specific (D1/R2) import leaks into the controller.
- [x] Validation, auth, not-found and conflict branches each return the correct
      `ControllerResult` status and are covered by a test.
- [x] Changed files lint clean; `make test-api` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local` and `make dev-api`; as a student, save and share a note.
2. As a content creator, `curl` the per-student listing and confirm the note appears; then
   unshare it and confirm the response shows `private`, `moderated` and a bumped revision.
3. As the student, try to share again — expect `409 NOTE_MODERATED`; clear moderation as
   the admin; share again — expect `200`.
4. As a student and as a tutor, call each staff route — expect `403`.
5. `make test-api`; `make lint`; `pnpm dump-openapi` produces no further diff.
6. `git diff --stat` confirms only guardrail files changed.
