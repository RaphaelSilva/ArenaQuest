# RFC 0023: Media acknowledgment — read and watched marks as mission evidence

**Date:** 2026-10-11
**Status:** Draft
**Author:** raphaelsilva
**Affected:**
- `apps/api/migrations/0033_create_media_acknowledgments.sql` (new — `media_acknowledgments`; the number follows `0032_create_job_runs.sql` on `main` and is confirmed when the migration is written. No statement touches `media`, `topic_nodes`, `topic_progress` or `xp_events`)
- `packages/shared/types/entities.ts` (`Entities.Content.MediaAcknowledgment`, `MediaAcknowledgmentKind`)
- `packages/shared/domain/media/acknowledgment.ts` (new — the media *family* of a MIME type, `video` · `pdf` · `image`, read by API and web alike)
- `packages/shared/ports/i-media-acknowledgment-repository.ts` (new), `packages/shared/ports/index.ts`
- `apps/api/src/adapters/db/d1-media-acknowledgment-repository.ts` (new), `apps/api/src/container.ts` (wiring in the content slice)
- `apps/api/src/controllers/media-acknowledgments.controller.ts` (new — catalog gate, media checks, write-once)
- `apps/api/src/routes/media-acknowledgments.router.ts` (new — `POST /v1/topics/{id}/media/{mediaId}/acknowledge`, `GET /v1/topics/{id}/media/acknowledgments`, `@hono/zod-openapi`), `apps/api/src/routes/index.ts` (mount)
- `apps/api/src/routes/topics.router.ts` (the existing watched route also writes an `auto` acknowledgment; its response is unchanged)
- `packages/shared/domain/missions/requirements.ts` (new kind `media_viewed`), `packages/shared/domain/gamification/mission-evaluator.ts` (new signal `media_acknowledged`, candidate lookup), `packages/shared/ports/i-mission-evidence-repository.ts` (`EvidenceCount.target` for the dynamic target), `apps/api/src/adapters/db/d1-mission-evidence-repository.ts` (counting SQL), `apps/api/src/core/missions/hook.ts` (log ids)
- `apps/api/src/openapi/components/entities.ts` (new schemas)
- `apps/web/src/components/catalog/MediaList/MediaList.tsx` (checked state, the control, the per-topic counter), `apps/web/src/app/(protected)/catalog/[id]/page.tsx` (loads the caller's acknowledgments), `apps/web/src/lib/topics-api.ts` (`acknowledgeMedia`, `listMediaAcknowledgments`)
- `apps/web/src/components/missions/RequirementEditor.tsx`, `step-target.ts`, `use-topic-media-stats.ts` (the `media_viewed` step in the admin editor and in the student step labels)
- `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (new `catalog.mediaAck` keys and `media_viewed` labels, identical keys)
- `scripts/demo/dataset/base.json` (optional — one demo acknowledgment and one `media_viewed` step, RFC 0021)

---

## Summary

Give every student a **per-user, per-media acknowledgment** — "I read this", "I watched this" —
stored once in a new `media_acknowledgments` table. A student ticks a material in the topic viewer
(`manual`); a video the player sees through to the end ticks itself (`auto`), through the watched
route that already exists. The topic shows how many of its materials the student has acknowledged,
and missions gain a `media_viewed` requirement kind, counted from that table, so a mission step can
ask for a topic's documents and images — not only its videos — to be read. Today only videos leave
any trace, only automatically, and only as an XP ledger row; this RFC turns "the student went through
the material" into a domain fact. Every product decision it raises — XP, undo, the video double check,
the meaning of "all", topic completion, staff reporting — is listed in *Open Questions* for the
product owner; the design below is written so each answer changes a parameter, not the shape.

## Motivation

The product owner, during the M27 preview walkthrough (2026-10-11), in substance: *inside a topic,
when it shows an image or a document, I cannot say that I read it or finished it. For video I can,
because the player knows it started and ended. For documents I need an input from the user saying
the media was read, or observed. Even for video a double check would be welcome.*

| Case | Today | Covered by this RFC? |
|---|---|---|
| Student finishes a video | `VideoStage` reports at 90 % / `ended` → `xp_events` row `video:<mediaId>:v1` (only when gamification is on) | ✅ also writes an `auto` acknowledgment |
| Student reads a PDF | Opens or downloads it through a link; nothing is recorded but the topic visit | ✅ `manual` acknowledgment |
| Student looks at an image | Opens it through a link; nothing is recorded but the topic visit | ✅ `manual` acknowledgment |
| Student wants to confirm a video by hand ("double check") | No control | ✅ the same control, semantics in Open Question 3 |
| A topic shows "3 / 5 materials" for the student | No per-media state exists | ✅ |
| A mission step "read the materials of topic X" | Only `video_watched` (videos) and `topic_visited` (any visit) exist | ✅ `media_viewed` |
| Tenant with `GAMIFICATION_ENABLED=false` keeps a watch record | No — the XP engine writes nothing | ✅ the acknowledgment does not depend on gamification |
| Acknowledging everything completes the topic | `POST /v1/me/topics/{id}/complete` has no UI | ❓ Open Question 7 |

## Goals & Non-Goals

**Goals**
- One write-once record per `(user, media)`, for every ready media type the catalog shows, with the
  instant and whether it came from the player (`auto`) or from the student (`manual`).
- A manual acknowledgment route behind the catalog gate, idempotent, `404` on any miss.
- The existing watched route also records an `auto` acknowledgment, with no change to its response
  or its XP.
- A persistent checked state on each media row and a per-topic counter in the viewer.
- A `media_viewed` mission requirement kind (count or all, optional media families), evaluated by
  the M27 engine with hooks and reconciliation, like every other kind.

**Non-Goals**
- **Changing what completes a topic.** The dormant `POST /v1/me/topics/{id}/complete` keeps having
  no UI here; wiring it to acknowledgments is Open Question 7 and, if accepted, its own change (RFC
  0022 Alternative 5 already deferred topic completion to a topic-level decision).
- **Measuring reading.** No scroll depth, time-on-page or embedded PDF viewer (Alternative 4).
- **Audio uploads.** `AudioStage` exists, but `audio/*` is not in `ALLOWED_MEDIA_TYPES`
  (`packages/shared/domain/media/limits.ts:24-30`); the `audio` family is added to this RFC's type
  filter in the same change that allows the upload type.
- **A cross-topic "my reading history" page** (`/v1/me/...`). The per-topic read is enough for the
  viewer and the mission engine; a history page can follow on demand.
- **Retro-dating.** Existing `xp_events` video rows are not copied into the new table (Tradeoffs).
- **Reworking the watched route into `@hono/zod-openapi`.** It stays a plain Hono route with its
  current contract; the new routes use `createRoute`.

## Current State (for reference)

**1. The viewer.** `apps/web/src/components/catalog/MediaList/MediaList.tsx` renders one collapsible
row per media (`:87-181`). Expanding a row calls `onVisitTopic` (`:59-66`), which the topic page
binds to `client.topics.visit(id)` → `POST /v1/me/topics/{id}/visit`
(`apps/web/src/app/(protected)/catalog/[id]/page.tsx:166-178`). Videos mount `VideoStage`, PDFs
`PdfStage` (download and "open in new tab" links only — no embedded viewer,
`PdfStage.tsx:43-59`), audio `AudioStage`; everything else, images included, is a plain link
labelled *Document* (`MediaList.tsx:28-34, 170-176`). No row carries any per-user state.

**2. Watched videos.** `VideoStage.tsx:4-55` fires `onWatched` once per mounted video at 90 % of the
duration or on `ended` (M27 Task 01); `MediaList` de-duplicates per page view (`:47-49, 72-76`); the
page calls `markVideoWatched` (`topics-api.ts:69-75`, a swallowed beacon) →
`POST /v1/topics/{id}/videos/{videoId}/watched` (`apps/api/src/routes/topics.router.ts:19-73`). The
route checks the topic through the catalog gate (`:26-30`, `TopicsController.getPublishedById`,
`topics.controller.ts:54-65` — not published, archived or outside the access set → `404`), then
awards `video_watched` (50 XP, `xp-config.ts:14`) keyed `video:<videoId>:v1`
(`xp-engine.ts:22-25`), records streak activity, runs the quest and badge engines, and fires the
mission hook `video_watch` (`:70`). **It does not check that `videoId` is a ready video of the
topic** — only the mission evaluator does (`mission-evaluator.ts:171-175`, through
`MissionContextResolver.isReadyVideoOfTopic`, `container.ts:276-284`). When
`GAMIFICATION_ENABLED=false` (`container.ts:343-346`) the XP engine writes nothing, so the watch
leaves no trace at all.

**3. Documents, images, audio.** No per-user, per-media record exists. The only trace of a
student's contact with them is `topic_progress` (`0010_create_progress_tables.sql:5-16`), one row
per `(user, topic)`, written by the visit.

**4. Mission evidence (RFC 0022, M27).** Requirement kinds live in
`packages/shared/domain/missions/requirements.ts:9-23`; `video_watched` takes `{ minCount }`
(`:51`), and `targetCountOf` is static per step (`:116-120`). Evidence for `topic_visited` and
`video_watched` is captured by the evaluator into `mission_evidence (requirement_id, user_id,
ref_id, occurred_at, source)` (`0031_create_mission_requirements.sql:77-85`) on each hook signal
while the step is open (`mission-evaluator.ts:195-209`), because their sources keep no usable
history; `submissions_on_topic` is counted directly from `topic_submissions`
(`d1-mission-evidence-repository.ts:58-74`). The counting statement binds the target as `?7`
(`:172-196`). Reconciliation backfills `video_watched` evidence from `xp_events`
(`d1-mission-participation-repository.ts:143-170`) — so a tenant without gamification cannot backfill
videos either.

**5. Media rows and their lifecycle.** `media (id, topic_node_id, type, status, …)`
(`0006_create_media.sql`); deletion is a soft delete to `status = 'deleted'`
(`d1-media-repository.ts:107-112`), and a ready media can be moved to another topic by staff
(`admin-media.controller.ts:154-175`, `d1-media-repository.ts:91-103`) — only `topic_node_id`
changes.

## Proposed Design

### 1. The record: `media_acknowledgments`

```sql
-- 0033_create_media_acknowledgments.sql
CREATE TABLE IF NOT EXISTS media_acknowledgments (
  user_id         TEXT NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  media_id        TEXT NOT NULL REFERENCES media(id)       ON DELETE CASCADE,
  topic_node_id   TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE, -- the topic it was acknowledged on
  kind            TEXT NOT NULL CHECK (kind IN ('auto', 'manual')),
  acknowledged_at TEXT NOT NULL DEFAULT (datetime('now')),                     -- 'YYYY-MM-DD HH:MM:SS' UTC
  PRIMARY KEY (user_id, media_id)
);
CREATE INDEX IF NOT EXISTS idx_media_ack_topic_user ON media_acknowledgments (topic_node_id, user_id);
CREATE INDEX IF NOT EXISTS idx_media_ack_media      ON media_acknowledgments (media_id);
```

- **One row per `(user, media)`, first write wins.** The write is
  `INSERT … ON CONFLICT (user_id, media_id) DO NOTHING`, and `meta.changes` tells the caller whether
  this request created it — the same conditional-write idiom as `mission_evidence` and
  `mission_enrollments` (`d1-mission-participation-repository.ts:17`). A later `auto` after a
  `manual` (or the reverse) changes nothing: the row keeps its first `kind` and instant.
- **Never deleted by the student** in this draft (no route deletes a row). Whether a manual tick can
  be undone is Open Question 2; if it can, the change is one `DELETE … WHERE kind = 'manual'` route,
  and the evaluator's write-once completion (RFC 0022 §3.5) already guarantees nothing it rewarded is
  taken back.
- **`topic_node_id` is context, not the counting key.** It records where the student acknowledged
  the material (for a staff report and for audit). Every count joins `media` and uses the media's
  **current** `topic_node_id` and `status`, as `video_watched` already does
  (`d1-mission-evidence-repository.ts:100-121`): a soft-deleted media stops counting, and a media
  moved into a topic counts there with its original instant — the same rule as a moved submission.

**Why not `xp_events`.** It is written only when gamification is enabled (`container.ts:343-346`),
so a tenant without XP would have no record; it is a ledger keyed by an idempotency string
(`source_kind`, `source_id`, no foreign key), not a domain table the viewer can join; and a manual
acknowledgment may earn no XP at all (Open Question 1), so it would have no ledger row to live in.
The ledger keeps doing what it does; it stops being the only memory of a watch.

**Why not a column on `media`.** `media` is shared by every student; per-user state does not fit a
per-media row. **Why not `topic_progress`**: see Alternative 2.

**Shared types.**

```ts
// packages/shared/types/entities.ts — Entities.Content
export type MediaAcknowledgmentKind = 'auto' | 'manual';
export interface MediaAcknowledgment {
  userId: string;
  mediaId: string;
  topicNodeId: string;
  kind: MediaAcknowledgmentKind;
  acknowledgedAt: string;
}

// packages/shared/domain/media/acknowledgment.ts — one mapping for API, web and the counting SQL
export const MEDIA_FAMILIES = ['video', 'pdf', 'image'] as const; // 'audio' joins with its upload type
export type MediaFamily = (typeof MEDIA_FAMILIES)[number];
export function mediaFamilyOf(mimeType: string): MediaFamily | null; // video/* · application/pdf · image/*
```

**Port.**

```ts
// packages/shared/ports/i-media-acknowledgment-repository.ts
export interface IMediaAcknowledgmentRepository {
  /** Write-once. `created` is false when a row already existed; `row` is always the stored one. */
  acknowledge(args: { userId: string; mediaId: string; topicNodeId: string; kind: MediaAcknowledgmentKind }):
    Promise<{ created: boolean; row: MediaAcknowledgment }>;
  /** The caller's rows for media currently on `topicId` and not deleted. */
  listForUserOnTopic(userId: string, topicId: string): Promise<MediaAcknowledgment[]>;
  /** Staff report (only if Open Question 8 says so): every row for media currently on `topicId`. */
  listForTopic(topicId: string): Promise<MediaAcknowledgment[]>;
}
```

`D1MediaAcknowledgmentRepository` implements it; it is instantiated in `buildApp(env)` through the
container's content slice, like every adapter.

### 2. HTTP surface

All under `/v1/topics/*`, which `authGuard` already covers (`routes/public/catalog.topics.ts:68-69`).
The new routes live in `routes/media-acknowledgments.router.ts`, declared with `createRoute`; the
controller returns `ControllerResult<T>`.

**`POST /v1/topics/{id}/media/{mediaId}/acknowledge`** — manual acknowledgment. No body.

1. Catalog gate on the topic, exactly as the watched route (`TopicsController.getPublishedById`;
   staff bypass the access set, as there).
2. The media must exist, have `topic_node_id = {id}`, `status = 'ready'`, and a known family —
   otherwise `404 NotFound` (the same answer as a gate miss, so the route is not an oracle).
3. `acknowledge({ kind: 'manual' })`.
4. Records a visit through `ProgressService.visitTopic` and fires the `topic_visit` hook, so a tick
   is never less evidence than expanding the row (`progress.ts:241-249` is the code it mirrors).
5. When `created`, fires the mission hook `media_acknowledged` (§5) and — only if Open Question 1
   decides so — awards XP.
6. Responds `201 { data: MediaAcknowledgment }` when created, `200 { data: MediaAcknowledgment }`
   with the **stored** row (its first `kind` and instant) when it already existed.

**`POST /v1/topics/{id}/videos/{videoId}/watched`** (existing) — after the gate, and only when the
media is a ready video of the topic (the `isReadyVideoOfTopic` check, moved up from the evaluator
into the route for this write), `acknowledge({ kind: 'auto' })`; when `created`, fires
`media_acknowledged` in addition to the existing `video_watch`. Everything else — XP, streak, quest,
badge, the `{ xpAwarded }` response, the beacon's status codes — is unchanged. A media that is not a
ready video of the topic writes no acknowledgment and the route still answers as today.

**`GET /v1/topics/{id}/media/acknowledgments`** — the caller's acknowledgments on that topic, for
the viewer. Catalog gate, `404` on a miss.

```jsonc
{ "data": {
    "items": [ { "mediaId": "…", "kind": "auto", "acknowledgedAt": "2026-10-11 14:03:22" } ],
    "acknowledgedCount": 3,   // rows whose media is ready and still on this topic
    "readyCount": 5           // ready media of the topic in a known family — the counter's denominator
} }
```

Embedding the state in `GET /v1/topics/{id}` instead (one request fewer) is possible later; a
separate read keeps the cached topic payload user-agnostic.

**`GET /v1/admin/topics/{id}/media/acknowledgments`** — **only if Open Question 8 accepts it**:
per-media counts and, per student, which materials were acknowledged and how. Readable by `admin`
and `content_creator`, write-free.

No rate limiter is proposed: every row is written at most once per `(user, media)`, so a repeated
call costs one read and one no-op insert. The anonymous-route limiter pattern (`KvRateLimiter`) can
be added if staging shows abuse.

### 3. Viewer UI

- **Checked state on the row header.** Each row in `MediaList` shows a check mark and the label
  *Read* (documents, images) or *Watched* (videos) once acknowledged, with `title` giving the date
  and, for videos, whether the player or the student marked it.
- **The control.** A *Mark as read* / *Mark as watched* button inside the expanded stage, next to
  the existing *Open* / *Download* links — so the student opens the material before ticking it.
  Placement on the collapsed header instead is Open Question 9. Clicking calls the acknowledge route
  optimistically and rolls back on failure with an inline error. While Open Question 2 is open the
  control has **no un-check**, and a one-line note under it says the mark is final (dictionary key
  `catalog.mediaAck.finalHint`, dropped if undo is accepted).
- **Videos.** The auto mark appears as soon as the watched beacon fires (the page updates its local
  state from the same callback that calls `markVideoWatched`). Whether the manual button also shows
  on a video, before or after the auto mark, is Open Question 3; the API accepts both today.
- **Per-topic counter.** Above the list, *3 / 5 materials* from `acknowledgedCount` / `readyCount`,
  and a full-width progress bar reusing the M27 `MissionProgressBar` styling.
- **i18n.** New `catalog.mediaAck.*` keys in `dict-en.ts` / `dict-pt.ts` (identical keys); the
  `getMediaTypeLabel` literals (`MediaList.tsx:28-34`) move into the dictionary at the same time,
  since the counter and the labels must agree, and the coverage script would flag new literals.

### 4. XP

Three options, **not decided here** (Open Question 1):

| Option | Effect | Concern |
|---|---|---|
| A. None for manual acknowledgments | XP keeps coming only from observed or staff-validated actions; videos keep their 50 XP from the player | A student sees nothing happen when ticking |
| B. A small fixed amount (new `XpAction` `media_acknowledged`, keyed `media_ack:<mediaId>:v1`) | Immediate feedback; idempotent per media | Self-declared XP is farmable on topics with many files |
| C. Only through mission steps (`media_viewed` with an `xp_reward`) | The admin decides where reading is worth XP, per mission and window | Outside missions a tick earns nothing |

Whatever is chosen, a manual tick on a video **never** awards `video_watched` (that remains the
player's), and an `auto` acknowledgment adds no XP beyond the existing `video_watched`.

### 5. Missions: the `media_viewed` kind

```ts
// packages/shared/domain/missions/requirements.ts
media_viewed: z.object({
  // exactly one of minCount / all
  minCount: MinCount.optional(),
  all: z.literal(true).optional(),
  // empty or absent = every family
  types: z.array(z.enum(MEDIA_FAMILIES)).min(1).max(MEDIA_FAMILIES.length).optional(),
  // whether a `manual` acknowledgment counts for videos (Open Question 3)
  videoRequiresAuto: z.boolean().default(false),
}).strict().refine((p) => (p.minCount === undefined) !== (p.all === undefined)),
```

- `media_viewed` joins `REQUIREMENT_KINDS` and `TOPIC_REQUIREMENT_KINDS` (it targets a topic).
- **Counting** is done directly from `media_acknowledgments`, like `submissions_on_topic` counts
  `topic_submissions`: the table keeps its own instant, so **no `mission_evidence` capture is
  needed**, and the reconciliation's re-count *is* the backfill. The `ev` CTE:

  ```sql
  ev AS (
    SELECT a.user_id, datetime(a.acknowledged_at) AS at,
           ROW_NUMBER() OVER (PARTITION BY a.user_id ORDER BY datetime(a.acknowledged_at), a.media_id) AS n
      FROM media_acknowledgments a
      JOIN scope ON scope.user_id = a.user_id
      JOIN media md ON md.id = a.media_id
     WHERE md.topic_node_id = ?8 AND md.status = 'ready'
       AND <family filter over md.type>                       -- from `types`
       AND (?9 = 0 OR md.type NOT LIKE 'video/%' OR a.kind = 'auto')  -- videoRequiresAuto
       AND datetime(a.acknowledged_at) >= scope.opens_at
       AND datetime(a.acknowledged_at) <= MIN(datetime(?5), datetime(?6))
  )
  ```

  The instant is `acknowledged_at`; a step completes at the instant of its target-th qualifying
  acknowledgment, as every other kind.
- **The window rule** above (only acknowledgments made inside the step's interval count) is RFC
  0022's rule, applied unchanged. Combined with write-once, a material acknowledged *before* the step
  opened can never count for it. That is the strict reading of a mission and the draft's working
  assumption, but it is a product decision — Open Question 6 lists the alternative ("acknowledged by
  the end of the window").
- **`all: true` has a dynamic target.** `targetCountOf` returns `null` for it, and the counting
  statement replaces the bound `?7` with a `target` CTE — the number of ready media of the requested
  families on the topic **at evaluation time** (Open Question 5) — so `kth_at` is the instant of the
  last required acknowledgment. `EvidenceCount` gains `target` so the evaluator compares against the
  same number. A completed step is never un-completed (RFC 0022 §3.5), so media added afterwards does
  not reopen it; media added before completion raises the bar. A topic with **zero** matching media
  never completes an `all` step (no vacuous truth); the admin editor warns on save, using
  `use-topic-media-stats.ts`, which already counts ready media per topic.
- **Hook.** New `MissionSignal` `{ kind: 'media_acknowledged'; userId; topicId; mediaId }`, fired by
  both routes in §2 when a row was created. `findCandidates` looks up open `media_viewed` steps on the
  topic; no evidence row is captured. A lost hook is repaired by the daily reconciliation, which
  needs no special backfill for this kind.
- **Relation to `video_watched`.** This draft **keeps both**: `video_watched` stays the
  player-observed, `mission_evidence`-backed kind M27 shipped (unchanged, including its `xp_events`
  backfill); `media_viewed` with `types: ['video']` and `videoRequiresAuto: true` expresses the same
  thing from the new table. Folding `video_watched` into `media_viewed` is Alternative 5.
- **Admin editor.** `RequirementEditor` offers *Materials read* with the topic picker, a
  *count* / *all materials* switch, family checkboxes and the video toggle; `step-target.ts` renders
  the student label (*Read 3 materials of X* / *Read all materials of X*).

### 6. Topic completion

`POST /v1/me/topics/{id}/complete` exists, awards `topic_complete` (100 XP) and has no UI
(`progress.ts:251-288`). "Every material acknowledged" is a natural trigger for it, but it changes
what a completed topic means (a topic without media, a topic whose media grows, subtopics), and
house rules forbid changing topic rules without a decision. This RFC therefore **does not call
`/complete`**; Open Question 7 asks whether a follow-up should.

### 7. Security

- **Who writes.** Only the authenticated caller, for themself: the user id comes from the token,
  never from the path or a body. No route lets staff write or delete another user's acknowledgment.
- **Gate and misses.** The topic goes through the catalog gate; topic not published, archived or
  outside the caller's access set, media absent, deleted, pending, of another topic or of an unknown
  family → `404 NotFound`, one answer for every miss (RFC 0016 / RFC 0020 house rule).
- **Who reads.** A student reads only their own rows (`GET /v1/topics/{id}/media/acknowledgments`
  takes no user id). Staff reads go through `/v1/admin/...` only, and only if Open Question 8 accepts
  the report.
- **Logging.** Failures log ids only (user, topic, media), never a file name — the convention of
  `core/missions/hook.ts`.
- **Self-declared evidence.** A manual acknowledgment proves a click, not reading; §5's
  `videoRequiresAuto` and Open Questions 1, 3 and 9 are the levers that bound what a click can earn.

## Alternatives Considered

1. **Reuse `xp_events` as the record.** Rejected: no row when `GAMIFICATION_ENABLED=false`; a ledger
   keyed by an idempotency string is not a joinable domain table; a manual tick may earn no XP and
   then has no row to live in; and mixing "what happened" into "what was paid" makes the ledger a
   read model for the viewer.
2. **A per-media JSON column (or a set) on `topic_progress`.** Rejected: one instant per topic row,
   not per material; read-modify-write contention on every tick; counting inside JSON in SQL; and a
   moved media would have to be rewritten in every student's progress row.
3. **A self-declared "Mark topic as complete" button instead of per-media marks.** Deferred, not
   rejected: it is the dormant `/complete` route and the topic-level decision RFC 0022 Alternative 5
   already deferred; it answers "did you finish the lesson" but not "did you read *this* document",
   which is what the owner asked and what a mission step needs. Open Question 7 can still lead there.
4. **Automatic "read" detection** (PDF scroll depth, time on page, image dwell). Rejected: PDFs open
   in a new tab or download (`PdfStage.tsx:43-59`) — the app cannot observe them without building an
   embedded viewer; time-on-page measures an open tab, not reading; and an image has no duration or
   end. A player-observed mark exists only for videos, and stays (`auto`).
5. **Fold `video_watched` into `media_viewed`** (one kind, `types: ['video']`, auto only). Deferred:
   it would migrate M27's stored steps and its `mission_evidence` rows, and remove the `xp_events`
   backfill for watches that predate the new table. Reconsider once the table has a few months of
   history.
6. **Two instants per row (`auto_at`, `manual_at`) instead of `kind`.** Deferred to Open Question 3:
   it is the shape a true "double check" on videos needs (the player saw it *and* the student
   confirmed it). With one `kind`, the second mark is a no-op. The migration in §1 would change before
   it ships if the owner wants the double check.
7. **Write acknowledgments into `mission_evidence`.** Rejected: that table belongs to a requirement
   (`requirement_id` in its key) and exists only while a mission does; an acknowledgment is a fact
   about the student and the material, needed by the viewer even when no mission exists.

## Implementation Plan

Total **~7 dev days**, after the Open Questions are answered (some answers remove work: no staff
report, no XP action). **Depends on M27** (PR #81: migration 0031, the evaluator, the hook runner,
the reconciliation job and Task 01's video wiring); planning and execution start after it merges.

### Phase 0 — Decisions (owner)
Answer Open Questions 1-9; fix the §1 schema (Alternative 6) and the §5 window rule accordingly.

### Phase 1 — Schema, types, port, adapter (~1 d, backend)
Migration, `MediaAcknowledgment` types, `mediaFamilyOf`, the port and `D1MediaAcknowledgmentRepository`
with adapter tests (write-once, `created`, current-topic and deleted-media filtering).

### Phase 2 — Routes and hooks (~1.5 d, backend)
The acknowledge and list routes (OpenAPI, controller, gate, `404`s, visit), the `auto` write in the
watched route, the `media_acknowledged` signal and hook logging; router tests including the
gamification-off tenant.

### Phase 3 — Viewer (~1.5 d, frontend)
Checked state, control, counter, optimistic update, i18n keys and the dictionary move of the type
labels; component tests.

### Phase 4 — Mission kind (~1.5 d, backend)
`media_viewed` params and refinement, the dynamic `all` target, the counting SQL, `findCandidates`,
evaluator and reconciliation tests (window, `videoRequiresAuto`, moved and deleted media).

### Phase 5 — Admin editor and student labels (~1 d, frontend)
`RequirementEditor`, `step-target.ts`, the zero-media warning, and the staff report page if Open
Question 8 accepts it (+0.5 d).

### Phase 6 — Docs and demo (~0.5 d)
`CLAUDE.md` (API bullet), `docs/product/FEATURES.md`, the demo dataset (one acknowledgment, one
`media_viewed` step) with RFC 0021's CI check counts.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| Self-declared evidence can be gamed — a student ticks everything unread | XP for manual ticks is an explicit owner choice (OQ 1); the control sits inside the opened material (OQ 9); `videoRequiresAuto` keeps video steps player-observed; staff can see the pattern if the report exists (OQ 8) |
| Write-once punishes a mis-click (a material marked by accident stays marked) | OQ 2 decides undo; if accepted, deleting a `manual` row is one route and nothing already rewarded is revoked (RFC 0022 §3.5) |
| Write-once plus the strict window: a material read before a mission started can never count for it | Stated in §5 and asked in OQ 6, with the "acknowledged by the end" alternative ready to swap into the `ev` CTE |
| A topic's media changes (added, moved, deleted) after students acknowledged | Counts always read the media's current topic and status; an `all` target is computed at evaluation; a completed step is never reopened or revoked; OQ 5 confirms the semantics |
| Watches before this RFC ships have no acknowledgment, so the counter starts at zero for videos already watched | Accepted for the draft (Non-Goal *Retro-dating*); a one-off backfill from `xp_events` `video` rows, as `backfillEvidence` already reads them, is a small addition if the owner wants it |
| The watched route now validates the media for its write, while still awarding XP for any id | The acknowledgment is correct by construction; tightening the XP award to ready videos of the topic is a separate backlog fix, out of scope here |
| Two video kinds (`video_watched`, `media_viewed` with `types: ['video']`) can confuse admins | The editor describes each in one line; Alternative 5 is the path to one kind |

## Success Criteria

- (Ph 1-2) A student `POST`s acknowledge on a ready PDF of a topic in their access set → `201` and
  one row `kind = 'manual'`; a second call → `200` with the same `acknowledgedAt`; the row count is
  unchanged.
- (Ph 2) The same call on a topic outside the access set, an archived topic, a pending media, a
  deleted media or a media of another topic → `404 NotFound` with an identical body each time.
- (Ph 2) On a tenant with `GAMIFICATION_ENABLED=false`, finishing a video writes one `auto`
  acknowledgment and no `xp_events` row; the watched route's response body is unchanged.
- (Ph 2) A manual tick on a video already acknowledged by the player leaves `kind = 'auto'` and its
  instant untouched.
- (Ph 2) Acknowledging a media records a visit: `topic_progress` exists for the topic afterwards.
- (Ph 3) After reload, the topic page shows each acknowledged row as checked and the counter reads
  `acknowledgedCount / readyCount`; a deleted media disappears from both numbers.
- (Ph 4) A mission with one `media_viewed` step (`all: true`, `types: ['pdf', 'image']`) completes in
  the request that acknowledges the last such material inside the window; its `completed_at` equals
  that acknowledgment's `acknowledged_at`.
- (Ph 4) With the hook forced to throw, the acknowledgment still succeeds, and after `scheduled()` the
  step is completed with `completed_by = 'reconcile'` and the same `completed_at`.
- (Ph 4) With `videoRequiresAuto: true`, a manually ticked video does not count; an `auto` one does.
- (Ph 5) The admin editor refuses to save a `media_viewed` step with both or neither of `minCount`
  and `all`, and warns on an `all` step whose topic has no matching media.

## Open Questions

All owned by the **product owner**; none is decided by this draft.

1. **XP for manual acknowledgments.** None (A), a small fixed amount per material (B, with a value),
   or only through mission steps (C) — §4.
2. **Can a manual tick be undone?** Never (the draft's assumption, with a "this mark is final" hint),
   within a grace period, or always? Does undo apply to `auto` marks (the draft says no)?
3. **Videos: auto only, or a double check?** (a) auto only — no manual button on videos; (b) the
   manual button as a fallback when the player could not report (one record, first wins — the
   draft); (c) a true double check, where the player *and* the student both mark it (needs
   Alternative 6's two-instant row). And should a manual video tick count for `media_viewed` steps by
   default (`videoRequiresAuto` default)?
4. **Which media types are "materials"?** Every ready media of the topic (draft), or only documents
   and images, with videos tracked separately in the counter?
5. **What does `all` mean?** The ready media of the topic **at evaluation time** (draft), or a
   snapshot taken when the step opens or the mission starts, so later uploads do not raise the bar?
6. **Must the acknowledgment fall inside the mission window?** Strictly inside the step's interval
   (RFC 0022's rule, the draft), or "acknowledged by the end of the window", so an earlier read counts?
7. **Should acknowledging every material complete the topic** (wiring the dormant
   `POST /v1/me/topics/{id}/complete`, its 100 XP and its quests)? If yes, what about topics without
   media and subtopics?
8. **Can staff see who acknowledged what?** A per-topic report for `admin` and `content_creator`
   (§2), admin only, or no report at all?
9. **Where does the control live?** Only inside the opened material (the draft — the student must
   open it first), or also on the collapsed row header for a one-click tick?

## References

- Owner request: M27 preview walkthrough, 2026-10-11 (quoted in *Motivation*).
- Viewer: `apps/web/src/components/catalog/MediaList/MediaList.tsx:28-34, 47-49, 59-66, 72-76, 87-181`,
  `VideoStage.tsx:4-55`, `PdfStage.tsx:43-59`, `AudioStage.tsx`;
  `apps/web/src/app/(protected)/catalog/[id]/page.tsx:166-178`; `apps/web/src/lib/topics-api.ts:69-75`.
- Watched route and gate: `apps/api/src/routes/topics.router.ts:19-73`,
  `apps/api/src/controllers/topics.controller.ts:54-65`, `apps/api/src/routes/index.ts:78-90`,
  `apps/api/src/routes/public/catalog.topics.ts:68-69`.
- Progress: `apps/api/src/routes/me/progress.ts:83-140, 241-288`,
  `apps/api/migrations/0010_create_progress_tables.sql:5-16`.
- Gamification: `packages/shared/domain/gamification/xp-config.ts:1-21`, `xp-engine.ts:22-25`,
  `apps/api/src/container.ts:276-284, 343-346`.
- Missions (RFC 0022 / M27): `packages/shared/domain/missions/requirements.ts:9-23, 51, 116-120`,
  `packages/shared/domain/gamification/mission-evaluator.ts:33-37, 62-67, 166-213`,
  `apps/api/src/core/missions/hook.ts:1-60`,
  `apps/api/src/adapters/db/d1-mission-evidence-repository.ts:1-74, 100-121, 160-199`,
  `apps/api/src/adapters/db/d1-mission-participation-repository.ts:143-170`,
  `apps/api/migrations/0031_create_mission_requirements.sql:77-85`,
  `apps/web/src/components/missions/use-topic-media-stats.ts`.
- Media: `apps/api/migrations/0006_create_media.sql`, `packages/shared/domain/media/limits.ts:24-30`,
  `apps/api/src/adapters/db/d1-media-repository.ts:46-55, 91-112`,
  `apps/api/src/controllers/admin-media.controller.ts:136-175`.
- Related RFCs: RFC 0022 (mission requirements — the engine, the window rule, write-once completion;
  its *Roadmap* item 4 is this RFC), RFC 0016 and RFC 0020 (`404` on misses, conditional writes),
  RFC 0021 (demo seed and its CI check).
- Milestone: [M27 Mission requirements](../milestones/27-mission-requirements/milestone.md)
  (Task 01 — video watched wiring).
