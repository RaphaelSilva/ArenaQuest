# Task 03 — Backend: Student notes API — my note, class notes and my-notes list (Phase 2)

**Status:** ✅ Done
**Milestone:** [21 — Student notes — private and shared topic notes with staff moderation](./milestone.md)
**RFC:** [RFC 0016](../../RFCs/0016-student-notes.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-schema-and-repository.task.md)

## Summary

Opens the note surface a student uses and encodes the access table of RFC 0016 §3 in one
`NotesController`. Four routes behind `authGuard`: read the caller's note on a topic
(`null` when none); save it with a body, an optional visibility and a `baseRevision`
(`201` on create, `200` on update, `409 NOTE_STALE` with the current note in `meta` when
the revision is stale, `409 NOTE_MODERATED` when sharing a moderated note, `400` on an
empty or oversized body after sanitisation); delete it (`204`); and list a topic's notes.
Every topic-scoped route applies the **catalog's** gate — published, not archived, in the
caller's effective access set — and answers `404` on any miss, unlike comments, which
check enrollment only and answer `403`. The listing's audience is decided here and passed
to the repository as `includePrivate`: a student or tutor gets **shared notes only**, with
their own flagged `isMine`; `admin` and `content_creator` get every note and bypass the
effective-access check, as they do for topics. A `/v1/me/notes` route returns every note
the caller wrote across topics with the topic title and a `topicAccessible` flag; a note
whose topic the caller can no longer read is returned but refuses edit and share. This task
also mounts the router, wires `noteRepo` into the `engagement` group, adds the cursor
helper, and regenerates `openapi.json`. Task 04 adds the staff-only routes; Tasks 05–06
render this contract.

## Dependencies

- [Task 02](./02-schema-and-repository.task.md) — hard code dependency: every read and
  write goes through `INoteRepository`.
- [Task 01](./01-shared-contracts.task.md) — transitively, for `NOTE_BODY_MAX` and the
  entity.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/notes.controller.ts` (new).
  - `apps/api/src/routes/notes.router.ts` (new) and its mount line in
    `apps/api/src/routes/index.ts`.
  - `apps/api/src/routes/me/notes.ts` (new) and its mount line in
    `apps/api/src/routes/me/index.ts`.
  - `apps/api/src/routes/_shared/` — one cursor encode/decode helper (new file).
  - `apps/api/src/container.ts` — `noteRepo` added to the `engagement` group; no other
    group changes shape.
  - `apps/api/src/openapi/components/entities.ts` — the note schemas.
  - `apps/api/openapi.json` — regenerated with `pnpm dump-openapi`.
  - `apps/api/test/**` — controller and route specs.
- **Validation is `@hono/zod-openapi`.** Params, query and body are declared with
  `createRoute` + Zod at the route layer. **`@ValidateBody` / `@Body()` decorators do not
  exist here** (`docs/product/backlog/refactoring/07-validatebody-documentation-drift.task.md`);
  reintroducing them is a review failure.
- **Routes vs controllers.** Role resolution, the access table, sanitisation and the
  length check live in the controller returning `ControllerResult<T>`; routes parse and
  shape the response.
- **`404`, never `403`, for a note or topic the caller may not see.** A private note of
  another student and a non-existent note are indistinguishable.
- **Audience is never a request parameter.** No query string or body field widens the
  listing; `includePrivate` is derived from the caller's roles only.
- **`tutor` is a student here.** Only `admin` and `content_creator` are staff.
- **Staff have no write path on others' notes.** The save and delete routes act on the
  caller's own note only — the path says `me` and the controller never accepts an author id.
- **Comments are untouched.** `comments.controller.ts`, `comments.router.ts` and their
  `403` behaviour are out of scope.
- **No XP.** The router does not call `xpEngine`.
- **Per-request adapters.** `noteRepo` is built inside `buildApp(env)`.

## Scope

In:
- `GET`, `PUT`, `DELETE /v1/topics/{id}/notes/me`.
- `GET /v1/topics/{id}/notes?cursor=` with the student/staff audience split and `isMine`.
- `GET /v1/me/notes?cursor=` with topic title and `topicAccessible`; read-only enforcement
  for inaccessible topics (edit and share refused, delete allowed).
- Sanitisation with `sanitizeMarkdown`, trim, and the 1…`NOTE_BODY_MAX` check.
- The error branches: `400`, `404`, `409 NOTE_STALE` (with `meta.current`), `409
  NOTE_MODERATED`.
- Container wiring, router mounts, cursor helper, OpenAPI schemas and regenerated
  `openapi.json`.
- The test matrix: student × {own, other's private, other's shared}; tutor = student;
  admin and content creator × {private, shared}; topic draft / archived / out-of-access;
  stale revision; moderated share; crafted cursor; lost-access read-only behaviour.

Out:
- `GET /v1/admin/users/{userId}/notes` and the moderation routes — Task 04.
- Any frontend change, including `api-types.gen.ts` — Task 05.

## Acceptance Criteria

- [x] A student's `PUT` with `baseRevision: 0` returns `201`, a following `GET` returns the
      note with `revision: 1`, and `DELETE` returns `204`.
- [x] The same three calls on a draft, archived or out-of-access topic return `404`.
- [x] A `PUT` with a stale `baseRevision` returns `409` with `error: NOTE_STALE` and the
      current note in `meta.current`; the stored row is unchanged.
- [x] A body that is empty after trim, or longer than `NOTE_BODY_MAX` after sanitisation,
      returns `400`; a `<script>` in the body is stripped before storage.
- [x] A student and a tutor listing a topic receive only shared notes (their own flagged
      `isMine`); an `admin` and a `content_creator` receive every note with its visibility.
- [x] No request parameter makes a private note of another student appear to a student;
      asserted with a cursor taken from a staff listing.
- [x] `GET /v1/me/notes` returns every note of the caller with `topicAccessible`; for an
      inaccessible topic, `PUT` is refused and `DELETE` succeeds.
- [x] No `@ValidateBody` or `@Body()` decorator appears in the diff; comments files are
      unchanged; no `xpEngine` call is added.
- [x] No provider-specific (D1/R2) import leaks into the controller.
- [x] Validation, auth, not-found and conflict branches each return the correct
      `ControllerResult` status and are covered by a test.
- [x] Changed files lint clean; `make test-api` green, pre-existing suite unchanged.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local` and `make dev-api`; log in as two seeded students and an admin.
2. `curl` the save → read → delete cycle as student A; repeat on a draft topic and confirm
   `404`.
3. As student A, save a private note; as student B, list the topic and read the note by
   id — confirm it is absent and `404`; as the admin, list the topic and confirm it is
   present with `visibility: private`.
4. Open two shells, `PUT` with the same `baseRevision` from both, and confirm one `200` and
   one `409 NOTE_STALE` carrying the winning body.
5. `make test-api` — the matrix passes and the pre-existing suite is unchanged.
6. `make lint`; `pnpm dump-openapi` produces no further diff.
7. `git diff --stat` confirms only guardrail files changed, and that
   `comments.controller.ts`, `comments.router.ts` and `topics.controller.ts` are absent.
