# RFC 0022: Mission requirements — evidence-driven missions with ordered steps, enrollment and per-step rewards

**Date:** 2026-10-02
**Status:** Draft
**Author:** raphaelsilva
**Affected:**
- `apps/api/migrations/0031_create_mission_requirements.sql` (new — `mission_requirements`, `mission_enrollments`, `mission_requirement_progress`, `mission_evidence`, `mission_audience_group`, `mission_audience_user`; adds `mode` and `enrollment_mode` to `missions`. No statement touches `topic_nodes`, `topic_progress`, `topic_submissions` or any billing table)
- `packages/shared/types/entities.ts` (`Entities.Gamification`: `Mission` gains `mode` / `enrollmentMode`, `predicateKind` / `predicateParams` become `@deprecated` legacy fields; new `MissionRequirement`, `MissionEnrollment`, `MissionRequirementProgress`)
- `packages/shared/domain/missions/requirements.ts` (new — requirement kinds, the per-kind Zod params, limits; one table read by API and web)
- `packages/shared/domain/mission.ts`, `packages/shared/types/dashboard.ts` (`DashboardMissionEntry` gains `enrollment`, `joinable`, `steps` — additive)
- `packages/shared/domain/gamification/mission-evaluator.ts` (new — pure evaluator: windowing, sequential unlock, write-once completion, rewards)
- `packages/shared/domain/gamification/quest-evaluator.ts` (mission loop narrowed to legacy missions, lines 79-106)
- `packages/shared/domain/gamification/xp-config.ts` (new `XpAction` `mission_step_reward`)
- `packages/shared/ports/i-mission-repository.ts` (extended — requirements and audience on the authoring side), `packages/shared/ports/i-mission-participation-repository.ts` (new — enrollments, step progress, captured evidence), `packages/shared/ports/i-mission-evidence-repository.ts` (new — set-based counting over the source tables), `packages/shared/ports/index.ts`
- `apps/api/src/adapters/db/d1-mission-repository.ts` (extended), `apps/api/src/adapters/db/d1-mission-participation-repository.ts`, `apps/api/src/adapters/db/d1-mission-evidence-repository.ts` (new)
- `apps/api/src/controllers/admin-missions.controller.ts` (typed requirements, lock after start, audience, participants), `apps/api/src/controllers/me-missions.controller.ts` (steps, enrollment, join, leave, manual check)
- `apps/api/src/routes/admin/missions.ts` (`requireRole(ROLES.ADMIN)` on the router; new routes), `apps/api/src/routes/me/gamification.ts` (extended `GET /missions`), `apps/api/src/routes/me/missions.ts` (new — detail, join, leave, check)
- `apps/api/src/core/missions/hook.ts` (new — best-effort hook runner), called from `apps/api/src/routes/submissions.router.ts`, `apps/api/src/routes/me/submissions.ts`, `apps/api/src/routes/admin/submissions.ts`, `apps/api/src/routes/me/progress.ts`, `apps/api/src/routes/topics.router.ts`, `apps/api/src/routes/admin/billing.ts`
- `apps/api/src/jobs/reconcile-missions.ts` (new) and `apps/api/src/index.ts` `scheduled()` (wiring), `apps/api/src/container.ts` (`missionEvaluator` in the gamification slice)
- `apps/api/src/openapi/components/entities.ts` (new schemas)
- `apps/web/src/app/(protected)/admin/missions/page.tsx` (list; the free `predicateKind` / `predicateParams` fields go away), `apps/web/src/app/(protected)/admin/missions/[id]/page.tsx` (new — editor and participants), `apps/web/src/app/(protected)/admin/page.tsx` (Missions card admin-only)
- `apps/web/src/components/missions/*` (new — requirement editor, topic/event pickers, step list), reusing `apps/web/src/components/tasks/task-topic-picker.tsx`
- `apps/web/src/components/dashboard/MissionsList.tsx` (per-step progress, *Join*), `apps/web/src/app/(protected)/missions/[id]/page.tsx` (new — the mission page, where a manual check is ticked)
- `apps/web/src/components/catalog/MediaList/*` (Phase 0 — call the existing `markVideoWatched` from the live video viewer)
- `apps/web/src/lib/admin-gamification-api.ts`, `apps/web/src/lib/dashboard-api.ts`, `apps/web/src/lib/missions-api.ts` (new)
- `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (new `missions:` section, reworked `admin.missions`, identical keys)
- `scripts/demo/dataset/base.json`, `scripts/demo/dataset.mjs`, `scripts/demo/sql.mjs`, `scripts/demo/ci-check.mjs` (the demo mission moves to typed requirements — RFC 0021)

---

## Summary

Turn a mission from **one free-text predicate with a global counter** into an ordered list of
**typed requirements** — *"upload 3 demonstrations with a description on topic X"*, *"open topic
Y"*, *"watch 2 videos of topic Z"*, *"tick: I practised with a partner"*, *"take part in the
seminar"* — each with Zod-validated parameters, an optional XP reward of its own, and progress
computed from **evidence the student already produces** inside the mission's window. A mission
runs in **parallel** mode (every step open at once) or **sequential** mode (step N counts evidence
only from the moment step N−1 completed). Students take part through an **enrollment** —
automatic, by clicking *Join*, or assigned by an admin to users and groups — and the dashboard
shows the missions they are in with per-step progress. Progress is evaluated **inline, right after
the write that produced the evidence**, and a daily reconciliation in the existing `scheduled()` run
recomputes it from the sources as a safeguard. Rewards are **write-once** through the `xp_events`
ledger: nothing a student deletes afterwards takes XP back. Mission authoring becomes
**admin-only**. Topics, submissions, tasks and quests keep their tables and their rules; the mission
runs on its own data and only *reads* theirs.

## Motivation

Missions shipped in M7 as a time-boxed counter: one `predicate_kind` string, one JSON blob, one
`current_value`. That shape cannot say what the product needs a mission to say, and the free-string
layer under it is already broken in production code.

| Case | Today | This RFC |
|---|---|---|
| "This month, post 3 demonstrations of *Kihon 1* with a description" | Not expressible: params have no topic, the counter has no filter, submissions are no source | `submissions_on_topic` with `minCount: 3`, `requireDescription: true` |
| "First watch the lesson, then post your attempt" (order matters) | Not expressible | `sequential` mode: the upload counts only after the watch step completed |
| "Shared demonstrations are worth more than private ones" | — | Two requirements, `visibility: 'any'` and `visibility: 'shared_only'`, each with its own `xp_reward` |
| "Attend the September seminar" | — | `event_participation` on the event, satisfied by a settled charge |
| A self-declared step ("I trained with a partner this week") | — | `manual_check`, ticked on the mission page |
| Only the black-belt group takes this mission | Every user sees every active mission | `enrollment_mode: 'assigned'` with groups and users |
| A student chooses to take a challenge | — | `enrollment_mode: 'open'` + *Join* on the dashboard |
| A hook fails mid-request | Progress is lost for good | The daily reconciliation recomputes it from the evidence |
| Admin sets the mission's badge | Never awarded | Awarded on completion, idempotently |

**The predicate layer is fragile, and it shows.** `QuestEvaluator` maps predicate strings to event
sources through a hard-coded table (`packages/shared/domain/gamification/quest-evaluator.ts:6-13`)
and reads the target from `JSON.parse(params).target` (lines 53 and 89). The seed of the quests it
evaluates, `apps/api/migrations/0019_seed_quests.sql:7`, writes predicate kind **`login`** — the
table only knows `daily_login`, so the daily-login quest is skipped with a `console.debug` on every
login and **never progresses**. Every seeded row also writes `{"count":N}` while the evaluator reads
`.target`, so **every target collapses to 1**: "watch 10 videos this week" completes after one video.
The demo dataset repeats the mistake for its mission (`scripts/demo/dataset/base.json:468-481`,
`predicateKind: "complete_topic"`, `params: { "count": 1 }`). Nothing validated either string at
write time, and nothing could, because the admin form takes the kind as free text and the params as
raw JSON. Typed requirements remove this class of bug for missions: the kind is an enum checked by
the database, the params are parsed by a per-kind schema on every write, and the target is a foreign
key. Quests are out of scope here; their seed/evaluator mismatch gets its own backlog item (Phase 7).

## Goals & Non-Goals

**Goals**
- A mission is made of **1…20 ordered requirements**, each of a typed kind with Zod-validated params
  and a target held in a typed, foreign-keyed column.
- Five v1 kinds: `submissions_on_topic`, `topic_visited`, `video_watched`, `manual_check`,
  `event_participation`.
- Evidence counts **only inside the mission's window** (`start_at`…`end_at`, both mandatory), never
  the student's lifetime history.
- Per-mission **mode**: `parallel` or `sequential`; in sequential mode step N's evidence counts only
  from the instant step N−1 completed.
- **Enrollment** per student (`auto` / `open` / `assigned`); hooks evaluate only active missions the
  user is enrolled in.
- **Inline evaluation** right after the originating write, best-effort; a **daily idempotent
  reconciliation** that can close a mission but never reopen one.
- **Write-once rewards**: per-step XP, mission XP and the mission badge, all through `xp_events`
  with deterministic idempotency keys.
- **Admin-only authoring** with a structured requirements editor; content creators lose the write
  access they hold today.
- The dashboard shows the student's missions with per-step progress and a *Join* action.

**Non-Goals**
- **Changing topics or submissions.** No new column on `topic_nodes`, `topic_progress` or
  `topic_submissions`; no change to visit, complete, upload, share, move or moderation rules. The
  mission only reads their rows.
- **`topic_completed` as a kind.** No UI calls `POST /v1/me/topics/{id}/complete`; see
  Alternatives §5.
- **Real attendance (door check-in) for events.** The system has no attendance record; v1 uses the
  settled charge as the participation signal. Check-in is a future RFC.
- **Participants without an account.** Only logged-in users have missions; a walk-in attendee who
  never registered is invisible by design.
- **Fusing Task + TaskStage (M4/M5) into missions.** Deferred, not rejected (Alternatives §2).
  `tasks`, `task_stages`, `task_progress` and `task_stage_progress` are untouched and **not
  migrated**.
- **Redesigning daily/weekly quests ("desafios").** They stay as shipped in M7. A weekly challenge is
  today a `quest_definitions` row with `kind = 'weekly'`; re-expressing recurring challenges as
  recurring missions is deferred to a future RFC.
- **Staff review of submissions** — still deferred by RFC 0020; a requirement only counts rows.
- **Recommendations and manual badge approval** — owned by RFC 0008.
- **Revoking XP** (Alternatives §6), notifications, leaderboards per mission, mission templates.

## Current State (for reference)

**1. Schema.** `apps/api/migrations/0024_create_missions.sql:4-30`:

```sql
CREATE TABLE IF NOT EXISTS missions (
  id TEXT NOT NULL PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL, end_at TEXT NOT NULL,
  predicate_kind TEXT NOT NULL, predicate_params TEXT NOT NULL DEFAULT '{}',
  xp_reward INTEGER NOT NULL DEFAULT 0, badge_id TEXT, active INTEGER NOT NULL DEFAULT 1,
  created_at …, updated_at …);
CREATE TABLE IF NOT EXISTS mission_progress (
  user_id TEXT NOT NULL, mission_id TEXT NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0, target_value INTEGER NOT NULL DEFAULT 1,
  completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT, updated_at …,
  PRIMARY KEY (user_id, mission_id), …);
```

No target, no steps, no enrollment. `start_at` / `end_at` are stored as the ISO-8601 strings the
API receives (`'2026-10-02T12:00:00.000Z'`), while every evidence table stamps
`datetime('now')` (`'2026-10-02 12:00:00'`) — a raw string comparison between the two misorders
values on the same day (`' '` sorts before `'T'`).

**2. The free JSON form.** The admin API accepts `predicateKind: z.string().min(1)` and
`predicateParams: z.string().min(1)` (`apps/api/src/controllers/admin-missions.controller.ts:6-16`;
OpenAPI example `'3'` in `routes/admin/missions.ts:58-59`). The admin page types the kind as free
text and the params as raw JSON with a parse-only preview
(`apps/web/src/app/(protected)/admin/missions/page.tsx:18-19, 81-88, 128-130, 225`).

**3. Evaluation.** `QuestEvaluator.evaluate(userId, sourceKind, now)` loops over **every** active
mission and, when the mission's predicate maps to the event's source, adds 1 to the counter and
grants `mission_reward` XP on completion (`quest-evaluator.ts:79-106`). It ignores which topic or
video produced the event, never awards `badge_id` (no code path reads it besides the repository),
and treats every user as a participant. It is called inline, inside a `try/catch` that only logs,
from three places: `routes/topics.router.ts:52-58` (`'video'`), `routes/auth/login.ts:174-180`
(`'login'`) and `routes/me/progress.ts:270-275, 310-315` (`'topic'`, `'stage'`). That best-effort
inline pattern is the one this RFC reuses.

**4. Student read.** `GET /v1/me/missions` (`routes/me/gamification.ts:114-131, 211-217`) returns
every active mission with the user's single counter (`controllers/me-missions.controller.ts:8-23`);
`GET /v1/me/dashboard` embeds the same list, rendered by
`apps/web/src/components/dashboard/MissionsList.tsx` as one progress bar per mission.

**5. The missing guard.** `/v1/admin/*` admits `ADMIN` and `CONTENT_CREATOR`
(`routes/admin/index.ts:27`), and `/missions` is mounted with no guard of its own (line 46),
unlike `/users` (`routes/admin/users.ts:279`), `/billing` (`billing.ts:1181`), `/storage`
(`storage.ts:153`) and `/levels` (`levels.ts:82`). RFC 0009 decided on 2026-06-23 that reward values
are admin-only; `/quests` enforces it server-side (`routes/admin/quests.ts:189-199`), `/missions`
only hides the field in the web form (`admin/missions/page.tsx:43, 148`). A content creator can
create a mission with any `xpReward` through the API today; the router spec signs a content-creator
token and never uses it (`apps/api/test/routes/admin-missions.router.spec.ts:15, 25`).

**6. Evidence that exists today.**
- *Submissions* — `topic_submissions` (`0030_create_topic_submissions.sql:14-35`): `status`
  (`pending`/`ready`/`removed`), `description` (`''` when empty), `visibility`, `moderated_at`,
  `created_at`. Durable and re-readable; there is no `ready_at` column.
- *Topic visit* — `POST /v1/me/topics/{id}/visit` upserts `topic_progress`
  (`core/progress/progress-service.ts:156-184`, `adapters/db/d1-progress-repository.ts:111-131`):
  `created_at` is the first visit, `updated_at` moves on **every** visit, and a `completed` row is
  never touched again. The table keeps no history. The web calls `visit` from the catalog topic page
  (`apps/web/src/app/(protected)/catalog/[id]/page.tsx:166-169`) — but only when the student expands
  or plays a media item (`components/catalog/MediaList/MediaList.tsx:54-65`), not on page open, and a
  topic without media never records a visit.
- *Video watched* — `POST /v1/topics/{id}/videos/{videoId}/watched` (`routes/topics.router.ts:19-69`)
  checks the topic gate and appends an `xp_events` row (`source_kind = 'video'`,
  `source_id = videoId`, key `video:<videoId>:v1` — `xp-engine.ts:24`). The key makes it **first
  watch only**, the row is not written when `GAMIFICATION_ENABLED=false` (`container.ts:285-288`),
  and the route does not check that the video belongs to the topic. Its only web caller,
  `VideoPlayerWithPlaylist` (`components/catalog/VideoPlayerWithPlaylist.tsx:39-44`), is rendered
  only by `MediaTabs`, which **no page mounts** since the catalog redesign — today nothing in the UI
  produces this evidence.
- *Topic complete* — `POST /v1/me/topics/{id}/complete` exists and is tested at service level
  (`apps/api/test/core/progress-service.spec.ts:334-353`), but `topics-api.ts:62-63` `complete` has
  **no call site** in the web app.
- *Event participation* — `event_charges` (`0028_create_event_charges.sql:24-53`): one live charge
  per `(event_id, user_id)`, `status` cached as `open` / `paid` / `void` by `REFRESH_CHARGE_STATUS`
  (`adapters/db/d1-event-charge-repository.ts:196-204`; `paid` ⇔ balance ≤ 0, through payments or a
  waiver). Writes go through `/v1/admin/billing/charges/{id}/payments`, `/adjustments`, `/void` and
  `/charge-payments/{id}/reverse` (`routes/admin/billing.ts:1099-1118`,
  `core/billing/event-charge-service.ts:473-580`). `event_audience_user` is explicitly *"may see this
  announcement"*, not participation (`0027_create_events.sql:79-81`). There is no attendance record.

**7. The cron.** One daily trigger (`apps/api/wrangler.jsonc:28-32`, `"0 6 * * *"`) runs billing,
then the abandoned-upload sweep in a `finally` (`apps/api/src/index.ts:57-71`).

**8. Reusable pieces.** `TaskTopicPicker` (`apps/web/src/components/tasks/task-topic-picker.tsx:13`)
lists published, non-archived topics as a multi-select. Event audiences give the users-and-groups
grant shape (`0027_create_events.sql:82-99`, replace-all `PUT /v1/admin/events/{id}/audience` at
`routes/admin/events.ts:216`, `adapters/db/d1-event-repository.ts:505-514`). `xp_events` is unique on
`(user_id, source_kind, idempotency_key)` (`0014_create_xp_events.sql:15-16`); `user_badges` on
`(user_id, badge_id)` with `INSERT OR IGNORE` (`adapters/db/d1-badge-repository.ts:141-148`).

## Proposed Design

### 1. Schema (`0031_create_mission_requirements.sql`)

Additive. Two `ALTER … ADD COLUMN` on `missions` (defaults make every existing row valid), six new
tables. `mission_progress` stays and becomes the **aggregate**: `current_value` = completed steps,
`target_value` = number of steps.

```sql
-- Mode and enrollment policy. start_at / end_at already exist and stay NOT NULL:
-- there is no mission without a window.
ALTER TABLE missions ADD COLUMN mode TEXT NOT NULL DEFAULT 'parallel'
  CHECK (mode IN ('parallel', 'sequential'));
ALTER TABLE missions ADD COLUMN enrollment_mode TEXT NOT NULL DEFAULT 'auto'
  CHECK (enrollment_mode IN ('auto', 'open', 'assigned'));

-- The mission's own steps.
CREATE TABLE IF NOT EXISTS mission_requirements (
  id             TEXT NOT NULL PRIMARY KEY,
  mission_id     TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL CHECK (position >= 1),
  kind           TEXT NOT NULL CHECK (kind IN ('submissions_on_topic', 'topic_visited',
                   'video_watched', 'manual_check', 'event_participation')),
  title          TEXT NOT NULL,                       -- 1…120, shown as the step label
  -- Targets are typed columns, not JSON, so the database holds referential integrity
  -- and the hooks find "requirements on this topic" through an index.
  topic_node_id  TEXT REFERENCES topic_nodes(id) ON DELETE RESTRICT,
  event_id       TEXT REFERENCES events(id) ON DELETE RESTRICT,
  params         TEXT NOT NULL DEFAULT '{}',          -- parsed by RequirementParams[kind] on every write and read
  xp_reward      INTEGER NOT NULL DEFAULT 0 CHECK (xp_reward >= 0),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (mission_id, position),
  CHECK (
    (kind IN ('submissions_on_topic', 'topic_visited', 'video_watched')
       AND topic_node_id IS NOT NULL AND event_id IS NULL)
    OR (kind = 'event_participation' AND event_id IS NOT NULL AND topic_node_id IS NULL)
    OR (kind = 'manual_check' AND topic_node_id IS NULL AND event_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_mission_requirements_topic
  ON mission_requirements (topic_node_id, kind) WHERE topic_node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mission_requirements_event
  ON mission_requirements (event_id) WHERE event_id IS NOT NULL;

-- Who takes part. counts_from is the evidence floor for this user (§3.3).
CREATE TABLE IF NOT EXISTS mission_enrollments (
  mission_id   TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source       TEXT NOT NULL CHECK (source IN ('auto', 'self', 'admin')),
  joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
  counts_from  TEXT NOT NULL,                         -- 'YYYY-MM-DD HH:MM:SS' UTC
  left_at      TEXT,                                  -- set by Leave or by an audience removal
  PRIMARY KEY (mission_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mission_enrollments_user
  ON mission_enrollments (user_id, mission_id) WHERE left_at IS NULL;

-- Per-step progress. completed_at is write-once (§3.5).
CREATE TABLE IF NOT EXISTS mission_requirement_progress (
  requirement_id TEXT NOT NULL REFERENCES mission_requirements(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission_id     TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  current_count  INTEGER NOT NULL DEFAULT 0 CHECK (current_count >= 0),
  target_count   INTEGER NOT NULL CHECK (target_count >= 1),
  checked_at     TEXT,                                -- manual_check: when the student ticked it
  completed_at   TEXT,                                -- evidence instant of the target-th item
  completed_by   TEXT CHECK (completed_by IN ('hook', 'reconcile')),
  recorded_at    TEXT,                                -- wall clock when completed_at was written
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (requirement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mission_requirement_progress_user
  ON mission_requirement_progress (user_id, mission_id);

-- Captured evidence for the two kinds whose source keeps no history (§3.2).
CREATE TABLE IF NOT EXISTS mission_evidence (
  requirement_id TEXT NOT NULL REFERENCES mission_requirements(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ref_id         TEXT NOT NULL,                       -- media id (video_watched) or topic id (topic_visited)
  occurred_at    TEXT NOT NULL,                       -- 'YYYY-MM-DD HH:MM:SS' UTC
  source         TEXT NOT NULL CHECK (source IN ('hook', 'backfill')),
  PRIMARY KEY (requirement_id, user_id, ref_id)
);

-- Assignment grants for enrollment_mode = 'assigned' — the event-audience shape.
CREATE TABLE IF NOT EXISTS mission_audience_group (
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  group_id   TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (mission_id, group_id)
);
CREATE TABLE IF NOT EXISTS mission_audience_user (
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (mission_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mission_audience_group_group ON mission_audience_group (group_id);
CREATE INDEX IF NOT EXISTS idx_mission_audience_user_user   ON mission_audience_user (user_id);
```

- **`RESTRICT` on topic and event targets** changes no current rule: no API route hard-deletes a
  topic (`DELETE /v1/admin/topics/{id}` archives; `D1TopicNodeRepository.delete` at
  `d1-topic-node-repository.ts:381` has no caller) or an event (`D1EventRepository.delete` at
  `d1-event-repository.ts:468` has none either). `event_charges` already holds events with
  `RESTRICT`. An archived target simply cannot produce evidence any more (§8).
- **Timestamps.** The new tables store `datetime('now')` form. Every window comparison goes through
  `datetime(…)` on both sides, so the ISO strings in `missions` and the SQLite strings in the
  evidence tables compare as instants (Current State §1).
- **Legacy missions.** A mission created before this RFC has no requirement rows and a
  `predicate_kind` other than `'requirements'`. New missions write `predicate_kind = 'requirements'`,
  `predicate_params = '{}'` (the columns stay `NOT NULL`; dropping them is a follow-up). Legacy
  missions keep running on the M7 loop until their `end_at` (§3.7).

### 2. Requirement kinds and their params

`packages/shared/domain/missions/requirements.ts` — one module read by the API (validation,
evaluation) and the web (editor, step labels):

```ts
export const REQUIREMENT_KINDS = [
  'submissions_on_topic', 'topic_visited', 'video_watched', 'manual_check', 'event_participation',
] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const MISSION_STEPS_MAX = 20;
export const REQUIREMENT_TITLE_MAX = 120;
export const REQUIREMENT_MIN_COUNT_MAX = 50;
export const MANUAL_CHECK_INSTRUCTIONS_MAX = 500;

const MinCount = z.number().int().min(1).max(REQUIREMENT_MIN_COUNT_MAX);

export const RequirementParams = {
  submissions_on_topic: z.object({
    minCount: MinCount,
    requireDescription: z.boolean().default(false),   // counts only description <> ''
    visibility: z.enum(['any', 'shared_only']).default('any'),
    countModerated: z.boolean().default(false),        // a force-unshared row counts only if true
  }).strict(),
  topic_visited: z.object({}).strict(),
  video_watched: z.object({ minCount: MinCount }).strict(),
  manual_check: z.object({
    instructions: z.string().trim().max(MANUAL_CHECK_INSTRUCTIONS_MAX).default(''),
  }).strict(),
  event_participation: z.object({}).strict(),
} as const;

const base = {
  title: z.string().trim().min(1).max(REQUIREMENT_TITLE_MAX),
  xpReward: z.number().int().min(0).default(0),
};

export const RequirementInput = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('submissions_on_topic'), topicId: z.string().uuid(),
             params: RequirementParams.submissions_on_topic }),
  z.object({ ...base, kind: z.literal('topic_visited'), topicId: z.string().uuid(),
             params: RequirementParams.topic_visited.default({}) }),
  z.object({ ...base, kind: z.literal('video_watched'), topicId: z.string().uuid(),
             params: RequirementParams.video_watched }),
  z.object({ ...base, kind: z.literal('manual_check'),
             params: RequirementParams.manual_check.default({}) }),
  z.object({ ...base, kind: z.literal('event_participation'), eventId: z.string().uuid(),
             params: RequirementParams.event_participation.default({}) }),
]);
export type RequirementInput = z.infer<typeof RequirementInput>;

/** How many qualifying items complete the step. */
export const targetCountOf = (r: { kind: RequirementKind; params: unknown }): number =>
  r.kind === 'submissions_on_topic' || r.kind === 'video_watched'
    ? (r.params as { minCount: number }).minCount
    : 1;
```

What each kind counts — always **inside the step's open interval** (§3.3) and only for the
enrolled user:

| Kind | Qualifying item | Evidence instant | Source |
|---|---|---|---|
| `submissions_on_topic` | A `topic_submissions` row by the user on the target topic with `status = 'ready'`; plus `description <> ''` when `requireDescription`; plus `visibility = 'shared'` (and sharing enabled for the label) when `shared_only`; plus `moderated_at IS NULL` unless `countModerated` | `created_at` (presign time; the table has no `ready_at`). Editing or moving a submission later does not re-date it, so an old demonstration moved into the topic does not count | Read directly |
| `topic_visited` | A visit of the target topic | When the visit happened | Captured in `mission_evidence` (§3.2) |
| `video_watched` | A distinct `media` row of the target topic whose type is a video, reported watched | When the watch was reported | Captured in `mission_evidence` (§3.2) |
| `manual_check` | The student's tick on the mission page | `checked_at` | `mission_requirement_progress.checked_at` |
| `event_participation` | A `paid` `event_charges` row of the user for the target event | The event's `starts_at` — participation happens at the event, and paying early must not disqualify | Read directly |

- **Why the paid charge and not `event_audience_user`.** An audience row is a visibility grant
  ("may see this announcement", `0027_create_events.sql:79-81`) and is written before anyone
  decides to come; a settled charge is the only record in the system of a person committing to an
  event. A `void` charge, or a payment reversed back to `open`, stops qualifying (progress may regress
  until the step completes). Only priced events can be targets: the editor lists events with an
  `event_prices` row, and the API refuses others with `400 EVENT_NOT_CHARGEABLE`. Real attendance is
  a Non-Goal.
- **An event in the future does not count yet**: the evidence instant must also be `≤ now`. A charge
  paid before the event completes the step at the first evaluation after `starts_at` — in practice
  the next daily reconciliation (§4), since no write happens at the moment the event starts.
- **Different XP for private and shared evidence** is expressed as **two requirements** — e.g.
  "3 demonstrations" (`visibility: 'any'`, 50 XP) and "1 shared demonstration" (`shared_only`,
  +30 XP) in parallel mode. One requirement = one reward; the policy itself is Open Question 2.
- A `shared_only` requirement cannot be created while `SUBMISSIONS_SHARING_ENABLED=false` for the
  label (`400 REQUIREMENT_SHARING_DISABLED`); if the switch is turned off later, shared rows stop
  qualifying, matching RFC 0020's read-time filter.

### 3. Evaluation

#### 3.1 The evaluator

`packages/shared/domain/gamification/mission-evaluator.ts`, pure domain code behind three ports:

```ts
export type MissionSignal =
  | { kind: 'submission';   userId: string; topicIds: string[] }      // finalize, edit, delete, move, moderation
  | { kind: 'topic_visit';  userId: string; topicId: string }
  | { kind: 'video_watch';  userId: string; topicId: string; mediaId: string }
  | { kind: 'event_charge'; userId: string; eventId: string };

export class MissionEvaluator {
  constructor(
    private readonly missions: IMissionRepository,                 // definitions, requirements, audience
    private readonly participation: IMissionParticipationRepository, // enrollments, progress, captured evidence
    private readonly evidence: IMissionEvidenceRepository,         // counting SQL over the source tables
    private readonly badges: IBadgeRepository,
    private readonly xp: XpEngine,
  ) {}

  /** Hook entry point: evaluates only what this signal can affect. */
  onSignal(signal: MissionSignal, now: Date): Promise<void>;
  /** Manual check: the route's own action, not a hook (§6). */
  check(userId: string, missionId: string, requirementId: string, now: Date): Promise<CheckResult>;
  /** Set-based recomputation of one mission for all its enrollments (§4). */
  reconcileMission(missionId: string, now: Date): Promise<ReconcileStats>;
}
```

`onSignal` does:

1. **Find candidates** in one indexed query: requirements whose `kind` matches the signal and whose
   `topic_node_id` / `event_id` is the signal's target, on missions with `active = 1` and
   `datetime(start_at) <= now <= datetime(end_at)`, with the user's enrollment state. Zero rows — the
   common case — ends the hook after **one** query.
2. **Ensure enrollment** where the policy grants it implicitly: `auto` missions, and `assigned`
   missions whose audience covers the user (directly or by group) — `INSERT OR IGNORE` with
   `source = 'auto' | 'admin'` and `counts_from = start_at`. `open` missions are evaluated only for
   users who joined. Enrollments with `left_at` set are skipped.
3. **Capture** (`topic_visit`, `video_watch` only): for each candidate requirement whose step is
   **open** for this user right now (§3.3), `INSERT … ON CONFLICT DO NOTHING` into
   `mission_evidence` with `occurred_at = now`, `source = 'hook'`. For `video_watch` the evaluator
   first checks that `mediaId` is a `ready` video of `topicId` — the watched route does not
   (Current State §6). Writing only for an open step means the stored instant is always the first
   occurrence that can count.
4. **Evaluate** each affected enrollment with `evaluateEnrollment` (§3.4).

#### 3.2 Hook sites

A hook is one call to `runMissionHook(container, signal)` (`apps/api/src/core/missions/hook.ts`),
placed in the route **after** the originating write succeeded, wrapped exactly like today's
`questEvaluator.evaluate` calls: `try { … } catch (err) { console.error('[mission] …', ids) }`. A
hook failure never changes the originating response; the reconciliation repairs what it missed.

| Originating write | Route | Signal |
|---|---|---|
| Submission finalized (`ready`) | `POST /v1/topics/{id}/submissions/{sid}/finalize` (`routes/submissions.router.ts:252`) | `submission`, the topic |
| Submission edited — only when `description` or `visibility` changed | `PATCH /v1/topics/{id}/submissions/{sid}` (`:258`) | `submission` |
| Submission deleted by its author | `DELETE /v1/topics/{id}/submissions/{sid}` (`:264`) | `submission` (may regress) |
| Submissions moved | `POST /v1/me/submissions/move` (`routes/me/submissions.ts:108`) | `submission`, source and target topics |
| Staff unshare / clear moderation / remove | `routes/admin/submissions.ts:140, 145, 150` | `submission`, for the **author** |
| Topic visited | `POST /v1/me/topics/{id}/visit` (`routes/me/progress.ts:240`) — on every successful call, not only `changed`, because a repeat visit inside the window is new evidence | `topic_visit` |
| Video watched | `POST /v1/topics/{id}/videos/{videoId}/watched` (`routes/topics.router.ts:19`) | `video_watch` |
| Charge payment, adjustment, void, payment reversal | `/v1/admin/billing/charges/{id}/payments`, `/adjustments`, `/void`, `/charge-payments/{id}/reverse` (`routes/admin/billing.ts:1088-1118`) | `event_charge`, for the charge's user |

No hook goes into `topic_progress`, `topic_submissions` or the billing services: the routes call the
evaluator next to them, the same way they already call the quest evaluator.

#### 3.3 Windowing and the sequential unlock

For an enrollment `e` of mission `m`, requirement `r` at position `p`:

```
opens_at(e)     = max(m.start_at, e.counts_from)
counts_from     = m.start_at   for source 'auto' and 'admin'
                = joined_at    for source 'self'          ("from start_at or from enrollment,
                                                            whichever is later")
step_open(r, e) = opens_at(e)                                       in parallel mode
                = opens_at(e)                         if p = 1      in sequential mode
                = progress(r_{p-1}, e).completed_at   if p > 1 and step p-1 completed
                = locked                              otherwise
evidence counts ⇔ step_open(r, e) <= instant <= min(m.end_at, now)
```

- **Evidence before the window, or before the step opened, never counts** — "in that period there
  are three", never the student's history. A demonstration uploaded last month and moved into the
  topic today keeps its `created_at` and does not count.
- **Sequential mode** evaluates steps in `position` order and stops at the first incomplete one;
  later steps are `locked` and are not counted at all.
- **Completion instants are evidence instants.** A step's `completed_at` is the instant of its
  `target_count`-th qualifying item (or `checked_at`), **not** the wall clock of the evaluation. The
  hook and the reconciliation therefore compute the same value, and a step closed late by the cron
  does not shift the next step's window.
- **Joined late to an `open` mission**: only evidence after *Join* counts. `auto` and `admin`
  enrollments count from `start_at`, so a lazily created row (§3.1 step 2) loses nothing.

#### 3.4 `evaluateEnrollment` and the counting SQL

```
for r in requirements ordered by position:
  row = progress(r, e)
  if row.completed_at:                        # write-once: never recounted, never un-completed
      prev_completed_at = row.completed_at; continue
  from = step_open(r, e); if locked: break
  (count, kth_at) = evidence.count(r, user, from, min(m.end_at, now))   # manual_check: checked_at
  if count >= target_count(r):
      complete(r, e, completed_at = kth_at)   # conditional UPDATE … WHERE completed_at IS NULL
      if it changed a row: award step XP
      prev_completed_at = kth_at
  else:
      upsert current_count = count            # may go down: partial progress may regress
      if m.mode = 'sequential': break
if every step completed: complete mission (completed_at = max(step completed_at)),
                          award mission XP and badge
```

Counting is one statement per requirement, written for a **set** of users so the hook (one user) and
the reconciliation (all enrollments) share it. For `submissions_on_topic`:

```sql
WITH scope AS (
  SELECT e.user_id,
         CASE WHEN ?prev_req IS NULL
              THEN MAX(datetime(?start_at), datetime(e.counts_from))
              ELSE datetime(prev.completed_at) END                         AS opens_at
    FROM mission_enrollments e
    LEFT JOIN mission_requirement_progress prev
           ON prev.requirement_id = ?prev_req AND prev.user_id = e.user_id
   WHERE e.mission_id = ?mission AND e.left_at IS NULL
     AND (?user IS NULL OR e.user_id = ?user)
     AND (?prev_req IS NULL OR prev.completed_at IS NOT NULL)   -- sequential: step unlocked
),
ev AS (
  SELECT s.author_id AS user_id, datetime(s.created_at) AS at,
         ROW_NUMBER() OVER (PARTITION BY s.author_id ORDER BY s.created_at, s.id) AS n
    FROM topic_submissions s JOIN scope ON scope.user_id = s.author_id
   WHERE s.topic_node_id = ?topic AND s.status = 'ready'
     AND datetime(s.created_at) >= scope.opens_at
     AND datetime(s.created_at) <= MIN(datetime(?end_at), datetime(?now))
     AND (?require_description = 0 OR s.description <> '')
     AND (?shared_only = 0 OR (s.visibility = 'shared' AND ?sharing_enabled = 1))
     AND (?count_moderated = 1 OR s.moderated_at IS NULL)
)
SELECT scope.user_id, COUNT(ev.at) AS count,
       MAX(CASE WHEN ev.n = ?min_count THEN ev.at END) AS kth_at
  FROM scope LEFT JOIN ev ON ev.user_id = scope.user_id
 GROUP BY scope.user_id;
```

(`?prev_req` is `NULL` in parallel mode and for position 1.) The other kinds swap the `ev` source:
`mission_evidence WHERE requirement_id = ?req` for `topic_visited` / `video_watched`;
`event_charges c JOIN events v ON v.id = c.event_id WHERE c.event_id = ?event AND c.status = 'paid'`
with `datetime(v.starts_at)` as the instant for `event_participation`; and
`mission_requirement_progress.checked_at` for `manual_check`. All of them rely on existing indexes
(`idx_topic_submissions_author`, `idx_event_charges_user_status`) or on the new tables' keys.

#### 3.5 Write-once completion and rewards

- **Step completion** is one conditional statement; the reward is granted only when it changed a row:

  ```sql
  UPDATE mission_requirement_progress
     SET completed_at = ?kth_at, current_count = target_count, completed_by = ?by,
         recorded_at = datetime('now'), updated_at = datetime('now')
   WHERE requirement_id = ?req AND user_id = ?user AND completed_at IS NULL;
  ```

  Two concurrent hooks completing the same step produce one `meta.changes = 1`; the XP key below is
  the second guard.
- **Partial progress** is an upsert that never touches a completed row:
  `INSERT … ON CONFLICT (requirement_id, user_id) DO UPDATE SET current_count = excluded.current_count
  … WHERE mission_requirement_progress.completed_at IS NULL`.
- **Mission completion** reuses `mission_progress` with the same guard
  (`… SET completed = 1 … WHERE completed = 0`), so `countCompletedMissions` and the
  `mission_completed` badge rule (`badge-engine.ts:58-59`) keep working unchanged.
- **Rewards**, all through `XpEngine.award` and therefore `xp_events`
  (`idempotency_key = sourceKind:sourceId:version`, `xp-engine.ts:24`):

  | Reward | `action` / `sourceKind` | `sourceId` | Key |
  |---|---|---|---|
  | Step XP (`xp_reward > 0`) | `mission_step_reward` (new `XpAction`, 0 default points) | requirement id | `mission_step_reward:<reqId>:v1` |
  | Mission XP (`xp_reward > 0`) | `mission_reward` (as today) | mission id | `mission_reward:<missionId>:v1` |
  | Mission badge (`badge_id`) | `badgeRepo.awardBadge` (`INSERT OR IGNORE`), then the badge's own `xp_reward` as `badge_award` | badge id | `badge_award:<badgeId>:v1` (as `BadgeEngine` does) |

  The mission key is unchanged from M7, so a legacy mission that already paid out cannot pay twice.
  After a completion the hook also calls `badgeEngine.evaluate` (the `mission_completed` rule), as
  the other hooks do.
- **Nothing revokes.** Deleting a counted demonstration, a voided charge, leaving the mission or an
  admin removing the user from the audience never deletes an `xp_events` row, a `user_badges` row or
  a `completed_at`. An admin who must take XP back uses RFC 0010's ledger adjustment, which leaves a
  trace.
- With `GAMIFICATION_ENABLED=false`, `XpEngine.award` is a no-op as today; progress is still
  recorded.

#### 3.6 Manual check

`manual_check` is the route's own action, not a hook: `POST /v1/me/missions/{id}/requirements/{reqId}/check`
sets `checked_at = now` (if unset) on the step's progress row and runs `evaluateEnrollment` in the
same request. It answers `409 MISSION_STEP_LOCKED` when a sequential predecessor is incomplete and
`409 MISSION_CLOSED` outside the window. A check is final — it completes the step and is write-once
like any completion; the page confirms before sending. Nothing is written to `topic_progress`.

#### 3.7 Legacy missions and the quest evaluator

`QuestEvaluator`'s mission loop (`quest-evaluator.ts:79-106`) is narrowed to legacy missions
(`predicate_kind <> 'requirements'`, new `listActiveLegacyMissions`). The API no longer accepts
`predicateKind`, so no legacy mission can be created; once none is active the loop is deleted
(backlog item, Phase 7). Daily and weekly quests are untouched.

### 4. Scheduled reconciliation

`apps/api/src/jobs/reconcile-missions.ts`, called from the existing `scheduled()` handler after the
submission sweep, in its own `try/finally` link so a billing or sweep failure never skips it and its
own failure affects neither:

1. **Scope**: missions with `active = 1`, `predicate_kind = 'requirements'`,
   `datetime(start_at) <= now` and `datetime(end_at) >= now - 48 hours` — a mission whose hook
   failed in its last hours is still closed by the next daily run.
2. **Materialise implicit enrollments**, one `INSERT OR IGNORE … SELECT` per mission: every active
   user for `auto`; `mission_audience_user` ∪ members of `mission_audience_group` for `assigned`
   (`source = 'admin'`). `counts_from = start_at`.
3. **Backfill captured evidence** (`source = 'backfill'`) from what the sources still hold:
   `xp_events` (`source_kind = 'video'`, joined to `media` on the target topic) at `earned_at`, and
   `topic_progress` at `created_at`, and at `updated_at` when `status = 'in_progress'` (a completed
   row's `updated_at` is not a visit). Only instants inside the mission window are inserted;
   `ON CONFLICT DO NOTHING` keeps hook rows.
4. **Recompute** each requirement in position order with the set-based statement of §3.4 for all
   enrollments, then apply completions and partial counts in `db.batch` chunks of 100.
5. **Monotonic**: the job may close a step or a mission (`completed_by = 'reconcile'`) and grant its
   rewards; it never clears a `completed_at` or a `completed` flag. Partial counts may go down.
6. Logs counts only (`missions`, `enrollments`, `steps_closed`, `missions_closed`), never user data.

Set-based counting keeps the run within D1's per-invocation query cap: the cost is
O(missions × requirements) statements plus batched writes, not O(users).
`POST /v1/admin/missions/{id}/reconcile` runs the same routine for one mission on demand — one
routine, two callers, as billing does.

### 5. Enrollment

| `enrollment_mode` | Who sees the mission | How the enrollment row appears | `counts_from` |
|---|---|---|---|
| `auto` | Every authenticated user | First hook evaluation for that user, or the daily run after `start_at` (§4) | `start_at` |
| `open` | Every authenticated user | The student clicks **Join** (`source = 'self'`) | `joined_at` |
| `assigned` | Users in `mission_audience_user` or in a group of `mission_audience_group` | `PUT …/audience` for direct users; first hook or daily run for group members (`source = 'admin'`) | `start_at` |

- **Leave** (`POST /v1/me/missions/{id}/leave`) exists only for `self` enrollments: it sets
  `left_at`; hooks and the cron skip the row; completed steps and rewards stay. Joining again clears
  `left_at` and keeps the original `counts_from`, so leaving cannot reset a window.
- **Audience replacement** (`PUT /v1/admin/missions/{id}/audience`, replace-all like events): users
  no longer covered get `left_at = now`; their progress and rewards stay.
- The dashboard read never writes: an `auto` mission without a row is shown as
  `enrollment: { source: 'auto', implicit: true }` with its steps computed read-only.
- Whether `auto` should also require access to the requirement targets, and whether staff take part,
  are Open Questions 3 and 4.

### 6. HTTP surface

All routes are `@hono/zod-openapi` `createRoute` definitions returning `ControllerResult` through
`respondWith`, under `/v1`, like the rest of the API.

**Admin** — `buildAdminMissionsRouter` gains `router.use('*', requireRole(ROLES.ADMIN))`:

| Method & path | Purpose | Success / errors |
|---|---|---|
| `GET /v1/admin/missions` | List, with `requirementCount`, `enrolledCount`, `completedCount` | `200` |
| `GET /v1/admin/missions/{id}` | Mission + ordered requirements + audience | `200` · `404` |
| `POST /v1/admin/missions` | `MissionCreate` (below), mission and requirements in one `db.batch` | `201` · `400` |
| `PATCH /v1/admin/missions/{id}` | Mission fields; after `start_at` only `title`, `description`, `active` and extending `end_at` | `200` · `400` · `404` · `409 MISSION_STARTED` |
| `PUT /v1/admin/missions/{id}/requirements` | Replace the ordered list (1…20); positions are the array order | `200` · `400` · `409 MISSION_STARTED` |
| `PATCH /v1/admin/missions/{id}/requirements/{reqId}` | `title` only — the one field editable after start | `200` · `404` |
| `PUT /v1/admin/missions/{id}/audience` | `{ groupIds, userIds }`, replace-all; only for `assigned` | `200` · `400` · `409 MISSION_NOT_ASSIGNED` |
| `GET /v1/admin/missions/{id}/participants?cursor=` | Enrollments with per-step progress and `completed_by` | `200 { data, nextCursor }` |
| `POST /v1/admin/missions/{id}/reconcile` | Run §4 for this mission | `200 ReconcileStats` |
| `DELETE /v1/admin/missions/{id}` | Soft delete (`active = 0`), as today | `200` · `404` |

```ts
const MissionCreate = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2_000),
  startAt: z.string().datetime(),            // mandatory
  endAt: z.string().datetime(),              // mandatory, > startAt
  mode: z.enum(['parallel', 'sequential']).default('parallel'),
  enrollmentMode: z.enum(['auto', 'open', 'assigned']).default('auto'),
  xpReward: z.number().int().min(0).default(0),
  badgeId: z.string().uuid().nullable().default(null),
  requirements: z.array(RequirementInput).min(1).max(MISSION_STEPS_MAX),
  audience: z.object({ groupIds: z.array(z.string().uuid()), userIds: z.array(z.string().uuid()) })
             .optional(),                    // only with enrollmentMode = 'assigned'
});
```

- **Target validation** (`400 INVALID_REQUIREMENT_TARGET`, with the index of the offending item):
  topics must exist, be `published` and not archived; events must exist, be `published` and have an
  `event_prices` row (`EVENT_NOT_CHARGEABLE`); `video_watched` targets must hold at least one
  `ready` video; `shared_only` needs sharing enabled.
- **Locked after start.** Once `now >= start_at`, requirements, mode, enrollment mode, window start
  and reward values are frozen (`409 MISSION_STARTED`): changing a running mission's rules would
  retroactively change what students already earned or were promised. The existing "cannot shorten
  `end_at` below now" rule (`admin-missions.controller.ts:75-87`) stays.
- `predicateKind` / `predicateParams` leave the request schemas; responses keep them for legacy
  rows, marked deprecated in OpenAPI.

**Student** — `routes/me/gamification.ts` keeps `GET /missions`; new `routes/me/missions.ts`:

| Method & path | Purpose | Success / errors |
|---|---|---|
| `GET /v1/me/missions` | Active missions the caller is enrolled in or may join, each with steps | `200 { data: DashboardMissionEntry[] \| null }` |
| `GET /v1/me/missions/{id}` | One mission with steps (the mission page) | `200` · `404` |
| `POST /v1/me/missions/{id}/join` | Join an `open` mission inside its window | `201` · `200` (already joined) · `404` · `409 MISSION_NOT_JOINABLE` · `409 MISSION_CLOSED` |
| `POST /v1/me/missions/{id}/leave` | Leave a `self` enrollment | `204` · `404` · `409 MISSION_NOT_LEAVABLE` |
| `POST /v1/me/missions/{id}/requirements/{reqId}/check` | Tick a `manual_check` step (§3.6) | `200 { step, mission }` · `404` · `409 MISSION_STEP_LOCKED` · `409 MISSION_CLOSED` |

```ts
// packages/shared/types/dashboard.ts — additive; `mission` and `progress` keep their shape
export interface DashboardMissionEntry {
  mission: Mission;                       // + mode, enrollmentMode
  progress: MissionProgress | null;       // aggregate: completed steps / step count
  enrollment: { source: 'auto' | 'self' | 'admin'; joinedAt: string | null; implicit: boolean } | null;
  joinable: boolean;                      // open, inside the window, not enrolled
  steps: MissionStepView[];               // [] for a legacy mission
}
export interface MissionStepView {
  id: string; position: number; kind: RequirementKind; title: string; xpReward: number;
  target:
    | { type: 'topic'; topicId: string | null; title: string | null; accessible: boolean }
    | { type: 'event'; slug: string | null; title: string | null; startsAt: string | null }
    | null;                               // manual_check
  instructions: string | null;            // manual_check only
  current: number; required: number;
  state: 'locked' | 'open' | 'completed';
  completedAt: string | null;
}
```

`GET /v1/me/dashboard` embeds the same entries. Completed missions stay listed until `end_at`.

### 7. Frontend

**Admin editor** — `(protected)/admin/missions` keeps the list; create and edit move to
`(protected)/admin/missions/[id]` (`new` for creation):

- **Mission card**: title, description, window (both required, local time converted to ISO),
  **Mode** (*Parallel — all steps at once* / *Sequential — one after another*), **Enrollment**
  (*Automatic* / *Students join* / *Assigned*), mission XP and badge. With *Assigned*, a users-and-
  groups picker in the shape of the events audience editor.
- **Requirements editor** (`components/missions/RequirementEditor.tsx`): a list of step cards and
  **Add step** with a kind picker. Per kind:
  - *Demonstrations on a topic*: topic, minimum count, "description required", "count: any /
    shared only", "count moderated demonstrations", XP.
  - *Visit a topic*: topic, XP — with the hint that a visit is recorded when the student opens a
    media item of the topic (Current State §6), and a warning when the topic has no media.
  - *Watch videos*: topic, minimum count (capped by the topic's video count), XP.
  - *Self-check*: instructions, XP.
  - *Event participation*: event picker over published, priced events, XP.
  The topic field reuses `TaskTopicPicker` (`allowDrafts = false`) through a thin single-select
  wrapper (`selected = [id]`, `onChange` keeps the last pick). In sequential mode the cards show
  their number and reorder by drag with keyboard-accessible up/down buttons; in parallel mode
  numbers are hidden. Validation errors from the API are mapped back to the card at their index.
- **After start** the form is read-only except title, description, extending the end and the
  active switch, with a banner explaining why.
- **Participants** tab on the same page: per student, a row of step chips (locked / open with
  `current/required` / completed with date and *hook* or *reconcile*), and **Reconcile now**.
- The admin hub's Missions card (`admin/page.tsx:143`) is shown to `admin` only.

**Student dashboard** — `MissionsList` becomes two groups:

- **My missions**: each enrolled mission with its window ("ends Oct 31"), the aggregate bar and a
  compact **step list** — check, lock or progress counter per step, the step title, the target as a
  link (`/catalog/{topicId}`, `/catalog/{topicId}/submissions` for demonstrations,
  `/events/{slug}`), and the step's XP. Sequential missions show steps numbered with later ones
  locked.
- **Available**: `open` missions the student has not joined, with **Join**. A confirmation states
  that only activity from now on counts.
- Clicking a mission opens **`(protected)/missions/[id]`**: full description, every step with its
  instructions, and the **I did it** button of `manual_check` steps (with a confirmation that it
  cannot be undone). Leave is in the page's menu for `self` enrollments.
- A target the student cannot open is shown without a link and without its title (§8).
- i18n: a `missions:` section and a reworked `admin.missions` section in both dictionaries with
  identical keys; `check-i18n-coverage.js` stays green.

**Phase 0 — make `video_watched` producible.** The live catalog viewer
(`components/catalog/MediaList/*`, `VideoStage`) calls the existing
`client.topics.markVideoWatched(topicId, mediaId)` at 90 % played or on `ended`, the rule
`VideoPlayerWithPlaylist` already implements. No API change, no topic change; side effects are
Open Question 5.

### 8. Security

- **Admin-only authoring**: `requireRole(ROLES.ADMIN)` on the missions router, same pattern as
  `/users`, `/billing`, `/storage` and `/levels`. **Role-boundary change**: content creators lose
  create, edit and delete on missions, which they hold today through the `/admin/*` umbrella. A
  router spec asserts `403` for a content creator on every admin missions route.
- **Topic targets reuse the catalog gate.** Evidence can only be produced through gated endpoints
  (visit, watched, submissions all check published + not archived + effective access set), so the
  evaluator adds no new way to touch a topic. The student read resolves each topic target through
  `getEffectiveAccessTopicIds`: an inaccessible target is returned as
  `{ topicId: null, title: null, accessible: false }`, so a mission never discloses the title of a
  topic outside the student's access set.
- **Event targets** disclose title and slug only if the event is visible to the caller under the
  events audience rules (`D1EventRepository`); otherwise `null`s.
- **404 on misses**, like notes and submissions: an `assigned` mission the caller is not assigned
  to, a requirement id that is not a `manual_check` step of that mission, or a mission outside the
  caller's visibility all answer `404` — no route is an enumeration oracle.
- **Write-once rewards** bound abuse: uploading and deleting the same demonstration cannot earn a
  step twice (the key is per requirement), and a step needs evidence inside its own interval.
- Hooks log `missionId` / `requirementId` / `userId` only, never descriptions or file names.

## Alternatives Considered

1. **Keep a single predicate per mission with a richer JSON** (e.g. `{ "target": 3, "topicId": …,
   "requireDescription": true }`). Rejected: it keeps the bug class of Motivation — unvalidated
   strings, unvalidated JSON, no foreign key on the target — and still cannot express two steps,
   an order, or a reward per step.
2. **Fuse Task + TaskStage into Mission.** Deferred, not rejected. Sequential mode covers the same
   ground as staged tasks, with evidence instead of a self-declared check-in, and would let one
   concept replace two. It needs a migration of `task_progress` / `task_stage_progress`, a decision on
   tasks without a window, and a review of the M4/M5 admin and student surfaces — a separate RFC once
   missions with requirements have been used in practice. In v1 Task/TaskStage stay as they are and
   `task_progress` is not migrated.
3. **Scheduled-only evaluation.** Rejected: a student who uploads the third demonstration would wait
   up to a day to see the step close — the feedback a mission exists to give arrives too late.
4. **Hook-only evaluation.** Rejected: hooks are best-effort by design (a failure must not fail the
   upload), so without a safeguard a lost hook is lost progress forever, as it is today; and an
   event's start, which completes a prepaid `event_participation`, is not a write any hook sees.
5. **`topic_completed` as a kind, with a new "Mark as complete" button on the topic page.**
   Deferred. `POST /v1/me/topics/{id}/complete` has no UI, and adding the button changes the topic
   concept (what "completed" means, who decides it, its XP), which this RFC does not do. A step the
   student declares lives inside the mission instead (`manual_check`). The kind can be added once a
   topic-level RFC gives completion a UI.
6. **Revocable XP** (deleting the counted demonstration takes the step XP back). Rejected: it makes
   the ledger depend on later deletions, invites "why did my XP drop" support load, and contradicts
   the append-only `xp_events` design (M7, RFC 0010). Progress may regress until completion; after it,
   nothing regresses.
7. **`event_audience_user` as participation evidence.** Rejected: it is a visibility grant written
   before anyone commits, and its own migration says it must not be read as more (§2).
8. **Read video evidence from `xp_events` only.** Rejected as the primary source: the idempotency key
   records the first watch ever, so a re-watch inside the window would not count, and no row is
   written when `GAMIFICATION_ENABLED=false`. Kept as the cron's backfill source (§4).
9. **One table per requirement kind**, or typed columns for every param. Rejected: kinds will grow;
   the target — the only param that needs integrity and an index — is a typed column, the rest is
   JSON parsed by the per-kind schema at every boundary.
10. **Per-user reconciliation** (call the hook routine for every enrollment). Rejected: the query
    count grows with users × steps and would hit D1's per-invocation cap on one cron run; the
    set-based statement grows with steps only.
11. **Let admins edit requirements of a running mission.** Rejected: it silently changes what was
    already earned or promised; a running mission is fixed, and a new mission is cheap.

## Implementation Plan

Total: **~12 dev days**, one milestone (**M27**), backend and frontend tasks separable.

### Phase 0 — Make the evidence producible (~0.5 d, frontend)
Wire `markVideoWatched` into the live catalog video viewer (`MediaList` / `VideoStage`) at 90 % or
`ended`; component test. Independent of the rest; can ship first.

### Phase 1 — Shared foundations (~1.5 d, backend)
`domain/missions/requirements.ts` (kinds, Zod params, limits, `targetCountOf`); entity and dashboard
types; `IMissionRepository` extension, `IMissionParticipationRepository`,
`IMissionEvidenceRepository`; `XpAction` `mission_step_reward`; `MissionEvaluator` with unit tests
over in-memory ports: windowing, sequential unlock from the evidence instant, write-once completion,
regression before completion, reward keys.

### Phase 2 — Schema and adapters (~2 d, backend)
Migration `0031`; D1 adapters; the per-kind counting statements with Workers-pool tests (window
edges in both timestamp formats, `requireDescription`, `shared_only` with sharing off,
`countModerated`, moved submission keeps its date, voided and reversed charges, future event).

### Phase 3 — Admin API (~1.5 d, backend)
Admin-only guard; create / patch / replace requirements / audience / participants / reconcile with
target validation and the start lock; OpenAPI schemas; regenerated `api-types.gen.ts`; specs
including `403` for a content creator on every route.

### Phase 4 — Hooks, student API, reconciliation (~2 d, backend)
`runMissionHook` at every site of §3.2; `GET /v1/me/missions` (and the dashboard) with steps;
`GET /v1/me/missions/{id}`; join / leave / check; `reconcile-missions` in `scheduled()`; legacy
narrowing of `QuestEvaluator`.

### Phase 5 — Admin web (~2 d, frontend)
Mission editor page with the requirements editor, pickers, sequential ordering, audience picker,
read-only state after start, participants tab; hub card admin-only; dictionaries.

### Phase 6 — Student web (~2 d, frontend)
`MissionsList` with *My missions* / *Available* and step lists, *Join*; mission page with manual
check and leave; dictionaries; component tests.

### Phase 7 — Demo seed, docs, follow-ups (~0.5 d)
Demo dataset's mission rewritten as typed requirements and `ci-check.mjs` counts updated (RFC 0021);
FEATURES §5 entry; backlog items for (a) the quest seed/evaluator mismatch (`login` vs
`daily_login`, `count` vs `target`) and (b) deleting the legacy mission loop and the
`predicate_*` columns once no legacy mission is active.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| Content creators who author missions today lose that ability | Flagged as a role-boundary change; read-only access is Open Question 1; matches the 2026-06-23 economy decision that reward values are admin-only |
| A hook adds latency to uploads, visits and payments | One indexed query when no mission targets the topic/event (the common case); evaluation touches only matching requirements of one user |
| A hook fails and the student sees no progress | Best-effort by design; the daily reconciliation recomputes from the evidence and closes the step with the same `completed_at` the hook would have written |
| Prepaid `event_participation` closes up to a day after the event starts | Documented (§2); the admin can run *Reconcile now* |
| `video_watched` / `topic_visited` depend on the web calling two endpoints | Phase 0 wires the video call; the visit semantics (media interaction, not page open) are surfaced in the editor and are Open Question 6 |
| Backfill from `topic_progress` misses visits whose instant was overwritten | Hooks are primary; backfill only adds instants the source still proves; a missed visit can be repeated by the student inside the window |
| Comparing ISO and SQLite timestamps as strings misorders same-day values | Every window predicate wraps both sides in `datetime()`; tests cover both formats at the edges |
| Two hooks complete the same step concurrently | Conditional `UPDATE … WHERE completed_at IS NULL` plus the per-requirement XP idempotency key |
| A student games a count by uploading and deleting | Counts use only `ready` rows inside the step interval; rewards are once per requirement |
| Legacy missions coexist with the new model | Narrowed M7 loop, no new legacy rows, removal tracked as a backlog item |
| The cron run grows with tenants' user counts | Set-based statements, O(missions × steps); batched writes; 48 h post-window scope |
| Admin needs to fix a mistake in a running mission | Locked by design; deactivate and create a corrected mission; already granted XP stays |

## Success Criteria

- (Ph 2/4) A mission with one `submissions_on_topic` step (`minCount: 3`, `requireDescription:
  true`) completes **within the request** that finalizes the third ready submission with a
  non-empty description; the response of that finalize is unchanged, and `xp_events` holds exactly
  one `mission_step_reward:<reqId>:v1` and one `mission_reward:<missionId>:v1` for the student.
- (Ph 2) Submissions created before `start_at`, or moved into the topic from an older upload, do not
  count; a submission without a description does not count while `requireDescription` is true.
- (Ph 2/4) In a sequential mission, a demonstration uploaded before step 1 (watch a video) completed
  does not count for step 2; one uploaded after it does.
- (Ph 4) With the hook forced to throw, the originating request still succeeds, and after
  `scheduled()` the step and mission are completed with `completed_by = 'reconcile'` and the same
  `completed_at` the hook would have written.
- (Ph 4) After the student deletes a counted demonstration of a **completed** mission, the
  `xp_events` ledger, `user_badges` and every `completed_at` are unchanged; on an **incomplete**
  step `current_count` goes down.
- (Ph 4) Running `scheduled()` twice in a row changes no row the second time.
- (Ph 3) A content creator gets `403` on `POST /v1/admin/missions` and every other admin missions
  route; an admin gets `201`. A request with an unknown `kind`, a `minCount` of 0, an extra param
  key, an archived topic or an unpriced event is a `400` naming the requirement index.
- (Ph 3) After `start_at`, `PUT …/requirements` answers `409 MISSION_STARTED`.
- (Ph 4) A student not assigned to an `assigned` mission gets `404` on `GET /v1/me/missions/{id}`,
  `join` and `check`, and never sees it in `GET /v1/me/missions`.
- (Ph 4) Joining an `open` mission mid-window counts only evidence produced after the join.
- (Ph 4) A paid charge for an event inside the window completes `event_participation` once the
  event has started; voiding the charge before completion takes the count back to 0.
- (Ph 0/4) Watching 90 % of a topic video in the catalog advances a `video_watched` step on that
  topic; reporting a video id from another topic does not.
- (Ph 6) On the dashboard a student sees *My missions* with per-step state and *Available* with
  *Join*; ticking a self-check on the mission page completes the step; the flow works in `pt` and
  `en` builds and the i18n coverage check passes.
- (Ph 7) The demo seed CI check passes with the demo mission expressed as requirements.

## Open Questions

1. **Read-only missions for content creators?** Today they write; this RFC makes authoring
   admin-only. Should `GET /v1/admin/missions*` stay open to `content_creator` (list, detail,
   participants) so instructors can follow their students? Owner: product owner.
2. **XP policy for private vs shared evidence.** The model allows any split (two requirements with
   different `xp_reward`); is there a house default the editor should suggest (e.g. shared evidence
   worth more, moderated evidence never counting)? Owner: product owner.
3. **Does `auto` enrollment follow the topic access gate of the targets?** Today every user would be
   enrolled, including students who cannot open the target topic and therefore can never finish.
   Option: enroll only users whose effective access set contains every topic target. Owner: product
   owner.
4. **Visibility outside the enrollment.** Should students see `assigned` missions they are not in
   (as locked teasers), and should staff accounts be enrolled in `auto` missions at all? Owner:
   product owner.
5. **Re-wiring `markVideoWatched` (Phase 0) re-enables its side effects**: 50 XP per first watch of a
   video (`xp-config.ts:13`), the weekly video quest and the `videos_watched_in_period` badge rule,
   none of which fire from the UI today. Accept as a bug fix, or gate them? Owner: product owner.
6. **`topic_visited` semantics.** A visit is recorded when the student expands or plays a media item,
   not on page open, and never on a topic without media. Calling `visit` on page mount would change
   topic progress for every student (a topic-concept change, out of scope here). Keep v1 as is, or
   file the change separately? Owner: product owner.

## Resolved Decisions

All decided **2026-10-02** by the **product owner**:

1. **One RFC, not an epic** — the change adds tables and ports, carries open product decisions and
   moves a role boundary, which fails the backlog criteria.
2. **A mission is made of N requirements** — typed rows in `mission_requirements` replace the single
   `predicate_kind` + free JSON; `missions` and `mission_progress` stay, the latter as the aggregate.
   Requirements are the mission's own steps. **Topics and submissions are not modified** — no column
   on `topic_nodes`, `topic_progress` or `topic_submissions`, no change to their rules; the mission
   runs on its own data (§1).
3. **v1 kinds** — `submissions_on_topic` (target topic, `minCount`, `requireDescription`,
   `visibility: any | shared_only`, `countModerated`; only `ready` rows), `topic_visited`,
   `video_watched` (`minCount`), `manual_check` (ticked on the mission page, stored in the mission's
   progress, never in `topic_progress`), `event_participation` (a non-void, settled charge — chosen
   over `event_audience_user`; attendance is a Non-Goal; only logged-in users). `topic_completed` is
   not a v1 kind (§2, Alternatives §5).
4. **Evidence is windowed by the mission** — only evidence between `start_at` and `end_at` counts;
   both stay mandatory (§3.3).
5. **Mode per mission: `sequential` or `parallel`** — sequential counts step N's evidence only from
   step N−1's completion; parallel opens every step at `start_at` or at enrollment, whichever is
   later (§3.3).
6. **Evaluation = hooks + scheduled reconciliation** — an in-process `MissionEvaluator` inline after
   each originating write, best-effort; the daily `scheduled()` run recomputes idempotently and may
   close, never reopen (§3, §4).
7. **Rewards are write-once** — per-requirement `xp_reward` plus mission `xp_reward` and badge,
   through `xp_events` with idempotency keys; deleting evidence or leaving never revokes; partial
   progress may regress, completion never does (§3.5).
8. **Enrollment** — `mission_enrollments` (user, mission, `joined_at`, source `auto | self | admin`);
   mission-level `enrollment_mode` `auto` / `open` / `assigned` (users and groups, as event
   audiences); hooks evaluate only active missions the user is enrolled in; the dashboard shows
   participation with per-step progress and *Join* (§5, §7).
9. **Admin-only setup** — `requireRole(ADMIN)` on the missions router; content creators lose write
   access (role-boundary change); read-only for them is Open Question 1 (§8).
10. **Admin UI** — a structured requirements editor replaces `predicateKind` / `predicateParams`:
    kind picker, topic picker reusing `task-topic-picker.tsx`, params per kind, ordering in
    sequential mode (§7).
11. **Task/TaskStage unchanged in v1** — fusing them into missions is deferred, not rejected;
    `task_progress` is not migrated (Non-Goals, Alternatives §2).
12. **Daily/weekly quests stay as shipped in M7** — a weekly challenge is a `quest_definitions` row
    with `kind = 'weekly'`; recurring missions are a future RFC (Non-Goals).
13. **Relationship to RFC 0008 and RFC 0020** — RFC 0008 (Draft, revised 2026-09-30 on
    `docs/rfc-0008-reconciliation`) is **not** superseded: this RFC owns mission participation and
    progress on the dashboard, RFC 0008 keeps recommendations and manual badge approval. RFC 0020's
    staff review of submissions stays deferred there; this RFC only reads submission rows as
    evidence.
14. **Known defect cited as motivation** — `0019_seed_quests.sql` writes `login` and `{"count":N}`
    while `quest-evaluator.ts` knows `daily_login` and reads `.target`: the daily-login quest never
    progresses and every target collapses to 1. Typed requirements fix the class for missions; the
    quest fix is a backlog item (Phase 7).

## References

- Relevant code: `apps/api/migrations/0024_create_missions.sql`, `0018_create_quests.sql`,
  `0019_seed_quests.sql:1-14`, `0010_create_progress_tables.sql`, `0014_create_xp_events.sql`,
  `0027_create_events.sql:79-99`, `0028_create_event_charges.sql:24-53`,
  `0030_create_topic_submissions.sql`;
  `packages/shared/domain/gamification/quest-evaluator.ts:6-13, 53, 79-106`,
  `xp-engine.ts:20-26`, `xp-config.ts:1-19`, `badge-engine.ts:58-59`;
  `packages/shared/types/entities.ts` (`Gamification.Mission`, ~line 583),
  `packages/shared/types/dashboard.ts:19-22`, `packages/shared/ports/i-mission-repository.ts`;
  `apps/api/src/controllers/admin-missions.controller.ts:6-16, 75-87`,
  `apps/api/src/controllers/me-missions.controller.ts:8-23`,
  `apps/api/src/routes/admin/missions.ts:6-199`, `apps/api/src/routes/admin/index.ts:27, 46`,
  `apps/api/src/routes/admin/quests.ts:189-199`, `apps/api/src/routes/admin/storage.ts:153`,
  `apps/api/src/adapters/db/d1-mission-repository.ts:160-200`,
  `apps/api/src/routes/topics.router.ts:19-69`, `apps/api/src/routes/me/progress.ts:240-281`,
  `apps/api/src/routes/auth/login.ts:174-180`, `apps/api/src/core/progress/progress-service.ts:156-207`,
  `apps/api/src/routes/submissions.router.ts:252-264`, `apps/api/src/routes/me/submissions.ts:108`,
  `apps/api/src/routes/admin/submissions.ts:140-150`, `apps/api/src/routes/admin/billing.ts:1088-1118`,
  `apps/api/src/adapters/db/d1-event-charge-repository.ts:196-204`, `apps/api/src/index.ts:57-71`,
  `apps/api/src/container.ts:285-294`, `apps/api/test/routes/admin-missions.router.spec.ts`,
  `apps/api/test/core/progress-service.spec.ts:289-353`;
  `apps/web/src/app/(protected)/admin/missions/page.tsx`,
  `apps/web/src/components/dashboard/MissionsList.tsx`,
  `apps/web/src/components/tasks/task-topic-picker.tsx`, `apps/web/src/lib/topics-api.ts:43-71`,
  `apps/web/src/app/(protected)/catalog/[id]/page.tsx:166-169`,
  `apps/web/src/components/catalog/MediaList/MediaList.tsx:54-65`,
  `apps/web/src/components/catalog/VideoPlayerWithPlaylist.tsx:39-44`,
  `scripts/demo/dataset/base.json:468-481`
- Related RFCs: RFC 0008 (dashboard recommendations and manual badge approval — keeps those),
  RFC 0009 (gamification catalog administration — the admin-only economy decision),
  RFC 0010 (player progression — ledger adjustments are the only way to take XP back),
  RFC 0014 / 0015 (events, audiences and charges — the participation signal),
  RFC 0016 (notes — `404` on misses, conditional writes), RFC 0020 (submissions — the evidence
  rows; staff review stays deferred there), RFC 0021 (demo seed and its CI check)
- Milestones: [M4 Task engine](../milestones/4-task-engine-and-interconnection/milestone.md) and
  [M5 Engagement & progress](../milestones/5-engagement-and-student-progress/milestone.md) (Task +
  TaskStage, unchanged), [M7 Gamification](../milestones/7-gamification-engine-and-learner-ux/milestone.md)
  §2.3 (quests and missions as shipped),
  [M15](../milestones/15-gamification-catalog-administration/milestone.md),
  [M16](../milestones/16-player-progression-administration/milestone.md)
