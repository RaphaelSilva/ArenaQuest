# Task 02 — Backend: Notes schema and D1 repository with revision-guarded writes (Phase 1)

**Status:** ✅ Done
**Milestone:** [21 — Student notes — private and shared topic notes with staff moderation](./milestone.md)
**RFC:** [RFC 0016](../../RFCs/0016-student-notes.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-shared-contracts.task.md)

## Summary

Creates the `topic_notes` table and the `D1NoteRepository` that implements
`INoteRepository`. The table (RFC 0016 §1) holds one row per `(topic_node_id, author_id)`
— enforced by a unique constraint — with a Markdown body, a `visibility` restricted to
`private`/`shared` and defaulting to `private`, an integer `revision` starting at 1,
`shared_at`, the moderation pair `moderated_at`/`moderated_by`, and the two timestamps;
`author_id` cascades on user deletion, and two indexes serve "notes by author" and "notes on
a topic by visibility". The heart of the task is the **conditional save** of RFC 0016 §4:
an update succeeds only when the stored `revision` equals the caller's `baseRevision`, and
the version test and the write are **one statement**, so SQLite applies them atomically and
no concurrent request can slip between check and write; a first create (`baseRevision` 0)
is an insert that does nothing on a unique-key conflict. The adapter reads the number of
rows the statement changed: one means written (with `revision` incremented and
`shared_at` stamped on a private→shared transition), zero means stale, and the adapter
then returns the current row — or `null` if the note no longer exists — as the stale
outcome. Moderation writes go through the same token: setting moderation also forces
`private` and increments `revision`; clearing it touches only the flag. Listings are
cursor-paginated (page of 20), newest first, and the topic listing returns private rows
**only** when the caller-supplied `includePrivate` is true. Tasks 03–04 build the HTTP
surface on this.

## Dependencies

- [Task 01](./01-shared-contracts.task.md) — hard code dependency: the port and entity this
  adapter implements.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/0028_create_topic_notes.sql` (new) — additive: one new table, two
    indexes, no change to any existing table. Renumber if RFC 0015's migration lands first.
    Rollback is dropping the table; no existing data depends on it.
  - `apps/api/src/adapters/db/d1-note-repository.ts` (new).
  - `apps/api/test/**` — adapter specs against the Workers pool.
- **The concurrency check is one statement.** A read-then-compare-then-write sequence is a
  review failure: D1 holds no transaction across two calls from a Worker, so it has a race
  window (RFC 0016 Alternatives §6).
- **The token is `revision`, never a timestamp.** `datetime('now')` has one-second
  resolution; a check on `updated_at` would miss two writes in the same second (RFC 0016
  Alternatives §5).
- **Moderation bumps `revision`; it never touches `body`.**
- **`includePrivate` is a parameter, not a policy.** The adapter never decides who may see
  private rows; it obeys the flag the controller passes (Task 03).
- **Ports & Adapters / cloud-agnostic.** D1 types stay inside the adapter; the outcome it
  returns is the port's type.
- **No rating table.** No `note_ratings` or equivalent is created.

## Scope

In:
- Migration `0028` exactly as RFC 0016 §1 describes it.
- `D1NoteRepository` implementing every `INoteRepository` method: find mine, find by id,
  conditional save (create and update paths), delete mine, list by topic
  (`includePrivate`), list by author (with topic title), set/clear moderation.
- Opaque, stable cursor encoding for both listings (newest `shared_at` for the class
  list, newest `updated_at` for the author list, id as tie-breaker).
- Specs: create; update at the right revision; update at a stale revision returns the
  current row unchanged; two saves with the same `baseRevision` in the same second yield
  one write and one stale; create when a row exists is stale; update after delete is stale
  with `null`; private→shared stamps `shared_at`; moderation forces `private`, bumps
  `revision`, leaves `body` byte-identical; listings exclude private rows unless
  `includePrivate`; pagination is stable across pages; user deletion cascades.

Out:
- Access rules, roles and the effective-access gate — Task 03.
- HTTP routes and OpenAPI — Tasks 03–04.
- Any frontend change.

## Acceptance Criteria

- [x] `make db-migrate-local` applies `0028` cleanly to a fresh replica; the table has the
      unique `(topic_node_id, author_id)`, the `visibility` check, `revision` defaulting to
      1, and both indexes.
- [x] A spec issuing two saves with the same `baseRevision` back to back asserts exactly one
      written outcome and one stale outcome, and the stored body is the first one.
- [x] A stale outcome carries the current row (or `null` after a delete) and the stored row
      is unchanged.
- [x] Setting moderation leaves `body` byte-identical, sets `visibility` to `private`, and
      increments `revision`.
- [x] The topic listing with `includePrivate` false never returns a private row, including
      when fed a cursor taken from an `includePrivate` true listing.
- [x] No provider-specific (D1/R2) import leaks into a port or controller.
- [x] Changed files lint clean; `make test-api` green for the affected specs.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local` and inspect the new table's schema, constraint and indexes.
2. `make test-api` — the repository specs pass, including the same-second double save.
3. `make lint`.
4. `git diff --stat` confirms only the migration, the adapter and its specs changed.
