# Task 01 — Backend: Shared foundations — media limits, WhatsApp normalisation and event contracts (Phase 0)

**Status:** ✅ Done
**Milestone:** [20 — Events board — public listing, access-scoped audiences and per-event WhatsApp contact](./milestone.md)
**RFC:** [RFC 0014](../../RFCs/0014-events-board-and-whatsapp-contact.md)
**Team:** Backend API

## Summary

Lays the cloud-agnostic foundation every later task in this milestone builds on, and
pays off two duplications before a third copy can be created. `packages/shared` gains an
`Entities.Events` namespace and two `Entities.Config` enums — `EventStatus`
(`draft` · `published` · `archived`) and `EventAudience` (`public` · `members` ·
`restricted`) — plus an `IEventRepository` port that is the only contract the API will
ever talk to, exported from `ports/index.ts` alongside its siblings. Two pure domain
modules move in beside them: `domain/contact/whatsapp.ts`, which takes
`normalizeWhatsapp` out of `apps/web/src/lib/brand.ts` verbatim (including its "10–15
digits or treat as unset" rule) so the API can reject at write time exactly what the web
would refuse to render, and `domain/media/limits.ts`, which becomes the allowed-type and
size table that `CLAUDE.md` already claims is a single source of truth — today it is a
literal in `admin-media.controller.ts` and a second copy inside `import-media.mjs`'s
`validateMediaFile`. The controller is migrated onto the shared table with **no change to
its behaviour or its numbers**; the importer, a zero-dependency script that runs without a
build step, keeps its copy under a parity test instead (see
[the plan](./planing/01-shared-foundations.plan.md) §2). `brand.ts` re-exports the moved
helper so every current caller keeps working. Everything here is pure and
unit-testable without a Worker: no D1, no R2, no Cloudflare type crosses into
`packages/shared`. Tasks 02–04 consume the port and the enums; Task 04 enforces the
flyer ceiling from this limits table rather than a third literal.

## Dependencies

- None — independent. This is the first task of the milestone and the only one with no
  sibling prerequisite.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/types/entities.ts` — adds the `Entities.Events` namespace and the
    two `Entities.Config` enums. Additive only; no existing namespace changes shape.
  - `packages/shared/ports/i-event-repository.ts` (new) and its export line in
    `packages/shared/ports/index.ts`.
  - `packages/shared/domain/contact/whatsapp.ts` (new) and
    `packages/shared/domain/media/limits.ts` (new).
  - `apps/web/src/lib/brand.ts` — **only** to delete the local `normalizeWhatsapp` body
    and re-export the shared one. No other line of this file changes.
  - `apps/api/src/controllers/admin-media.controller.ts` — **only** to replace its
    allowed-type/size literal with an import from the shared limits module. No change to
    the values, the error shapes, or the upload lifecycle.
  - `scripts/content/import-media.test.mjs` — **only** to add the parity test. The
    importer script itself is **not** modified (see the acceptance criteria and
    [the plan](./planing/01-shared-foundations.plan.md) §2).
  - `packages/shared/**/__tests__/**` (or the workspace's existing test location) — unit
    tests for the two domain modules.
- **No Cloudflare types in shared.** `packages/shared` stays cloud-agnostic: the port
  describes the contract in domain terms only, and no `D1Database`, `R2Bucket`, `KVNamespace`
  or `@cloudflare/workers-types` symbol may appear in any file added here.
- **Pure domain modules.** `whatsapp.ts` and `limits.ts` contain no I/O, no environment
  read and no framework import — they are functions and a table, callable from the Worker,
  from the web build and from a plain Node script alike.
- **Behaviour-preserving extraction.** The move is a refactor, not a redesign. The
  normalisation rule keeps its existing digit range and its "treat as unset" return; the
  limits table keeps today's values exactly (`image/jpeg`, `image/png`, `image/webp` ≤ 5 MB;
  `application/pdf` ≤ 25 MB; `video/mp4` ≤ 100 MB). A changed number here is a
  regression in the bulk importer and the topic uploader at once.
- **The port describes, it does not implement.** `IEventRepository` declares the reads and
  writes Tasks 02–04 need — audience-scoped listing by scope, slug lookup, admin listing
  including drafts, create, update, the audience grant replacement, and the flyer column
  writes — without naming a store. Task 02 supplies the only implementation.
- **`import-media.mjs` stays dependency-free — and therefore keeps its own table.** The
  importer is a documented stdlib-only ESM script with no install or build step, run
  directly by `make import-media-*`, while `@arenaquest/shared` resolves only through an
  untracked `dist/`. Importing the shared table would break its zero-dependency contract
  (asserted by its own test) and fail at runtime on any checkout that has not built. The
  duplication is instead locked down by a parity test; the script itself is not modified.
- **No upload path changes.** This task does not touch presign, `PUT` or finalize
  behaviour anywhere — the declared-size hole in topic media stays open by design and
  belongs to its own backlog item (milestone guardrail).

## Scope

In:
- `Entities.Events` and the `EventStatus` / `EventAudience` enums in the shared entity
  schema, covering the event's identity, dates and timezone, status, audience, the flyer
  columns and the contact columns.
- `IEventRepository` and its `ports/index.ts` export.
- `domain/contact/whatsapp.ts` with `normalizeWhatsapp` lifted from `brand.ts`, and
  `brand.ts` reduced to a re-export.
- `domain/media/limits.ts` with the allowed types and ceilings, plus whatever shared
  validation helper the two existing call sites need in common.
- `admin-media.controller.ts` migrated onto the shared table, and a parity test pinning
  `import-media.mjs`'s own table to it.
- Unit tests for both domain modules: the normaliser's accept, reject and "treat as unset"
  branches across the digit range; the limits table's type and ceiling lookups.

Out:
- The migration, the repository implementation and slug generation — Task 02.
- `optionalAuth`, the read controller and the rate limiter — Task 03.
- The flyer presign/finalize enforcement that consumes this table — Task 04.
- Any frontend surface — Tasks 05–07.
- Fixing the declared-size ceiling in **topic** media — out of scope for this milestone.

## Acceptance Criteria

- [x] `Entities.Events`, `Entities.Config.EventStatus` and `Entities.Config.EventAudience`
      exist and are importable from `packages/shared`; every pre-existing export of that
      module is unchanged.
- [x] `IEventRepository` is exported from `packages/shared/ports/index.ts` and names every
      read and write Tasks 02–04 require.
- [x] `git grep` finds no Cloudflare or provider type in any file added under
      `packages/shared/`.
- [x] `normalizeWhatsapp` lives only in `packages/shared/domain/contact/whatsapp.ts`;
      `brand.ts` re-exports it, its behaviour is unchanged, and every existing caller of
      `brand.whatsapp` resolves the same value it did before.
- [x] The allowed-type/size literal is gone from
      `apps/api/src/controllers/admin-media.controller.ts`, which imports
      `domain/media/limits.ts`; the ceilings are numerically identical to today's.
- [x] `scripts/content/import-media.mjs` **keeps** its own table — it is a documented
      zero-dependency stdlib script run without a build step, and `@arenaquest/shared`
      resolves only through an untracked `dist/` (see
      [the plan](./planing/01-shared-foundations.plan.md) §2). A **parity test** asserts
      the importer's table equals the shared one, so a future divergence fails CI instead
      of drifting silently.
- [x] A unit test covers the normaliser's accept / reject / unset branches and the limits
      lookup for each allowed type.
- [x] `make import-media-staging SOURCE=./content DRY_RUN=1` still preflights and reports
      the same per-file verdicts as before the change. **Not executed** — it needs
      `AQ_ADMIN_EMAIL` / `AQ_ADMIN_PASSWORD` and a `./content` tree, neither available in
      this environment. Satisfied *by construction* instead: `import-media.mjs` is
      byte-unchanged in this task (`git diff` against the candidate returns 0 lines), so
      its preflight cannot have moved. Re-run it on a machine with credentials before the
      milestone PR if you want the empirical check.
- [x] Changed files lint clean; `make test-api` and `make test-web` green — the existing
      media and brand specs pass unchanged.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make build` — `packages/shared` compiles and both consuming workspaces resolve the new
   modules under TypeScript strict mode.
2. `make test-api` — the new shared unit tests pass and the existing
   `admin-media.controller` specs pass **unchanged**, proving the extraction moved no
   behaviour.
3. `make test-web` — the existing `brand.ts` specs pass against the re-export.
4. Run a dry-run import against a local tree with a deliberately oversize file and an
   unsupported type, and confirm the preflight report is identical to a run on the previous
   commit.
5. `git grep -n "image/webp\|SIZE_LIMIT" apps/api/src scripts/` confirms a single
   definition remains, in `packages/shared`.
6. `git diff --stat` confirms only scope-guardrail files changed — in particular that no
   file under `apps/api/src/adapters/` or `apps/web/src/app/` appears.
