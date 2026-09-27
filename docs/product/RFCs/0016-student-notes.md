# RFC 0016: Student notes — private and shared topic notes with staff moderation

**Date:** 2026-09-27
**Status:** Draft
**Revised:** 2026-09-27
**Author:** raphaelsilva
**Affected:**
- `apps/api/migrations/0028_create_topic_notes.sql` (new — `topic_notes`; RFC 0015 also claims `0028`, the second to land renumbers)
- `packages/shared/types/entities.ts` (new `Entities.Engagement.Note`, `Config.NoteVisibility`)
- `packages/shared/ports/i-note-repository.ts` (new port) and `packages/shared/ports/index.ts`
- `packages/shared/domain/notes/limits.ts` (new — body limit, one table read by API and web)
- `apps/api/src/adapters/db/d1-note-repository.ts` (new adapter)
- `apps/api/src/controllers/notes.controller.ts` (new — ownership, visibility, staff and moderation rules)
- `apps/api/src/routes/notes.router.ts` (new — topic-scoped routes)
- `apps/api/src/routes/me/notes.ts` (new — "my notes" review list)
- `apps/api/src/routes/admin/notes.ts` (new — moderation: force-unshare, clear moderation)
- `apps/api/src/container.ts`, `apps/api/src/routes/index.ts` (wiring)
- `apps/api/src/openapi/components/entities.ts` (new schemas)
- `apps/web/src/lib/notes-api.ts` (new client)
- `apps/web/src/components/catalog/notes/*` (new — editor with autosave and conflict banner, class notes list)
- `apps/web/src/app/(protected)/notes/page.tsx` (new — "My notes")
- `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (new `notes:` section, identical keys)

---

## Summary

Give students a **notebook per topic**: on any published topic they can read, a student
writes one Markdown note of their own. A note is **private by default** — hidden from other
students, but readable by staff (`admin`, `content_creator`). The author may **share** it,
which makes it readable by every other student who can read that topic. **Admins can
force-unshare** a shared note (moderation), which returns it to private and blocks
re-sharing until an admin clears the flag. A "My notes" page lets the student review
everything they wrote across topics. Notes are a new `Engagement` entity, deliberately
separate from comments: a comment is a public, append-only contribution to a discussion; a
note is an **editable study artifact** whose audience among students is the author's choice.
Peer rating of shared notes was considered and **removed from scope** (Alternatives §3).

## Motivation

The topic page today has exactly one place for a student to write: the discussion
(`apps/web/src/components/catalog/Discussion.tsx`). It is the wrong tool for studying:

| Case | Comments today | This RFC |
|---|---|---|
| Student summarises a class for themselves | Visible to the whole class the moment it is posted | Private note — classmates don't see it |
| Student refines their summary over the week | No edit — only soft-delete and repost | Note is edited in place, autosaved |
| Student wants to reread everything they wrote | No per-user view; comments are scattered per topic | "My notes" lists every note across topics |
| A good summary could help classmates | Buried in a thread sorted by date | Author shares it; it appears under "Class notes" |
| Staff want to follow how students are studying a topic | No signal beyond comments | Staff read every note on the topic, private included |
| A shared note is inappropriate | Admin can delete a comment | Admin force-unshares; the author keeps their text |

Notes and comments differ in ownership, lifecycle and audience, so bolting sharing and
editing onto `topic_comments` would change the meaning of an existing, XP-awarding entity
(see Alternatives §1).

## Goals & Non-Goals

**Goals**
- A student with read access to a published topic can create, edit and delete **their own**
  note on it, in Markdown sanitised on write.
- A note is `private` or `shared`; the author toggles it at any time.
- **Private is private among students**: no other student can read it through any endpoint.
  **Staff (`admin`, `content_creator`) can read every note**, private or shared, read-only.
- Shared notes are listed on the topic for every student who can read the topic.
- **Admins can force-unshare** a shared note; a moderated note cannot be re-shared by its
  author until an admin clears the flag.
- A "My notes" page lists the student's notes across all topics.
- The editor never silently loses text when the same note is open in two tabs (§4).
- Topic access is enforced exactly as the catalog does it — published, not archived, in the
  caller's effective access set — and a miss is `404`, never `403`.
- The editor tells the student, in plain words, who can read a private note.

**Non-Goals**
- **Peer rating of shared notes** (1–5 score). Removed on 2026-09-27; may return in a future
  RFC (Alternatives §3).
- **XP, quests or badges for notes** (Open Question 1).
- **Several notes per topic, titles, folders, tags.** One note per student per topic
  (Alternatives §2).
- **Staff editing or deleting a student's note.** Staff read; admins unshare. The text is
  always the student's.
- **Anonymous sharing.** A shared note shows its author's name, like comments do.
- **Comments or threads on notes.** The discussion remains the place to talk.
- **Real-time collaborative editing** and version history. A note has one writer; concurrent
  writes from that writer are detected, not merged (§4).
- **Media attachments inside notes.** Markdown text only; links are allowed.
- **Notifications** ("your note was unshared by an admin" beyond the banner in the editor).

## Current State (for reference)

**1. Comments are the only learner-written content.** `0022_create_topic_comments.sql`
creates `topic_comments` (append-only, soft delete, one reply level) and `comment_likes`.
`ICommentRepository` (`packages/shared/ports/i-comment-repository.ts`) has no update method,
and every comment is visible to every reader of the topic.

**2. Comments check enrollment but not publication.**
`CommentsController.listComments` (`apps/api/src/controllers/comments.controller.ts`) only
tests `enrolledTopicIds.includes(topicNodeId)` and answers **`403`**. The catalog, by
contrast, returns **`404`** unless the node is `published`, not `archived`, and in
`getEffectiveAccessTopicIds` (`apps/api/src/controllers/topics.controller.ts`,
`getPublishedById`). Notes follow the catalog rule, not the comments one — a draft or
archived topic must not accept notes, and a miss must not reveal that the topic exists.

**3. Privileged roles bypass the topic gate.** Both routers compute
`isPrivileged = roles ∋ admin | content_creator` and skip the access check. Notes reuse the
same definition of "staff" — the two roles that already see every topic are the two that see
every note.

**4. There is no optimistic-concurrency precedent.** No repository in `apps/api/src/adapters/db/`
guards an `UPDATE` with a version; every edit endpoint is last-write-wins. Topic content is
edited by one author in the backoffice, so it never mattered. A note autosaves from a
student's browser, where two tabs are ordinary, so it does (§4).

**5. Timestamps have one-second resolution.** Every table uses
`DEFAULT (datetime('now'))` (`YYYY-MM-DD HH:MM:SS`). Two autosaves inside the same second
produce the same `updated_at`, which is why §4 versions with an integer, not a timestamp.

**6. Markdown sanitisation exists.** `sanitizeMarkdown` (`packages/shared/utils/sanitize-markdown.ts`)
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
  revision       INTEGER NOT NULL DEFAULT 1,  -- +1 on every write, by anyone (§4)
  shared_at      TEXT,                         -- last time it became shared
  moderated_at   TEXT,                         -- set by an admin force-unshare; blocks re-sharing
  moderated_by   TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (topic_node_id, author_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_notes_author ON topic_notes (author_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_topic_notes_topic  ON topic_notes (topic_node_id, visibility);
```

- **Hard delete, not soft delete.** When the author deletes a note it is gone. Comments
  soft-delete to keep threads coherent; notes have no thread to keep.
- **`UNIQUE (topic_node_id, author_id)`** makes "my note on this topic" a single row.
- **`revision`** is the concurrency token of §4. `updated_at` stays for display only.

### 2. Shared domain

`packages/shared/domain/notes/limits.ts` holds `NOTE_BODY_MAX = 20_000` (characters, after
sanitisation), read by the API validator and the web editor's counter — the
`domain/media/limits.ts` precedent.

`packages/shared/types/entities.ts` gains, under `Entities.Engagement`:

```ts
interface Note {
  id: string; topicNodeId: string; authorId: string; authorName: string;
  body: string; visibility: Config.NoteVisibility;   // 'private' | 'shared'
  revision: number;
  sharedAt: string | null; moderated: boolean;
  createdAt: string; updatedAt: string;
}
```

### 3. Access rules

All rules live in `NotesController`; routes only pass the caller, their roles and the
effective access set. "Staff" = `admin` or `content_creator`.

| Action | Student (author) | Other student | Staff |
|---|---|---|---|
| Read/write own note on T | ✅ if T readable | — | — |
| Read a **private** note | ✅ own | ❌ `404` | ✅ read-only |
| Read a **shared** note | ✅ own | ✅ if T readable | ✅ read-only |
| List notes on T | shared notes (incl. own) | shared notes | **all** notes, with visibility badge |
| Share / unshare own note | ✅ unless moderated (`409 NOTE_MODERATED`) | — | — |
| Edit or delete someone else's note | — | ❌ `404` | ❌ `403` |
| Force-unshare / clear moderation | — | — | `admin` only (Open Question 2) |

"T readable" = published, not archived, in the caller's effective access set; any miss is
`404`. Staff bypass the effective-access check, as they do for topics.

Decisions encoded in the table:

- **Private means private among students** (decided 2026-09-27). Staff read private notes to
  follow how a topic is being studied. The editor states this under the visibility switch —
  *"Private: only you and the staff (admins and content creators) can read it"* — so the
  student is never misled about who can see their text.
- **Staff access is read-only.** There is no staff edit or delete path; the only staff write
  is moderation, and it changes visibility, never the body.
- **Moderation is an unshare, not a delete** (reinforced 2026-09-27).
  `POST /v1/admin/notes/{id}/unshare` sets `visibility = 'private'`, `moderated_at`,
  `moderated_by` and bumps `revision`. The author keeps the text and can keep editing it
  privately; re-sharing returns `409 NOTE_MODERATED` until an admin clears the flag
  (`DELETE /v1/admin/notes/{id}/moderation`). The author's editor shows a banner
  *"An administrator made this note private"*.
- **Losing access to a topic does not take the student's words away.** "My notes" lists all
  of the author's notes, each flagged `topicAccessible`. A note on a topic the student can no
  longer read is **read-only** (no edit, no share) and absent from the class listing; it can
  still be deleted.

### 4. Writing a note, and what happens with two tabs

**The write.** `PUT /v1/topics/{id}/notes/me` with
`{ body, visibility?, baseRevision }` creates or updates the caller's note. The body is
`sanitizeMarkdown`-ed, trimmed, and must be 1…`NOTE_BODY_MAX` characters (an empty body is
`400`; deleting is an explicit action). `baseRevision` is the `revision` the client last
received — `0` when the client believes no note exists yet. The web editor autosaves after
~2 s without typing, and every successful response hands back the new `revision`, which the
tab keeps for its next save.

**The check is one SQL statement.** An update is:

```sql
UPDATE topic_notes
   SET body = ?1, visibility = ?2, revision = revision + 1, updated_at = datetime('now'),
       shared_at = CASE WHEN ?2 = 'shared' AND visibility = 'private'
                        THEN datetime('now') ELSE shared_at END
 WHERE topic_node_id = ?3 AND author_id = ?4 AND revision = ?5;   -- ?5 = baseRevision
```

and a first create (`baseRevision = 0`) is
`INSERT … ON CONFLICT (topic_node_id, author_id) DO NOTHING`. The repository reads
`meta.changes` from D1: **1** means the write landed; **0** means the row was not at the
revision the client thought, so nothing was written and the controller answers
`409 NOTE_STALE` with the current note (or `null` if it no longer exists) in `meta.current`.

Because the version test and the write are the **same statement**, SQLite executes them
atomically — there is no window between "check" and "write" for another request to slip
into, which a `SELECT` followed by an `UPDATE` would have (D1 does not hold a transaction
across two separate calls from a Worker). And because the token is an integer that
increments on every write, two saves in the same second are still told apart, which
`updated_at` could not do (Current State §5).

**Walkthrough — the same note open in tab A and tab B:**

| Step | Tab A | Tab B | Row in D1 |
|---|---|---|---|
| 1 | opens note, holds `revision 3` | opens note, holds `revision 3` | `rev 3`, text *X* |
| 2 | types, autosaves `baseRevision 3` → `WHERE revision = 3` matches → **200**, holds `rev 4` | — | `rev 4`, text *X+a* |
| 3 | — | types, autosaves `baseRevision 3` → `WHERE revision = 3` matches **0 rows** → **409 NOTE_STALE**, `meta.current` = `rev 4`, *X+a* | unchanged, `rev 4` |
| 4 | — | autosave **pauses**; banner: *"This note was changed in another window."* with **Load latest** / **Keep mine** | unchanged |
| 5a | — | **Load latest** → editor replaced by *X+a*, holds `rev 4`, B's unsaved text copied to the clipboard | unchanged |
| 5b | — | **Keep mine** → re-sends B's text with `baseRevision 4` → **200**, `rev 5` (A's text is now overwritten *by an explicit choice*) | `rev 5`, text *X+b* |

Tab A learns about B's write the same way the next time it saves: it holds `rev 4`, the row
is at `rev 5`, so A gets the 409 and the banner. Neither tab ever overwrites the other
without the student pressing a button.

**Without this check** (last-write-wins, how every other edit endpoint works today), step 3
would succeed and silently replace *X+a* with *X+b*: tab A's paragraph is gone, and nothing
tells the student.

**Other writers go through the same token:**
- **Admin force-unshare** bumps `revision`. An author editing the note in an open tab gets
  `409` on the next autosave, and the banner explains the note was made private by an
  administrator — rather than the tab silently re-sharing it.
- **Delete in tab A while tab B edits**: B's next save matches no row → `409` with
  `meta.current = null`; the banner offers **Recreate** (sends `baseRevision 0`) or
  **Discard**.
- **Two tabs both creating the first note**: the second `INSERT … ON CONFLICT DO NOTHING`
  writes nothing → `409` with the note the first tab created.

What this does **not** do: merge two versions. A student who types in both tabs chooses one
of them (and has the other on the clipboard). Real merging is a collaborative-editing
feature and is out of scope.

### 5. HTTP surface

Mounted like comments — `buildNotesRouter` at `v1.route('/', …)`, behind `authGuard`.

| Method & path | Who | Purpose | Success |
|---|---|---|---|
| `GET /v1/topics/{id}/notes/me` | student | The caller's note on the topic | `200 { data: Note \| null }` |
| `PUT /v1/topics/{id}/notes/me` | student | Upsert `{ body, visibility?, baseRevision }` | `200 Note` (`201` on create) · `409 NOTE_STALE` · `409 NOTE_MODERATED` |
| `DELETE /v1/topics/{id}/notes/me` | student | Hard-delete the caller's note | `204` |
| `GET /v1/topics/{id}/notes?cursor=` | any | Students: shared notes. Staff: all notes. Newest first, page of 20 | `200 { data: Note[], nextCursor }` |
| `GET /v1/me/notes?cursor=` | student | Every note the caller wrote, newest `updatedAt` first, with topic title and `topicAccessible` | `200 { data, nextCursor }` |
| `POST /v1/admin/notes/{id}/unshare` | admin | Force-unshare (moderation) | `200 Note` |
| `DELETE /v1/admin/notes/{id}/moderation` | admin | Clear the moderation flag | `204` |

- The class listing for students is ordered by `shared_at` desc and includes the caller's own
  shared note flagged `isMine`. It never returns a private row to a non-staff caller,
  whatever the parameters.
- Cursors are opaque (`base64(sortKey|id)`). This is the **first cursor-paginated endpoint**
  in the API (existing lists return everything), so the cursor helper lands in
  `routes/_shared/` for reuse.

### 6. Ports & adapters

```ts
export interface INoteRepository {
  findMine(topicNodeId: string, authorId: string): Promise<NoteRecord | null>;
  findById(id: string): Promise<NoteRecord | null>;
  /** Conditional write of §4; `stale` carries the current row (or null) when 0 rows changed. */
  saveMine(p: SaveNoteParams): Promise<{ ok: true; note: NoteRecord; created: boolean }
                                      | { ok: false; stale: NoteRecord | null }>;
  deleteMine(topicNodeId: string, authorId: string): Promise<boolean>;
  listByTopic(topicNodeId: string, opts: { includePrivate: boolean; viewerId: string; page: CursorPage }): Promise<Paged<NoteRecord>>;
  listByAuthor(authorId: string, page: CursorPage): Promise<Paged<AuthoredNoteRecord>>;
  setModeration(id: string, adminId: string | null): Promise<NoteRecord | null>;
}
```

`includePrivate` is decided by the controller from the caller's roles, never taken from the
request. The repository is instantiated per request in the container's `engagement` slice,
next to `commentRepo`.

### 7. Web surface

- **Topic page** (`(protected)/catalog/[id]`) gets a **Notes** panel beside Discussion with two
  tabs: *My note* — a Markdown editor with preview, debounced autosave, a save-state
  indicator (saving / saved / conflict), the private/shared switch with the audience line of
  §3, and the moderation banner when applicable; and *Class notes* — shared notes rendered
  with the catalog's existing sanitised Markdown renderer.
- **Staff** see *Class notes* with every note on the topic, each with a *private* / *shared*
  badge; admins get an **Unshare** action on shared notes and **Allow sharing again** on
  moderated ones. Staff never see an editor on someone else's note.
- **Sharing is a deliberate act**: switching to *shared* shows a one-line confirmation that
  classmates will see the note with the author's name.
- **"My notes"** (`(protected)/notes`) lists the caller's notes grouped by topic with
  visibility and moderation badges, last edit, and a link back to the topic; read-only rows
  show why ("you no longer have access to this topic").
- **i18n**: a `notes:` section in `dict-en.ts` / `dict-pt.ts` with identical keys;
  `check-i18n-coverage.js` stays green.

## Alternatives Considered

1. **Extend `topic_comments` with `visibility` and an edit endpoint.** Rejected. Comments are
   public by construction, soft-deleted to keep reply threads coherent, and award
   `comment_posted` XP. A private, editable comment would change every reader of that table
   and silently start awarding XP for private writing.
2. **Many notes per topic (titled notes, like a notebook of pages).** Deferred, not rejected.
   One note per topic keeps the "revise your summary" workflow simple. Relaxing the `UNIQUE`
   later is additive; tightening it later would not be.
3. **Peer rating of shared notes (1–5, one rating per reader, Bayesian ranking).** Removed from
   scope by the product owner on 2026-09-27; **deferred, not rejected**. The first draft of
   this RFC specified it (a `note_ratings` table keyed `(note_id, rater_id)`, anonymous raters,
   aggregates computed on read). Nothing here blocks adding it later: it is a new table
   referencing `topic_notes.id` plus a `sort=top` option on the class listing.
4. **Private notes hidden from staff too.** Rejected on 2026-09-27: staff need to follow how
   students study a topic. Mitigated by telling the student in the editor who can read a
   private note.
5. **Version by `updated_at` instead of an integer `revision`.** Rejected: `datetime('now')`
   has one-second resolution, so two autosaves in the same second would share a token and a
   lost update would go undetected.
6. **Read-then-write concurrency check (`SELECT revision`, compare, then `UPDATE`).** Rejected:
   two requests can interleave between the two statements; the conditional `UPDATE` is atomic.
7. **Last-write-wins (no check), like every other edit endpoint.** Rejected: with autosave and
   two tabs, it loses text silently — the one failure a notebook must not have.
8. **Live sync between tabs** (BroadcastChannel / WebSocket push). Deferred: it improves the
   experience but does not remove the need for the server-side check (a second device has no
   shared channel), so the check comes first.

## Implementation Plan

Total: **~4–5 dev days**, as one milestone with backend and frontend tasks kept separate.

### Phase 0 — Shared foundations (~0.5 d)
Entity types, `Config.NoteVisibility`, `domain/notes/limits.ts`, `INoteRepository` port.

### Phase 1 — Schema and repository (~1 d)
Migration `0028`, `D1NoteRepository` with the conditional write of §4 (`meta.changes`),
listing with `includePrivate`, cursor pagination; repository tests on the Workers pool,
including the same-second double write.

### Phase 2 — Student and staff API (~1 d)
`NotesController`, `GET/PUT/DELETE /v1/topics/{id}/notes/me`, `GET /v1/topics/{id}/notes`,
`GET /v1/me/notes`, the access table of §3 as tests (student ↔ student `404`, staff read-only),
`409 NOTE_STALE`.

### Phase 3 — Moderation API (~0.5 d)
Admin unshare / clear moderation, `409 NOTE_MODERATED`, revision bump, OpenAPI schemas and
regenerated `api-types.gen.ts`.

### Phase 4 — Web (~1.5 d)
`notes-api.ts`, Notes panel (editor, autosave, save-state indicator, conflict and moderation
banners, audience line), Class notes with staff badges and admin actions, "My notes" page,
dictionaries in both languages, component tests including the two-tab conflict.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| Students assume "private" means nobody else reads it | The audience line under the switch names staff explicitly; same text in "My notes" |
| Abusive content in a shared note | Admin force-unshare with sticky `moderated_at`; the author keeps their private text |
| Admin unshares while the author is editing, and the tab re-shares it | Moderation bumps `revision`; the tab's next save is `409` and shows the moderation banner |
| Two tabs overwrite each other | Conditional `UPDATE … WHERE revision = ?`, `409 NOTE_STALE`, explicit Load latest / Keep mine |
| A student ignores the banner and keeps typing in a stale tab | Autosave stays paused while in conflict; the indicator shows *not saved* |
| Large notes bloat the class listing payload | `NOTE_BODY_MAX = 20 000`; page size 20; an `excerpt` field can be added later without breaking clients |
| Migration number collides with RFC 0015 | Whichever lands second renumbers its migration; noted in **Affected** |

## Success Criteria

- (Ph 2) A student creates, reads, edits and deletes their note on a readable topic; a draft,
  archived or out-of-access topic answers `404`.
- (Ph 2) Another student gets `404` for someone else's **private** note through every endpoint,
  and the class listing never contains it.
- (Ph 2) An admin and a content creator can read every note on a topic, private included, and
  get `403` on any attempt to edit or delete one.
- (Ph 1–2) A write with a stale `baseRevision` returns `409 NOTE_STALE`, leaves the row
  unchanged, and returns the current note; two writes in the same second with the same
  `baseRevision` produce exactly one `200` and one `409`.
- (Ph 3) Force-unshare hides the note from students, bumps `revision`, and blocks re-sharing
  with `409 NOTE_MODERATED` until an admin clears it; the body is never changed.
- (Ph 4) With the same note open in two tabs, neither tab's text is lost without the student
  choosing it; the flow works in both `pt` and `en` builds and the i18n coverage check passes.

## Open Questions

1. **Should notes feed gamification?** Candidates: XP once per note when first shared
   (idempotency key = note id), a quest kind `share_note`. Sharing is not a quality signal on
   its own, so XP would reward empty shares. Recommendation: ship without. *Owner: product.*
2. **Can a `content_creator` moderate, or only `admin`?** Both can read every note; the draft
   gives the unshare power to `admin` only, matching comment deletion. *Owner: product.*
3. **Staff views beyond the topic page.** Staff read notes topic by topic in *Class notes*.
   Is a per-student view in the user backoffice ("all notes by this student") needed in this
   RFC, or later? *Owner: product.*
4. **Tutors.** The `tutor` role exists but has no content powers today. Does it read notes
   like staff, only shared ones, or none? The draft gives it the student view. *Owner: product.*
5. **Deactivated authors.** `ON DELETE CASCADE` covers hard deletion; a deactivated (not
   deleted) user's shared notes stay listed. Hide them? *Owner: product.*

## Resolved Decisions

- **2026-09-27 — Private is private among students only** (product owner). Staff
  (`admin`, `content_creator`) read every note. Replaces the first draft's "no role bypass".
- **2026-09-27 — Peer rating removed from scope** (product owner). Recorded as Alternatives §3,
  deferred.
- **2026-09-27 — Admin moderation by force-unshare is required** (product owner).
- **2026-09-27 — Concurrency is detected with an integer `revision` in a conditional `UPDATE`**
  (this revision), replacing the first draft's `baseUpdatedAt`, which a same-second double
  save would defeat.

## References

- Relevant code: `apps/api/migrations/0022_create_topic_comments.sql`,
  `apps/api/src/controllers/comments.controller.ts`, `apps/api/src/routes/comments.router.ts`,
  `apps/api/src/controllers/topics.controller.ts` (`getPublishedById`),
  `packages/shared/utils/sanitize-markdown.ts`,
  `packages/shared/domain/media/limits.ts` (single-table precedent),
  `apps/web/src/components/catalog/Discussion.tsx`
- Related RFCs: RFC 0005 (effective access set and node visibility — the gate notes reuse),
  RFC 0003 (route organisation and OpenAPI), RFC 0009 (gamification catalog — where note XP
  would plug in, Open Question 1)
