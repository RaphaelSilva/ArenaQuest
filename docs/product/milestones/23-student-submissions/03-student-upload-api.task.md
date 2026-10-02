# Task 03 — Backend: Student upload API — presign, finalize, edit, delete and summary (Phase 2)

**Status:** ✅ Done
**Milestone:** [23 — Student submissions](./milestone.md)
**RFC:** [RFC 0020](../../RFCs/0020-student-submissions.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-config-schema-and-repository.task.md)

## Summary

Opens the write side a student uses, in a new `SubmissionsController`. **Presign** takes a
file name, content type, size, title, optional description and visibility; it applies the
catalog's topic gate (published, not archived, in the effective access set, else `404`), a
per-user rate limit (30 per hour, `429`), the type check against `SUBMISSION_MEDIA_TYPES`, the
size check (videos against `SUBMISSIONS_VIDEO_MAX_BYTES`, images and PDF against
`mediaSizeLimitFor`, `422 FileTooLarge`), refuses `shared` when the label switch is off
(`409 SUBMISSION_SHARING_DISABLED`), then creates the pending row through the quota-guarded
insert (`409 SUBMISSION_QUOTA` with reason, usage and limit) and returns a presigned PUT under
`submissions/{authorId}/{uuid}-{name}`. **Finalize** marks the row `ready` only when the
stored object exists (`422 NotUploaded`) and its length, content type and leading signature
bytes all match what was declared; on any mismatch it deletes the object and the row and
answers `422 UPLOAD_MISMATCH`; it is idempotent on a `ready` row. **Edit** changes title,
description (sanitised Markdown) and visibility, refusing to share a moderated submission
(`409 SUBMISSION_MODERATED`) or to share while the switch is off. **Delete** removes the object
and then the row — pending, ready, or a tombstone being dismissed — answering `502` and keeping
the row if R2 fails. **Summary** returns the effective limits, `sharingEnabled`, the caller's
usage and the class count for a topic (staff also get the total). This task wires
`submissionRepo`, the config and the `rl:submissions:` limiter into the container, mounts the
router, and adds the OpenAPI schemas. Reads beyond the summary and moving are Task 04.

## Dependencies

- [Task 02](./02-config-schema-and-repository.task.md) — hard code dependency: repository,
  config parser and `readHead`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/submissions.controller.ts` (new).
  - `apps/api/src/routes/submissions.router.ts` (new) and its mount line in
    `apps/api/src/routes/index.ts`.
  - `apps/api/src/container.ts` — `submissionRepo` and `SubmissionConfig` in the `engagement`
    group, one `rl:submissions:` `KvRateLimiter`; no other group changes shape.
  - `apps/api/src/openapi/components/entities.ts` — submission, presign and summary schemas.
  - `apps/api/openapi.json` — regenerated with `pnpm dump-openapi`.
  - `apps/api/test/**` — controller and route specs, plus small binary fixtures (a real
    iPhone `.mov`, an MP4, a JPEG, a PDF, a text file).
- **Validation is `@hono/zod-openapi`.** `createRoute` + Zod at the route layer; no
  `@ValidateBody` / `@Body()` decorators (they do not exist here).
- **Routes vs controllers.** Access, quota, config and signature decisions live in the
  controller and return `ControllerResult<T>`.
- **`404` for any topic or submission the caller may not see**; a submission of another
  student is indistinguishable from a missing one.
- **The key is server-built** and never contains the topic id; the client never chooses it.
- **Signature check reads 32 bytes**, never the whole object.
- **Config errors surface as `500 SUBMISSION_CONFIG_INVALID`** on every submission route.
- **Course media is untouched.** No change to `TopicsController`, `admin-media.controller.ts`
  behaviour or the `media` table.
- **No XP.** No `xpEngine` call.

## Scope

In:
- `POST /v1/topics/{id}/submissions/presign`, `POST …/{sid}/finalize`,
  `PATCH …/{sid}`, `DELETE …/{sid}`, `GET /v1/topics/{id}/submissions/summary`.
- Rate limiting on presign only.
- Container wiring, router mount, OpenAPI schemas, regenerated `openapi.json`.
- Tests: each accepted type end to end; oversize per type; wrong signature; missing object;
  idempotent finalize; quota count and bytes; switch off; moderated share; R2 failure on
  delete; draft / archived / out-of-access topic; another student's submission on every
  write route; the course payload unchanged after uploads.

Out:
- `scope=` listings, single read, `/v1/me/submissions` and move — Task 04.
- Staff routes, tombstone creation and the sweep — Task 05.
- Any frontend change — Task 06.

## Acceptance Criteria

- [x] An iPhone `.mov`, an MP4, a JPEG and a PDF each go presign → PUT → finalize to `ready`
      on a readable topic.
- [x] A text file uploaded as `video/mp4` fails finalize with `422 UPLOAD_MISMATCH` and leaves
      neither row nor object; finalize without an upload is `422 NotUploaded`.
- [x] A video over `SUBMISSIONS_VIDEO_MAX_BYTES` and an image over 5 MB are refused at presign
      with `422 FileTooLarge`.
- [x] With `SUBMISSIONS_PER_TOPIC_MAX=3`, the fourth presign on a topic answers
      `409 SUBMISSION_QUOTA` with `reason: 'count'`; a presign crossing the byte quota has
      `reason: 'storage'`.
- [x] The 31st presign within an hour by one user answers `429`.
- [x] Presign on a draft, archived or out-of-access topic answers `404`; every write route on
      another student's submission answers `404`.
- [x] With `SUBMISSIONS_SHARING_ENABLED=false`, presign or `PATCH` with `shared` answers
      `409 SUBMISSION_SHARING_DISABLED`; sharing a moderated submission answers
      `409 SUBMISSION_MODERATED`.
- [x] A malformed `SUBMISSIONS_*` var makes every route here answer
      `500 SUBMISSION_CONFIG_INVALID`.
- [x] `DELETE` removes the object then the row; with R2 failing it answers `502` and the row
      remains.
- [x] `GET /v1/topics/{id}` returns byte-identical media before and after uploads.
- [x] No `@ValidateBody` / `@Body()` in the diff; no provider import in the controller.
- [x] Changed files lint clean; `make test-api` green; `pnpm dump-openapi` leaves no diff.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local` and `make dev-api`; log in as a seeded student.
2. `curl` presign for a local `.mov`, `PUT` the file to the returned URL, finalize, and read
   the summary — usage and count reflect it.
3. Repeat with a renamed text file and confirm `422 UPLOAD_MISMATCH` and no row left.
4. Set `SUBMISSIONS_PER_TOPIC_MAX=1` in `.dev.vars`, restart, and confirm the second presign
   is `409`; set it to `abc` and confirm `500 SUBMISSION_CONFIG_INVALID`.
5. `make test-api`; `make lint`; `pnpm dump-openapi`.
6. `git diff --stat` confirms only guardrail files changed and `topics.controller.ts` is
   absent.
