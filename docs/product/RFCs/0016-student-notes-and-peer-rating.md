# RFC 0016: Student notes — private and shared topic notes with peer rating

**Date:** 2026-09-27
**Status:** Draft
**Author:** raphaelsilva
**Affected:**
- `apps/api/migrations/0028_create_topic_notes.sql` (new — `topic_notes` and `note_ratings`; renumber if RFC 0015 lands a migration first)
- `packages/shared/types/entities.ts` (new `Entities.Engagement.Note`, `NoteRating`, `Config.NoteVisibility`)
- `packages/shared/ports/i-note-repository.ts` (new port) and `packages/shared/ports/index.ts`
- `packages/shared/domain/notes/` (new — body limits, rating scale, ranking score; one table read by API and web)
- `apps/api/src/adapters/db/d1-note-repository.ts` (new adapter)
- `apps/api/src/controllers/notes.controller.ts` (new — ownership, sharing and rating rules)
- `apps/api/src/routes/notes.router.ts` (new — topic-scoped and note-scoped routes)
- `apps/api/src/routes/me/notes.ts` (new — "my notes" review list)
- `apps/api/src/routes/admin/notes.ts` (new — moderation: force-unshare)
- `apps/api/src/container.ts`, `apps/api/src/routes/index.ts` (wiring)
- `apps/api/src/openapi/components/entities.ts` (new schemas)
- `apps/web/src/lib/notes-api.ts` (new client)
- `apps/web/src/components/catalog/notes/*` (new — editor, shared-notes list, rating control)
- `apps/web/src/app/(protected)/notes/page.tsx` (new — "My notes")
- `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (new `notes:` section, identical keys)

---

## Summary

Give students a **notebook per topic**: on any published topic they can read, a student
writes one Markdown note of their own. A note is **private by default**; the author may
**share** it, which makes it readable by every other student who can read that topic. Shared
notes of *other* students can be **rated on a 1–5 scale**, one rating per reader, changeable
and removable; the author sees the aggregate (average + count), never who rated. A "My notes"
page lets the student review everything they wrote across topics. Notes are a new
`Engagement` entity, deliberately separate from comments: a comment is a public, append-only
contribution to a discussion; a note is a **private, editable study artifact** that only
becomes public by the author's explicit choice. The single most important consequence is a
new **privacy boundary** inside the learner surface — the first piece of learner content that
admins cannot read unless the author shares it.

## Motivation

The topic page today has exactly one place for a student to write: the discussion
(`apps/web/src/components/catalog/Discussion.tsx`). It is the wrong tool for studying:

| Case | Comments today | This RFC |
|---|---|---|
| Student summarises a class for themselves | Public the moment it is posted | Private note, shared only if they choose |
| Student refines their summary over the week | No edit — only soft-delete and repost | Note is edited in place, autosaved |
| Student wants to reread everything they wrote | No per-user view; comments are scattered per topic | "My notes" lists every note across topics |
| A good summary helps classmates prepare an exam | Buried in a thread sorted by date | Shared notes ranked by peer rating |
| Class signals which summary is the most useful | Only a binary like, on any comment | 1–5 rating on shared notes, aggregate shown |

Notes and comments differ in ownership, lifecycle and audience, so bolting sharing, editing
and scoring onto `topic_comments` would change the meaning of an existing, XP-awarding
entity (see Alternatives §1).

## Goals & Non-Goals

**Goals**
- A student with read access to a published topic can create, edit and delete **their own**
  note on it, in Markdown sanitised on write.
- A note is `private` or `shared`; the author toggles it at any time. Private notes are
  readable **only by their author** — not by other students, tutors, content creators or
  admins.
- Shared notes are listed on the topic for every caller who can read the topic, ranked by
  rating or by recency.
- A reader can rate another student's shared note (integer 1–5), change the rating, or
  remove it. Authors cannot rate their own note.
- Authors see their note's rating average and count; individual raters stay anonymous.
- A "My notes" page lists the student's notes across all topics with visibility and rating.
- Admins can **force-unshare** an abusive shared note (moderation) without reading or
  deleting the author's work.
- Topic access is enforced exactly as the catalog does it — published, not archived, in the
  caller's effective access set — and a miss is `404`, never `403`.

**Non-Goals**
- **XP, quests or badges for notes and ratings.** Scoring behaviour first has to be observed;
  rewarding it now invites rating rings. Deferred to Open Question 1.
- **Several notes per topic, titles, folders, tags.** One note per student per topic (see
  Alternatives §2).
- **Anonymous sharing.** A shared note shows its author's name, like comments do.
- **Tutor/teacher review of private notes**, or teacher grading of notes. A future RFC; it
  needs an explicit consent model on top of the privacy boundary set here.
- **Comments or threads on notes.** The discussion remains the place to talk.
- **Real-time collaborative editing** and version history. A note has one writer; the last
  write wins behind an optimistic-concurrency check (§4).
- **Media attachments inside notes.** Markdown text only; links are allowed.
- **Notifications** ("your note was rated").

## Current State (for reference)

**1. Comments are the only learner-written content.** `0022_create_topic_comments.sql`
creates `topic_comments` (append-only, soft delete, one reply level) and `comment_likes`
(binary). `ICommentRepository` (`packages/shared/ports/i-comment-repository.ts`) has no
update method, and every comment is visible to every reader of the topic.

**2. Comments check enrollment but not publication.**
`CommentsController.listComments` (`apps/api/src/controllers/comments.controller.ts`) only
tests `enrolledTopicIds.includes(topicNodeId)` and answers **`403`**. The catalog, by
contrast, returns **`404`** unless the node is `published`, not `archived`, and in
`getEffectiveAccessTopicIds` (`apps/api/src/controllers/topics.controller.ts`,
`getPublishedById`). Notes follow the catalog rule, not the comments one — a draft or
archived topic must not accept notes, and a miss must not reveal that the topic exists.

**3. Privileged roles bypass the topic gate.** Both routers compute
`isPrivileged = roles ∋ admin | content_creator` and skip the access check. That bypass is
right for *reading the topic* and wrong for *reading a private note*; §3 separates them.

**4. XP is awarded inline by the router.** `comments.router.ts` calls
`xpEngine.award({ action: 'comment_posted', … })` after a successful create;
`XpAction` in `packages/shared/domain/gamification/xp-config.ts` is a closed union. Notes
do not touch it in this RFC.

**5. Markdown sanitisation exists.** `sanitizeMarkdown` (`packages/shared/utils/sanitize-markdown.ts`)
already protects topic content on write, and the catalog already renders sanitised Markdown.
Notes reuse both unchanged.

## Proposed Design

### 1. Schema (`0028_create_topic_notes.sql`)

```sql
CREATE TABLE IF NOT EXISTS topic_notes (
  id             TEXT PRIMARY KEY,
  topic_node_id  TEXT NOT NULL REFERENCES topic_nodes(id),
  author_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body           TEXT NOT NULL,
  visibility     TEXT NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('private', 'shared')),
  shared_at      TEXT,                 -- first time it became shared; kept across unshare
  moderated_at   TEXT,                 -- set by an admin force-unshare; blocks re-sharing
  moderated_by   TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (topic_node_id, author_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_notes_author ON topic_notes (author_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_topic_notes_shared ON topic_notes (topic_node_id, visibility);

CREATE TABLE IF NOT EXISTS note_ratings (
  note_id     TEXT NOT NULL REFERENCES topic_notes(id) ON DELETE CASCADE,
  rater_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (note_id, rater_id)
);
```

- **Hard delete, not soft delete.** A note is private work; when its author deletes it, it is
  gone, and its ratings cascade with it. Comments soft-delete to keep threads coherent; notes
  have no thread to keep.
- **`UNIQUE (topic_node_id, author_id)`** makes "my note on this topic" a single row, which
  turns create/update into one idempotent upsert.
- **Aggregates are computed on read** (`AVG`, `COUNT` grouped by `note_id`, filtered by the
  shared-notes index). A topic with a class's worth of notes is tens of rows; a denormalised
  counter would add a write path to keep consistent for no measurable gain. Revisit if a
  single topic exceeds ~1 000 shared notes.
- **`shared_at` survives an unshare**, so "shared since" is stable and ratings are not lost
  when the author hides a note for a while (§3).

### 2. Shared domain (`packages/shared/domain/notes/`)

One table, read by the API validator and the web editor, following the
`domain/media/limits.ts` precedent:

```ts
export const NOTE_BODY_MAX = 20_000;          // characters, after sanitisation
export const NOTE_RATING_MIN = 1;
export const NOTE_RATING_MAX = 5;

/** Bayesian average: a single 5★ must not outrank twenty 4.6★ ratings. */
export const NOTE_RANK_PRIOR_MEAN = 3;
export const NOTE_RANK_PRIOR_WEIGHT = 3;
export function noteRankScore(avg: number, count: number): number {
  return (NOTE_RANK_PRIOR_WEIGHT * NOTE_RANK_PRIOR_MEAN + avg * count)
       / (NOTE_RANK_PRIOR_WEIGHT + count);
}
```

`packages/shared/types/entities.ts` gains, under `Entities.Engagement`:

```ts
interface Note {
  id: string; topicNodeId: string; authorId: string; authorName: string;
  body: string; visibility: Config.NoteVisibility;          // 'private' | 'shared'
  sharedAt: string | null; moderated: boolean;
  createdAt: string; updatedAt: string;
  rating: { average: number | null; count: number };          // null when count = 0
}
interface SharedNoteView extends Note { isMine: boolean; myRating: number | null }
```

### 3. Access rules (the privacy boundary)

All rules live in `NotesController`; routes only pass the caller and the effective access set.

| Action | Rule | Miss |
|---|---|---|
| Read/write **my** note on topic T | T is readable by the caller (published, not archived, in effective access set; privileged roles bypass *this* check only) | `404` |
| List shared notes on T | T readable by the caller | `404` |
| Read a **private** note | Caller is the author — **no role bypass**, admins included | `404` |
| Share | Caller is the author, T readable, note not `moderated_at` | `404` / `409 NOTE_MODERATED` |
| Rate note N | N is `shared`, caller ≠ author, T readable by the caller | `404` / `403 CANNOT_RATE_OWN_NOTE` |
| Force-unshare N | Caller has role `admin` | `403` |

Decisions encoded in the table:

- **Private means private.** The `isPrivileged` bypass of the comments router (Current State §3)
  grants *topic* reads, never *private note* reads. Admin moderation only ever sees what the
  author already shared.
- **Unsharing hides, it does not reset.** When the author sets `visibility = 'private'`,
  existing ratings stay in `note_ratings` but the note disappears from every listing and
  stops accepting ratings; re-sharing restores the same aggregate.
- **Losing access to a topic does not take the student's words away.** "My notes" lists all
  of the author's notes, each flagged `topicAccessible`. A note on a topic the student can no
  longer read is **read-only** (no edit, no share, excluded from the shared listing because
  the topic itself is no longer listed for the author); it can still be deleted.
- **Moderation is an unshare, not a delete.** `POST /v1/admin/notes/{id}/unshare` sets
  `visibility = 'private'`, `moderated_at`, `moderated_by`. The author keeps the text and
  can keep editing it privately; re-sharing returns `409 NOTE_MODERATED` until an admin
  clears the flag (`DELETE /v1/admin/notes/{id}/moderation`).
- **Rater anonymity.** No endpoint returns `rater_id` to anyone other than the rater
  themselves (`myRating`).

### 4. Writing a note

- **Upsert.** `PUT /v1/topics/{id}/notes/me` creates or replaces the caller's note.
  The body is `sanitizeMarkdown`-ed, trimmed, and must be 1…`NOTE_BODY_MAX` characters;
  an empty body is rejected (`400`) — deleting is an explicit action.
- **Optimistic concurrency.** The request carries `baseUpdatedAt` (the `updatedAt` the
  client last saw; omitted on first create). If the stored row's `updated_at` differs, the
  write is refused with `409 NOTE_STALE` and the current note in `meta`, so two open tabs
  cannot silently overwrite each other. The web editor surfaces "this note changed in
  another window — reload / overwrite".
- **Editing a shared note keeps its ratings.** Ratings rate the note, not a revision.
  Accepted as a tradeoff (see Tradeoffs) rather than tracking revisions.
- **Visibility travels in the same request** (`visibility?: 'private' | 'shared'`), so
  "write and publish" is one call; setting `shared` stamps `shared_at` the first time.

### 5. HTTP surface

Mounted like comments — `buildNotesRouter` at `v1.route('/', …)`, behind `authGuard`.

| Method & path | Purpose | Success |
|---|---|---|
| `GET /v1/topics/{id}/notes/me` | The caller's note on the topic | `200 { data: Note \| null }` |
| `PUT /v1/topics/{id}/notes/me` | Upsert `{ body, visibility?, baseUpdatedAt? }` | `200 Note` (`201` on create) |
| `DELETE /v1/topics/{id}/notes/me` | Hard-delete the caller's note | `204` |
| `GET /v1/topics/{id}/notes?sort=top\|recent&cursor=` | Shared notes on the topic, page of 20 | `200 { data: SharedNoteView[], nextCursor }` |
| `PUT /v1/notes/{noteId}/rating` | Rate `{ score: 1..5 }` (create or change) | `200 { average, count, myRating }` |
| `DELETE /v1/notes/{noteId}/rating` | Remove the caller's rating | `200 { average, count, myRating: null }` |
| `GET /v1/me/notes?cursor=` | Every note the caller wrote, newest `updatedAt` first, with topic title and `topicAccessible` | `200 { data, nextCursor }` |
| `POST /v1/admin/notes/{id}/unshare` | Moderation (admin) | `200 Note` |
| `DELETE /v1/admin/notes/{id}/moderation` | Clear the moderation flag (admin) | `204` |

- `sort=top` orders by `noteRankScore` desc, then `shared_at` desc; `sort=recent` by
  `shared_at` desc. The caller's own shared note is included and flagged `isMine`.
- Cursors are opaque (`base64(sortKey|id)`). This is the **first cursor-paginated endpoint**
  in the API (existing lists return everything), so the cursor helper lands in
  `routes/_shared/` for reuse. The shared list never returns private rows, whatever the
  parameters.
- Rating responses return the fresh aggregate so the UI updates without a refetch.
- Rating writes go through a per-user `KvRateLimiter` (60/min), the same adapter the events
  board uses, to blunt scripted rating bursts.

### 6. Ports & adapters

```ts
export interface INoteRepository {
  findMine(topicNodeId: string, authorId: string): Promise<NoteRecord | null>;
  findById(id: string): Promise<NoteRecord | null>;
  upsertMine(p: UpsertNoteParams): Promise<{ note: NoteRecord; created: boolean }>;
  deleteMine(topicNodeId: string, authorId: string): Promise<boolean>;
  listShared(topicNodeId: string, viewerId: string, page: SharedPage): Promise<Paged<SharedNoteRecord>>;
  listByAuthor(authorId: string, page: CursorPage): Promise<Paged<AuthoredNoteRecord>>;
  setModeration(id: string, adminId: string | null): Promise<NoteRecord | null>;
  upsertRating(noteId: string, raterId: string, score: number): Promise<RatingAggregate>;
  deleteRating(noteId: string, raterId: string): Promise<RatingAggregate>;
}
```

`upsertMine` enforces `baseUpdatedAt` in SQL (`UPDATE … WHERE updated_at = ?` and a
row-count check), so the concurrency check is not a read-then-write race. The repository is
instantiated per request in the container's `engagement` slice, next to `commentRepo`.

### 7. Web surface

- **Topic page** (`(protected)/catalog/[id]`) gets a **Notes** panel beside Discussion with two
  tabs: *My note* — a Markdown editor with preview, debounced autosave (~2 s idle), a
  private/shared switch and, once shared, the aggregate rating; and *Class notes* — the
  shared list with `top`/`recent` sort, rendered with the catalog's existing sanitised
  Markdown renderer, a 5-star control per note (disabled on the caller's own), and the
  caller's current rating highlighted.
- **Sharing is a deliberate act**: switching to *shared* shows a one-line confirmation that
  classmates will see the note with the author's name.
- **"My notes"** (`(protected)/notes`) lists the caller's notes grouped by topic with
  visibility badge, rating aggregate, last edit, and a link back to the topic; read-only rows
  show why ("you no longer have access to this topic").
- **Admin**: an *Unshare* action on each shared note in the Class notes tab, visible to
  admins only; no admin page lists private notes because none can.
- **i18n**: a `notes:` section in `dict-en.ts` / `dict-pt.ts` with identical keys;
  `check-i18n-coverage.js` stays green.

## Alternatives Considered

1. **Extend `topic_comments` with `visibility` and an edit endpoint.** Rejected. Comments are
   public by construction, soft-deleted to keep reply threads coherent, and award
   `comment_posted` XP. A private, editable, rateable comment would change every reader of
   that table and silently start awarding XP for private writing.
2. **Many notes per topic (titled notes, like a notebook of pages).** Deferred, not rejected.
   One note per topic keeps the "revise your summary" workflow and the rating meaningful
   (one artifact per student per topic, not a feed that can be padded). Relaxing the
   `UNIQUE` later is additive; tightening it later would not be.
3. **Binary like (reuse the comment-like pattern) instead of 1–5.** Rejected: the request is
   explicitly a *score*, and a like cannot distinguish "useful" from "excellent". The 1–5
   scale plus a Bayesian rank gives a signal a like cannot.
4. **Plain arithmetic mean for ranking.** Rejected: a single 5★ would outrank a note with
   twenty 4.6★ ratings. The Bayesian prior (§2) costs one function.
5. **Denormalised `rating_sum` / `rating_count` columns on `topic_notes`.** Deferred: correct
   only if every rating write also updates the note in the same batch; the read-side
   aggregate is cheap at current scale.
6. **Admin can read private notes for moderation.** Rejected: nothing private can be abusive to
   others, and a moderator reading private study notes defeats the point of "private". Only
   shared content is moderated.
7. **Invalidate ratings when a shared note is edited.** Deferred: it punishes authors for
   improving their note, which is exactly the behaviour we want. Revisit if bait-and-switch
   (share good text, collect ratings, replace it) shows up in practice.

## Implementation Plan

Total: **~5–6 dev days**, as one milestone with backend and frontend tasks kept separate.

### Phase 0 — Shared foundations (~0.5 d)
Entity types, `Config.NoteVisibility`, `domain/notes/` limits and `noteRankScore` with unit
tests, `INoteRepository` port.

### Phase 1 — Schema and repository (~1 d)
Migration `0028`, `D1NoteRepository` with the conditional upsert, shared listing with the
ranking in SQL, cursor pagination; repository tests against the Workers pool.

### Phase 2 — Author API (~1 d)
`NotesController` author paths, `GET/PUT/DELETE /v1/topics/{id}/notes/me`,
`GET /v1/me/notes`, access rules of §3 incl. "private has no role bypass" tests,
`409 NOTE_STALE`.

### Phase 3 — Sharing, rating and moderation API (~1 d)
Shared listing, rating upsert/delete with rate limiting, admin unshare/clear-moderation,
OpenAPI schemas and regenerated `api-types.gen.ts`.

### Phase 4 — Web (~1.5–2 d)
`notes-api.ts`, Notes panel (editor + autosave + conflict banner, Class notes list, star
control), "My notes" page, admin unshare action, dictionaries in both languages, component
tests.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| Rating rings — friends rate each other 5★ | No XP or ranking reward tied to ratings in v1 (Non-Goals); Bayesian prior damps small counts; per-user rate limit |
| Bait-and-switch — edit a highly rated shared note into something else | Ratings survive edits by design (Alt. 7); `updatedAt` shown on shared notes; admin force-unshare |
| Abusive content in a shared note | Admin force-unshare with sticky `moderated_at`; author keeps their private text |
| Admin expects to "see everything" and cannot read private notes | Stated as a product rule in the admin docs; the API answers `404`, never leaks existence |
| Two tabs overwrite each other | `baseUpdatedAt` check in the `UPDATE`'s `WHERE`, `409 NOTE_STALE` with the current note |
| Large notes bloat the shared listing payload | `NOTE_BODY_MAX = 20 000`; list page size 20; list may return a truncated `excerpt` if payloads grow (non-breaking addition) |
| Migration number collides with RFC 0015 (extras) | Whichever lands second renumbers its migration; noted in **Affected** |

## Success Criteria

- (Ph 2) A student upserts, reads and deletes their note on a readable topic; a draft,
  archived or out-of-access topic answers `404`.
- (Ph 2) An admin, a content creator and another student all get `404` reading someone else's
  **private** note, through every endpoint.
- (Ph 2) A stale `baseUpdatedAt` yields `409 NOTE_STALE` and leaves the row unchanged.
- (Ph 3) The shared listing never returns a private or moderated note; it includes the
  caller's own shared note flagged `isMine`.
- (Ph 3) Rating one's own note returns `403 CANNOT_RATE_OWN_NOTE`; re-rating changes the score
  without adding a row; removing a rating updates the aggregate; `rater_id` appears in no
  response.
- (Ph 3) Unshare → re-share restores the prior aggregate; force-unshare blocks re-sharing
  with `409 NOTE_MODERATED` until cleared.
- (Ph 4) A student can write, share, rate and review notes end to end in both `pt` and `en`
  builds; i18n coverage check passes.

## Open Questions

1. **Should notes feed gamification?** Candidates: XP once per note when first shared
   (idempotency key = note id), XP to the author when a note crosses N ratings with average
   ≥ 4, a quest kind `share_note`. Recommendation: ship without, observe rating behaviour for
   a cycle, then decide. *Owner: product.*
2. **Can tutors read shared notes of their group only, or also private notes with consent?**
   Out of scope here; would need an explicit consent flag. *Owner: product.*
3. **Should the rater see the author's name before rating, or should ratings be blind?**
   Current design shows the name (like comments). Blind rating reduces favouritism but makes
   the list feel anonymous. *Owner: product.*
4. **Retention when a student is deactivated.** `ON DELETE CASCADE` covers hard deletion; a
   deactivated (not deleted) user's shared notes stay listed. Hide them? *Owner: product.*

## References

- Relevant code: `apps/api/migrations/0022_create_topic_comments.sql`,
  `apps/api/src/controllers/comments.controller.ts`, `apps/api/src/routes/comments.router.ts`,
  `apps/api/src/controllers/topics.controller.ts` (`getPublishedById`),
  `packages/shared/domain/gamification/xp-config.ts`,
  `packages/shared/utils/sanitize-markdown.ts`,
  `apps/web/src/components/catalog/Discussion.tsx`
- Related RFCs: RFC 0005 (effective access set and node visibility — the gate notes reuse),
  RFC 0003 (route organisation and OpenAPI), RFC 0009 (gamification catalog — where note XP
  would plug in, Open Question 1), RFC 0014 (per-user/IP `KvRateLimiter` precedent)
