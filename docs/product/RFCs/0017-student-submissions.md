# RFC 0017: Student submissions — demonstration media in the per-topic student area

**Date:** 2026-09-29
**Status:** Draft
**Author:** raphaelsilva
**Affected:**
- `apps/api/migrations/0029_create_topic_submissions.sql` (new — `topic_submissions`; `0028` is claimed by RFC 0015 and RFC 0016, whichever lands later renumbers)
- `packages/shared/types/entities.ts` (new `Entities.Engagement.Submission`, `Config.SubmissionStatus`; reuses `Config.NoteVisibility` from RFC 0016, renamed `Config.StudentContentVisibility` if both land together)
- `packages/shared/domain/submissions/limits.ts` (new — title/description length, per-topic count and per-student storage quota; one table read by API and web)
- `packages/shared/domain/media/limits.ts` (read, unchanged — the allowed-type/size table stays the single source of truth)
- `packages/shared/ports/i-submission-repository.ts` (new port) and `packages/shared/ports/index.ts`
- `apps/api/src/adapters/db/d1-submission-repository.ts` (new adapter)
- `apps/api/src/controllers/submissions.controller.ts` (new — ownership, visibility, quota, upload lifecycle, moderation)
- `apps/api/src/routes/submissions.router.ts` (new — topic-scoped student routes)
- `apps/api/src/routes/me/submissions.ts` (new — "my submissions" across topics)
- `apps/api/src/routes/admin/submissions.ts` (new — staff: per-student list, force-unshare, clear moderation, remove)
- `apps/api/src/jobs/sweep-pending-submissions.ts` (new — daily cleanup of abandoned uploads) and `apps/api/src/index.ts` `scheduled()` (wiring)
- `apps/api/src/container.ts` (repository + per-user upload rate limiter), `apps/api/src/routes/index.ts` (wiring)
- `apps/api/src/openapi/components/entities.ts` (new schemas)
- `apps/web/src/lib/submissions-api.ts` (new client)
- `apps/web/src/components/catalog/student-area/*` (new — the per-topic *Student area* shell shared with RFC 0016 notes, submission uploader, list, editor, class gallery)
- `apps/web/src/app/(protected)/catalog/[id]/page.tsx` (mounts the student area)
- `apps/web/src/app/(protected)/admin/users/[userId]/page.tsx` (new *Submissions* section)
- `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (new `submissions:` and `studentArea:` sections, identical keys)

---

## Summary

Let a student **post evidence of their own practice** on a topic: a video of themselves
performing a technique, a photo, or a PDF. Each upload is a **submission** — one file plus a
title and a short description the student writes — attached to one topic and owned by the
student, who can rename, re-describe or delete it at any time. Submissions live in a new
**Student area** on the catalog topic page, next to the student's note from RFC 0016: the two
features together are "my work on this topic". A submission is **private by default** —
visible to its author and to staff (`admin`, `content_creator`) — and the author may **share**
it with every student who can read the topic, where it appears in a *Class submissions*
gallery. Staff can force-unshare and, for content that must go, remove it. Files travel
through the same `presign → PUT → finalize` lifecycle and the same type/size table as
backoffice media, but in a **separate table and key prefix**, so a student upload can never
surface as course content.

## Motivation

Topics today are one-way: staff publish content, students consume it and, at most, comment.
For practice-based subjects (the `budo` tenant is the obvious case) the most useful thing a
student can produce is a recording of themselves executing what the topic teaches — and there
is nowhere to put it.

| Case | Today | This RFC |
|---|---|---|
| Student records themselves doing the kata of a topic | Sends it by WhatsApp; lost in a chat, not tied to the topic | Uploads it as a submission on that topic |
| Student wants to label what the video shows ("2nd attempt, left side") | — | Title + description, editable after upload |
| Student wants to compare this month's recording with last month's | Scrolls a chat history | Their submissions on the topic, newest first; "My submissions" across topics |
| Instructor wants to see how a student is progressing on a technique | Asks the student to resend | Staff read every submission on the topic, and every submission by a student in the user backoffice |
| A good demonstration could help classmates | — | Author shares it; it appears under *Class submissions* |
| A shared upload is inappropriate | — | Staff force-unshare; an admin can remove it entirely |
| Photo of a hand-written exercise, or a PDF worksheet | — | Same flow, image or PDF instead of video |

Why a submission is not a comment attachment or a note attachment: comments are public and
append-only; a note is one editable Markdown text per topic (RFC 0016 explicitly lists media
attachments as a non-goal). A submission is a **file with metadata**, many per topic, with its
own storage lifecycle and cleanup — a different entity with a different shape.

## Goals & Non-Goals

**Goals**
- A student with read access to a published topic can upload **several** submissions to it,
  each one file (`video/mp4`, `image/jpeg|png|webp`, `application/pdf`) with a title and an
  optional description.
- The author can edit a submission's title, description and visibility, and delete it (file
  included) at any time.
- A submission is `private` (author + staff) or `shared` (+ every student who can read the
  topic). Private by default; the UI names the audience in plain words.
- Staff (`admin`, `content_creator`) read every submission — per topic on the topic page, per
  student in the user backoffice — and can force-unshare. `admin` can remove a submission.
- Upload limits reuse `domain/media/limits.ts` unchanged; the API re-verifies the **stored**
  object's size and type at finalize, since the uploader is no longer trusted staff.
- Per-student abuse bounds: a count per topic, a total storage quota, and an upload rate limit.
- Abandoned uploads (`pending` rows and their objects) are swept automatically.
- A student upload **never** appears in the topic's course media (`GET /v1/topics/{id}`).
- Topic access is enforced exactly as the catalog does — published, not archived, in the
  caller's effective access set — and a miss is `404`.
- The Student area on the topic page hosts both this feature and RFC 0016's note.

**Non-Goals**
- **Staff feedback / grading on a submission** (a comment, a score, "approved"). The most
  natural follow-up; kept out so this RFC ships the storage and privacy model first. See Open
  Question 1.
- **Server-side transcoding** or thumbnails. Files are stored and served as uploaded. Poster
  frames come from the browser's `<video preload="metadata">`.
- **Formats outside the media table** (`video/quicktime`, HEIC). See Open Question 2.
- **Several files per submission.** One file per submission; a "take" with three angles is
  three submissions (Alternatives §3).
- **XP, quests or badges** for submitting — consistent with RFC 0016's decision for notes.
- **Tutor powers.** A `tutor` sees submissions as a student does (as in RFC 0016).
- **Comments or likes on shared submissions.** The discussion remains the place to talk.
- **Recording in the browser** (`MediaRecorder`). The student records with their phone's
  camera and uploads the file; the file input with `capture` covers mobile.
- **Notifications** to staff when a submission arrives.

## Current State (for reference)

**1. The media lifecycle exists, but only for staff.** `apps/api/src/routes/admin/topics.ts`
exposes `POST /v1/admin/topics/{topicId}/media/presign` → client `PUT` to R2 →
`POST …/media/{mediaId}/finalize`, all behind `requireRole(ADMIN, CONTENT_CREATOR)`
(`routes/admin/index.ts:23`). Presign validates `contentType` against `ALLOWED_MEDIA_TYPES` and
the declared size against `mediaSizeLimitFor` (`controllers/admin-media.controller.ts:77-117`);
the presigned PUT signs `ContentType` and `ContentLength`
(`adapters/storage/r2-storage-adapter.ts:115-124`), expiry 3600 s. The key is
`topics/${topicId}/${uuid}-${sanitizeFileName(name)}` (`admin-media.controller.ts:96-98`).

**2. Finalize checks existence, not size.** `finalize` (`admin-media.controller.ts:119-141`)
issues a `HeadObject` and marks the row `ready`; it never compares the stored length. The
event flyer finalize does (`controllers/admin-events.controller.ts:534-553`) — the precedent
this RFC follows, because a student is an untrusted uploader.

**3. `media` is course content by construction.** `0006_create_media.sql` gives each row a
single `topic_node_id` and no notion of author role; `TopicsController.getPublishedById`
(`controllers/topics.controller.ts:54-84`) returns **every `ready` row** of the topic to every
reader, with a signed GET URL (TTL 3600 s, `:15`, `:76-81`). A student upload stored there
would instantly become course material for the whole class.

**4. Media is always served through signed GET URLs.** `R2_PUBLIC_BASE` exists but is unused by
media and empty in most envs (`wrangler.jsonc:42`). Private student videos need exactly this.

**5. Nothing cleans up abandoned uploads.** The only `scheduled()` handler is daily billing
(`src/index.ts:44-52`); `IMediaRepository.hardDelete` has no caller in the media flow. With
staff as the only uploaders this was tolerable; with every student uploading from a phone on a
flaky connection it is not.

**6. Nothing rate-limits uploads.** `KvRateLimiter` (`adapters/rate-limit/kv-rate-limiter.ts`)
is built only for login, register, activate, forgot-password and the events board
(`container.ts:153-159, 271-300`).

**7. The access gate to reuse.** `TopicsController.getPublishedById` answers `404` unless the
topic is published, not archived and in `getEffectiveAccessTopicIds`
(`adapters/db/d1-enrollment-repository.ts:52-82`, RFC 0005); `routes/topics.router.ts:26`
already reuses it as the check for topic-scoped student endpoints. `admin` and
`content_creator` bypass it (`routes/public/catalog.topics.ts:73,85`).

**8. The topic page.** `apps/web/src/app/(protected)/catalog/[id]/page.tsx` renders
`TopicHeader`, `ContentSection`, `MediaList` (`components/catalog/MediaList/*`, with
`VideoStage`, `PdfStage`) and `Discussion`. RFC 0016 plans a *Notes* panel beside Discussion;
neither exists in code yet.

## Proposed Design

### 1. Schema (`0029_create_topic_submissions.sql`)

```sql
CREATE TABLE IF NOT EXISTS topic_submissions (
  id             TEXT PRIMARY KEY,
  topic_node_id  TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
  author_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',          -- sanitised Markdown, may be empty
  storage_key    TEXT NOT NULL UNIQUE,
  original_name  TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,                  -- declared at presign, verified at finalize
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'ready')),
  visibility     TEXT NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('private', 'shared')),
  shared_at      TEXT,
  moderated_at   TEXT,                              -- staff force-unshare; blocks re-sharing
  moderated_by   TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_topic_submissions_author ON topic_submissions (author_id, created_at);
CREATE INDEX IF NOT EXISTS idx_topic_submissions_topic  ON topic_submissions (topic_node_id, status, visibility, shared_at);
CREATE INDEX IF NOT EXISTS idx_topic_submissions_sweep  ON topic_submissions (status, created_at);
```

- **Its own table, not `media`** — Current State §3. The two never join; the course media query
  cannot see a submission whatever its status.
- **Hard delete.** Deleting a submission removes the row and the object. There is no thread or
  history to keep.
- **No `deleted` status.** `media` needs one because the row is soft-deleted before the object;
  here the row is deleted *after* the object (§4), so a failed object delete leaves a `ready`
  row the author can retry, never a ghost.

### 2. Storage layout

Key: `submissions/{authorId}/{topicId}/{uuid}-{sanitizeFileName(originalName)}`.

- **Author first** so everything one student uploaded is one prefix — which is what makes
  account deletion clean (§8) and a per-student audit a single `ListObjects`.
- **Separate from `topics/…`** so a bucket-level rule or a future lifecycle policy can treat
  student content differently from course content (e.g. a different retention).
- The key is built server-side; the client never chooses it. `sanitizeFileName` is moved from
  `admin-media.controller.ts` to `packages/shared/utils/` so both controllers share it.
- Served only through `getPresignedDownloadUrl` (TTL 3600 s), never `R2_PUBLIC_BASE`. Responses
  carrying URLs set `Cache-Control: private, no-store`.

### 3. Shared domain

`packages/shared/domain/submissions/limits.ts`:

```ts
export const SUBMISSION_TITLE_MAX = 120;              // characters
export const SUBMISSION_DESCRIPTION_MAX = 2_000;      // characters, after sanitisation
export const SUBMISSIONS_PER_TOPIC_MAX = 20;          // ready + pending, per student per topic
export const SUBMISSION_STORAGE_PER_STUDENT_BYTES = 2 * 1024 ** 3;  // 2 GiB across all topics
export const SUBMISSION_PENDING_TTL_HOURS = 24;       // sweep threshold (§6)
```

Types and per-type size limits are **not** redefined: presign and finalize call
`isAllowedMediaType` / `mediaSizeLimitFor` from `domain/media/limits.ts`, so a limit changes in
one place for staff, events, the importer and students alike.

`Entities.Engagement` gains:

```ts
interface Submission {
  id: string; topicNodeId: string;
  authorId: string; authorName: string;
  title: string; description: string;
  originalName: string; contentType: MediaType; sizeBytes: number;
  status: Config.SubmissionStatus;           // 'pending' | 'ready'
  visibility: Config.NoteVisibility;         // 'private' | 'shared' (RFC 0016)
  sharedAt: string | null; moderated: boolean;
  url: string | null;                        // signed GET, only when ready
  createdAt: string; updatedAt: string;
}
```

### 4. Upload lifecycle

```
student                           API                                  R2
  │ POST …/submissions/presign ──▶ gate topic (404) · rate limit (429)
  │   {fileName, contentType,      type/size vs media table (400/422)
  │    sizeBytes, title,           quota: count & bytes (409), atomic INSERT pending
  │    description?, visibility?}  ◀── 201 {submission, uploadUrl, expiresAt}
  │ PUT uploadUrl (XHR, progress) ─────────────────────────────────────▶ object
  │ POST …/{sid}/finalize ───────▶ HeadObject: exists? length == sizeBytes?
  │                                content-type == declared?  → ready (200)
  │                                mismatch → delete object + row, 422
```

- **Metadata is sent at presign**, so a finished upload is immediately a complete submission —
  there is no "untitled upload" state for the UI to chase. `title` defaults client-side to the
  file name without extension.
- **Quota check and insert are one statement**, the RFC 0016 pattern (a check followed by a
  write can interleave on D1):

  ```sql
  INSERT INTO topic_submissions (id, topic_node_id, author_id, title, description,
                                 storage_key, original_name, content_type, size_bytes, visibility)
  SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
   WHERE (SELECT COUNT(*) FROM topic_submissions
           WHERE author_id = ?3 AND topic_node_id = ?2) < ?11            -- per-topic count
     AND (SELECT COALESCE(SUM(size_bytes), 0) FROM topic_submissions
           WHERE author_id = ?3) + ?9 <= ?12;                            -- storage quota
  ```

  `meta.changes = 0` → `409 SUBMISSION_QUOTA` with `meta: { reason: 'count' | 'storage', used, limit }`.
  Pending rows count toward both limits, so a student cannot start fifty parallel presigns to
  slip past them.
- **Finalize re-verifies the stored object** (Current State §2): `ContentLength` must equal
  `size_bytes` and `ContentType` must equal `content_type`. The signed PUT already enforces
  both, so a mismatch means something bypassed it; the controller deletes the object and the
  row and answers `422 UPLOAD_MISMATCH`. Finalize on a `ready` row is idempotent (`200`).
- **Delete order: object, then row.** If the R2 delete throws, the row stays and the request
  answers `502`; the author can retry. The reverse order (the `media` one) leaves orphaned
  objects no query can find.

### 5. Access rules

All rules live in `SubmissionsController`; routes pass the caller, roles and effective access
set. "Staff" = `admin` or `content_creator`; `tutor` = student. "T readable" = published, not
archived, in the effective access set; any miss is `404`. Staff bypass the access check.

| Action | Author | Other student | `content_creator` | `admin` |
|---|---|---|---|---|
| Upload to T | ✅ if T readable | — | — | — |
| Read a **private** submission | ✅ | ❌ `404` | ✅ read-only | ✅ read-only |
| Read a **shared** submission | ✅ | ✅ if T readable | ✅ | ✅ |
| List submissions on T | own (all) + shared | shared | **all ready** | **all ready** |
| Edit title / description / visibility | ✅ (share blocked if moderated: `409 SUBMISSION_MODERATED`) | ❌ `404` | ❌ `403` | ❌ `403` |
| Delete | ✅ | ❌ `404` | ❌ `403` | ✅ **remove** (§7) |
| Force-unshare / clear moderation | — | — | ✅ | ✅ |
| List every submission by one student | — | — | ✅ | ✅ |

- **Pending rows are visible only to their author** (so the UI can resume or cancel them); staff
  and classmates see `ready` only.
- **Losing access to T** does not take the student's uploads away: "My submissions" still lists
  them flagged `topicAccessible: false`, read-only except for delete. They leave the class
  gallery.
- **Sharing is a deliberate act**, confirmed in the UI with a line saying classmates will see
  the file **with the author's name** — a video of a person is more identifying than a note.

### 6. Abandoned uploads

A new `sweep-pending-submissions` job runs from the existing `scheduled()` handler (daily, next
to billing — no new cron). For each `pending` row older than `SUBMISSION_PENDING_TTL_HOURS`
(the presigned PUT expires after 1 h, so 24 h is far past any in-flight upload), it deletes the
object if present, then the row, in batches of 100. It logs a count, never file names.

### 7. Moderation and removal

- **Force-unshare** (`POST /v1/admin/submissions/{id}/unshare`, both staff roles) sets
  `visibility = 'private'`, `moderated_at`, `moderated_by`. The file stays; the author keeps it
  privately and cannot re-share until staff clear the flag
  (`DELETE /v1/admin/submissions/{id}/moderation`). Identical semantics to RFC 0016 notes.
- **Remove** (`DELETE /v1/admin/submissions/{id}`, `admin` only) deletes object and row. This
  exists — unlike for notes — because a file can hold content that must not stay on the
  platform at all, where unsharing is not enough. It is restricted to `admin` because it destroys
  the student's own work. The author's list shows nothing afterwards; there is no tombstone
  (Open Question 3).

### 8. Account deletion

`ON DELETE CASCADE` removes rows when a user is hard-deleted, but not R2 objects. The user
deletion path (`UsersController` hard delete, if and when it runs) additionally calls
`storage.deletePrefix('submissions/{userId}/')`. `IStorageAdapter` gains `deletePrefix(prefix)`
(`ListObjectsV2` + `DeleteObjects` in pages of 1 000) — the only port change.

### 9. HTTP surface

Mounted like comments/notes — `buildSubmissionsRouter` at `v1.route('/', …)`, behind `authGuard`.

| Method & path | Who | Purpose | Success / errors |
|---|---|---|---|
| `GET /v1/topics/{id}/submissions?cursor=` | any | Author: own (incl. pending) + shared. Students: shared. Staff: all ready. Newest first, page 20 | `200 { data, nextCursor }` |
| `POST /v1/topics/{id}/submissions/presign` | student | Create pending + presigned PUT | `201` · `400` · `409 SUBMISSION_QUOTA` · `422 FileTooLarge` · `429` |
| `POST /v1/topics/{id}/submissions/{sid}/finalize` | author | Verify object, mark ready | `200` · `422 NotUploaded` · `422 UPLOAD_MISMATCH` |
| `PATCH /v1/topics/{id}/submissions/{sid}` | author | `{ title?, description?, visibility? }` | `200` · `409 SUBMISSION_MODERATED` |
| `DELETE /v1/topics/{id}/submissions/{sid}` | author | Delete object and row (pending or ready) | `204` · `502` |
| `GET /v1/me/submissions?cursor=` | student | All own submissions across topics, with topic title and `topicAccessible` | `200 { data, nextCursor }` |
| `GET /v1/admin/users/{userId}/submissions?cursor=` | staff | Every ready submission by that student | `200 { data, nextCursor }` |
| `POST /v1/admin/submissions/{id}/unshare` | staff | Force-unshare | `200` |
| `DELETE /v1/admin/submissions/{id}/moderation` | staff | Clear moderation | `204` |
| `DELETE /v1/admin/submissions/{id}` | `admin` | Remove | `204` |

- `PresignSubmissionSchema` extends the admin `PresignSchema` (`fileName ≤ 255`,
  `contentType: z.enum(ALLOWED_MEDIA_TYPES)`, `sizeBytes`) with `title` (1…`SUBMISSION_TITLE_MAX`
  after trim), `description` (`sanitizeMarkdown`, ≤ `SUBMISSION_DESCRIPTION_MAX`) and
  `visibility` (default `private`).
- **Edits are last-write-wins**, deliberately unlike notes: there is no autosave, the form
  submits on an explicit *Save*, and the fields are short. See Alternatives §5.
- **Rate limit**: a `KvRateLimiter` keyed by user id, prefix `rl:submissions:`, **30 presigns per
  hour**, applied to `presign` only. It bounds churn (upload/delete loops) that the quota, being
  a level and not a rate, does not.
- Cursors reuse the helper RFC 0016 introduces in `routes/_shared/`; whichever lands first adds it.

### 10. Ports & adapters

```ts
export interface ISubmissionRepository {
  findById(id: string): Promise<SubmissionRecord | null>;
  /** Atomic quota-guarded insert of §4; null when a quota refused it. */
  createPending(p: CreatePendingSubmission, q: SubmissionQuota): Promise<SubmissionRecord | null>;
  quotaUsage(authorId: string, topicNodeId: string): Promise<{ count: number; bytes: number }>;
  markReady(id: string): Promise<SubmissionRecord>;
  updateMeta(id: string, patch: SubmissionMetaPatch): Promise<SubmissionRecord>;
  delete(id: string): Promise<void>;
  listByTopic(topicNodeId: string, opts: { viewerId: string; scope: 'student' | 'staff'; page: CursorPage }): Promise<Paged<SubmissionRecord>>;
  listByAuthor(authorId: string, opts: { includePending: boolean; page: CursorPage }): Promise<Paged<AuthoredSubmissionRecord>>;
  setModeration(id: string, staffId: string | null): Promise<SubmissionRecord | null>;
  listStalePending(olderThanHours: number, limit: number): Promise<SubmissionRecord[]>;
}
```

`scope` is decided by the controller from roles, never from the request. `quotaUsage` exists
only to fill the `409` meta and the UI's quota meter; enforcement is the conditional insert.
Instantiated per request in the container's `engagement` slice, next to `commentRepo` and
RFC 0016's `noteRepo`.

### 11. Web surface — the Student area

The idea of the product owner is one place per topic that holds *the student's own work*.
RFC 0016 plans a Notes panel; this RFC turns that into a shared shell:

- **`StudentArea`** (`components/catalog/student-area/StudentArea.tsx`) is mounted on the topic
  page between the content/media and Discussion, with two tabs: **Minha anotação / My note**
  (RFC 0016's editor, unchanged) and **Minhas demonstrações / My submissions** (this RFC).
  Whichever RFC lands first creates the shell with its own tab; the second adds a tab.
- **Primary action**: a **Send a demonstration** button in the tab header (and, on mobile, a
  sticky button at the bottom of the tab). It opens a dialog:
  file input (`accept` from `ALLOWED_MEDIA_TYPES`; on mobile the OS offers camera or library),
  title (prefilled from the file name), description (Markdown, with the character counter from
  the limits table), and the visibility switch with the audience line —
  *"Private: only you and the staff (admins and content creators) can see it."*
  Type and size are checked **in the browser before presign** using the same table, so a
  150 MB video is refused with its limit before a byte is sent.
- **Upload progress**: the PUT uses `XMLHttpRequest` for `upload.onprogress`; the dialog shows
  a progress bar and can cancel (aborts the PUT, then `DELETE`s the pending row). Closing the
  tab mid-upload leaves a pending row, shown in the list as *Upload interrupted* with
  **Discard**; the sweep removes it after 24 h anyway.
- **My submissions list**: cards newest first — poster frame / image thumbnail / PDF icon,
  title, description excerpt, date, size, visibility badge, moderation banner. Clicking opens
  the existing viewers (`VideoStage`, `PdfStage`, the image viewer) in a modal. Card menu:
  **Edit** (title, description, visibility), **Delete** (confirmation).
  A quota line shows *"3 of 20 on this topic · 1.2 GB of 2 GB used"*.
- **Class submissions**: a second section below the student's own, listing shared submissions
  with author name — the "section of student videos" on the topic. Hidden when empty.
- **Staff view**: the Student area becomes **Student submissions** — every ready submission on
  the topic, grouped by student, with private/shared badges and **Unshare**, **Allow sharing
  again** and (admin) **Remove**. Staff never see an upload button or an editor on someone
  else's submission.
- **User backoffice** (`(protected)/admin/users/[userId]`): a *Submissions* section listing that
  student's submissions grouped by topic, same actions.
- **"My submissions" across topics**: RFC 0016 adds a *My notes* page at `(protected)/notes`.
  Rather than a second page, it becomes **"My work"** (`(protected)/my-work`) with *Notes* and
  *Submissions* tabs. If this RFC lands first, the page ships with the Submissions tab only.
- **i18n**: `studentArea:` (shell) and `submissions:` sections in both dictionaries, identical
  keys; `check-i18n-coverage.js` stays green.

## Alternatives Considered

1. **Store submissions in `media` with an `uploaded_by_role` / `kind` column.** Rejected. Every
   existing reader of `media` — the catalog topic payload, the admin media list, the importer's
   ledger reconciliation — would need a new filter, and forgetting one publishes a student's
   private video to the class. A separate table makes the leak impossible rather than
   prevented.
2. **Attach files to RFC 0016 notes instead of a new entity.** Rejected. A note is one text per
   topic with autosave and revision checks; submissions are many files per topic with an upload
   lifecycle. Folding them together would force the note editor to own uploads and quotas. They
   share a UI shell (§11), not a table.
3. **Several files per submission** (a "take" with front and side angles). Deferred, not
   rejected. It needs a child table and a multi-file uploader; one file per submission covers
   the stated need, and a later `submission_files` table can adopt existing rows as
   single-file submissions.
4. **Private-only submissions (no sharing) in v1.** Considered, since videos of people are
   sensitive. Not chosen: the product owner's description asks for a section of student videos
   on the topic, which only sharing provides. Private by default + explicit confirmation +
   staff moderation bound the risk. Open Question 4 keeps a per-tenant switch possible.
5. **Revision-checked edits like notes.** Rejected for this entity. Notes autosave on every
   pause, so two tabs collide routinely; submission metadata changes on an explicit Save of
   three short fields. Last-write-wins loses at most a title edit made in another tab.
6. **Direct upload through the Worker** (multipart body to the API). Rejected: Workers' request
   size limits and CPU time make 100 MB bodies impractical, and it would diverge from the one
   upload path the platform already has.
7. **Public R2 URLs for shared submissions** (cacheable, cheaper). Rejected: a shared submission
   is still restricted to readers of the topic; a public URL would be forwardable forever.
   Signed URLs with a 1 h TTL match course media.
8. **Accept `video/quicktime` and HEIC for students only.** Deferred to Open Question 2 — it
   would fork the single limits table and relies on browser playback support that varies.

## Implementation Plan

Total: **~6–7 dev days**, one milestone, backend and frontend tasks kept separate. Independent
of RFC 0016 at the API level; the web shell (§11) is shared, and whichever lands second adapts.

### Phase 0 — Shared foundations (~0.5 d)
`Entities.Engagement.Submission`, `Config.SubmissionStatus`, `domain/submissions/limits.ts`,
`ISubmissionRepository`, `IStorageAdapter.deletePrefix`, `sanitizeFileName` moved to shared.

### Phase 1 — Schema and repository (~1 d)
Migration `0029`, `D1SubmissionRepository` with the quota-guarded insert (`meta.changes`),
listing scopes, cursor pagination; Workers-pool tests including two concurrent presigns at the
quota edge (exactly one succeeds).

### Phase 2 — Student API and upload lifecycle (~1.5 d)
`SubmissionsController`; presign / finalize (with stored-object verification) / patch / delete;
topic listing and `GET /v1/me/submissions`; per-user rate limiter; access table of §5 as tests
(student ↔ student `404`, pending hidden from staff, `topicAccessible`); proof that
`GET /v1/topics/{id}` never contains a submission.

### Phase 3 — Staff API, sweep, account deletion (~1 d)
`/v1/admin/users/{userId}/submissions`, unshare / clear moderation (both staff roles), remove
(admin only); sweep job wired into `scheduled()`; `deletePrefix` on user hard-delete; OpenAPI
schemas and regenerated `api-types.gen.ts`.

### Phase 4 — Web (~2–2.5 d)
`submissions-api.ts` (XHR PUT with progress and abort); `StudentArea` shell; upload dialog with
client-side preflight; My submissions list with viewers, edit and delete; Class submissions;
staff view and moderation actions; *Submissions* section in the user backoffice; "My work" page;
dictionaries in both languages; component tests for preflight rejection, cancel and interrupted
upload.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| A student's private video leaks into course content | Separate table and key prefix; a Phase 2 test asserts the topic payload never includes a submission |
| Students assume "private" means nobody else sees it | Audience line names staff explicitly, in the dialog and on each card |
| Sharing a video of oneself is regretted later | Private default, confirmation naming the author, unshare or delete at any time |
| Abusive or illegal content | Staff force-unshare immediately; `admin` removal deletes the object |
| Storage cost grows with every student | Per-topic count and 2 GiB per-student quota in one limits file; pending counts toward them; sweep removes abandoned uploads |
| Upload/delete loops churn R2 operations | 30 presigns/hour per user (`rl:submissions:`) |
| Phone records `.mov` / HEIC and the upload is refused | Client preflight explains the accepted formats before upload; iOS converts photos to JPEG on upload; Open Question 2 decides on `.mov` |
| Slow mobile networks and 100 MB videos | Progress bar, cancel, resumable-by-retry (a failed PUT re-presigns); multipart upload deferred |
| Hard-deleted user leaves orphaned objects | Author-first key prefix + `deletePrefix` on hard delete |
| R2 delete fails while deleting | Object deleted before the row; failure keeps the row and returns `502` so the author retries |
| Migration number collides with RFC 0015/0016 | `0029` chosen; whichever lands out of order renumbers, noted in **Affected** |

## Success Criteria

- (Ph 1) Two concurrent presigns at `SUBMISSIONS_PER_TOPIC_MAX − 1` produce one `201` and one
  `409 SUBMISSION_QUOTA`; the storage quota refuses a presign that would cross 2 GiB.
- (Ph 2) A student uploads a video, image and PDF to a readable topic and each becomes `ready`;
  a draft, archived or out-of-access topic answers `404` at presign.
- (Ph 2) A finalize whose stored object differs in size or type from the presign returns
  `422 UPLOAD_MISMATCH` and leaves neither row nor object.
- (Ph 2) Another student gets `404` for someone else's private submission through every
  endpoint, never sees pending rows, and sees shared ones only while the topic is readable.
- (Ph 2) `GET /v1/topics/{id}` returns the same media before and after students upload.
- (Ph 3) Both staff roles read every ready submission on a topic and by a student, and force-
  unshare; only `admin` removes; students and tutors get `403` on every admin route.
- (Ph 3) A pending row older than 24 h and its object are gone after the scheduled run.
- (Ph 4) On a phone, a student records a video, uploads it with a visible progress bar, titles
  it, and finds it in the Student area; a file over its limit is refused before upload; the
  flow works in `pt` and `en` builds and the i18n coverage check passes.

## Open Questions

1. **Staff feedback on a submission** — should an instructor be able to leave a written
   correction (and maybe a status such as *reviewed*) on a submission, visible to its author?
   It is the natural reason to submit a video at all. Recommendation: a follow-up RFC (a
   `submission_feedback` table, one thread per submission), so this one ships the storage and
   privacy model first. *Owner: product owner.*
2. **`.mov` from iPhones.** iOS records H.264/HEVC in `video/quicktime`. Accepting it for
   submissions only forks the limits table and plays unreliably outside Safari; rejecting it
   means students must export as MP4 (or set camera to *Most Compatible*). Recommendation:
   reject in v1 with a clear, localised explanation; revisit with usage data. *Owner: product
   owner.*
3. **Tombstone on admin removal** — should the author see *"Removed by the staff"* in place of a
   removed submission, rather than it silently disappearing? *Owner: product owner.*
4. **Per-tenant switch for sharing** — should a label be able to disable sharing (private-only),
   e.g. a tenant with minors? Would live in the label profile, not the database. *Owner:
   product owner.*
5. **Quota values** — 20 per topic and 2 GiB per student are placeholders sized for a class of
   ~50 on R2's free tier headroom; confirm per tenant expectations. *Owner: product owner.*
6. **Button placement** — the product owner flagged the on-screen buttons for discussion. §11
   proposes one primary *Send a demonstration* action inside the Student area tab (sticky on
   mobile) rather than a button in the topic header; confirm before the frontend task is cut.
   *Owner: product owner.*

## References

- Relevant code: `apps/api/src/controllers/admin-media.controller.ts:77-154` (lifecycle to
  mirror), `apps/api/src/controllers/admin-events.controller.ts:534-553` (stored-size
  verification precedent), `apps/api/src/adapters/storage/r2-storage-adapter.ts:115-143`,
  `apps/api/migrations/0006_create_media.sql`, `packages/shared/domain/media/limits.ts`,
  `apps/api/src/controllers/topics.controller.ts:54-84` (access gate, course media payload),
  `apps/api/src/adapters/db/d1-enrollment-repository.ts:52-82`,
  `apps/api/src/adapters/rate-limit/kv-rate-limiter.ts`, `apps/api/src/index.ts:44-52`
  (`scheduled()`), `apps/web/src/app/(protected)/catalog/[id]/page.tsx`,
  `apps/web/src/components/catalog/MediaList/*`
- Related RFCs: RFC 0016 (student notes — visibility vocabulary, moderation semantics, cursor
  helper, and the Student area shell shared with this RFC), RFC 0005 (effective access set),
  RFC 0003 (route organisation and OpenAPI), RFC 0004 (catalog redesign — the topic page this
  extends)
