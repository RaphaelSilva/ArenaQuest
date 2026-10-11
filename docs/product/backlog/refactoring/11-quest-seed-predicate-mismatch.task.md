# Task 11 — Backend: Seeded quests never progress (predicate and params mismatch)

**Status:** 📝 Open
**Kind:** Bug
**Team:** Backend API
**Priority:** Medium
**Found in:** Milestone 27 (RFC 0022 Motivation), closeout Task 14, 2026-10-03

## Summary

The daily and weekly quests seeded by `apps/api/migrations/0019_seed_quests.sql` do not behave as
their titles say, for every student on every label and environment (reproducible locally). The
daily login quest never progresses, because its row names a predicate the evaluator does not know.
Every seeded quest target collapses to 1, because the rows store `{"count":N}` while the evaluator
reads `target`, so *"Assistir 10 vídeos na semana"* completes — and pays its 300 XP — after one
video. The two comment quests never progress either, because the comment route never notifies the
quest evaluator. Wrong data is shown on the dashboard and XP is over- or under-granted; nothing is
lost.

## Reproduction

1. Starting state — local replica after `make db-reset-local`; `make dev-api`; the seeded
   `student@arenaquest.dev` account (`apps/api/migrations/seed/0001_test_users.sql`).
2. Log in as the student, then read `GET /v1/me/quests/daily`. Watch one video of an accessible
   topic (`POST /v1/topics/{id}/videos/{videoId}/watched`), post one comment
   (`POST /v1/topics/{id}/comments`), then read `GET /v1/me/quests/daily` and
   `GET /v1/me/quests/weekly` again.
3. **Expected:** `daily-login` is completed after the login; `weekly-video` shows `1/10`;
   `daily-comment` is completed and `weekly-discussion` shows `1/3`.
4. **Actual:** `daily-login` stays at 0 (the API log carries
   `[quest] unknown predicateKind "login" — skipping`); `weekly-video` is completed at `1/1` and its
   `quest_reward` XP is granted; `daily-comment` and `weekly-discussion` stay at 0.

## Root Cause

**Established** (read in the code):

- `packages/shared/domain/gamification/quest-evaluator.ts` maps predicates through
  `PREDICATE_TO_SOURCE` (`watch_video`, `complete_subtopic`, `post_comment`, `check_in_stage`,
  `daily_login`, `complete_topic`) and skips any other value. The `daily-login` row in
  `0019_seed_quests.sql` uses `login`, which is not a key.
- The evaluator reads the goal as `JSON.parse(predicateParams)?.target ?? 1`. Every seeded row stores
  `{"count":N}`, so every target is 1.
- `questEvaluator.evaluate` is called with `'video'` (`routes/topics.router.ts`), `'login'`
  (`routes/auth/login.ts`), `'topic'` and `'stage'` (`routes/me/progress.ts`) — never with
  `'comment'`. `routes/comments.router.ts` awards `comment_posted` XP but does not call the
  evaluator, so `post_comment` quests cannot progress.
- The admin quest schema (`apps/api/src/routes/admin/quests.ts`,
  `controllers/admin-quests.controller.ts`) accepts any non-empty `predicateKind` and any JSON
  `predicateParams`; its OpenAPI examples are `login_count` and `{"count":1}`, so an admin following
  the documentation reproduces the same mismatch.

**Not established:** whether any deployed label has admin-edited quest rows that already use
`daily_login` / `target`; the fix must leave such rows untouched.

## Scope

In:
- A data-only migration that corrects the seeded rows by id **only while they still hold the seeded
  values** (`predicate_kind = 'login'` → `daily_login`; `{"count":N}` → `{"target":N}`), so an
  admin edit is never overwritten. `0019_seed_quests.sql` itself is not edited (it is already
  applied everywhere).
- The comment route notifies the quest evaluator with source `comment` after a successful create,
  best-effort like the other call sites (a failure is logged and never changes the `201`).
- Admin quest create/update refuse a `predicateKind` the evaluator does not know and params without
  a positive integer `target` (`400`), and the OpenAPI examples name a real predicate.
- Regression tests: the evaluator progresses `daily_login` and honours `target`; the migration
  rewrites a seeded row and leaves an edited one alone; a comment advances a `post_comment` quest;
  the admin schema rejects `login` and `{"count":1}`.

Out:
- Redesigning daily/weekly quests or moving them onto the mission engine — RFC 0023 (*Challenges as
  recurring missions*).
- Missions: RFC 0022 replaced free predicates with typed requirements for every new mission.
- The admin quests web page (`apps/web/src/app/(protected)/admin/quests/page.tsx`) — it already
  shows the server's `400`; a predicate picker is a separate frontend task if wanted.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/0032_fix_seeded_quest_predicates.sql` (new, data-only `UPDATE`s; renumbered
    if another migration lands first)
  - `packages/shared/domain/gamification/quest-evaluator.ts` (export the known predicate list; no
    change to the evaluation loop)
  - `apps/api/src/routes/comments.router.ts` (one best-effort evaluator call)
  - `apps/api/src/routes/admin/quests.ts`, `apps/api/src/controllers/admin-quests.controller.ts`
  - `apps/api/openapi.json` (regenerated with `pnpm dump-openapi`)
  - `apps/api/test/**`
- The migration issues no DDL and touches no table but `quest_definitions`.
- No change to `quest_progress` rows already written; XP already granted is not revoked.

## Acceptance Criteria

- [ ] After a fresh `make db-reset-local`, a student login completes `daily-login`, one watched
      video shows `weekly-video` at `1/10` (not completed), and one comment completes
      `daily-comment`.
- [ ] The migration rewrites a row still holding the seeded values and leaves a row whose
      `predicate_kind` or `predicate_params` was edited unchanged (spec over a real D1).
- [ ] `POST /v1/admin/quests` with `predicateKind: "login"` or `predicateParams: "{\"count\":1}"` is a
      `400`; with `daily_login` and `{"target":1}` it is a `201`.
- [ ] A regression test pins each of the three causes and fails on the old code.
- [ ] `make test-api` and `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Run the reproduction on the old code and confirm the three failures (and the
   `unknown predicateKind "login"` log line).
2. Apply the fix; `make db-reset-local`, run the reproduction again; `make test-api`; `make lint`.
3. `git diff --stat` confirms only scope-guardrail files changed.
