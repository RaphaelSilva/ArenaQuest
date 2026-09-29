# RFC 0020: Student submissions — students upload, manage and move demonstration media per topic

**Date:** 2026-09-29
**Status:** Draft
**Revised:** 2026-09-29
**Author:** raphaelsilva
**Affected:**
- `apps/api/migrations/0030_create_topic_submissions.sql` (new — `topic_submissions`; `0028`/`0029` go to RFC 0016 notes and RFC 0015 event charges, whichever lands out of order renumbers)
- `packages/shared/types/entities.ts` (new `Entities.Engagement.Submission`, `Config.SubmissionStatus`; reuses the `'private' | 'shared'` visibility of RFC 0016)
- `packages/shared/domain/media/limits.ts` (adds `SUBMISSION_MEDIA_TYPES` — the course table plus `video/quicktime` — in the same single source of truth)
- `packages/shared/domain/submissions/limits.ts` (new — title/description lengths and the defaults of the env-configured quotas)
- `packages/shared/ports/i-submission-repository.ts` (new port), `packages/shared/ports/i-storage-adapter.ts` (`readHead`, `deletePrefix`), `packages/shared/ports/index.ts`
- `apps/api/src/core/submissions/config.ts` (new — parses and validates the `SUBMISSIONS_*` env vars)
- `apps/api/src/adapters/db/d1-submission-repository.ts` (new adapter), `apps/api/src/adapters/storage/r2-storage-adapter.ts` (`readHead`, `deletePrefix`)
- `apps/api/src/controllers/submissions.controller.ts` (new — ownership, visibility, quota, upload lifecycle, move, moderation, removal)
- `apps/api/src/routes/submissions.router.ts` (new — topic-scoped student routes), `apps/api/src/routes/me/submissions.ts` (new — cross-topic list, quota, move), `apps/api/src/routes/admin/submissions.ts` (new — staff)
- `apps/api/src/jobs/sweep-pending-submissions.ts` (new) and `apps/api/src/index.ts` `scheduled()` (wiring)
- `apps/api/src/container.ts` (repository, config, per-user upload rate limiter), `apps/api/src/routes/index.ts` (wiring)
- `apps/api/wrangler.jsonc`, `apps/api/.dev.vars.example` (new `SUBMISSIONS_*` vars per environment)
- `apps/api/src/openapi/components/entities.ts` (new schemas)
- `apps/web/src/lib/submissions-api.ts` (new client)
- `apps/web/src/app/(protected)/catalog/[id]/page.tsx` (new *My demonstrations* button)
- `apps/web/src/app/(protected)/catalog/[id]/submissions/page.tsx` (new — the per-topic submissions page: upload, manage, move, class gallery, staff view)
- `apps/web/src/app/(protected)/submissions/page.tsx` (new — "My demonstrations" across topics)
- `apps/web/src/components/catalog/submissions/*` (new — uploader, card, editor, topic picker, gallery)
- `apps/web/src/app/(protected)/admin/users/[userId]/page.tsx` (new *Submissions* section)
- `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (new `submissions:` section, identical keys)

---

## Summary

Let a student **post evidence of their own practice** on a topic — a video of themselves
performing a technique, a photo, or a PDF — **straight from their phone, iPhone `.mov`
included**. Each upload is a **submission**: one file plus a title and a description the
student writes, owned by the student, who can edit, delete or **move it to another topic** at
any time. The catalog topic page gets a **My demonstrations** button that opens a dedicated
page for that topic, where the upload happens and where the student manages what they sent.
A submission is **private by default** (author + staff); the author may **share** it with the
class, and shared submissions form the topic's *Class demonstrations* gallery on that page.
Staff can force-unshare, and an admin can remove a file, leaving a *"Removed by the staff"*
tombstone for its author. Quotas (**10 per topic, 1 GiB per student**) are **environment
variables**, so each label and environment sets its own. Files travel through the same
`presign → PUT → finalize` lifecycle as backoffice media, but in a **separate table and key
prefix**, so a student upload can never surface as course content.

## Motivation

Topics today are one-way: staff publish content, students consume it and, at most, comment.
For practice-based subjects (the `budo` label is the obvious case) the most useful thing a
student can produce is a recording of themselves executing what the topic teaches — and there
is nowhere to put it.

| Case | Today | This RFC |
|---|---|---|
| Student records a kata on their iPhone and wants to post it | Sends it by WhatsApp; lost in a chat | Uploads the `.mov` as-is from the phone to the topic |
| Student labels what the video shows ("2nd attempt, left side") | — | Title + description, editable after upload |
| Student posted a video under the wrong topic | — | Moves it to the right topic, no re-upload |
| Student compares this month's recording with last month's | Scrolls a chat history | Their submissions on the topic page, newest first; "My demonstrations" across topics |
| Instructor follows how a student progresses on a technique | Asks the student to resend | Staff see every submission on the topic, and every submission by a student in the user backoffice |
| A good demonstration could help classmates | — | Author shares it; it appears under *Class demonstrations* |
| A shared upload is inappropriate | — | Staff force-unshare; an admin removes it, the author sees why |
| Photo of a hand-written exercise, or a PDF worksheet | — | Same flow, image or PDF instead of video |

Why a submission is not a comment or note attachment: comments are public and append-only; a
note is one editable Markdown text per topic, and RFC 0016 lists media attachments as a
non-goal. A submission is a **file with metadata**, many per topic, with its own storage
lifecycle — a different entity.

## Goals & Non-Goals

**Goals**
- A student with read access to a published topic uploads **several** submissions to it, each
  one file — `video/mp4`, **`video/quicktime`**, `image/jpeg|png|webp`, `application/pdf` —
  with a title and an optional description, directly from a phone's camera roll.
- The author edits title, description and visibility, deletes the submission (file included),
  and **moves one or several submissions to another topic** they can read.
- A submission is `private` (author + staff) or `shared` (+ every student who can read the
  topic). Private by default; the UI names the audience in plain words.
- Staff (`admin`, `content_creator`) see every submission — per topic and per student — and can
  force-unshare. `admin` can remove one; its author then sees *"Removed by the staff"*.
- Per-topic count, per-student storage and per-file video size are **environment variables**
  (`SUBMISSIONS_PER_TOPIC_MAX` = 10, `SUBMISSIONS_STORAGE_PER_STUDENT_BYTES` = 1 GiB,
  `SUBMISSIONS_VIDEO_MAX_BYTES`), set per label and environment in `wrangler.jsonc`.
- The API re-verifies the **stored** object — size, declared type and file signature — at
  finalize, since the uploader is no longer trusted staff.
- Abandoned uploads (`pending` rows and their objects) are swept automatically.
- A student upload **never** appears in the topic's course media (`GET /v1/topics/{id}`).
- Topic access is enforced exactly as the catalog does — published, not archived, in the
  caller's effective access set — and a miss is `404`.

**Non-Goals**
- **Staff review of submissions** (a correction, a score, a "reviewed" status). The subject of
  the **next RFC**, decided 2026-09-29; this one ships the storage, privacy and management model
  it will build on.
- **Server-side transcoding** or thumbnails. Files are stored and served as uploaded; poster
  frames come from `<video preload="metadata">`. See Alternatives §8 for when transcoding
  becomes worth it.
- **Copying** a submission to a second topic (it would duplicate storage). Move only.
- **Moving by staff.** Only the author moves their submissions.
- **Several files per submission** (Alternatives §3).
- **XP, quests or badges** for submitting — consistent with RFC 0016's decision for notes.
- **Tutor powers.** A `tutor` sees submissions as a student does (as in RFC 0016).
- **Comments or likes on shared submissions**, **in-browser recording** (`MediaRecorder`),
  **notifications** to staff.
- **`video/quicktime` for backoffice media.** Course media keeps its table; the importer's
  `.mov → .mp4` conversion path is unchanged.

## Current State (for reference)

**1. The media lifecycle exists, but only for staff.** `apps/api/src/routes/admin/topics.ts`
exposes `POST /v1/admin/topics/{topicId}/media/presign` → client `PUT` to R2 →
`POST …/media/{mediaId}/finalize`, behind `requireRole(ADMIN, CONTENT_CREATOR)`
(`routes/admin/index.ts:23`). Presign validates `contentType` against `ALLOWED_MEDIA_TYPES` and
size against `mediaSizeLimitFor` (`controllers/admin-media.controller.ts:77-117`); the presigned
PUT signs `ContentType` and `ContentLength` (`adapters/storage/r2-storage-adapter.ts:115-124`),
expiry 3600 s. The key is `topics/${topicId}/${uuid}-${sanitizeFileName(name)}`
(`admin-media.controller.ts:96-98`).

**2. Finalize checks existence, not size.** `finalize` (`admin-media.controller.ts:119-141`)
issues a `HeadObject` and marks the row `ready`; it never compares the stored length or looks at
the bytes. The event flyer finalize does check the length
(`controllers/admin-events.controller.ts:534-553`).

**3. `media` is course content by construction.** `0006_create_media.sql` gives each row one
`topic_node_id` and no notion of author role; `TopicsController.getPublishedById`
(`controllers/topics.controller.ts:54-84`) returns **every `ready` row** of the topic to every
reader, with a signed GET URL (TTL 3600 s). A student upload stored there would instantly become
course material for the whole class.

**4. `.mov` is rejected everywhere.** `ALLOWED_MEDIA_TYPES` (`packages/shared/domain/media/limits.ts:25-31`)
has `video/mp4` as its only video type; `scripts/media/convert-skipped.mjs` exists precisely to
remux or transcode `.mov` before import. An iPhone's camera roll delivers `video/quicktime`.

**5. Media is always served through signed GET URLs.** `R2_PUBLIC_BASE` is unused by media and
empty in most envs (`wrangler.jsonc:42`). Private student videos need exactly this.

**6. Nothing cleans up abandoned uploads.** The only `scheduled()` handler is daily billing
(`src/index.ts:44-52`).

**7. Nothing rate-limits uploads.** `KvRateLimiter` (`adapters/rate-limit/kv-rate-limiter.ts`)
is built only for login, register, activate, forgot-password and the events board
(`container.ts:153-159, 271-300`).

**8. Tunables live in `wrangler.jsonc` `vars`, per label and environment.** Each `env.*` block
(`wrangler.jsonc:36, 120, 161`) carries its own `vars` — the natural home for per-label quotas.

**9. The access gate to reuse.** `getPublishedById` answers `404` unless the topic is published,
not archived and in `getEffectiveAccessTopicIds` (`adapters/db/d1-enrollment-repository.ts:52-82`,
RFC 0005); `routes/topics.router.ts:26` already uses it for topic-scoped student endpoints.
`admin` and `content_creator` bypass it (`routes/public/catalog.topics.ts:73,85`).

**10. The topic page.** `apps/web/src/app/(protected)/catalog/[id]/page.tsx` renders
`TopicHeader`, `ContentSection`, `MediaList` (`components/catalog/MediaList/*`, with
`VideoStage`, `PdfStage`) and `Discussion`.

## Proposed Design

### 1. Schema (`0030_create_topic_submissions.sql`)

```sql
CREATE TABLE IF NOT EXISTS topic_submissions (
  id             TEXT PRIMARY KEY,
  topic_node_id  TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
  author_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',          -- sanitised Markdown, may be empty
  storage_key    TEXT UNIQUE,                       -- NULL once removed by staff
  original_name  TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,                  -- declared at presign, verified at finalize
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'ready', 'removed')),
  visibility     TEXT NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('private', 'shared')),
  shared_at      TEXT,
  moderated_at   TEXT,                              -- staff force-unshare; blocks re-sharing
  moderated_by   TEXT REFERENCES users(id),
  removed_at     TEXT,                              -- admin removal; row kept as a tombstone
  removed_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_topic_submissions_author ON topic_submissions (author_id, topic_node_id, status);
CREATE INDEX IF NOT EXISTS idx_topic_submissions_topic  ON topic_submissions (topic_node_id, status, visibility, shared_at);
CREATE INDEX IF NOT EXISTS idx_topic_submissions_sweep  ON topic_submissions (status, created_at);
```

- **Its own table, not `media`** — Current State §3. The course media query cannot see a
  submission whatever its status.
- **Author delete is a hard delete** (object, then row). **Admin removal is a tombstone**
  (object deleted, row kept with `status = 'removed'`) — §8.
- **`removed` rows are outside every quota** and every non-author, non-staff listing.

### 2. Storage layout

Key: `submissions/{authorId}/{uuid}-{sanitizeFileName(originalName)}`.

- **No topic id in the key.** A move (§6) is then a metadata-only `UPDATE`: no copy, no second
  object, no window where the file exists twice or not at all.
- **Author first** — everything a student uploaded is one prefix, which makes account deletion
  (§9) a single `deletePrefix`.
- **Separate from `topics/…`**, so course and student content can get different bucket-level
  rules later (e.g. retention).
- Built server-side; the client never chooses it. `sanitizeFileName` moves from
  `admin-media.controller.ts` to `packages/shared/utils/` for both controllers.
- Served only via `getPresignedDownloadUrl` (TTL 3600 s), never `R2_PUBLIC_BASE`; responses that
  carry URLs set `Cache-Control: private, no-store`.

### 3. Limits and configuration

**Types** — `packages/shared/domain/media/limits.ts` gains, in the same file that stays the
single source of truth:

```ts
export const SUBMISSION_MEDIA_TYPES = [...ALLOWED_MEDIA_TYPES, 'video/quicktime'] as const;
export const SUBMISSION_VIDEO_TYPES = ['video/mp4', 'video/quicktime'] as const;
```

Images and PDF keep their course limits (`mediaSizeLimitFor`: 5 MB / 25 MB). **Videos** use the
env var below, because a phone recording is larger than an edited course clip.

**Quotas are environment variables**, decided 2026-09-29:

| Var | Default | Meaning |
|---|---|---|
| `SUBMISSIONS_PER_TOPIC_MAX` | `10` | Pending + ready submissions per student per topic |
| `SUBMISSIONS_STORAGE_PER_STUDENT_BYTES` | `1073741824` (1 GiB) | Sum of pending + ready `size_bytes` per student, all topics |
| `SUBMISSIONS_VIDEO_MAX_BYTES` | `262144000` (250 MB) | Per-file limit for `video/mp4` and `video/quicktime` submissions |

- Declared in each `env.*.vars` block of `wrangler.jsonc` and in `.dev.vars.example`, so every
  label and environment sets its own. Defaults live in `domain/submissions/limits.ts` and apply
  only when a var is **absent**.
- `apps/api/src/core/submissions/config.ts` parses them with Zod (positive integers,
  `VIDEO_MAX ≤ STORAGE_PER_STUDENT`). A var that is **present but invalid** is not replaced by a
  default: submission endpoints answer `500 SUBMISSION_CONFIG_INVALID` and log the var name, and
  the deploy preflight of RFC 0007 rejects it before it ships.
- The web never hardcodes them: `GET /v1/me/submissions/quota?topicId=` returns the effective
  limits and the caller's usage, and the upload page preflights against that response.

`domain/submissions/limits.ts` also holds the text limits, which are not tunables:
`SUBMISSION_TITLE_MAX = 120` and `SUBMISSION_DESCRIPTION_MAX = 2_000` (characters, after
sanitisation).

### 4. The iPhone path (`video/quicktime`)

Decided 2026-09-29: a student must be able to post straight from an iPhone. What that takes:

- **Upload.** The file input accepts `video/quicktime` and `.mov`; presign and finalize accept
  it for submissions (§3). iOS converts HEIC photos to JPEG on upload when the `accept` list does
  not name HEIC, so photos need nothing extra.
- **Storage.** The `.mov` is stored byte-for-byte; no conversion runs in the Worker (it could
  not: a Worker has no `ffmpeg` and ~100 MB videos exceed its memory and CPU budget).
- **Playback.** iPhones record H.264 (*Most Compatible*) or HEVC (*High Efficiency*, the default).
  Safari plays both; Chrome and Edge play both on hardware with HEVC decoding (most machines from
  the last several years); Firefox's HEVC support is partial. The viewer therefore tries
  `<video>` first and, on a `MEDIA_ERR_SRC_NOT_SUPPORTED` error, replaces the player with
  *"This video can't be played in this browser"* and a **Download** button — the file is never
  inaccessible, at worst it opens outside the browser.
- **Why this was first proposed as a rejection**, for the record: `.mov` was outside the single
  limits table, the import tooling already converts it, and HEVC playback is not universal. The
  fallback above removes the only real cost, and staff watch mostly on devices that play HEVC.
- If the fallback turns out to be frequent, transcoding (Alternatives §8) is the follow-up.

### 5. Upload lifecycle

```
student                               API                                   R2
  │ POST …/submissions/presign ─────▶ gate topic (404) · rate limit (429)
  │   {fileName, contentType,          type/size vs §3 (400 / 422 FileTooLarge)
  │    sizeBytes, title,               quota: atomic INSERT pending (409 SUBMISSION_QUOTA)
  │    description?, visibility?}      ◀── 201 {submission, uploadUrl, expiresAt}
  │ PUT uploadUrl (XHR, progress) ─────────────────────────────────────────▶ object
  │ POST …/{sid}/finalize ──────────▶ HEAD: length == size_bytes, type == declared
  │                                   readHead(32 bytes): signature matches type
  │                                   ok → ready (200) · mismatch → delete object+row, 422
```

- **Metadata travels with presign**, so a finished upload is immediately a complete submission.
  `title` defaults client-side to the file name without extension.
- **Quota check and insert are one statement** (a separate check-then-write can interleave on
  D1 — the RFC 0016 pattern):

  ```sql
  INSERT INTO topic_submissions (id, topic_node_id, author_id, title, description,
                                 storage_key, original_name, content_type, size_bytes, visibility)
  SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
   WHERE (SELECT COUNT(*) FROM topic_submissions
           WHERE author_id = ?3 AND topic_node_id = ?2 AND status <> 'removed') < ?11
     AND (SELECT COALESCE(SUM(size_bytes), 0) FROM topic_submissions
           WHERE author_id = ?3 AND status <> 'removed') + ?9 <= ?12;
  ```

  `meta.changes = 0` → `409 SUBMISSION_QUOTA` with `meta: { reason: 'count' | 'storage', used, limit }`.
  Pending rows count, so fifty parallel presigns cannot slip past the limits.
- **Finalize verifies the stored object.** Length and type must match what was signed, and the
  first bytes must carry the type's signature: `ftyp` at offset 4 for MP4/QuickTime, `FF D8 FF`
  for JPEG, `89 50 4E 47` for PNG, `RIFF….WEBP` for WebP, `%PDF` for PDF. `readHead` is a ranged
  `GetObject` (`Range: bytes=0-31`) — the Worker never downloads the file. A mismatch deletes the
  object and the row and answers `422 UPLOAD_MISMATCH`. Finalize on a `ready` row is idempotent.
- **Author delete order: object, then row.** If the R2 delete throws, the row stays and the
  request answers `502`; the author retries. The reverse order leaves orphans no query can find.

### 6. Moving submissions between topics

Decided 2026-09-29 as a core feature.

`POST /v1/me/submissions/move` with `{ ids: string[1..10], targetTopicId }`.

- **Who and what.** Only the author; only `ready` submissions (pending and removed ones are
  refused per item). The **target** must be readable by the caller (else the whole request is
  `404`); the **source** need not be — moving is how a student rescues submissions from a topic
  they lost access to.
- **Metadata only.** The key has no topic id (§2), so a move is an `UPDATE` of
  `topic_node_id`. Storage usage is unchanged; the per-topic count is checked on the target.
- **Atomic per item, sequential across items.** The controller sends one conditional `UPDATE`
  per id in a single `db.batch` (D1 runs a batch's statements in order, in one transaction), so
  each sees the counts left by the previous one:

  ```sql
  UPDATE topic_submissions
     SET topic_node_id = ?1, visibility = 'private', shared_at = NULL, updated_at = datetime('now')
   WHERE id = ?2 AND author_id = ?3 AND status = 'ready' AND topic_node_id <> ?1
     AND (SELECT COUNT(*) FROM topic_submissions
           WHERE author_id = ?3 AND topic_node_id = ?1 AND status <> 'removed') < ?4;
  ```

  The response is `200 { moved: Submission[], refused: [{ id, reason: 'quota' | 'not_found' | 'not_ready' | 'same_topic' }] }`
  — partial success is normal (e.g. 3 selected, 2 slots free on the target).
- **A move resets visibility to `private`.** A shared submission's audience is the source
  topic's readers; the target's are different people. Moving must not publish a video to a new
  audience silently, so the student re-shares on the target if they want. The UI says so in the
  move dialog.
- **Moderation travels with the file.** `moderated_at` is kept, so a moved submission still
  cannot be re-shared until staff clear it.

### 7. Access rules

"Staff" = `admin` or `content_creator`; `tutor` = student. "T readable" = published, not
archived, in the effective access set; any miss is `404`. Staff bypass the access check. All
rules live in `SubmissionsController`.

| Action | Author | Other student | `content_creator` | `admin` |
|---|---|---|---|---|
| Upload to T | ✅ if T readable | — | — | — |
| Read a **private** submission | ✅ | ❌ `404` | ✅ read-only | ✅ read-only |
| Read a **shared** submission | ✅ | ✅ if T readable | ✅ | ✅ |
| List on T | own (all statuses) + shared | shared | all ready + removed | all ready + removed |
| Edit title / description / visibility | ✅ (share blocked if moderated: `409 SUBMISSION_MODERATED`) | ❌ `404` | ❌ `403` | ❌ `403` |
| Move to another topic | ✅ (§6) | ❌ `404` | ❌ `403` | ❌ `403` |
| Delete | ✅ hard delete | ❌ `404` | ❌ `403` | ✅ **remove** → tombstone (§8) |
| Force-unshare / clear moderation | — | — | ✅ | ✅ |
| List every submission by one student | — | — | ✅ | ✅ |

- **Pending rows are visible only to their author**, so the UI can resume or discard them.
- **Losing access to T** does not take uploads away: "My demonstrations" still lists them with
  `topicAccessible: false` — read-only except delete and **move** (§6). They leave the gallery.
- **Sharing is a deliberate act**, confirmed with a line saying classmates will see the file
  **with the author's name** — a video of a person is more identifying than a note.

### 8. Moderation, removal and the tombstone

- **Force-unshare** (`POST /v1/admin/submissions/{id}/unshare`, both staff roles) sets
  `visibility = 'private'`, `moderated_at`, `moderated_by`. The author keeps the file privately
  and cannot re-share until staff clear the flag (`DELETE /v1/admin/submissions/{id}/moderation`).
  Same semantics as RFC 0016 notes.
- **Remove** (`DELETE /v1/admin/submissions/{id}`, `admin` only) is for content that must leave
  the platform, where unsharing is not enough. It deletes the object, then sets
  `status = 'removed'`, `removed_at`, `removed_by`, `storage_key = NULL`, `description = ''`,
  `visibility = 'private'`. If the object delete fails the row is untouched and the call answers
  `502`.
- **The author sees a tombstone** (decided 2026-09-29): the card keeps the title and date and
  shows *"Removido pela equipe" / "Removed by the staff"*, with no player and no actions except
  **Dismiss**, which hard-deletes the row. A tombstone is outside every quota, never appears to
  classmates, and cannot be moved, edited or shared.
- Staff lists show tombstones with who removed them and when — the only audit trail of a
  removal, since the file is gone.

### 9. Abandoned uploads and account deletion

- **Sweep.** `sweep-pending-submissions` runs from the existing daily `scheduled()` handler (no
  new cron). For each `pending` row older than 24 h (the presigned PUT expires after 1 h), it
  deletes the object if present, then the row, in batches of 100, and logs a count — never file
  names.
- **Account deletion.** `ON DELETE CASCADE` removes rows on a user hard-delete but not objects;
  the hard-delete path also calls `storage.deletePrefix('submissions/{userId}/')`
  (`ListObjectsV2` + `DeleteObjects` in pages of 1 000).

### 10. HTTP surface

Mounted like comments/notes — `buildSubmissionsRouter` at `v1.route('/', …)`, behind `authGuard`.

| Method & path | Who | Purpose | Success / errors |
|---|---|---|---|
| `GET /v1/topics/{id}/submissions?cursor=` | any | Author: own (all statuses) + shared. Students: shared. Staff: all ready + removed. Newest first, page 20 | `200 { data, nextCursor }` |
| `POST /v1/topics/{id}/submissions/presign` | student | Create pending + presigned PUT | `201` · `400` · `409 SUBMISSION_QUOTA` · `422 FileTooLarge` · `429` |
| `POST /v1/topics/{id}/submissions/{sid}/finalize` | author | Verify object, mark ready | `200` · `422 NotUploaded` · `422 UPLOAD_MISMATCH` |
| `PATCH /v1/topics/{id}/submissions/{sid}` | author | `{ title?, description?, visibility? }` | `200` · `409 SUBMISSION_MODERATED` |
| `DELETE /v1/topics/{id}/submissions/{sid}` | author | Delete (pending, ready) or dismiss a tombstone | `204` · `502` |
| `GET /v1/me/submissions?cursor=` | student | All own submissions across topics, with topic title and `topicAccessible` | `200 { data, nextCursor }` |
| `GET /v1/me/submissions/quota?topicId=` | student | Effective limits (§3) and the caller's usage | `200 { limits, usage }` |
| `POST /v1/me/submissions/move` | student | Move up to 10 own submissions to a topic (§6) | `200 { moved, refused }` · `404` |
| `GET /v1/admin/users/{userId}/submissions?cursor=` | staff | Every ready or removed submission by that student | `200 { data, nextCursor }` |
| `POST /v1/admin/submissions/{id}/unshare` | staff | Force-unshare | `200` |
| `DELETE /v1/admin/submissions/{id}/moderation` | staff | Clear moderation | `204` |
| `DELETE /v1/admin/submissions/{id}` | `admin` | Remove → tombstone | `204` · `502` |

- `PresignSubmissionSchema`: `fileName ≤ 255`, `contentType: z.enum(SUBMISSION_MEDIA_TYPES)`,
  `sizeBytes`, `title` (1…120 after trim), `description` (`sanitizeMarkdown`, ≤ 2 000),
  `visibility` (default `private`).
- **Edits are last-write-wins**, unlike notes: no autosave, an explicit *Save*, three short
  fields (Alternatives §5).
- **Rate limit**: a `KvRateLimiter` keyed by user id, prefix `rl:submissions:`, 30 presigns per
  hour, on `presign` only — it bounds upload/delete churn that a quota (a level, not a rate)
  does not.
- Cursors reuse the helper RFC 0016 introduces in `routes/_shared/`; whichever lands first adds it.

### 11. Ports & adapters

```ts
export interface ISubmissionRepository {
  findById(id: string): Promise<SubmissionRecord | null>;
  /** Quota-guarded insert of §5; null when a quota refused it. */
  createPending(p: CreatePendingSubmission, q: SubmissionQuota): Promise<SubmissionRecord | null>;
  usage(authorId: string, topicNodeId?: string): Promise<{ topicCount: number; bytes: number }>;
  markReady(id: string): Promise<SubmissionRecord>;
  updateMeta(id: string, patch: SubmissionMetaPatch): Promise<SubmissionRecord>;
  /** Batched conditional moves of §6, in order. */
  move(authorId: string, ids: string[], targetTopicId: string, perTopicMax: number): Promise<MoveResult>;
  delete(id: string): Promise<void>;
  markRemoved(id: string, adminId: string): Promise<SubmissionRecord>;
  listByTopic(topicNodeId: string, opts: { viewerId: string; scope: 'student' | 'staff'; page: CursorPage }): Promise<Paged<SubmissionRecord>>;
  listByAuthor(authorId: string, opts: { scope: 'self' | 'staff'; page: CursorPage }): Promise<Paged<AuthoredSubmissionRecord>>;
  setModeration(id: string, staffId: string | null): Promise<SubmissionRecord | null>;
  listStalePending(olderThanHours: number, limit: number): Promise<SubmissionRecord[]>;
}
```

`IStorageAdapter` gains `readHead(key, bytes)` (ranged GET) and `deletePrefix(prefix)`. `scope`
is decided by the controller from roles, never from the request. Instantiated per request in the
container's `engagement` slice, next to `commentRepo` and RFC 0016's `noteRepo`; the parsed
`SubmissionConfig` is built per request from `env` like every other binding.

### 12. Web surface

Decided 2026-09-29: the topic page gets **a button**, and the upload happens on **a new page**.

- **Topic page** (`(protected)/catalog/[id]`): a **Minhas demonstrações / My demonstrations**
  button in the topic header area, with a count badge of the student's ready submissions on the
  topic. For staff the same button reads **Demonstrações dos alunos / Student demonstrations**.
  The topic page renders nothing else of this feature, so it stays as light as today.
- **Submissions page** (`(protected)/catalog/[id]/submissions`), the student's area for the
  topic:
  - **Header**: breadcrumb back to the topic, the quota line *"3 of 10 on this topic · 420 MB of
    1 GB used"* (from `/me/submissions/quota`), and the **Enviar demonstração / Send a
    demonstration** button (sticky at the bottom on mobile).
  - **Upload form**: file input (`accept` from `SUBMISSION_MEDIA_TYPES` plus `.mov`; on a phone
    the OS offers camera or library), title prefilled from the file name, description (Markdown,
    with a counter), and the visibility switch with the audience line — *"Private: only you and
    the staff (admins and content creators) can see it."* Type, size and remaining quota are
    checked **before** presign, so a file over the limit is refused with its limit before a byte
    is sent. The PUT uses `XMLHttpRequest` for a progress bar, with **Cancel** (aborts the PUT,
    then `DELETE`s the pending row). An interrupted upload shows as *Upload interrupted* with
    **Discard**; the sweep removes it after 24 h anyway.
  - **My demonstrations**: cards newest first — poster frame / thumbnail / PDF icon, title,
    description excerpt, date, size, visibility and moderation badges. Clicking opens the
    existing viewers (`VideoStage` with the §4 fallback, `PdfStage`, image viewer). Card menu:
    **Edit**, **Move to another topic**, **Delete**. A **Select** mode enables moving several at
    once. Tombstones render as in §8.
  - **Move dialog**: a topic picker over the student's readable topics (the catalog tree the
    page already has access to), showing each target's free slots; states that the moved items
    become private. After the call it reports moved and refused items with the reason.
  - **Class demonstrations**: the shared submissions of the topic, with author names — the
    topic's "section of student videos". Hidden when empty.
  - **Staff view** of the same route: every ready and removed submission, grouped by student,
    with badges and **Unshare**, **Allow sharing again** and (admin) **Remove**. No upload
    button, no editor on someone else's submission.
- **"My demonstrations" across topics** (`(protected)/submissions`): the student's submissions
  grouped by topic, with the same card actions (move included) and a link to each topic's page;
  rows on topics they lost access to explain why they are read-only.
- **User backoffice** (`(protected)/admin/users/[userId]`): a *Submissions* section with that
  student's submissions grouped by topic and the same staff actions.
- **i18n**: a `submissions:` section in both dictionaries, identical keys;
  `check-i18n-coverage.js` stays green.

## Alternatives Considered

1. **Store submissions in `media` with a `kind` column.** Rejected. Every reader of `media` —
   the catalog topic payload, the admin media list, the importer's reconciliation — would need a
   new filter, and one forgotten filter publishes a student's private video to the class. A
   separate table makes the leak impossible rather than prevented.
2. **Attach files to RFC 0016 notes.** Rejected. A note is one autosaved text per topic;
   submissions are many files per topic with an upload lifecycle, quotas and moves.
3. **Several files per submission** (front and side angles of one take). Deferred, not rejected:
   needs a child table and a multi-file uploader; a later `submission_files` table can adopt
   existing rows as single-file submissions.
4. **Private-only submissions (no sharing).** Not chosen: the product owner asked for a section
   of student videos on the topic, which only sharing provides. Private default, explicit
   confirmation and staff moderation bound the risk.
5. **Revision-checked edits like notes.** Rejected for this entity: notes autosave and collide
   routinely across tabs; submission metadata changes on an explicit Save of three short fields.
6. **Upload through the Worker** (multipart body to the API). Rejected: Worker request size and
   CPU limits make 250 MB bodies impractical, and it would fork the platform's one upload path.
7. **Public R2 URLs for shared submissions.** Rejected: a shared submission is still restricted
   to the topic's readers; a public URL is forwardable forever.
8. **Transcode every upload to MP4/H.264** (Cloudflare Stream, or an `ffmpeg` job outside the
   Worker). Deferred, not rejected. It would give universal playback and smaller files, but adds
   a paid service or a new runtime to operate. Worth it if the §4 fallback proves frequent; the
   `storage_key` column can then point at the derived file without an API change.
9. **Reject `.mov` and ask students to export MP4.** The first draft's recommendation;
   **rejected on 2026-09-29** by the product owner — posting straight from an iPhone is a
   requirement (§4).
10. **Keep the topic id in the storage key and copy the object on move.** Rejected: a copy
    doubles storage until the delete lands, can fail halfway, and gains nothing — the key is
    never shown to anyone.
11. **Keep a moved submission's visibility.** Rejected: it would silently publish a video to a
    different class. Resetting to private costs one click to re-share.
12. **Quotas as constants in `packages/shared`.** The first draft's design; **replaced on
    2026-09-29** by environment variables so each label and environment sets its own without a
    code change.
13. **Submission area as tabs inside the topic page.** The first draft's design; **replaced on
    2026-09-29** by a button leading to a dedicated page, which keeps the topic page light and
    gives upload, management and moving the room they need on a phone.

## Implementation Plan

Total: **~7–8 dev days**, one milestone, backend and frontend tasks kept separate. Independent
of RFC 0016 except for the shared cursor helper.

### Phase 0 — Shared foundations (~0.5 d)
`Entities.Engagement.Submission`, `Config.SubmissionStatus`, `SUBMISSION_MEDIA_TYPES`,
`domain/submissions/limits.ts`, `ISubmissionRepository`, `IStorageAdapter.readHead` and
`deletePrefix`, `sanitizeFileName` moved to shared.

### Phase 1 — Config, schema and repository (~1.5 d)
`core/submissions/config.ts` with its tests (absent → default, invalid → error); `SUBMISSIONS_*`
in `wrangler.jsonc` for every env and in `.dev.vars.example`; migration `0030`;
`D1SubmissionRepository` with the quota-guarded insert and the batched move; Workers-pool tests
including two concurrent presigns at the quota edge (exactly one succeeds) and a move of 3 items
into a topic with 2 free slots (2 moved, 1 refused).

### Phase 2 — Student API and upload lifecycle (~2 d)
`SubmissionsController`; presign / finalize (length, type, signature) / patch / delete; move;
quota endpoint; topic listing and `GET /v1/me/submissions`; per-user rate limiter; the access
table of §7 as tests; proof that `GET /v1/topics/{id}` never contains a submission; a real
QuickTime fixture passing finalize and a renamed text file failing it.

### Phase 3 — Staff API, tombstone, sweep, account deletion (~1 d)
`/v1/admin/users/{userId}/submissions`, unshare / clear moderation (both staff roles), remove
→ tombstone (admin only); sweep wired into `scheduled()`; `deletePrefix` on user hard-delete;
OpenAPI schemas and regenerated `api-types.gen.ts`.

### Phase 4 — Web (~2.5–3 d)
`submissions-api.ts` (XHR PUT with progress and abort); topic-page button; submissions page
(upload form with preflight against the quota endpoint, cards, edit, delete, tombstones, move
dialog and select mode, class gallery, staff view); `.mov` playback fallback; "My
demonstrations" page; backoffice section; dictionaries in both languages; component tests for
preflight rejection, cancel, interrupted upload, move with partial refusal, and the playback
fallback.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| A student's private video leaks into course content | Separate table and key prefix; a Phase 2 test asserts the topic payload never includes a submission |
| An HEVC `.mov` does not play in a given browser | Fallback message + Download (§4); transcoding is the deferred follow-up (Alternatives §8) |
| A file lies about its type (a script renamed `.mp4`) | Finalize checks the file signature on the first 32 bytes; mismatches are deleted |
| Students assume "private" means nobody else sees it | Audience line names staff explicitly, in the form and on each card |
| Moving publishes a video to a new class | A move resets visibility to private and the dialog says so |
| Abusive or illegal content | Staff force-unshare immediately; admin removal deletes the object and leaves only a tombstone |
| Storage cost grows with every student | Env-configured per-topic count and per-student quota; pending counts; sweep removes abandoned uploads |
| A misconfigured quota var silently falls back to a default | Present-but-invalid is an error (`500 SUBMISSION_CONFIG_INVALID`), caught first by the RFC 0007 preflight |
| Upload/delete loops churn R2 operations | 30 presigns/hour per user (`rl:submissions:`) |
| Large phone videos on slow mobile networks | Progress bar, cancel, retry re-presigns; 250 MB per-file default is tunable per label; multipart upload deferred |
| Hard-deleted user leaves orphaned objects | Author-first key prefix + `deletePrefix` on hard delete |
| R2 delete fails while deleting or removing | Object deleted before the row changes; failure answers `502` and the action is retried |
| Migration number collides with RFC 0015/0016 | `0030` chosen; whichever lands out of order renumbers, noted in **Affected** |

## Success Criteria

- (Ph 1) With `SUBMISSIONS_PER_TOPIC_MAX` absent the limit is 10; set to `3` it is 3; set to `abc`
  every submission endpoint answers `500 SUBMISSION_CONFIG_INVALID`.
- (Ph 1) Two concurrent presigns at the per-topic limit − 1 produce one `201` and one
  `409 SUBMISSION_QUOTA`; a presign crossing 1 GiB of total usage is refused.
- (Ph 2) A student uploads an iPhone `.mov`, an MP4, an image and a PDF to a readable topic and
  each becomes `ready`; a draft, archived or out-of-access topic answers `404` at presign.
- (Ph 2) A finalize whose stored object differs in size, type or signature returns
  `422 UPLOAD_MISMATCH` and leaves neither row nor object.
- (Ph 2) Moving 3 submissions into a topic with 2 free slots moves 2, refuses 1 with `quota`,
  and every moved submission is private; the file in R2 is untouched.
- (Ph 2) Another student gets `404` for someone else's private submission through every
  endpoint and never sees pending rows or tombstones.
- (Ph 2) `GET /v1/topics/{id}` returns the same media before and after students upload.
- (Ph 3) Both staff roles read every submission on a topic and by a student and force-unshare;
  only `admin` removes; after removal the object is gone, the author sees *"Removed by the
  staff"* and the quota is freed; students and tutors get `403` on every admin route.
- (Ph 3) A pending row older than 24 h and its object are gone after the scheduled run.
- (Ph 4) On an iPhone, a student taps *My demonstrations* on a topic, records or picks a video,
  uploads it with a visible progress bar, titles it, and later moves it to another topic; a file
  over its limit is refused before upload; the flow works in `pt` and `en` builds and the i18n
  coverage check passes.

## Open Questions

1. **Per-label switch for sharing.** Should a label (tenant — `arenaquest`, `spaziord`, `budo`)
   be able to turn sharing off, so every submission stays private between student and staff —
   e.g. a school whose students are minors? It would be one more env var
   (`SUBMISSIONS_SHARING_ENABLED`, default `true`) next to the quotas. Recommendation: include it,
   it is a few lines. *Owner: product owner.*
2. **Per-file video default.** 250 MB covers roughly 3–4 min of iPhone 1080p HEVC video, or
   ~2 min of H.264. Confirm the default (it is tunable per label either way). *Owner: product
   owner.*

## Resolved Decisions

- **2026-09-29 — Staff review is the next RFC** (product owner). Removed from this one; listed as
  a non-goal.
- **2026-09-29 — iPhone `.mov` must upload as-is** (product owner). Accepted for submissions,
  stored unconverted, with a playback fallback (§4). Replaces the first draft's rejection.
- **2026-09-29 — Admin removal leaves a *"Removed by the staff"* tombstone** (product owner) (§8).
- **2026-09-29 — Quotas: 10 per topic, 1 GiB per student, set by environment variables**
  (product owner) (§3).
- **2026-09-29 — A button on the topic page leads to a dedicated upload/management page**
  (product owner) (§12). Replaces the first draft's in-page tabs.
- **2026-09-29 — Moving submissions between topics is a core feature** (product owner) (§6).
- **2026-09-29 — Renumbered from 0017 to 0020** (product owner), to stay clear of numbers
  in use on other branches.

## References

- Relevant code: `apps/api/src/controllers/admin-media.controller.ts:77-154` (lifecycle to
  mirror), `apps/api/src/controllers/admin-events.controller.ts:534-553` (stored-size check
  precedent), `apps/api/src/adapters/storage/r2-storage-adapter.ts:115-143`,
  `apps/api/migrations/0006_create_media.sql`, `packages/shared/domain/media/limits.ts`,
  `apps/api/src/controllers/topics.controller.ts:54-84` (access gate, course media payload),
  `apps/api/src/adapters/db/d1-enrollment-repository.ts:52-82`,
  `apps/api/src/adapters/rate-limit/kv-rate-limiter.ts`, `apps/api/src/index.ts:44-52`
  (`scheduled()`), `apps/api/wrangler.jsonc` (per-env `vars`),
  `scripts/media/convert-skipped.mjs` (today's `.mov` handling for course media),
  `apps/web/src/app/(protected)/catalog/[id]/page.tsx`,
  `apps/web/src/components/catalog/MediaList/*`
- Related RFCs: RFC 0016 (student notes — visibility vocabulary, moderation semantics, cursor
  helper), RFC 0005 (effective access set), RFC 0007 (deployment preflight — validates the new
  vars), RFC 0003 (route organisation and OpenAPI), RFC 0004 (catalog redesign — the topic page
  this extends)
