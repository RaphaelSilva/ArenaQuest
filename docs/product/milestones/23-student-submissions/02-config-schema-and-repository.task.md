# Task 02 — Backend: Submission config, schema and D1 repository (Phase 1)

**Status:** ✅ Done
**Milestone:** [23 — Student submissions](./milestone.md)
**RFC:** [RFC 0020](../../RFCs/0020-student-submissions.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-shared-contracts.task.md)

## Summary

Builds the persistence and configuration layer, with no route yet. **Config:**
`apps/api/src/core/submissions/config.ts` turns the four `SUBMISSIONS_*` vars into a typed
`SubmissionConfig` per request — an absent var takes its default from
`domain/submissions/limits.ts`, a present-but-invalid one (not a positive integer, a switch
other than `true`/`false`, or a video limit above the storage limit) is an error naming the
var, never a silent default. The vars are declared explicitly in **every** `env.*.vars` block
of `wrangler.jsonc` (defaults for all labels), documented in `.dev.vars.example`, and listed
as optional in `config/deployment.schema.jsonc` with an `enum` on the switch so the RFC 0007
preflight rejects a bad value before deploy. **Schema:** migration `0030` creates
`topic_submissions` exactly as RFC 0020 §1 — its own table, `status` in
`pending | ready | removed`, moderation and removal columns with `ON DELETE SET NULL` on the
staff references, three indexes — and touches no existing table. **Repository:**
`D1SubmissionRepository` implements the port, including the two concurrency-sensitive
operations: the **quota-guarded insert** (per-topic count and per-student bytes checked in the
same statement as the insert, pending rows counted, removed rows excluded) and the **batched
conditional move** (one guarded update per id, executed in order in a single batch, returning
moved and refused ids with reasons). It also implements the scoped listings with cursor
pagination, the topic summary counts, moderation, tombstoning and the stale-pending query.
**Storage:** the real `readHead` on `R2StorageAdapter` as a ranged `GetObject` of the first
bytes.

## Dependencies

- [Task 01](./01-shared-contracts.task.md) — the port, entity and limits it implements.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/0030_create_topic_submissions.sql` (new; renumber to the next free
    number if M21/M22 migrations shift the sequence).
  - `apps/api/src/core/submissions/config.ts` (new).
  - `apps/api/src/adapters/db/d1-submission-repository.ts` (new).
  - `apps/api/src/adapters/storage/r2-storage-adapter.ts` — `readHead` implementation only.
  - `apps/api/src/routes/_shared/` — the cursor helper, only if M21 has not landed it.
  - `apps/api/wrangler.jsonc` — the four vars added to every `env.*.vars` block; nothing else.
  - `apps/api/.dev.vars.example` — the four vars, commented.
  - `config/deployment.schema.jsonc` — four optional entries, `enum: ["true","false"]` on
    `SUBMISSIONS_SHARING_ENABLED`.
  - `apps/api/test/**` — config, repository and adapter specs.
- **Atomicity lives in SQL.** Quota and move guards are single conditional statements read
  through D1's `meta.changes`; a read-then-write check is a review failure (RFC §5, §6).
- **Move order matters.** The per-id updates run in one D1 batch, in request order, so each
  sees the counts the previous one left.
- **Invalid config is loud.** No fallback to a default when a var is present but malformed.
- **No existing table changes**, and nothing is written to `media`.
- **Per-request adapters.** Nothing in module scope.

## Scope

In:
- `SubmissionConfig` parser with tests for absent, valid, malformed and inconsistent values.
- Vars in all `wrangler.jsonc` environments, `.dev.vars.example`, deployment schema.
- Migration `0030`.
- `D1SubmissionRepository`: find, quota-guarded create, usage, mark ready, update meta,
  batched move, delete, mark removed (tombstone), scoped topic listing, author listing, topic
  summary, moderation, stale pending.
- `R2StorageAdapter.readHead`.
- Repository tests on the Workers pool, including the concurrency cases below.

Out:
- Controllers and routes — Tasks 03–05.
- Container wiring — Task 03.

## Acceptance Criteria

- [x] The parser returns the defaults when all vars are absent, the given values when valid,
      and an error naming the var for `abc`, `0`, `-1`, `SHARING=yes`, or a video limit above
      the storage limit.
- [ ] Every `env.*.vars` block in `wrangler.jsonc` declares the four vars; the deployment
      preflight passes with them and fails with `SUBMISSIONS_SHARING_ENABLED=maybe`.
      _Partially met: the vars are declared in every block and the schema carries the
      `enum`, but `scripts/label.mjs check` / `scripts/deploy/core.mjs` do not enforce `enum`
      on optional keys, so `maybe` is only rejected at runtime by `core/submissions/config.ts`
      (`500 SUBMISSION_CONFIG_INVALID`). Enforcing it needs a script change outside this
      milestone's guardrail — tracked as a separate follow-up._
- [x] `make db-migrate-local` applies `0030` cleanly on a fresh replica and on one that
      already holds data; no existing table's schema changes.
- [x] Two concurrent quota-guarded inserts at `limit − 1` produce exactly one row; an insert
      crossing the byte quota inserts nothing; removed rows are ignored by both counts.
- [x] A batched move of 3 ids into a topic with 2 free slots moves the first 2 and refuses the
      third with `quota`; moved rows are `private` with `shared_at` cleared, `moderated_at`
      kept and `storage_key` unchanged; pending, removed, foreign and same-topic ids are
      refused with their reasons.
- [x] `mine` / `class` / `all` listings return exactly the rows RFC §7 allows, newest first,
      paginated by an opaque cursor; `class` returns nothing when told sharing is off.
- [x] Deleting a `users` row referenced by `moderated_by` / `removed_by` succeeds and nulls
      those columns.
- [x] `readHead` returns exactly the requested leading bytes from a Miniflare R2 object.
- [x] Changed files lint clean; `make test-api` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`; inspect `topic_submissions` with `wrangler d1 execute --local`.
2. `make test-api` — config, repository and adapter specs pass, including the concurrent
   insert and the partial move.
3. Run the deployment preflight for one label/environment with a valid and an invalid switch
   value.
4. `make lint`.
5. `git diff --stat` confirms only guardrail files changed; `wrangler.jsonc` diff contains only
   the four vars per environment.
