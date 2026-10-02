# Task 10 — Backend: Local seed and documentation closeout (Phase 5)

**Status:** ✅ Done
**Milestone:** [23 — Student submissions](./milestone.md)
**RFC:** [RFC 0020](../../RFCs/0020-student-submissions.md)
**Team:** Backend API
**Depends On:** [Task 05](./05-staff-api-and-housekeeping.task.md), [Task 08](./08-move-and-my-demonstrations-web.task.md), [Task 09](./09-staff-surfaces-web.task.md)

## Summary

Closes the milestone. A local-only seed adds example submissions for the seeded test
accounts on a published topic — one private, one shared, one moderated and one removed
(tombstone) — so every state the UI renders is reachable right after `make db-reset-local`;
it inserts rows only, pointing at small placeholder objects the seed step uploads to the
local R2, and the no-dev-seed guard keeps it out of every deployed environment. `CLAUDE.md`
gains a short *Student submissions* paragraph under the API architecture: separate table and
`submissions/{authorId}/` prefix (never `media`), the four `SUBMISSIONS_*` vars and their
defaults, finalize's size/type/signature check, move semantics (metadata-only, reset to
private), the tombstone, and the daily sweep. `docs/product/FEATURES.md` gains the feature.
A `closeout-analysis.md` records what shipped against §3 of the milestone and any drift.
Finally RFC 0020's status moves to `Implemented` in its header and its README row.

## Dependencies

- [Task 05](./05-staff-api-and-housekeeping.task.md) — code dependency: the seed must match
  the final schema, including the tombstone.
- [Task 08](./08-move-and-my-demonstrations-web.task.md), [Task 09](./09-staff-surfaces-web.task.md)
  — ordering: the closeout asserts the whole milestone is complete, so it is written last.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/seed/00NN_submissions_local.sql` (new; next free seed number —
    `0004` is claimed by M21) and the `db-seed-local` target in `Makefile`, which enumerates
    seed files (plus the local R2 placeholder upload it needs).
  - `CLAUDE.md` — one *Student submissions* paragraph.
  - `docs/product/FEATURES.md` — one feature entry.
  - `docs/product/milestones/23-student-submissions/closeout-analysis.md` (new) and the status
    lines of `milestone.md` and the task files.
  - `docs/product/RFCs/0020-student-submissions.md` `Status:` header and its row in
    `docs/product/RFCs/README.md`.
- **Local only.** The seed must be rejected by `apps/api/scripts/check-no-dev-seed.ts` for
  staging and production; it is idempotent.
- **No behaviour change.** No application source file changes — only the seed, `Makefile`
  and documentation listed above.

## Scope

In:
- Local seed with the four states and placeholder objects; `Makefile` seed step.
- `CLAUDE.md` paragraph, `FEATURES.md` entry, closeout analysis.
- RFC 0020 status and README row; milestone and task statuses.

Out:
- Any code change — found gaps become backlog items listed in the closeout.

## Acceptance Criteria

- [x] After `make db-reset-local`, the seeded student sees a private, a shared, a moderated
      and a removed submission on the seeded topic, and the videos play.
- [x] `check-no-dev-seed.ts` rejects the new seed for staging and production; running
      `make db-seed-local` twice leaves the same rows.
- [x] `CLAUDE.md` and `FEATURES.md` describe the feature; `closeout-analysis.md` maps every
      milestone §3 box to its evidence.
- [x] RFC 0020 reads `Implemented` in its header and README row; `check-rfc.mjs` and
      `check-feature.mjs` pass.
- [x] `make lint`, `make test-api` and `make test-web` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`, `make dev`, log in as the seeded student and walk the four states.
2. Run `make db-seed-local` again and confirm no duplicates.
3. Run the no-dev-seed guard against staging and production targets.
4. `node .claude/skills/write-rfc/check-rfc.mjs` and
   `node .claude/skills/write-feature/check-feature.mjs`.
5. `make lint`; `make test-api`; `make test-web`.
6. `git diff --stat` confirms only guardrail files changed.
