# Task 01 — Backend: Notes contracts — entity, visibility, body limit and repository port (Phase 0)

**Status:** ✅ Done
**Milestone:** [21 — Student notes — private and shared topic notes with staff moderation](./milestone.md)
**RFC:** [RFC 0016](../../RFCs/0016-student-notes.md)
**Team:** Backend API

## Summary

Defines the vocabulary every later task speaks, with no behaviour of its own. The shared
package gains the `Note` entity under `Entities.Engagement` — id, topic, author id and
display name, Markdown body, visibility, the integer `revision` that is the note's
concurrency token, `sharedAt`, a `moderated` flag, and the two timestamps — plus the
`NoteVisibility` enum under `Entities.Config` with exactly two values, `private` and
`shared`. A new `domain/notes/limits.ts` holds `NOTE_BODY_MAX` (20 000 characters, counted
after sanitisation), following the `domain/media/limits.ts` precedent so the API validator
and the web editor's counter read one number. A new `INoteRepository` port declares the
persistence contract of RFC 0016 §6: find the caller's note on a topic, find by id, a
**conditional save** that reports either the written note (and whether it was created) or
a *stale* outcome carrying the current row or `null`, delete the caller's note, list a
topic's notes with an `includePrivate` switch the controller decides, list an author's
notes, and set or clear moderation. The port speaks in revisions and outcomes, never in
SQL or D1 result shapes. Task 02 implements it; Tasks 03–04 consume it.

## Dependencies

- None — independent.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/types/entities.ts` — add `Entities.Engagement.Note` and
    `Entities.Config.NoteVisibility`; no existing type changes.
  - `packages/shared/ports/i-note-repository.ts` (new) and its export in
    `packages/shared/ports/index.ts`.
  - `packages/shared/domain/notes/limits.ts` (new) and, if the package exposes domain
    modules through an index, that one export line.
  - `packages/shared/**/__tests__` or the package's existing test location — a unit test
    pinning the limit and the enum values.
- **Ports & Adapters.** The port names no Cloudflare, D1 or SQL concept: no `meta.changes`,
  no `D1Result`, no statement objects. A stale write is a typed outcome, not an exception.
- **Cloud-agnostic.** Nothing in `packages/shared` imports a provider SDK.
- **No rating vocabulary.** No `rating`, `score` or `NoteRating` type is introduced — peer
  rating was removed from RFC 0016.
- **No gamification coupling.** `XpAction` and everything under `domain/gamification/` stay
  untouched.

## Scope

In:
- `Entities.Engagement.Note` and `Entities.Config.NoteVisibility`.
- `NOTE_BODY_MAX` in `domain/notes/limits.ts`.
- `INoteRepository` with record, parameter, page and outcome types sufficient for Tasks
  02–04 (cursor page in, `{ data, nextCursor }` out).
- A small unit test asserting the enum's two values and the limit's value.

Out:
- The migration and the D1 adapter — Task 02.
- Any controller, route or HTTP schema — Tasks 03–04.
- Any frontend change.

## Acceptance Criteria

- [x] `Entities.Engagement.Note` and `Entities.Config.NoteVisibility` are exported and
      consumable from `@arenaquest/shared`; `NoteVisibility` has exactly `private` and
      `shared`.
- [x] `NOTE_BODY_MAX` equals `20000` and is imported from one module only.
- [x] `INoteRepository`'s conditional save returns a discriminated outcome (written vs.
      stale-with-current) — no method signals staleness by throwing.
- [x] No provider-specific (D1/R2) import leaks into the port or the shared types.
- [x] `git grep -n "Rating" packages/shared` returns nothing new.
- [x] Changed files lint clean; `make test-api` green (the shared package still builds for
      every consumer).
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make build` — every workspace compiles against the new shared exports.
2. Run the shared unit test for the enum and limit.
3. `make lint`.
4. `make test-api` — the pre-existing suite is unchanged.
5. `git diff --stat` confirms only the guardrail files changed.
