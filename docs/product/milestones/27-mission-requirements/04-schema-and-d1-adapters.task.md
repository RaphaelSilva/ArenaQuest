# Task 04 — Backend: Migration 0031 and D1 adapters with per-kind counting (Phase 2)

**Status:** ✅ Done
**Milestone:** [27 — Mission requirements](./milestone.md)
**RFC:** [RFC 0022](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-mission-contracts.task.md)

## Summary

Creates the schema and implements the three D1 adapters. Migration
`apps/api/migrations/0031_create_mission_requirements.sql` is additive: two `ADD COLUMN` on
`missions` — `mode` (default `parallel`, check `parallel` | `sequential`) and `enrollment_mode`
(default `auto`, check `auto` | `open` | `assigned`) — so every existing row stays valid; and six
tables exactly as RFC 0022 §1 specifies: `mission_requirements` (unique mission and position, a kind
check, `topic_node_id` and `event_id` foreign keys with `RESTRICT`, a table check pairing kind and
target, JSON `params`, `xp_reward ≥ 0`, partial indexes on the two target columns),
`mission_enrollments` (primary key mission and user, source check, `joined_at`, `counts_from`,
`left_at`, a partial index on active enrollments by user), `mission_requirement_progress` (primary
key requirement and user, `current_count`, `target_count`, `checked_at`, write-once
`completed_at`, `completed_by` check `hook` | `reconcile`, `recorded_at`), `mission_evidence`
(primary key requirement, user and reference id, `occurred_at`, source check `hook` | `backfill`),
`mission_audience_group` and `mission_audience_user` (with reverse indexes). Rollback is dropping
the six tables; the two added columns are inert for M7 code. The adapters implement the ports of
Task 02: `D1MissionRepository` (extended — create a mission with its requirements in one batch,
replace requirements, audience reads and replace-all writes, legacy listing), the new
`D1MissionParticipationRepository` (implicit-enrollment inserts that ignore duplicates, join,
leave, conditional completion that reports whether a row changed, partial-count upsert that never
touches a completed row, manual check, evidence capture that keeps the first row) and the new
`D1MissionEvidenceRepository` — **one set-based counting statement per kind**, scoped to one user
or to every active enrollment of a mission, returning per user the qualifying count and the instant
of the target-th item: ready submissions on the topic created in the interval, filtered by
description, visibility (with the label's sharing switch) and moderation; captured evidence rows for
visits and videos; `paid` charges on the event whose `starts_at` lies in the interval and in the
past; `checked_at` for manual checks. Every window comparison normalises both sides with
`datetime()`, because `missions` stores ISO-8601 strings and the evidence tables store SQLite's
`datetime('now')` form.

## Dependencies

- [Task 02](./02-mission-contracts.task.md) — hard code dependency: the ports and entity types
  being implemented.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/0031_create_mission_requirements.sql` (new; renumber if another migration
    lands first).
  - `apps/api/src/adapters/db/d1-mission-repository.ts` (extended),
    `apps/api/src/adapters/db/d1-mission-participation-repository.ts` (new),
    `apps/api/src/adapters/db/d1-mission-evidence-repository.ts` (new).
  - `apps/api/src/container.ts` — the two new repositories in the `gamification` group; no other
    group changes shape.
  - `apps/api/test/**` — schema and adapter specs (Workers pool).
- **No statement on any other table.** The migration issues nothing against `topic_nodes`,
  `topic_progress`, `topic_submissions`, `tasks*`, `quest_*`, `xp_events`, `user_badges` or the
  billing tables; the adapters only **read** `topic_submissions`, `topic_progress`, `xp_events`,
  `media`, `events`, `event_charges`, `event_prices`, `users`, `user_roles`, `user_group_members`.
- **`RESTRICT` changes no current rule**: no API route hard-deletes a topic or an event today.
- **Set-based, bounded queries.** Counting cost grows with requirements, never with users; window
  functions are allowed (D1 supports them).
- **Write-once at the database.** Completion is a conditional update on `completed_at IS NULL`,
  read through `meta.changes`; the partial-count upsert has the same guard.
- **Ports & Adapters.** D1 types stay inside `adapters/db/`.

## Scope

In:
- Migration 0031 and its schema spec (columns, defaults, checks, unique and partial indexes, the
  kind/target pairing check rejecting a mismatched row).
- The three adapters and their container wiring.
- Adapter specs per kind at the window edges in **both** timestamp formats; `requireDescription`;
  `shared_only` with sharing on and off; `countModerated`; a submission moved in from an older
  upload keeps its `created_at` and does not count; pending and removed submissions never count;
  voided and reversed charges; an event in the future; distinct videos only and only videos of
  the target topic; the target-th instant per user; completion conditional (second call reports no
  change); partial upsert leaves a completed row intact; implicit enrollment and audience replace.

Out:
- The evaluator — Task 03. Routes — Tasks 05 and 07. Hooks — Task 06. The cron job — Task 08.

## Acceptance Criteria

- [x] `make db-migrate-local` applies 0031 on a fresh local D1 and on one migrated to 0030;
      existing `missions` rows read back with `mode = 'parallel'` and `enrollment_mode = 'auto'`.
- [x] Inserting a `manual_check` requirement with a `topic_node_id`, or a `video_watched` one
      without, fails on the table check; a duplicate `(mission_id, position)` fails on the unique
      key.
- [x] With a mission window starting at `…T10:00:00.000Z`, a submission created at `… 09:59:59`
      is excluded and one at `… 10:00:00` is included.
- [x] For three ready submissions with descriptions at t1 < t2 < t3, the count is 3 and the
      target-th instant for `minCount: 3` is t3; with one description emptied the count is 2.
- [x] A `paid` charge for an event starting tomorrow counts 0; after the event start it counts 1;
      a `void` charge counts 0.
- [x] Completing an already-completed step reports no change; the partial upsert on a completed row
      changes nothing.
- [x] `git diff` shows no statement touching `topic_nodes`, `topic_progress`, `topic_submissions`,
      `tasks*` or `quest_*` in the migration.
- [x] No D1 symbol outside `apps/api/src/adapters/`; changed files lint clean; `make test-api`
      green.
- [x] No diff outside the scope guardrail.
      _Closed 2026-10-03. Adapter-level choices beyond the RFC text: `video_watched` counting joins `media` (ready videos of the target topic only), `requireDescription` uses `TRIM(description) <> ''`, duplicate-tolerant inserts use `ON CONFLICT DO NOTHING` (so CHECK violations still surface), `markCompleted` is conditional on `completed = 0` and `upsertProgress` refreshes `target_value`. Shared test fixtures live in `apps/api/test/db/mission-fixtures.ts`._

## Verification Plan

1. `make db-reset-local`; inspect the new tables with `wrangler d1 execute … "PRAGMA table_info(…)"`
   and the indexes with `PRAGMA index_list(…)`.
2. `cd apps/api && pnpm test test/db` — the new schema and adapter specs.
3. `make test-api`; `make lint`.
4. `git diff --stat` confirms only guardrail files changed.
