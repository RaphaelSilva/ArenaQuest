# Task 08 — Backend: Local seed and documentation closeout (Phase 5)

**Status:** ✅ Done
**Milestone:** [21 — Student notes — private and shared topic notes with staff moderation](./milestone.md)
**RFC:** [RFC 0016](../../RFCs/0016-student-notes.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-staff-notes-api.task.md), [Task 07](./07-staff-notes-web.task.md)

## Summary

Closes the milestone. A local-only seed adds example notes for the seeded test accounts —
one private note, one shared note and one moderated note on a published topic — so every
state the UI renders is reachable right after `make db-reset-local`, and the no-dev-seed
guard keeps it out of every deployed environment. `CLAUDE.md` gains a short *Student notes*
paragraph under the API architecture (privacy among students, staff read-only, moderation
by force-unshare, the `revision` concurrency contract and its `409 NOTE_STALE`), and
`docs/product/FEATURES.md` gains the feature. A `closeout-analysis.md` records what shipped
against §3 of the milestone and any drift. Finally RFC 0016's status moves to
`Implemented` in its header and its README row, with the milestone linked.

## Dependencies

- [Task 04](./04-staff-notes-api.task.md) — code dependency: the seed must match the final
  schema and moderation shape.
- [Task 07](./07-staff-notes-web.task.md) — ordering: the closeout asserts the whole
  milestone is complete, so it is written last.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/seed/0004_notes_local.sql` (new; next free seed number) and, only
    if the seed target enumerates files, the `db-seed-local` target in `Makefile`.
  - `CLAUDE.md` — one *Student notes* paragraph.
  - `docs/product/FEATURES.md` — one feature entry.
  - `docs/product/milestones/21-student-notes/closeout-analysis.md` (new) and the status
    lines of `milestone.md` and the task files.
  - `docs/product/RFCs/0016-student-notes.md` `Status:` header and its row in
    `docs/product/RFCs/README.md`.
- **Local only.** The seed must be rejected by `apps/api/scripts/check-no-dev-seed.ts` for
  staging and production; it is idempotent.
- **No code change.** No application source file (under `apps/*/src/` or `packages/`) is
  modified.

## Scope

In:
- The local seed with the three note states for seeded students.
- `CLAUDE.md` and `FEATURES.md` entries.
- `closeout-analysis.md`; milestone, task and RFC status updates.

Out:
- Any behaviour change — a gap found here becomes a new task, not a patch.

## Acceptance Criteria

- [x] `make db-reset-local` produces one private, one shared and one moderated note; running
      `make db-seed-local` again changes nothing.
- [x] The no-dev-seed guard rejects the seed for a deployed environment.
- [x] `CLAUDE.md` documents the privacy rule, staff read-only access, moderation and the
      `revision` / `409 NOTE_STALE` contract; `FEATURES.md` lists the feature.
- [x] `closeout-analysis.md` exists and walks the milestone's §3 criteria.
- [x] RFC 0016 reads `Implemented` in its header and in `docs/product/RFCs/README.md`, with
      Milestone 21 linked.
- [x] Changed files lint clean; `make test-api` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`; log in as the seeded students and staff and see the three states.
2. Run `make db-seed-local` twice and confirm no duplicate rows.
3. Run the no-dev-seed guard against a staging profile and confirm it refuses.
4. `node .claude/skills/write-rfc/check-rfc.mjs` and
   `node .claude/skills/write-tasks/check-task.mjs --milestone 21`.
5. `make test-api`; `make lint`.
6. `git diff --stat` confirms only guardrail files changed.
