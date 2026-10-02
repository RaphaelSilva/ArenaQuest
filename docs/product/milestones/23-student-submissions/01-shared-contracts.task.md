# Task 01 — Backend: Submission contracts — entity, media types, limits and ports (Phase 0)

**Status:** ✅ Done
**Milestone:** [23 — Student submissions](./milestone.md)
**RFC:** [RFC 0020](../../RFCs/0020-student-submissions.md)
**Team:** Backend API

## Summary

Lays the cloud-agnostic contracts every later task builds on, with no behaviour change
anywhere. `packages/shared` gains the `Entities.Engagement.Submission` entity and
`Entities.Config.SubmissionStatus` (`pending | ready | removed`), reusing the
`'private' | 'shared'` visibility vocabulary of RFC 0016 (defined here if M21 has not landed
it yet, and shared with it when it has). `domain/media/limits.ts` — the single source of
truth for media limits — gets `SUBMISSION_MEDIA_TYPES` (the course table plus
`video/quicktime`) and `SUBMISSION_VIDEO_TYPES` **appended**, leaving `ALLOWED_MEDIA_TYPES`
and `MEDIA_SIZE_LIMIT_BYTES` untouched so backoffice media and the importer are unaffected. A
new `domain/submissions/limits.ts` holds the text limits (title 120, description 2 000
characters after sanitisation), the sweep threshold (24 h), and the **defaults** of the four
env-configured tunables (10 per topic, 1 GiB per student, 250 MB per video, sharing on).
The `ISubmissionRepository` port declares every operation RFC 0020 §11 lists, and
`IStorageAdapter` gains `readHead(key, bytes)` for the finalize signature check.
`sanitizeFileName` moves from `admin-media.controller.ts` to `packages/shared/utils/` so both
upload paths share it; the admin controller's behaviour is byte-identical.

## Dependencies

- None. Independent; unblocks Task 02.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/types/entities.ts` — `Entities.Engagement.Submission`,
    `Entities.Config.SubmissionStatus` (and the visibility type if M21 has not added it).
  - `packages/shared/domain/media/limits.ts` — two constants appended; no existing export
    edited.
  - `packages/shared/domain/submissions/limits.ts` (new).
  - `packages/shared/ports/i-submission-repository.ts` (new) and
    `packages/shared/ports/index.ts`.
  - `packages/shared/ports/i-storage-adapter.ts` — `readHead` appended.
  - `packages/shared/utils/sanitize-file-name.ts` (new) and its barrel export, if one exists.
  - `apps/api/src/controllers/admin-media.controller.ts` — import of the moved helper only.
  - `apps/api/src/adapters/storage/r2-storage-adapter.ts` — a `readHead` stub that satisfies
    the port and throws "not implemented"; Task 02 implements it.
  - `packages/shared/**/__tests__` / `apps/api/test/**` — unit tests for the helper and the
    new limits.
- **No Cloudflare types in shared.** The port speaks in plain types; D1 and R2 stay behind
  adapters.
- **The limits table stays single.** Submission types are derived from
  `ALLOWED_MEDIA_TYPES`, not a second hand-written list, so a change to the course table
  flows to submissions automatically.
- **Env vars are not read here.** `domain/submissions/limits.ts` exports defaults only;
  parsing `env` is Task 02's `core/submissions/config.ts`.
- **No behaviour change.** No route, migration or UI in this task.

## Scope

In:
- Entity, status type, visibility type (if absent).
- `SUBMISSION_MEDIA_TYPES`, `SUBMISSION_VIDEO_TYPES`, a type guard for each.
- Text limits, sweep threshold and env defaults in `domain/submissions/limits.ts`.
- `ISubmissionRepository` with record, patch, quota, move-result and cursor-page types.
- `IStorageAdapter.readHead`.
- `sanitizeFileName` moved to shared, with tests pinning today's output.

Out:
- The migration, the D1 adapter and the real `readHead` — Task 02.
- Any route or controller — Tasks 03–05.

## Acceptance Criteria

- [x] `SUBMISSION_MEDIA_TYPES` equals `ALLOWED_MEDIA_TYPES` plus `video/quicktime`, asserted
      by a test; `ALLOWED_MEDIA_TYPES` and `MEDIA_SIZE_LIMIT_BYTES` are unchanged in the diff.
- [x] `domain/submissions/limits.ts` exports the defaults 10, 1 073 741 824, 262 144 000 and
      `true`, plus the title (120) and description (2 000) limits.
- [x] `ISubmissionRepository` declares every operation of RFC 0020 §11 and compiles with no
      import from `@cloudflare/*`.
- [x] `sanitizeFileName` returns identical output for the existing admin-media test inputs
      after the move; `admin-media.controller.ts` changes by its import line only.
- [x] `packages/shared` and `apps/api` typecheck; changed files lint clean; `make test-api`
      green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `pnpm --filter shared typecheck` and `pnpm --filter api typecheck`.
2. `make test-api` — the helper and limits tests pass; the admin-media suite is unchanged.
3. `make lint`.
4. `git diff --stat` confirms only guardrail files changed, and that `ALLOWED_MEDIA_TYPES` /
   `MEDIA_SIZE_LIMIT_BYTES` lines are untouched.
