# Milestone 27 — Mission requirements

**Status:** 📝 Draft
**Scope:** `apps/api` (mission requirements, enrollment, evidence counting, inline hooks at the existing write sites, admin-only authoring, daily reconciliation), `packages/shared` (requirement kinds and params, mission evaluator, ports, entity and dashboard types), `apps/web` (admin mission editor and participants view, dashboard missions panel, mission page, live video-watched wiring), `scripts/demo` (demo mission as typed requirements). Derived from [RFC 0022](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md).

> **Hard scope guardrail — read before opening any task.** This milestone may touch **only**: the new migration `apps/api/migrations/0031_create_mission_requirements.sql` (two `ADD COLUMN` on `missions`, six new tables — renumbered if another migration lands first); the mission files `apps/api/src/{adapters/db/d1-mission-repository.ts,adapters/db/d1-mission-participation-repository.ts,adapters/db/d1-mission-evidence-repository.ts,controllers/admin-missions.controller.ts,controllers/me-missions.controller.ts,routes/admin/missions.ts,routes/me/missions.ts,core/missions/**,jobs/reconcile-missions.ts}`; the `GET /missions` handler in `apps/api/src/routes/me/gamification.ts` and the mission part of `controllers/me-dashboard.controller.ts`; **one `runMissionHook(…)` call, after the existing write and inside its own `try/catch`**, in each of `apps/api/src/routes/{submissions.router.ts,me/submissions.ts,admin/submissions.ts,me/progress.ts,topics.router.ts,admin/billing.ts}` (no other line of those handlers changes); the reconcile call added to `scheduled()` in `apps/api/src/index.ts` (billing and the submission sweep untouched); wiring in `apps/api/src/container.ts` (the `gamification` group gains `missionEvaluator` and the two new repositories) and `routes/me/index.ts`; the regenerated `apps/api/openapi.json` and `apps/api/src/openapi/components/entities.ts`; `apps/api/test/**`; the shared files `packages/shared/{domain/missions/** (requirements and its spec),domain/mission.ts,domain/gamification/mission-evaluator.ts,types/dashboard.ts,ports/i-mission-repository.ts,ports/i-mission-participation-repository.ts,ports/i-mission-evidence-repository.ts,ports/index.ts}`, the `Entities.Gamification` mission types in `packages/shared/types/entities.ts`, one `XpAction` appended to `domain/gamification/xp-config.ts`, and the mission loop of `domain/gamification/quest-evaluator.ts` (narrowed to legacy missions — the quest loop is not edited); on the web, `apps/web/src/app/(protected)/admin/missions/**`, the Missions card in `apps/web/src/app/(protected)/admin/page.tsx`, the new `apps/web/src/app/(protected)/missions/**`, `apps/web/src/components/missions/**`, `apps/web/src/components/dashboard/MissionsList.tsx` (and its mount in `DashboardContent.tsx`), the `markVideoWatched` call in `apps/web/src/components/catalog/MediaList/**` (plus passing the topic id to it from `apps/web/src/app/(protected)/catalog/[id]/page.tsx`, nothing else on that page), `apps/web/src/lib/{admin-gamification-api.ts,dashboard-api.ts,missions-api.ts,api-client.ts (registering the missions client),api-types.gen.ts}`, and both i18n dictionaries (+ `types.ts`); `scripts/demo/{dataset/base.json,dataset.mjs,sql.mjs,ci-check.mjs}` and their tests; and, for the closeout only, `CLAUDE.md`, `docs/product/FEATURES.md`, `docs/ReleaseNotes.md`, new files under `docs/product/backlog/`, this folder's `closeout-analysis.md`, RFC 0022's `Status:` header and its `docs/product/RFCs/README.md` row. It is explicitly **not** an opportunity to: add **any column to `topic_nodes`, `topic_progress` or `topic_submissions`**, or change a visit, complete, upload, share, move or moderation rule (`progress-service.ts`, `submissions.controller.ts`, `d1-progress-repository.ts`, `d1-submission-repository.ts` stay as they are); add a **`topic_completed` kind** or a "mark as complete" button; fire `visit` on **topic page mount** (a backlog item); add **door check-in or attendance** for events, or touch `event-charge-service.ts` / `d1-event-charge-repository.ts`; change **Task / TaskStage** — `tasks`, `task_stages`, `task_progress`, `task_stage_progress` and their controllers are neither changed nor migrated; **redesign daily/weekly quests**, edit `quest_definitions`, `0019_seed_quests.sql` or the quest half of `quest-evaluator.ts` (the seed mismatch is a backlog item); **revoke XP** — no code path deletes or negates an `xp_events` or `user_badges` row; build **recurring missions or mission templates** (RFC 0023/0024 roadmap); add **staff review of submissions** (RFC 0020's deferred item) or RFC 0008's **recommendations and manual badge approval**; or change `getEffectiveAccessTopicIds`, `D1EventRepository`'s audience rules or `routes/admin/index.ts`'s umbrella guard. If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **A mission is an ordered list of typed requirements.** 1…20 rows in `mission_requirements`, each of kind `submissions_on_topic`, `topic_visited`, `video_watched`, `manual_check` or `event_participation`, with Zod-validated params and a foreign-keyed topic or event target, replacing the free `predicate_kind` + JSON that let `login` vs `daily_login` and `count` vs `target` slip through (RFC §1, §2, Motivation).
- **Evidence counts only inside the mission's window and the step's interval.** `start_at`/`end_at` stay mandatory; `parallel` opens every step at `max(start_at, counts_from)`, `sequential` opens step N at step N−1's completion instant (RFC §3.3).
- **Students take part through an enrollment.** `auto` (gated by access to every topic target, staff excluded), `open` (*Join* / *Leave*) or `assigned` (users and groups, locked teaser for the others) (RFC §5).
- **Feedback in the same request, safety net every day.** An inline `MissionEvaluator` hook after each originating write, best-effort; a daily, set-based, idempotent reconciliation that closes what a hook missed and never reopens anything (RFC §3.1, §3.2, §4).
- **Write-once rewards that cannot be farmed.** Per-step XP, mission XP and the mission badge — finally granted — through `xp_events` keys; nothing a student deletes or leaves takes them back (RFC §3.5).
- **A completed step keeps the daily streak alive** — one `streakEngine.recordActivity` call at the hook site (RFC §3.2).
- **Admin-only authoring with a structured editor.** `requireRole(ADMIN)` on every write route, content creators keep read access; kind picker, topic and event pickers, per-kind params, ordering, audience, a badge suggestion for windows ≥ 14 days, rules frozen after `start_at` (RFC §6, §7, §8).
- **The dashboard shows participation step by step.** *My missions* with per-step state and target links, *Available* with *Join*, *Locked* teasers, and a mission page for manual checks (RFC §7).
- **`video_watched` becomes producible again.** The live catalog viewer calls the existing `markVideoWatched`, announced in the release notes (RFC §7, Phase 0).
- **Full i18n coverage** across `dict-en`/`dict-pt`, enforced by `check-i18n-coverage.js`.

Out of scope (explicit, from RFC 0022 Non-Goals):
- **Changing topics or submissions** — no new column on `topic_nodes`, `topic_progress` or `topic_submissions`, no rule change; the mission only reads their rows.
- **`topic_completed` as a kind** — `/complete` has no UI and a topic-level button would change the topic concept (RFC Alternatives §5).
- **Real event attendance (door check-in)** — v1 uses the settled charge; check-in is a future RFC.
- **Participants without an account** — only logged-in users have missions.
- **Fusing Task + TaskStage into missions** — deferred, not rejected; `task_progress` is not migrated (RFC Alternatives §2; roadmap RFC 0024).
- **Redesigning daily/weekly quests** — they stay as shipped in M7; recurring missions are roadmap RFC 0023.
- **Staff review of submissions** (RFC 0020) and **recommendations / manual badge approval** (RFC 0008).
- **Revoking XP**, notifications, per-mission leaderboards, mission templates.

---

## 2. Functional Requirements

**Definitions and schema**
- `missions` gains `mode` (`parallel` default | `sequential`) and `enrollment_mode` (`auto` default | `open` | `assigned`); `start_at` and `end_at` stay `NOT NULL`. New missions write `predicate_kind = 'requirements'`.
- `mission_requirements` holds the steps: unique `(mission_id, position)`, a `kind` `CHECK`, `topic_node_id` for the three topic kinds, `event_id` for `event_participation`, neither for `manual_check` (a table `CHECK` enforces the pairing), `params` JSON parsed by the per-kind schema, `xp_reward ≥ 0`.
- `mission_enrollments` (PK `mission_id, user_id`; `source auto | self | admin`; `joined_at`; `counts_from`; `left_at`), `mission_requirement_progress` (PK `requirement_id, user_id`; `current_count`, `target_count`, `checked_at`, write-once `completed_at`, `completed_by hook | reconcile`, `recorded_at`), `mission_evidence` (PK `requirement_id, user_id, ref_id`), `mission_audience_group`, `mission_audience_user`. `mission_progress` remains the aggregate (`current_value` = completed steps).
- Every window comparison wraps both sides in `datetime()` (ISO in `missions`, SQLite form in evidence tables).

**Requirement kinds**
- `submissions_on_topic` counts the user's `ready` submissions on the target topic created inside the step interval, filtered by `requireDescription` (`description <> ''`), `visibility` (`any` | `shared_only`, the latter also requiring sharing enabled for the label) and `countModerated` (default `false`); `minCount` 1…50. Editing or moving a submission never re-dates it.
- `topic_visited` counts one visit of the target topic, `video_watched` counts `minCount` distinct ready videos of the target topic; both are captured in `mission_evidence` by the hook (only for an open step) and backfilled by the daily run from `topic_progress` / `xp_events`.
- `manual_check` is completed by the student's tick on the mission page and stored in `checked_at`; nothing is written to `topic_progress`.
- `event_participation` is satisfied by a `paid` `event_charges` row for the target event whose `starts_at` lies in the step interval and is in the past; only priced, published events can be targets. A void or reversed charge stops counting before completion.

**Evaluation**
- Hooks run after: submission finalize, edit (description or visibility changed), author delete, move (source and target topics), staff unshare / clear moderation / remove (for the author), topic visit (every successful call), video watched, charge payment / adjustment / void / payment reversal. A hook failure is logged with ids only and never changes the originating response.
- A hook does one indexed candidate query; with no matching active requirement it stops there. It creates implicit enrollments (`auto` for gated non-staff users, `assigned` for covered users) with `counts_from = start_at`.
- A step completes when its `target_count`-th qualifying item exists; `completed_at` is that item's instant. Completion is a conditional `UPDATE … WHERE completed_at IS NULL`; partial counts may go down, completed steps and missions never reopen.
- Rewards: `mission_step_reward:<reqId>:v1` per step, `mission_reward:<missionId>:v1` per mission, the mission badge through `awardBadge` plus its `badge_award` XP. The hook (and the manual check) also records streak activity when it closed a step; the daily run does not.
- The daily `scheduled()` run, after the submission sweep and isolated from it, materialises implicit enrollments, backfills captured evidence, recomputes every requirement of missions active or ended within 48 h with one set-based statement each, and writes in batches of 100. It logs counts only.
- Legacy missions (no requirements) keep progressing on the M7 loop until `end_at`; no new legacy mission can be created.

**Admin API (`/v1/admin/missions`)**
- `GET` list, detail and participants answer `admin` and `content_creator`; `POST`, `PATCH`, `PUT …/requirements`, `PATCH …/requirements/{reqId}`, `PUT …/audience`, `POST …/reconcile` and `DELETE` answer `admin` only (`403` for a content creator).
- Create takes the mission and its 1…20 requirements in one request and one `db.batch`; targets are validated (`400 INVALID_REQUIREMENT_TARGET` with the item index, `EVENT_NOT_CHARGEABLE`, `REQUIREMENT_SHARING_DISABLED`).
- After `start_at`, requirements, mode, enrollment mode, window start and reward values answer `409 MISSION_STARTED`; title, description, `active` and extending `end_at` remain editable; a requirement's title alone is patchable.
- `PUT …/audience` replaces grants for `assigned` missions (`409 MISSION_NOT_ASSIGNED` otherwise); users no longer covered get `left_at`, keeping progress and rewards.
- `predicateKind` / `predicateParams` leave the request schemas and are marked deprecated in responses.

**Student API (`/v1/me/missions`)**
- `GET /v1/me/missions` (and the dashboard) lists enrolled missions, joinable `open` missions and locked teasers of `assigned` missions (title and group names only), each enrolled entry with `steps` (`locked | open | completed`, `current/required`, target, XP, `completedAt`). An `auto` mission the student fails the gate for is absent. The read never writes.
- `GET /v1/me/missions/{id}`, `POST …/join` (`open` only, inside the window), `POST …/leave` (`self` only; rejoining keeps `counts_from`), `POST …/requirements/{reqId}/check` (`409 MISSION_STEP_LOCKED`, `409 MISSION_CLOSED`); any miss is `404`.
- Topic targets outside the caller's access set and event targets the caller cannot see are returned without id, title or slug.

**Web**
- Admin: list page; editor page (`new` / `[id]`) with mission card, mode, enrollment and audience picker, badge suggestion for windows ≥ 14 days, requirements editor per kind (topic picker reusing `TaskTopicPicker` single-select, event picker over priced events), sequential ordering by drag and up/down buttons, server errors mapped to the step card, read-only state after start and for content creators; participants tab with step chips and *Reconcile now* (admin).
- Student: `MissionsList` with *My missions*, *Available* (*Join* with confirmation) and *Locked*; mission page `(protected)/missions/[id]` with every step, target links, *I did it* (confirmed, final) and *Leave* for self-enrollments.
- Catalog: the live video viewer calls `markVideoWatched` at 90 % played or on `ended`.
- i18n: `missions:` and a reworked `admin.missions` section, identical keys in both dictionaries.

---

## 3. Acceptance Criteria

- [ ] A mission with one `submissions_on_topic` step (`minCount: 3`, `requireDescription: true`) completes within the request that finalizes the third ready submission with a description; the finalize response is unchanged, and `xp_events` holds exactly one `mission_step_reward:<reqId>:v1` and one `mission_reward:<missionId>:v1` for the student.
- [ ] Submissions created before `start_at`, or moved into the topic from an older upload, do not count; a submission with `description = ''` does not count while `requireDescription` is true; a moderated one does not count with `countModerated: false`.
- [ ] In a sequential mission, a demonstration uploaded before step 1 completed does not count for step 2; one uploaded after it does; step 2's interval starts at step 1's `completed_at`, not at the evaluation wall clock.
- [ ] With the hook forced to throw, the originating request still returns its normal status and body, and after `scheduled()` the step and mission are completed with `completed_by = 'reconcile'` and the same `completed_at` the hook would have written.
- [ ] After the student deletes a counted demonstration of a completed mission, `xp_events`, `user_badges` and every `completed_at` are unchanged; on an incomplete step `current_count` decreases.
- [ ] Running `scheduled()` twice in a row changes no row the second time.
- [ ] Completing a mission with a `badge_id` inserts exactly one `user_badges` row, also when the hook and the daily run both see the completion.
- [ ] Completing a step through a hook or a manual check on a day with no other activity advances `user_streak`; a step closed by the daily run does not.
- [ ] A content creator gets `403` on `POST /v1/admin/missions` and every other write route, and `200` on list, detail and participants; an admin gets `201` on create.
- [ ] A create with an unknown `kind`, `minCount: 0`, an extra params key, an archived topic or an unpriced event is a `400` naming the requirement index; after `start_at`, `PUT …/requirements` is `409 MISSION_STARTED`.
- [ ] A student outside an `assigned` mission gets `404` on detail, join and check, and sees it in `GET /v1/me/missions` only as a teaser with `locked.reason = 'assigned'`, title, group names and no steps.
- [ ] An `auto` mission targeting a topic outside a student's access set never enrolls that student and is absent from their list; no `admin` or `content_creator` is enrolled in an `auto` mission by a hook or by the daily run.
- [ ] Joining an `open` mission mid-window counts only evidence produced after the join; leaving and rejoining keeps the original `counts_from`.
- [ ] A paid charge for an event inside the window completes `event_participation` once the event has started; voiding it before completion takes the count back to 0.
- [ ] Watching 90 % of a topic video in the catalog sends `POST /v1/topics/{id}/videos/{videoId}/watched` (asserted on the mocked client) and advances a `video_watched` step on that topic; a video id from another topic does not.
- [ ] A window comparison test with `start_at = '…T10:00:00.000Z'` and evidence at `'… 09:59:59'` / `'… 10:00:00'` excludes the first and includes the second.
- [ ] In the admin editor, a window of 14 days or more without a badge shows the suggestion and saving still succeeds; a content creator sees the pages read-only.
- [ ] On the dashboard a student sees *My missions* with per-step state, *Available* with *Join* and *Locked* teasers; ticking a self-check on the mission page completes the step.
- [ ] `git diff origin/main -- apps/api/migrations/0010_create_progress_tables.sql apps/api/migrations/0030_create_topic_submissions.sql apps/api/migrations/0019_seed_quests.sql apps/api/src/core/progress apps/api/src/controllers/submissions.controller.ts apps/api/src/core/billing` is empty, and `0031` contains no statement on `topic_nodes`, `topic_progress`, `topic_submissions`, `tasks*` or `quest_*`.
- [ ] The demo seed CI check (`node scripts/demo/ci-check.mjs`) passes with the demo mission expressed as requirements.
- [ ] `check-i18n-coverage.js` passes; `NEXT_PUBLIC_LANGUAGE=en` and default `pt` both render the editor, the dashboard panel and the mission page with no hardcoded string.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] No diff outside the scope declared in the guardrail.

---

## 4. Specific Stack

- **Backend:** Cloudflare Workers + Hono; per-request adapters built in `buildApp(env)`; the `gamification` container group gains `missionEvaluator`, `missionParticipationRepo` and `missionEvidenceRepo`; controllers return `ControllerResult<T>` from `src/core/result.ts`. **Validation is `@hono/zod-openapi` `createRoute` + Zod at the route layer — not `@ValidateBody`/`@Body` decorators**; requirement params are parsed again by `RequirementParams[kind]` in the controller. Write routes add `requireRole(ROLES.ADMIN)` in their own middleware chain (the `/admin/*` umbrella keeps admitting content creators for the reads). Hooks go through `core/missions/hook.ts` (`try/catch`, ids-only log). Write-once completion uses D1 `meta.changes`; the daily job uses `ROW_NUMBER()` window functions and `db.batch` chunks of 100. `openapi.json` regenerated with `pnpm dump-openapi`.
- **Shared:** `domain/missions/requirements.ts` (kinds, Zod params, limits, `targetCountOf`), `domain/gamification/mission-evaluator.ts` (pure, no Cloudflare types), `Entities.Gamification` mission types, `DashboardMissionEntry` / `MissionStepView`, ports `i-mission-repository.ts` (extended), `i-mission-participation-repository.ts`, `i-mission-evidence-repository.ts`; `XpAction` `mission_step_reward`; existing `XpEngine`, `StreakEngine`, `IBadgeRepository` reused unchanged.
- **Database:** D1 migration `0031_create_mission_requirements.sql` — two `ADD COLUMN` with `CHECK` on `missions`, six tables, `RESTRICT` on topic/event targets, partial indexes on the targets. No change to any other existing table.
- **Frontend:** Next.js 15 App Router (React 19, Tailwind v4); admin editor and mission page as client components; `TaskTopicPicker` wrapped for single selection; drag ordering with keyboard-accessible up/down buttons; `useHasRole(ROLES.ADMIN)` for write affordances; `missions-api.ts`, `admin-gamification-api.ts`, `dashboard-api.ts` over the shared API client; types from the regenerated `api-types.gen.ts` (`pnpm gen:api-types`); both i18n dictionaries + `check-i18n-coverage.js`.
- **Scripts:** `scripts/demo/*` (RFC 0021 demo seed and its CI check).
- **Tests:** Vitest unit tests for the evaluator over in-memory ports (shared); Vitest + `@cloudflare/vitest-pool-workers` (API — counting SQL per kind at window edges in both timestamp formats, role matrix, start lock, hooks with a throwing evaluator, reconciliation idempotency and monotonicity, badge and streak); Vitest + RTL (web — editor per kind, ordering, read-only states, badge suggestion, dashboard groups, join, manual check, video-watched call).

---

## 5. Task Breakdown

Each task is one independent PR with one owner and one review surface. Backend and frontend never
share a file: the web work lands as five Frontend tasks (`01`, `09`–`12`), and the demo seed (`13`)
and the closeout (`14`) use the Backend template, as earlier milestones did for script and docs
tasks.

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Live catalog viewer reports watched videos](./01-video-watched-wiring-frontend.task.md) | 0 | Frontend | ✅ Done |
| 02 | [Mission contracts — requirement kinds, params, entities, ports](./02-mission-contracts.task.md) | 1 | Backend | ✅ Done |
| 03 | [Mission evaluator — windowing, sequential unlock, write-once rewards, streak](./03-mission-evaluator-domain.task.md) | 1 | Backend | ✅ Done |
| 04 | [Migration 0031 and D1 adapters with per-kind counting](./04-schema-and-d1-adapters.task.md) | 2 | Backend | ✅ Done |
| 05 | [Admin missions API — admin-only writes, typed requirements, start lock, audience, participants](./05-admin-missions-api.task.md) | 3 | Backend | ✅ Done |
| 06 | [Mission hooks at the evidence write sites](./06-mission-hooks.task.md) | 4 | Backend | ✅ Done |
| 07 | [Student missions API — steps, teasers, join, leave, manual check](./07-student-missions-api.task.md) | 4 | Backend | ☐ Open |
| 08 | [Daily reconciliation, admin reconcile endpoint and legacy loop narrowing](./08-reconciliation-job.task.md) | 4 | Backend | ☐ Open |
| 09 | [Admin mission editor — requirements editor, pickers, audience, badge suggestion](./09-admin-mission-editor-frontend.task.md) | 5 | Frontend | ☐ Open |
| 10 | [Admin participants tab and Reconcile now](./10-admin-participants-frontend.task.md) | 5 | Frontend | ☐ Open |
| 11 | [Dashboard missions panel — My missions, Available, Locked, Join](./11-dashboard-missions-panel-frontend.task.md) | 6 | Frontend | ☐ Open |
| 12 | [Mission page — steps, manual check, leave](./12-mission-page-frontend.task.md) | 6 | Frontend | ☐ Open |
| 13 | [Demo seed mission as typed requirements](./13-demo-seed-requirements.task.md) | 7 | Backend | ☐ Open |
| 14 | [Documentation closeout, backlog items and release note](./14-docs-and-closeout.task.md) | 7 | Backend | ☐ Open |

Dependency graph:

```
01 (independent, ships first)

02 ──► 03 ──────────────┬──► 06
 │                      ├──► 07 ──► 11 ──► 12
 └──► 04 ──► 05 ──► 09 ─┼──────────────────────┐
       │      │         │                      │
       │      └─────────┴──► 08 ──► 10         │
       └──► 13                                 ▼
                                    (all) ──► 14
```

(`03` and `04` depend on `02`; `05` depends on `04`; `06` and `07` depend on `03` and `04`; `08`
depends on `03`, `04` and `05`; `09` depends on `05`; `10` depends on `08` and `09`; `11` depends
on `07`; `12` depends on `07` and `11`; `13` depends on `04`; `14` depends on every other task.)

**Recommended execution order:** `01` → `02` → `03` → `04` → `05` → `06` → `07` → `08` → `09` →
`10` → `11` → `12` → `13` → `14`. `01` touches only the catalog viewer and can merge at any time —
first is best, since the release note for video XP rides with it. The backend (`02`–`08`) ships
behind routes no page calls yet; `03` (pure domain) and `04` (SQL) can run in parallel once `02` is
in. `09` can start as soon as `05` lands, in parallel with `06`–`08`; `11` needs only `07`, and `12`
follows `11` because it reuses its step components and client; `13` needs only the schema (`04`).
`14` is written last, because its closeout note and the RFC status change assert the milestone is
complete.

Each task is intended to land as an independent PR with `make lint`,
`make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC 0022 "Resolved Decisions")

All by the product owner, 2026-10-02. Items 1–14 are RFC Resolved Decisions 1–14; items 15–20 are
the six RFC Open Questions as answered (RFC Resolved Decision 15); item 21 is RFC Resolved
Decision 16.

1. **One RFC, not an epic** — new tables and ports, open product decisions and a role-boundary move fail the backlog criteria.
2. **A mission is made of N typed requirements; topics and submissions are not modified** — `missions` and `mission_progress` stay (the latter as aggregate); the mission runs on its own data ([RFC §1](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md#1-schema-0031_create_mission_requirementssql)).
3. **Five v1 kinds** — `submissions_on_topic`, `topic_visited`, `video_watched`, `manual_check` (ticked on the mission page, never in `topic_progress`), `event_participation` (paid charge over `event_audience_user`); `topic_completed` deferred ([RFC §2](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md#2-requirement-kinds-and-their-params)).
4. **Evidence is windowed by the mission** — never lifetime history; `start_at`/`end_at` mandatory ([RFC §3.3](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md#33-windowing-and-the-sequential-unlock)).
5. **`sequential` or `parallel` per mission** — sequential counts step N only from step N−1's completion; parallel opens at `start_at` or enrollment, whichever is later.
6. **Hooks + daily reconciliation** — inline best-effort hooks; the cron may close, never reopen ([RFC §3–§4](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md#4-scheduled-reconciliation)).
7. **Rewards are write-once** — step XP, mission XP and badge through `xp_events` keys; deletion or leaving never revokes; partial progress may regress, completion never does ([RFC §3.5](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md#35-write-once-completion-and-rewards)).
8. **Enrollment** — `mission_enrollments` with source `auto | self | admin`; `auto` / `open` / `assigned`; hooks evaluate only enrolled, active missions ([RFC §5](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md#5-enrollment)).
9. **Admin-only setup** — content creators lose write access (role-boundary change).
10. **Structured admin editor** — kind picker, `TaskTopicPicker` reuse, per-kind params, sequential ordering ([RFC §7](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md#7-frontend)).
11. **Task/TaskStage unchanged in v1** — fusion deferred, not rejected; `task_progress` not migrated.
12. **Daily/weekly quests stay as shipped in M7** — recurring missions are a future RFC.
13. **RFC 0008 not superseded; RFC 0020's staff review stays deferred** — this milestone owns mission participation on the dashboard and only reads submission rows.
14. **The quest seed/evaluator mismatch is evidence, not scope** — fixed for missions by typed requirements; the quest fix is a backlog item.
15. **Content creators keep read access** to `GET /v1/admin/missions*` — the instructor animates the mission in class and must see participants and per-step progress.
16. **Editor defaults: shared evidence worth more than private, moderated evidence never counts** — overridable per requirement; rewarding content staff took out of circulation is contradictory.
17. **`auto` enrollment follows the access gate of every topic target** — an impossible mission is the classic anti-pattern.
18. **Locked teasers for `assigned` missions; no staff in `auto` missions** — staff participation would distort the leaderboard.
19. **Phase 0 accepted as a bug fix** — video XP, the weekly video quest and the video badge come back; the release notes announce it.
20. **`topic_visited` keeps its current semantics in v1** — `visit` on page mount is a backlog item.
21. **Additions ratified** — `mission_evidence`; `mission_audience_group` / `mission_audience_user`; the Leave route; rules frozen after `start_at` (`409 MISSION_STARTED`); admin participants and reconcile endpoints; legacy missions kept on the M7 loop until they end.

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] The release notes announce that watching videos earns XP again (decision 19).
- [ ] Backlog items filed for the quest seed mismatch, the demo/legacy mission cleanup and `visit` on topic page mount.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC 0022 status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items remain backlog.
- [ ] No diff outside the scope declared in the guardrail.
