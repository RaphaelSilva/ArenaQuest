# Milestone 23 — Student submissions

**Status:** In Progress
**Scope:** `apps/api` (submissions bounded context in the `engagement` group, env-configured quotas, daily sweep), `packages/shared` (submission types, port, limits, storage-port additions), `apps/web` (topic *Demonstrations* button, the per-topic Demonstrations page with *Mine* / *Class* / *All* tabs and viewer, "My demonstrations" page, backoffice section), `config/deployment.schema.jsonc`. Derived from [RFC 0020](../../RFCs/0020-student-submissions.md).

> **Hard scope guardrail — read before opening any task.** This milestone may touch **only**: `apps/api/migrations/0030_create_topic_submissions.sql` (renumbered if M21's or M22's migration shifts the sequence); the new submissions files `apps/api/src/{core/submissions/config.ts,adapters/db/d1-submission-repository.ts,controllers/submissions.controller.ts,routes/submissions.router.ts,routes/me/submissions.ts,routes/admin/submissions.ts,jobs/sweep-pending-submissions.ts}`; `readHead` added to `apps/api/src/adapters/storage/r2-storage-adapter.ts` (no existing method changes); the `sanitizeFileName` move out of `apps/api/src/controllers/admin-media.controller.ts` (import change only, behaviour identical); the sweep call added to `scheduled()` in `apps/api/src/index.ts` (billing untouched); wiring in `container.ts` (the `engagement` group gains `submissionRepo`, one new `rl:submissions:` limiter; no other group changes shape), `routes/index.ts`, `routes/me/index.ts`, `routes/admin/index.ts`; the cursor helper under `apps/api/src/routes/_shared/` if M21 has not landed it; the four `SUBMISSIONS_*` vars in every `env.*.vars` block of `apps/api/wrangler.jsonc`, in `apps/api/.dev.vars.example` and in `config/deployment.schema.jsonc`; the regenerated `apps/api/openapi.json`; `apps/api/test/**`; the shared additions `packages/shared/{types/entities.ts (Entities.Engagement.Submission + Config.SubmissionStatus),domain/media/limits.ts (SUBMISSION_MEDIA_TYPES, SUBMISSION_VIDEO_TYPES — appended, nothing existing edited),domain/submissions/limits.ts,ports/i-submission-repository.ts,ports/i-storage-adapter.ts (`readHead` appended),ports/index.ts,utils/sanitize-file-name.ts}`; on the web, `apps/web/src/components/catalog/submissions/**`, the *Demonstrations* button in `apps/web/src/app/(protected)/catalog/[id]/page.tsx`, the new `apps/web/src/app/(protected)/catalog/[id]/submissions/**` and `apps/web/src/app/(protected)/submissions/**`, a *Submissions* section in `apps/web/src/app/(protected)/admin/users/[userId]/page.tsx`, one "My demonstrations" entry in `apps/web/src/components/layout/nav.tsx`, `apps/web/src/lib/submissions-api.ts`, the regenerated `apps/web/src/lib/api-types.gen.ts`, and both i18n dictionaries (+ `types.ts`); and, for the closeout only, a new local seed under `apps/api/migrations/seed/`, `CLAUDE.md`, `docs/product/FEATURES.md`, RFC 0020's `Status:` header and its `docs/product/RFCs/README.md` row. It is explicitly **not** an opportunity to: add **staff review, grading, corrections or a "reviewed" status** on submissions (the next RFC); add **server-side transcoding**, thumbnails, Cloudflare Stream or any `ffmpeg` path; **copy** submissions between topics, or let **staff move** them; support **several files per submission**; award **XP, quests or badges**, or touch `packages/shared/domain/gamification/**`; give the **`tutor`** role any power beyond a student's; add **comments, likes, notifications** or in-browser recording; accept **`video/quicktime` for backoffice media** or change `ALLOWED_MEDIA_TYPES`, `MEDIA_SIZE_LIMIT_BYTES`, `admin-media.controller.ts` behaviour, `scripts/content/import-media.mjs` or `scripts/media/convert-skipped.mjs`; store any submission in the **`media` table** or under the `topics/` key prefix; change `TopicsController`, `getEffectiveAccessTopicIds` or `d1-enrollment-repository.ts`; add a user **hard-delete** path or change `routes/admin/users.ts`; or change RFC 0016's notes files. If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **A `topic_submissions` entity, separate from course media.** One file plus title and description, many per student per topic, in its own table and under `submissions/{authorId}/…`, so no reader of `media` can ever surface a student upload (RFC §1, §2, Alternatives §1).
- **Upload straight from a phone, iPhone `.mov` included.** `presign → PUT → finalize` as in the backoffice, accepting `SUBMISSION_MEDIA_TYPES` (course types + `video/quicktime`), with a playback fallback when a browser cannot decode HEVC (RFC §4, §5).
- **Untrusted-uploader hardening.** Finalize checks the stored length, type and file signature; a per-user upload rate limit; a daily sweep of abandoned uploads (RFC §5, §9).
- **Quotas and sharing configured per label and environment.** `SUBMISSIONS_PER_TOPIC_MAX` (10), `SUBMISSIONS_STORAGE_PER_STUDENT_BYTES` (1 GiB), `SUBMISSIONS_VIDEO_MAX_BYTES` (250 MB), `SUBMISSIONS_SHARING_ENABLED` (`true`), enforced atomically in SQL and exposed to the web through a summary endpoint (RFC §3).
- **Students manage their own work.** Edit title/description/visibility, delete, and **move one or several submissions to another readable topic** — metadata-only, quota-checked on the target, reset to private (RFC §6).
- **Privacy among students, visibility for staff.** Private by default; shared ones are readable by the topic's readers; staff read everything, force-unshare, and `admin` removes, leaving a *"Removido pela equipe"* tombstone (RFC §7, §8).
- **A dedicated Demonstrations page reached from the topic.** Tabs *Minhas* / *Da turma* (staff: *Todos*), a full-screen viewer with previous/next, and a direct link per submission; plus a cross-topic "My demonstrations" page and a backoffice section (RFC §12).
- **Full i18n coverage** across `dict-en`/`dict-pt`, enforced by `check-i18n-coverage.js`.

Out of scope (explicit, from RFC 0020 Non-Goals):
- **Staff review of submissions** (corrections, scores, "reviewed") — the next RFC, decided 2026-09-29; it builds on this entity.
- **Server-side transcoding and thumbnails** — RFC Alternatives §8, deferred until the playback fallback proves frequent.
- **Copying submissions, and moving by staff** — move is author-only and never duplicates storage.
- **Several files per submission** — RFC Alternatives §3, deferred; a later child table can adopt existing rows.
- **XP, quests or badges** — consistent with RFC 0016's decision for notes.
- **Tutor powers** — a `tutor` behaves as a student.
- **Comments or likes on submissions, in-browser recording, notifications** — separate future decisions.
- **`video/quicktime` for backoffice media** — course media keeps its table and the importer's conversion path.

---

## 2. Functional Requirements

**Configuration**
- The four `SUBMISSIONS_*` vars are read per request; an **absent** var takes its default, a **present but invalid** one makes every submission endpoint answer `500 SUBMISSION_CONFIG_INVALID` naming the var in the log. `SUBMISSIONS_VIDEO_MAX_BYTES` may not exceed `SUBMISSIONS_STORAGE_PER_STUDENT_BYTES`.
- Every `env.*` block of `wrangler.jsonc` declares the four vars explicitly; `.dev.vars.example` documents them; `config/deployment.schema.jsonc` lists them as optional, with `enum: ["true","false"]` on the switch.
- `GET /v1/topics/{id}/submissions/summary` returns the effective limits, `sharingEnabled`, the caller's `topicCount` and `bytes`, and `classCount`; staff also get `totalCount`.

**Student — upload lifecycle**
- `POST /v1/topics/{id}/submissions/presign` with `{ fileName, contentType, sizeBytes, title, description?, visibility? }` creates a `pending` row and returns a presigned PUT (`201`). `contentType` must be in `SUBMISSION_MEDIA_TYPES`; videos are limited by `SUBMISSIONS_VIDEO_MAX_BYTES`, images and PDF by `mediaSizeLimitFor` (`422 FileTooLarge`).
- The per-topic count and per-student storage are checked in the same SQL statement as the insert; pending rows count; a refusal is `409 SUBMISSION_QUOTA` with `meta: { reason, used, limit }`.
- More than 30 presigns per hour by one user answer `429`.
- `POST …/{sid}/finalize` marks the row `ready` only when the stored object exists and its length, content type and leading signature bytes match; otherwise object and row are deleted and the answer is `422 UPLOAD_MISMATCH` (`422 NotUploaded` when absent). Finalizing a `ready` row is idempotent.
- `PATCH …/{sid}` edits `title`, `description` (sanitised Markdown, ≤ 2 000) and `visibility`; sharing a moderated submission is `409 SUBMISSION_MODERATED`; asking for `shared` while the label switch is off is `409 SUBMISSION_SHARING_DISABLED` (same on presign).
- `DELETE …/{sid}` by the author deletes the object, then the row (pending, ready, or a dismissed tombstone); an R2 failure keeps the row and answers `502`.
- Every student route answers `404` when the topic is draft, archived, missing or outside the caller's effective access set.

**Student — reading and moving**
- `GET /v1/topics/{id}/submissions?scope=mine` returns the caller's own submissions in every status; `scope=class` returns shared `ready` submissions, the caller's own flagged `isMine`, and nothing when sharing is disabled; pages of 20, newest first, opaque `nextCursor`.
- `GET /v1/topics/{id}/submissions/{sid}` returns one submission under the access rules; a private one of another student, a pending row or a tombstone of another student is `404`.
- A student never receives another student's private, pending or removed submission from any endpoint, whatever the parameters.
- `GET /v1/me/submissions?cursor=` lists all the caller's submissions across topics, with topic title and `topicAccessible`; submissions on topics the caller lost access to are read-only except delete and move.
- `POST /v1/me/submissions/move` with `{ ids (1..10), targetTopicId }` moves the caller's `ready` submissions in order, each guarded by the target's per-topic count; it answers `200 { moved, refused }` with per-item reasons (`quota`, `not_found`, `not_ready`, `same_topic`), or `404` when the target is not readable. A moved submission becomes private, keeps its moderation flag, and its R2 object is untouched.
- A course reader's `GET /v1/topics/{id}` payload never contains a submission.

**Staff**
- `admin` and `content_creator` may call `scope=all` (every ready and removed submission, grouped data carries the author) and read any submission; students get `403` on `scope=all`.
- `GET /v1/admin/users/{userId}/submissions?cursor=` lists every ready or removed submission by one student, to staff only.
- `POST /v1/admin/submissions/{id}/unshare` and `DELETE /v1/admin/submissions/{id}/moderation` for both staff roles; `DELETE /v1/admin/submissions/{id}` for `admin` only — deletes the object, then turns the row into a tombstone (`status = 'removed'`, `storage_key = NULL`, description cleared, private). Students and tutors get `403` on every admin route; staff have no edit or move route.

**Housekeeping**
- The daily `scheduled()` run deletes `pending` rows older than 24 h and their objects, in batches of 100, logging only a count.
- Deactivating a user leaves their submissions in place; their shared ones stay listed with their name.

**Web**
- The topic page shows a **Demonstrações** button with *"N minhas · M da turma"* (class count hidden when sharing is off); staff see **Demonstrações dos alunos** with the total.
- `/catalog/[id]/submissions` shows tabs **Minhas** and **Da turma** for students, **Todos** for staff, with the active tab in `?tab=`; the *Da turma* tab and the visibility switch are hidden when sharing is off.
- *Minhas*: quota line, **Enviar demonstração** (sticky on mobile), upload form with client-side preflight against the summary (type, size, remaining quota) before any presign, XHR progress bar with **Cancel**, *Upload interrupted* rows with **Discard**, cards with **Edit**, **Move to another topic**, **Delete**, a **Select** mode for multi-move, and tombstones reading *"Removido pela equipe"* with **Dismiss**.
- The move dialog picks among the student's readable topics, shows free slots, warns that moved items become private, and reports moved and refused items.
- *Da turma*: a card grid (thumbnail, title, author, date; own ones marked **Você**), a full-screen viewer with the player, description, **previous / next** and swipe, paging through the cursor, and **Copy link**; an empty state pointing to *Minhas*.
- `/catalog/[id]/submissions/[sid]` opens the page with the viewer on that submission; a reader without access gets the catalog not-found page.
- A video the browser cannot decode shows *"Este vídeo não pode ser reproduzido neste navegador"* and a **Download** button instead of a broken player.
- *Todos* (staff): every submission grouped by student, with badges and **Unshare**, **Allow sharing again** and (admin) **Remove**.
- `/submissions` ("My demonstrations") lists the student's submissions grouped by topic with the same card actions; the user backoffice shows a *Submissions* section with staff actions; the nav gains one "My demonstrations" entry.
- Every string comes from the dictionaries; `pt` and `en` builds both render.

---

## 3. Acceptance Criteria

- [ ] With the vars absent the effective limits are 10 / 1 GiB / 250 MB / sharing on; `SUBMISSIONS_PER_TOPIC_MAX=3` makes the fourth presign on a topic `409 SUBMISSION_QUOTA`; `SUBMISSIONS_PER_TOPIC_MAX=abc` makes every submission endpoint `500 SUBMISSION_CONFIG_INVALID`.
- [ ] Two concurrent presigns at `limit − 1` produce exactly one `201` and one `409`; a presign that would cross the storage quota is refused with `reason: 'storage'`.
- [ ] Fixtures of a real iPhone `.mov`, an MP4, a JPEG and a PDF each go `presign → PUT → finalize` to `ready` on a readable topic; a text file uploaded as `video/mp4` fails finalize with `422 UPLOAD_MISMATCH` and leaves neither row nor object.
- [ ] Presign on a draft, archived or out-of-access topic returns `404`.
- [ ] `GET /v1/topics/{id}` returns byte-identical media before and after students upload to that topic.
- [ ] Another student gets `404` on a direct read of a private submission, and `scope=class` never contains private, pending or removed rows — asserted over every status and with a crafted `cursor`.
- [ ] Moving 3 submissions into a topic with 2 free slots returns 2 `moved` and 1 `refused: quota`; the moved rows are `private`, keep `moderated_at`, and their `storage_key` is unchanged.
- [ ] With `SUBMISSIONS_SHARING_ENABLED=false`, sharing returns `409 SUBMISSION_SHARING_DISABLED`, `scope=class` is empty and previously shared rows are `404` to other students; with `true` again they are listed unchanged.
- [ ] Both staff roles read every submission and force-unshare; only `admin` removes; after removal R2 has no object, the author's `scope=mine` shows the tombstone, and the quota no longer counts it; students and tutors get `403` on every `/v1/admin/submissions*` route.
- [ ] A `pending` row created 25 h ago and its object are gone after `scheduled()` runs; a 1 h-old one is untouched.
- [ ] Deleting a `users` row of a staff member who moderated or removed a submission succeeds at the database level, and `moderated_by` / `removed_by` become `NULL`.
- [ ] In a component test, the class viewer steps with **next** across a page boundary, and a `MEDIA_ERR_SRC_NOT_SUPPORTED` error renders the Download fallback.
- [ ] A file over the video limit is rejected in the browser before any presign request is sent (asserted on the mocked client).
- [ ] `git grep -n "topic_submissions" -- apps/api/src/controllers/topics.controller.ts apps/api/src/controllers/admin-media.controller.ts` returns nothing; no diff to `ALLOWED_MEDIA_TYPES` or `MEDIA_SIZE_LIMIT_BYTES`; no diff under `packages/shared/domain/gamification/`.
- [ ] `check-i18n-coverage.js` passes; `NEXT_PUBLIC_LANGUAGE=en` and default `pt` both render the page with no hardcoded string.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] No diff outside the scope declared in the guardrail.

---

## 4. Specific Stack

- **Backend:** Cloudflare Workers + Hono; per-request adapters built in `buildApp(env)`; `D1SubmissionRepository` joins the `engagement` group; controllers return `ControllerResult<T>` from `src/core/result.ts`. **Validation is `@hono/zod-openapi` `createRoute` + Zod at the route layer — not `@ValidateBody`/`@Body` decorators, which do not exist in this codebase** (`docs/product/backlog/refactoring/07-validatebody-documentation-drift.task.md`). `authGuard` on every route; `/v1/admin` already admits `admin` and `content_creator`, and the remove route adds an `admin`-only check. Quota and move guards are single conditional statements read through D1's `meta.changes`; the move runs as one `db.batch`. `KvRateLimiter` keyed by user id, prefix `rl:submissions:`, 30/hour. `sanitizeMarkdown` on write. `openapi.json` regenerated with `pnpm dump-openapi`.
- **Storage:** R2 through the S3 API: presigned PUT signing `ContentType` + `ContentLength` (existing), `HeadObject` (existing), and the new `readHead` (`GetObject` with `Range: bytes=0-31`). Signed GET URLs only, TTL 3600 s, `Cache-Control: private, no-store`.
- **Shared:** `Entities.Engagement.Submission`, `Entities.Config.SubmissionStatus`; `SUBMISSION_MEDIA_TYPES` / `SUBMISSION_VIDEO_TYPES` appended to `domain/media/limits.ts`; `domain/submissions/limits.ts` (text limits + env defaults); ports `i-submission-repository.ts` and two methods on `i-storage-adapter.ts`; `utils/sanitize-file-name.ts`. No Cloudflare types in shared.
- **Database:** D1 migration `0030_create_topic_submissions.sql` — one table, three indexes, `ON DELETE SET NULL` on the staff references. No change to any existing table.
- **Config:** `wrangler.jsonc` `vars` per environment; `.dev.vars.example`; `config/deployment.schema.jsonc` (RFC 0007 preflight).
- **Frontend:** Next.js 15 App Router (React 19, Tailwind v4); the Demonstrations page is a client component (upload progress, tabs, viewer state); `submissions-api.ts` over `fetchWithAuth` for JSON and `XMLHttpRequest` for the PUT (`upload.onprogress`, `abort()`); types from the regenerated `api-types.gen.ts` (`pnpm gen:api-types`); existing `VideoStage` / `PdfStage` / image viewer and the catalog's sanitised Markdown renderer; `useHasRole` for staff affordances; both i18n dictionaries + `check-i18n-coverage.js`.
- **Tests:** Vitest + `@cloudflare/vitest-pool-workers` (API — config parsing, the access matrix per role, quota races, move with partial refusal, signature check with real fixtures, sweep, sharing switch); Vitest + RTL (web — preflight, cancel, interrupted upload, tabs, viewer navigation and fallback, move dialog, staff actions).

---

## 5. Task Breakdown

Each task is one independent PR with one owner and one review surface. Backend and frontend never share a file: RFC Phase 4 (web) lands as four Frontend tasks (`06`–`09`), and the closeout is its own Backend task (`10`).

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Submission contracts — entity, media types, limits and ports](./01-shared-contracts.task.md) | 0 | Backend | ✅ Done |
| 02 | [Submission config, schema and D1 repository](./02-config-schema-and-repository.task.md) | 1 | Backend | ✅ Done |
| 03 | [Student upload API — presign, finalize, edit, delete and summary](./03-student-upload-api.task.md) | 2 | Backend | ✅ Done |
| 04 | [Student read and move API](./04-student-read-and-move-api.task.md) | 2 | Backend | ✅ Done |
| 05 | [Staff submissions API, tombstone and housekeeping](./05-staff-api-and-housekeeping.task.md) | 3 | Backend | ✅ Done |
| 06 | [Demonstrations page — Mine tab and upload](./06-mine-tab-and-upload-web.task.md) | 4 | Frontend | ☐ Open |
| 07 | [Class tab, full-screen viewer and direct link](./07-class-tab-and-viewer-web.task.md) | 4 | Frontend | ☐ Open |
| 08 | [Move dialog and My demonstrations page](./08-move-and-my-demonstrations-web.task.md) | 4 | Frontend | ☐ Open |
| 09 | [Staff submission surfaces](./09-staff-surfaces-web.task.md) | 4 | Frontend | ☐ Open |
| 10 | [Local seed and documentation closeout](./10-seed-and-docs.task.md) | 5 | Backend | ☐ Open |

Dependency graph:

```
01 ──► 02 ──► 03 ──► 04 ──► 05
               │      │      │
               ▼      ▼      ▼
              06 ──► 07 ──► 09 ──► 10
               │                    ▲
               └─────► 08 ──────────┘
```

(`08` also needs `04`; `10` also needs `05`.)

**Recommended execution order:** `01` → `02` → `03` → `04` → `05` → `06` → `07` → `08` → `09` → `10`. The backend (`01`–`05`) ships first behind routes no page calls yet. `06` needs only the upload API (`03`) and can run in parallel with `04`–`05`, mocking `scope=mine` until `04` lands; `07` and `08` need the read and move API (`04`) and the page shell (`06`), and can run in parallel; `09` needs the staff API (`05`) and the viewer (`07`). `10` is written last, because its closeout note and the RFC status change assert the milestone is complete.

Each task is intended to land as an independent PR with `make lint`,
`make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC 0020 "Resolved Decisions")

1. **Staff review is the next RFC** (product owner, 2026-09-29) — no feedback, score or "reviewed" state here; the entity is built so it can be referenced later.
2. **iPhone `.mov` uploads as-is** (product owner, 2026-09-29) — accepted for submissions only, stored unconverted, with a Download fallback when playback fails; transcoding stays deferred.
3. **Admin removal leaves a *"Removido pela equipe"* tombstone** (product owner, 2026-09-29) — the object is deleted, the row stays for its author and for the staff audit trail, outside every quota.
4. **Quotas are environment variables: 10 per topic, 1 GiB per student** (product owner, 2026-09-29) — set per label and environment; present-but-invalid is an error, never a silent default.
5. **250 MB per video file by default** (product owner, 2026-09-29) — `SUBMISSIONS_VIDEO_MAX_BYTES`, tunable per label.
6. **Per-label sharing switch** (product owner, 2026-09-29) — `SUBMISSIONS_SHARING_ENABLED`, default `true`, a read-time filter that never rewrites rows.
7. **A button on the topic page opens a dedicated page** (product owner, 2026-09-29) — the topic page stays as light as today.
8. **Tabs *Minhas* / *Da turma* (staff *Todos*), full-screen viewer with previous/next, direct link per submission** (product owner, 2026-09-29) — "Da turma" over "Amigos" because there is no friend graph; the audience is the topic's readers.
9. **Moving between topics is a core feature** (product owner, 2026-09-29) — author-only, metadata-only (the key has no topic id), quota-checked on the target, resets to private, keeps moderation.
10. **Separate table and key prefix, never `media`** — makes a course-media leak impossible rather than filtered.
11. **Access follows the catalog gate and answers `404`** — like RFC 0016 notes; a miss does not reveal the topic or the submission exists.
12. **Metadata edits are last-write-wins** — no autosave and three short fields; the notes `revision` mechanism is not reused.

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC 0020 status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items remain backlog.
- [ ] No diff outside the scope declared in the guardrail.
