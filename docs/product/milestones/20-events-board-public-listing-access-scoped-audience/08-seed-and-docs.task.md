# Task 08 — Backend: Seeded example event and documentation closeout (Phase 6)

**Status:** 📝 Open
**Milestone:** [20 — Events board — public listing, access-scoped audiences and per-event WhatsApp contact](./milestone.md)
**RFC:** [RFC 0014](../../RFCs/0014-events-board-and-whatsapp-contact.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-admin-api.task.md)

## Summary

Makes the feature reproducible on a fresh machine and true in the documentation, which is
the half of a milestone that quietly decays. `make db-seed-local` gains an events seed so a
developer who has just run `make setup` sees a populated board instead of an empty state and
can exercise the audience rule without hand-writing SQL: the seed covers the cases the
matrix actually turns on — a `public` upcoming event, a `members` one, a `restricted` one
granted to a seeded group, a past event proving the computed scope predicate, and a draft
that must never appear on the public board — all pinned to the existing seeded accounts and
groups. It stays **local only** and idempotent, like every seed here, and the
`check-no-dev-seed` guard that refuses to deploy over a database still carrying dev-seed
accounts must keep working unchanged. Alongside it, three documents are corrected rather
than appended to: `CLAUDE.md` currently names `admin-media.controller.ts` as the source of
truth for media limits, which stopped being true in Task 01 and now points at
`packages/shared/domain/media/limits.ts`; `docs/product/FEATURES.md` gains the events board;
and RFC 0014's status moves to `Implemented` in both its own header and the RFCs README
index, with the items it deferred — RSVP, recurring events, iCal, the topic-media
declared-size hole — left standing as backlog rather than quietly dropped. The milestone's
closeout note is written last, once the other seven tasks are Done.

## Dependencies

- [Task 04](./04-admin-api.task.md) — hard dependency for the seed, which must insert rows
  matching the final schema and the audience grant shape, and for the documentation, which
  describes the API surface that task completed.
- [Task 01](./01-shared-foundations.task.md) — the `CLAUDE.md` correction is only true once
  the media limits actually moved to `packages/shared`.
- **Ordering:** although only Task 04 is a code dependency, the closeout note and the RFC
  status change are written **after** Tasks 05–07 are Done, since they assert the milestone
  is complete.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/seed/00NN_events_local.sql` (new) — the next sequential seed file.
  - `Makefile` — **only** the `db-seed-local` target, to apply the new seed file beside the
    existing two. No other target changes, and no `-dev` suffix is introduced.
  - `CLAUDE.md` — **only** the media-limits source-of-truth sentence and a brief events
    entry where the architecture section warrants it.
  - `docs/product/FEATURES.md` — the events board entry.
  - `docs/product/RFCs/0014-events-board-and-whatsapp-contact.md` — the `Status:` header
    line only.
  - `docs/product/RFCs/README.md` — RFC 0014's index row only.
  - `docs/product/milestones/20-events-board-public-listing-access-scoped-audience/closeout-analysis.md`
    (new) and the `**Status:**` lines of this milestone's own files.
- **The seed is local only.** It follows the existing `migrations/seed/` convention, is
  idempotent on re-run, and is never applied to staging or production. It must not defeat
  `apps/api/scripts/check-no-dev-seed.ts`, and `make deploy-staging`'s dev-seed guard must
  behave exactly as before.
- **The Makefile naming rule holds.** An unsuffixed target is local; an environment-touching
  target names its environment. This task adds no new target and introduces no `-dev`
  suffix.
- **No application code changes.** `apps/api/src/`, `packages/shared/` and `apps/web/src/`
  must all be absent from the diff. If seeding reveals a bug, it is a fix in the owning
  task or a new one — not a patch smuggled in here.
- **The seed carries no real personal data.** The WhatsApp numbers in the seeded events are
  obvious placeholders, never a real number, since a seed is copied into screenshots and
  test environments.
- **Documentation is corrected, not appended.** The stale `CLAUDE.md` sentence about
  `admin-media.controller.ts` is *replaced*. Leaving both statements standing is the drift
  this task exists to end — the same class of drift as the `@ValidateBody` passage recorded
  in `docs/product/backlog/refactoring/07-validatebody-documentation-drift.task.md`.
- **Deferred items stay visible.** RSVP, capacity, recurring events, iCal, reminders, the
  data-driven landing page and the topic-media declared-size hole are recorded as backlog in
  the closeout, not silently closed with the RFC.

## Scope

In:
- The local events seed: a `public` upcoming event, a `members` event, a `restricted` event
  granted to a seeded group, a past event, and a draft — wired to the existing seeded
  accounts and groups, idempotent, local only.
- The `db-seed-local` Makefile target extended to apply it.
- The `CLAUDE.md` correction pointing media limits at `packages/shared/domain/media/limits.ts`,
  plus a short events entry in the architecture notes.
- The `docs/product/FEATURES.md` events board entry.
- RFC 0014 set to `Implemented` in its header and in `docs/product/RFCs/README.md`.
- `closeout-analysis.md` for this milestone, recording what shipped, what was deferred and
  why, and any follow-up backlog items the implementation surfaced.
- The `**Status:**` lines of this milestone's task files and `milestone.md` brought to their
  final values.

Out:
- Any application code change in `apps/api/src/`, `packages/shared/` or `apps/web/src/`.
- New endpoints, screens or migrations — the schema migration is Task 02's.
- Fixing the topic-media declared-size hole — recorded as backlog, not fixed here.
- Writing RFC 0015 (extras revenue), which builds on `events.id` from outside this
  milestone.

## Acceptance Criteria

- [ ] `make db-reset-local` followed by `make dev-api` and `make dev-web` shows a populated
      `/events` board on a machine that has never run this feature, with no hand-written SQL.
- [ ] The seed covers a `public` upcoming, a `members`, a `restricted`-with-group, a past
      and a draft event; an anonymous `GET /v1/events` returns exactly the `public` one, and
      a seeded member of the granted group sees the restricted one.
- [ ] Running `make db-seed-local` twice in a row succeeds and produces no duplicate rows.
- [ ] `apps/api/scripts/check-no-dev-seed.ts` still detects a dev-seeded database, and the
      `guard-no-dev-seed-staging` / `guard-no-dev-seed-prod` targets behave unchanged.
- [ ] The seeded WhatsApp numbers are obvious placeholders, not real numbers.
- [ ] `git grep -n "admin-media.controller" CLAUDE.md` no longer claims that file is the
      source of truth for media limits; the sentence names
      `packages/shared/domain/media/limits.ts` instead.
- [ ] `docs/product/FEATURES.md` describes the events board, including that the public
      surface is anonymous and indexed.
- [ ] RFC 0014's `Status:` reads `Implemented` in its header and its row in
      `docs/product/RFCs/README.md` matches.
- [ ] `closeout-analysis.md` exists, names every deferred item with its reason, and links
      any follow-up backlog entries created — including the topic-media declared-size hole.
- [ ] Every task file in this milestone has a final `**Status:**` consistent with
      `milestone.md` §5.
- [ ] `apps/api/src/`, `packages/shared/` and `apps/web/src/` are absent from the diff.
- [ ] `make lint`, `make test-api` and `make test-web` pass green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local` on a clean replica and confirm the seed applies; run
   `make db-seed-local` a second time and confirm it is idempotent.
2. `make dev-api` and `curl -s $API/v1/events` with no `Authorization` header — confirm
   exactly the seeded `public` event; repeat with the seeded student's token and with a
   member of the granted group, and confirm the expected widening. Confirm the draft appears
   in neither.
3. `make dev-web` and open `/events` to confirm the board is populated out of the box.
4. Run `apps/api/scripts/check-no-dev-seed.ts` against the seeded local database and confirm
   it still reports the dev-seed accounts.
5. Re-read `CLAUDE.md`, `docs/product/FEATURES.md`, RFC 0014 and the RFCs README and confirm
   each statement is true of the code at this commit — in particular the media-limits
   pointer.
6. Confirm `git grep -n "getEffectiveAccessTopicIds" apps/api/src` still returns the same
   pre-milestone baseline of 13 lines across 5 files, and that no file under `src/core/billing/` or
   `d1-enrollment-repository.ts` has changed across the whole milestone.
7. `make lint`, `make test-api`, `make test-web`.
8. `git diff --stat` confirms only the guardrail files changed, and that no application
   source file appears in the list.
