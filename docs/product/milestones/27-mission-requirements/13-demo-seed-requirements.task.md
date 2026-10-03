# Task 13 — Backend: Demo seed mission as typed requirements (Phase 7)

**Status:** 📝 Open
**Milestone:** [27 — Mission requirements](./milestone.md)
**RFC:** [RFC 0022](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-schema-and-d1-adapters.task.md)

## Summary

Keeps RFC 0021's demo seed truthful once missions have requirements. Today the dataset's only
mission (`scripts/demo/dataset/base.json`, key `first-topic`) carries `predicateKind:
"complete_topic"` and `params: { "count": 1 }` — the same `count` vs `target` mismatch RFC 0022
cites — and `scripts/demo/dataset.mjs` validates `predicateKind` against the predicate table it
scrapes from `quest-evaluator.ts`. This task rewrites the demo mission as a **typed, windowed
mission**: a `mode`, an `enrollmentMode` and an ordered `requirements` list whose entries name a
kind, a dataset **topic key** (or event key), params and XP — for example a parallel `auto` mission
"Get started" with a `topic_visited` step and a `submissions_on_topic` step (`minCount: 1`,
`requireDescription: true`) on a seeded published topic, plus a badge. `dataset.mjs` validates
each requirement against the kinds and params schemas of
`packages/shared/domain/missions/requirements.ts` (unknown kind, bad params, unknown topic or event
key are dataset problems reported like the others), and per-label overrides keep their rename
semantics. `gamification.mjs` emits the mission with `predicate_kind = 'requirements'` and the new
`mode` / `enrollment_mode` columns, and emits one `mission_requirements` row per step with a
deterministic id; `sql.mjs` upserts them; `ci-check.mjs` asserts the new table's count (and that a
second seed run changes no row count). No demo enrollment or progress is seeded — the evaluator
creates them when a demo student acts — so the asserted XP, badges and `user_xp` = ledger checks
are unchanged.

## Dependencies

- [Task 04](./04-schema-and-d1-adapters.task.md) — hard code dependency: migration 0031 must exist
  for the seed to write `mission_requirements` and the new `missions` columns (Task 02's schemas come
  with it).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/demo/dataset/base.json` — the `gamification.missions` entry only.
  - `scripts/demo/dataset.mjs`, `scripts/demo/gamification.mjs`, `scripts/demo/sql.mjs`,
    `scripts/demo/ci-check.mjs` — mission validation, row building, upsert and the count check.
  - `scripts/demo/dataset.test.mjs`, `scripts/demo/gamification.test.mjs`,
    `scripts/demo/sql.test.mjs`, `scripts/demo/ci-check.test.mjs` — their mission cases.
- **No production path.** The seed's existing refusals (`-e production`, production-named
  resources) are untouched; nothing here runs outside local and staging.
- **Deterministic ids** through the existing id helper, so a re-run is idempotent.
- **No quest change**: quest definitions, quest progress and their params in the dataset stay as
  they are (the quest seed mismatch is a backlog item filed by Task 14).
- **No enrollment or progress rows** are seeded; the RFC 0021 XP and badge assertions keep their
  expected values.
- **Scripts only**: no web or API source file changes.

## Scope

In:
- The demo mission rewritten with `mode`, `enrollmentMode` and typed requirements.
- Dataset validation of requirements against the shared schemas; override handling.
- Row emission for `missions` (new columns, `predicate_kind = 'requirements'`) and
  `mission_requirements`; upsert; CI count.
- Tests: a valid mission passes; an unknown kind, `minCount: 0`, an unknown topic key are reported;
  emitted rows match the schema; the CI check counts the requirement rows and a second run changes
  no count.

Out:
- Any API or web change. Quest seed data — backlog (Task 14).

## Acceptance Criteria

- [ ] `node scripts/demo/ci-check.mjs` passes: every migration applies, each label seeds twice, and
      the counts include `mission_requirements` with no change on the second run.
- [ ] The demo mission reads back from the local D1 with `predicate_kind = 'requirements'`, its
      `mode`, `enrollment_mode` and its ordered requirement rows pointing at seeded topics.
- [ ] `dataset.mjs` reports an unknown requirement kind, invalid params and an unknown topic key as
      dataset problems (unit tests).
- [ ] The RFC 0021 assertions on student XP, badges and `user_xp` = ledger are unchanged.
- [ ] `make test-scripts` green; changed files lint clean; `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`; `make db-seed-demo-local LABEL=budo DRY_RUN=1` and read the planned
   mission rows; then run it for real.
2. Query the local D1 for the mission and its `mission_requirements` rows.
3. `node scripts/demo/ci-check.mjs`; `make test-scripts`.
4. `make test-api`; `make lint`.
5. `git diff --stat` confirms only guardrail files changed.
