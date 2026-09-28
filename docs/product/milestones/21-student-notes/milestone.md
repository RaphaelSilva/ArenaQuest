# Milestone 21 — Student notes — private and shared topic notes with staff moderation

**Status:** 📝 Draft
**Scope:** `apps/api` (notes bounded context in the `engagement` group), `packages/shared` (notes types, port and body limit), `apps/web` (topic Notes panel, "My notes" page, staff surfaces in the catalog and the user backoffice). Derived from [RFC 0016](../../RFCs/0016-student-notes.md).

> **Hard scope guardrail — read before opening any task.** This milestone may touch **only**: `apps/api/migrations/0028_create_topic_notes.sql` (renumbered if RFC 0015's migration lands first); the new notes files `apps/api/src/{adapters/db/d1-note-repository.ts,controllers/notes.controller.ts,routes/notes.router.ts,routes/me/notes.ts,routes/admin/notes.ts}` and their wiring in `container.ts` (the `engagement` group gains `noteRepo`; no other group changes shape), `routes/index.ts`, `routes/me/index.ts` and `routes/admin/index.ts`; a cursor helper under `apps/api/src/routes/_shared/`; the regenerated `apps/api/openapi.json`; `apps/api/test/**`; the shared additions `packages/shared/{types/entities.ts (Entities.Engagement.Note + Config.NoteVisibility),ports/i-note-repository.ts,ports/index.ts,domain/notes/limits.ts}`; on the web, `apps/web/src/components/catalog/notes/**`, the Notes panel mount in `apps/web/src/app/(protected)/catalog/[id]/page.tsx`, the new `apps/web/src/app/(protected)/notes/**`, a *Notes* section in `apps/web/src/app/(protected)/admin/users/[userId]/page.tsx`, one "My notes" entry in `apps/web/src/components/layout/nav.tsx`, `apps/web/src/lib/notes-api.ts`, the regenerated `apps/web/src/lib/api-types.gen.ts`, and both i18n dictionaries (+ `types.ts`); and, for the closeout only, a new local seed under `apps/api/migrations/seed/`, `CLAUDE.md`, `docs/product/FEATURES.md`, RFC 0016's `Status:` header and its `docs/product/RFCs/README.md` row. It is explicitly **not** an opportunity to: add **peer rating** of notes or any `note_ratings` table (removed from RFC 0016, deferred); award **XP, quests or badges** for notes, or touch `packages/shared/domain/gamification/**` or `xpEngine`; allow **several notes per topic**, titles, folders or tags; give staff an **edit or delete** path on a student's note; give the **`tutor`** role any power beyond a student's; add **anonymous sharing**, comments/threads on notes, real-time collaboration, version history, media attachments or notifications; change **comments** (`comments.controller.ts`, `comments.router.ts`, `Discussion.tsx`, `0022_*`) — including their `403`-vs-`404` inconsistency, which is its own backlog item; or modify `getEffectiveAccessTopicIds`, `d1-enrollment-repository.ts` or `topics.controller.ts`. If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **A `topic_notes` entity, one note per student per topic.** Markdown body sanitised on write, `private` by default, hard-deleted by its author, with an integer `revision` as its concurrency token (RFC §1, §2).
- **Privacy among students, transparency with staff.** No student can reach another student's private note through any endpoint; `admin` and `content_creator` read every note, read-only; the editor tells the student exactly who can read a private note (RFC §3).
- **The catalog's access gate, not the comments' one.** Every student-facing note route requires the topic to be published, not archived and in the caller's effective access set, answering `404` on any miss (RFC Current State §2, §3).
- **No silent lost update.** Writes are conditional on `revision` in a single SQL statement; a stale write is `409 NOTE_STALE` with the current note, and the editor resolves it only by an explicit student choice (RFC §4).
- **Sharing with the class.** A shared note is listed on the topic for every student who can read it, newest first, with the author's name (RFC §5).
- **Staff moderation by force-unshare.** Both staff roles can unshare a shared note and later allow sharing again; moderation never changes the body and bumps `revision` so an open editor notices (RFC §3, Resolved Decisions).
- **Review surfaces.** "My notes" for the student across all topics; a per-student notes section in the user backoffice for staff (RFC §5, §7).
- **Full i18n coverage** across `dict-en`/`dict-pt`, enforced by `check-i18n-coverage.js` (RFC §7).

Out of scope (explicit, from RFC 0016 Non-Goals):
- **Peer rating of shared notes** — removed by the product owner on 2026-09-27; RFC 0016 Alternatives §3 keeps the design for a future RFC, which would add a table referencing `topic_notes.id`.
- **XP, quests or badges for notes** — decided 2026-09-27; sharing is not a quality signal, and XP would reward empty shares.
- **Several notes per topic, titles, folders, tags** — the `UNIQUE (topic_node_id, author_id)` keeps one note; relaxing it later is additive.
- **Staff editing or deleting a student's note** — staff read and unshare; the text is always the student's.
- **Tutor powers over notes** — a `tutor` sees notes as a student does.
- **Anonymous sharing, comments on notes, real-time collaboration, version history, media attachments, notifications** — each a separate future decision; none changes this schema.

---

## 2. Functional Requirements

**Student — own note**
- `GET /v1/topics/{id}/notes/me` returns the caller's note on the topic, or `data: null` when none exists.
- `PUT /v1/topics/{id}/notes/me` with `{ body, visibility?, baseRevision }` creates the note (`201`, when `baseRevision` is `0`) or updates it (`200`), returning the note with its new `revision`.
- The body is sanitised with `sanitizeMarkdown`, trimmed, and must be 1…`NOTE_BODY_MAX` (20 000) characters; an empty body is `400`.
- A write whose `baseRevision` does not match the stored row — including a create when a note already exists, and an update when the note was deleted — changes nothing and returns `409 NOTE_STALE` with the current note (or `null`) in `meta.current`.
- `DELETE /v1/topics/{id}/notes/me` hard-deletes the caller's note (`204`).
- Setting `visibility: 'shared'` on a moderated note returns `409 NOTE_MODERATED`; setting it on a private note stamps `sharedAt`.
- Every route above answers `404` when the topic is draft, archived, missing or outside the caller's effective access set.

**Student — class notes and review**
- `GET /v1/topics/{id}/notes?cursor=` returns, to a student or tutor, only **shared** notes on the topic, newest `sharedAt` first, pages of 20 with an opaque `nextCursor`; the caller's own shared note is included and flagged `isMine`.
- A private note of another student never appears in any response to a student or tutor, whatever the parameters; a direct read of one is `404`.
- A deactivated (not deleted) author's shared notes stay listed with their name.
- `GET /v1/me/notes?cursor=` returns every note the caller wrote, newest `updatedAt` first, with topic title and a `topicAccessible` flag; a note on a topic the caller can no longer read is returned read-only (no edit, no share) but can still be deleted.

**Staff**
- On `GET /v1/topics/{id}/notes`, `admin` and `content_creator` receive **all** notes on the topic, private included, each with its visibility; they bypass the effective-access check as they do for topics.
- `GET /v1/admin/users/{userId}/notes?cursor=` returns every note by that student, private included, to staff only.
- `POST /v1/admin/notes/{id}/unshare` sets the note private, records `moderatedAt`/`moderatedBy`, bumps `revision` and never alters the body; `DELETE /v1/admin/notes/{id}/moderation` clears the flag (`204`). Both roles may call them; students and tutors get `403`.
- Staff have no route that edits or deletes another user's note.

**Web**
- The topic page shows a Notes panel beside Discussion with *My note* (Markdown editor + preview, debounced autosave, save-state indicator, private/shared switch with the audience line, share confirmation, moderation banner) and *Class notes*.
- On `409 NOTE_STALE` the editor pauses autosave and offers **Load latest** (unsaved text copied to the clipboard) or **Keep mine** (re-send on the current revision); a deleted-elsewhere note offers **Recreate** or **Discard**.
- "My notes" (`/notes`) lists the caller's notes grouped by topic with visibility and moderation badges and read-only rows explained.
- Staff see visibility badges and **Unshare** / **Allow sharing again** in *Class notes* and in the user backoffice *Notes* section; no editor appears on someone else's note.
- Every string comes from the dictionaries; `pt` and `en` builds both render.

---

## 3. Acceptance Criteria

- [ ] A student's `PUT` → `GET` → `DELETE` cycle on a readable topic returns `201`/`200`, the stored note, then `204`; the same calls on a draft, archived or out-of-access topic return `404`.
- [ ] Another student gets `404` reading a private note directly and never sees it in `GET /v1/topics/{id}/notes`, asserted over both visibilities and with a crafted `cursor`.
- [ ] An `admin` and a `content_creator` token each list every note on a topic (private included) and every note of one student via `GET /v1/admin/users/{userId}/notes`; any attempt by either to edit or delete another user's note is rejected and the row is unchanged.
- [ ] Two `PUT`s with the same `baseRevision`, issued within the same second, produce exactly one `200` and one `409 NOTE_STALE`, and the row holds the first body.
- [ ] Force-unshare by each staff role hides the note from students, increments `revision`, leaves `body` byte-identical, and makes the author's next share return `409 NOTE_MODERATED` until the flag is cleared; a student or tutor calling it gets `403`.
- [ ] A `tutor` token sees exactly what a student sees on every notes route.
- [ ] In the browser, the same note open in two tabs never loses text without the student pressing **Keep mine**; the flow is covered by a component test.
- [ ] `git grep -n "note_ratings\|NoteRating" -- apps packages` returns nothing; no diff under `packages/shared/domain/gamification/`.
- [ ] `check-i18n-coverage.js` passes; `NEXT_PUBLIC_LANGUAGE=en` and default `pt` both render the panel with no hardcoded string.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] No diff outside the scope declared in the guardrail.

---

## 4. Specific Stack

- **Backend:** Cloudflare Workers + Hono; per-request adapters built in `buildApp(env)`; `NoteRepository` joins the `engagement` group beside `commentRepo`; controllers return `ControllerResult<T>` from `src/core/result.ts`. **Validation is `@hono/zod-openapi` `createRoute` + Zod at the route layer — not `@ValidateBody`/`@Body` decorators, which do not exist in this codebase** (`docs/product/backlog/refactoring/07-validatebody-documentation-drift.task.md`). `authGuard` on every route; the `/v1/admin` umbrella already admits `admin` and `content_creator`. `sanitizeMarkdown` on write. The concurrency check reads D1's `meta.changes` from a single conditional `UPDATE` / `INSERT … ON CONFLICT DO NOTHING`. `openapi.json` regenerated with `pnpm dump-openapi`.
- **Shared:** `packages/shared/types/entities.ts` gains `Entities.Engagement.Note` and `Entities.Config.NoteVisibility`; new port `ports/i-note-repository.ts` (+ `ports/index.ts`); new `domain/notes/limits.ts` (`NOTE_BODY_MAX`). No Cloudflare types in shared.
- **Database:** D1 migration `0028_create_topic_notes.sql` — `topic_notes` with `UNIQUE (topic_node_id, author_id)`, `revision`, moderation columns and two indexes. No change to any existing table.
- **Frontend:** Next.js 15 App Router (React 19, Tailwind v4); the Notes panel is a client component (autosave, conflict state); `notes-api.ts` over `fetchWithAuth`; types from the regenerated `api-types.gen.ts` (`pnpm gen:api-types`); the catalog's existing sanitised Markdown renderer; `useHasRole` for staff affordances; both i18n dictionaries + `check-i18n-coverage.js`.
- **Tests:** Vitest + `@cloudflare/vitest-pool-workers` (API — the access matrix per role, the same-second double write, moderation); Vitest + RTL (web — autosave, the two-tab conflict flow, staff badges and actions).

---

## 5. Task Breakdown

Each task is one independent PR with one owner and one review surface. Backend and frontend never share a file: RFC Phase 4 (web) lands as three Frontend tasks (`05`–`07`), and the closeout is its own Backend task (`08`).

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Notes contracts — entity, visibility, body limit and repository port](./01-shared-contracts.task.md) | 0 | Backend | ☐ Open |
| 02 | [Notes schema and D1 repository with revision-guarded writes](./02-schema-and-repository.task.md) | 1 | Backend | ☐ Open |
| 03 | [Student notes API — my note, class notes and my-notes list](./03-student-notes-api.task.md) | 2 | Backend | ☐ Open |
| 04 | [Staff notes API — per-student list and moderation](./04-staff-notes-api.task.md) | 3 | Backend | ☐ Open |
| 05 | [Topic notes panel — editor, autosave and conflict handling](./05-notes-editor-web.task.md) | 4 | Frontend | ☐ Open |
| 06 | [Class notes list and My notes page](./06-class-and-my-notes-web.task.md) | 4 | Frontend | ☐ Open |
| 07 | [Staff notes surfaces — moderation actions and user backoffice section](./07-staff-notes-web.task.md) | 4 | Frontend | ☐ Open |
| 08 | [Local seed and documentation closeout](./08-seed-and-docs.task.md) | 5 | Backend | ☐ Open |

Dependency graph:

```
01 ──► 02 ──► 03 ──► 04
               │      │
               ▼      │
              05      │
               │      │
               ▼      ▼
              06 ──► 07 ──► 08
```

**Recommended execution order:** `01` → `02` → `03` → `04` → `05` → `06` → `07` → `08`. The backend (`01`–`04`) ships first behind routes no page calls yet. `05` needs only the student API (`03`) and can run in parallel with `04`; `06` reuses the panel `05` mounts; `07` needs the staff API (`04`) and the class list (`06`). `08` is written last, because its closeout note and the RFC status change assert the milestone is complete.

Each task is intended to land as an independent PR with `make lint`, `make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC 0016 "Resolved Decisions")

1. **Private is private among students only** (product owner, 2026-09-27) — `admin` and `content_creator` read every note, read-only; the editor states this to the student. Rules out a "no role bypass" private note.
2. **Peer rating is out of scope** (product owner, 2026-09-27) — deferred, not rejected; no `note_ratings` table, no score, no `sort=top`.
3. **Moderation by force-unshare is required, and both staff roles moderate** (product owner, 2026-09-27) — unshare, never delete; `moderated_at` is sticky until staff clear it.
4. **No gamification for notes** (product owner, 2026-09-27) — no XP, quest or badge; revisit with data.
5. **Staff get a per-student view in this milestone** (product owner, 2026-09-27) — `GET /v1/admin/users/{userId}/notes` and a *Notes* section in the user backoffice.
6. **`tutor` sees notes as a student** (product owner, 2026-09-27) — shared notes only.
7. **A deactivated author's shared notes stay visible** (product owner, 2026-09-27) — no filter on account status; hard deletion cascades.
8. **Concurrency is an integer `revision` checked inside one conditional `UPDATE`** (RFC revision, 2026-09-27) — `updated_at` has one-second resolution and a read-then-write check has a race window; both were rejected.
9. **Notes follow the catalog's access gate and answer `404`**, not the comments' `403` — a draft or archived topic accepts no notes, and a miss does not reveal the topic exists.
10. **One note per student per topic, hard-deleted** — relaxing the `UNIQUE` later is additive; a note has no thread to keep coherent, so no soft delete.

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC 0016 status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items remain backlog.
- [ ] No diff outside the scope declared in the guardrail.
