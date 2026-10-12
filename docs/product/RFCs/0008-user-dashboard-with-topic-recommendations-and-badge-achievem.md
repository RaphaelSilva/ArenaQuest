# RFC 0008: Configurable Widget Dashboard

**Date:** 2026-06-20
**Status:** Proposed
**Revised:** 2026-10-12
**Author:** raphaelsilva
**Affected:**
- `packages/shared/types/dashboard.ts` — the dashboard contract becomes a layout of widget instances plus per-widget data.
- `packages/shared/domain/dashboard/` (new) — widget registry, layout Zod schema, limits and the code default layout.
- `apps/api/src/controllers/me-dashboard.controller.ts` and `apps/api/src/routes/me/gamification.ts` — `GET /v1/me/dashboard` resolves the effective layout and returns data for enabled widgets only.
- `apps/api/src/routes/me/` (new dashboard-layout routes) and `apps/api/src/routes/admin/` (group default layouts).
- `apps/api/src/adapters/db/` and `apps/api/migrations/` — layout storage, group defaults, `topic_progress.last_visited_at`.
- `apps/api/src/core/progress/progress-service.ts` — a visit stamps `last_visited_at`, including on a completed topic.
- `config/labels/<label>.jsonc` and `scripts/cloudflare/deploy.mjs` — the label default layout and its injection into the Worker.
- `apps/web/src/components/dashboard/`, `apps/web/src/lib/dashboard-api.ts`, `apps/web/src/app/(protected)/settings/` and the admin groups backoffice.

> **Revision note (2026-10-12).** This RFC was first written on 2026-06-20 as a learner dashboard
> with group recommendations and a manually approved badge system. Most of that was delivered by
> Milestones 5, 7, 15 and 16 in a different shape, and a 2026-09-30 reconciliation narrowed it to
> group-curated recommendations. On 2026-10-12 the product owner reframed the remaining work: the
> dashboard becomes a **host of configurable widgets**, with defaults set per label and per group
> and a personal layout per student. Recommendations survive as one widget among others. The
> original disposition table is kept in [Current State](#current-state-for-reference) as history.

---

## Summary

Turn the learner dashboard into a **configurable layout of widgets**. Every block shown today —
level, streak, ranking, daily quests, missions, weekly challenges, badges and roadmap — becomes a
widget, and three new widgets join them: a **roadmap rooted at any topic**, **continue where you
left off** and **instructor recommendations**.

A layout is an ordered list of widget instances, each `{ type, version, config }`, validated by one
shared Zod schema. The effective layout of a student resolves in four tiers: the code default, the
**label default** (declared in the label profile and shipped with the deploy), the **group default**
(edited by an admin in the backoffice, the highest-priority group winning) and, once the student
customises it in **Settings**, the student's own copy. An admin can lock a widget so it cannot be
removed. `GET /v1/me/dashboard` resolves that layout and returns data for the enabled widgets only,
each degrading to empty on its own.

Delivery is one milestone in three phases: the widget foundation with the eight current widgets,
then admin defaults and locks, then the three new widgets.

## Motivation

- **The roadmap only shows root topics.** A student in a deep tree — a martial-arts curriculum
  organised kyu by kyu, for example — sees the same handful of top-level nodes forever. The owner
  wants a roadmap that starts from a chosen topic.
- **The instructor cannot shape the dashboard.** Every student of every group and every label sees
  the same fixed blocks. A tenant without a competitive culture cannot hide the ranking; an
  instructor cannot point a group at the material that matters this month.
- **The student cannot shape it either.** There is no preference storage at all beyond
  `users.timezone`; `/settings` only changes the password and links to billing.
- **The "current / last watched topic" from the original RFC never shipped.** The data to support a
  topic-level "continue" exists almost entirely (the visit route, `topic_progress`), but no surface
  uses it.
- **New capabilities keep arriving as fixed blocks.** Missions grew steps, teasers and a page of
  their own in M27; RFC 0023 will add read/watched marks. A widget registry gives every future
  learner capability one place to plug in instead of another hard-coded section.

## Goals & Non-Goals

### Goals

- A **widget registry** in `packages/shared`: each widget type has an id, a config schema, a version,
  a migration from older versions and a data contract.
- The **eight current dashboard blocks** migrated to widgets with no visual regression.
- A **layout** per student — enable, disable, reorder and configure widget instances, including
  several instances of the same type — edited from `/settings`.
- **Defaults** per label (profile) and per group (backoffice), with explicit group priority, a
  "new default available" notice and a restore action for a student who customised.
- **Locked widgets**: an admin can mark an instance of a default as not removable.
- A **configurable roadmap**: start topic, its direct children as stages, progress computed on the
  server from completed leaves.
- A **continue** widget: the last topic the student visited.
- A **recommendations** widget: an instructor-curated list of topics with a reason, read live from
  the group default.
- One aggregated `GET /v1/me/dashboard` that returns only enabled widgets and never fails as a whole
  because one widget failed.

### Non-Goals

- A free grid (drag, resize, absolute positions) or a separate mobile layout.
- Algorithmic or behavioural recommendations; recommendations that grant access, enroll a student or
  create progress.
- A media resume position (where the video stopped). "Continue" is topic-level.
- Restoring manual badge approval (`pending` / `approved` / `rejected`), rebuilding the badge engine,
  the badge catalog or per-player progression administration.
- Per-language recommendation text.
- Fixing the ranking widget's display names (it shows a slice of `userId`) and the hard-coded
  `'en-US'` date in the greeting — both are backlog items, independent of this RFC.
- Notifications, analytics on widget usage, and widgets on any page other than `/dashboard`.

## Current State (for reference)

### The dashboard today (verified on `main`, 2026-10-12)

- **API.** `GET /v1/me/dashboard` (`routes/me/gamification.ts`, `Cache-Control: private, max-age=15`)
  returns `DashboardShape`: `xp`, `streak`, `questsDaily`, `questsWeekly`, `missions`, `badges`.
  `MeDashboardController` runs the sub-reads in parallel and degrades each failed one to `null`.
  Only `missions` has a typed OpenAPI schema; the other fields are `z.any()`, so the generated web
  types are `unknown` and `dashboard-api.ts` redeclares them by hand.
- **Missions (M27).** Dashboard entries carry steps, enrollment, `joinable` and a `locked` teaser for
  `assigned` missions. A topic target the caller cannot open is redacted (`accessible: false`, no id,
  no title). Since 2026-10-11 a dedicated `/missions` page also exists.
- **Web.** `client.dashboard.get()` issues four calls — `/me/dashboard`, the global leaderboard,
  `/topics` and `/me/progress/topics` — and `DashboardContent.tsx` renders a fixed arrangement: three
  stat cards (level, streak, ranking), a two-column grid (daily + missions | weekly + badges) and the
  roadmap. A section with no data is not rendered.
- **Roadmap.** Built in the browser by `adaptRoadmap`: the root topics of `/topics`, a fixed `📚`
  emoji and a percentage of 0, 50 or 100 derived from the root's own status. Children are never
  aggregated.
- **Badges.** `locked` is always `[]`; the grid is hidden while the student has no badge.
- **Progress and visits.** `POST /v1/me/topics/{id}/visit` upserts `topic_progress` to `in_progress`
  and bumps `updated_at`, but **returns early on a completed topic** (`progress-service.ts`, monotonic
  status), so a revisit of a completed topic leaves no trace. A visit is recorded only when a media
  item is opened; backlog `user-experience/10` records it on page mount.
- **Preferences.** No preference storage beyond `users.timezone`. `/settings` holds the password form
  and the billing sub-page.
- **Groups.** `user_groups` / `user_group_members` (migration 0011); a user can belong to many groups.
  Effective topic access is `IEnrollmentRepository.getEffectiveAccessTopicIds(userId)`.
- **Label profiles.** `config/labels/<label>.jsonc` hold brand vars and per-environment resources. The
  deploy CLI bakes brand vars into the web build; Worker vars come from `wrangler.jsonc` `env.*`
  blocks (e.g. `SUBMISSIONS_*`). No profile value reaches the Worker today.

### Original proposal disposition (2026-09-30 reconciliation, kept as history)

| Original capability | Disposition |
|---|---|
| Create a learner dashboard | Delivered by Milestones 5 and 7 |
| Show current / last-watched topic | Not delivered; becomes the **continue** widget (topic-level, no media position) |
| Show group-curated recommendations | Not delivered; becomes the **recommendations** widget |
| Define badge catalog | Delivered by RFC 0009 / Milestone 15 |
| Detect badge eligibility | Delivered by the Milestone 7 rule engine |
| Require manual approval for every badge | Conflicts with automatic awards; not restored |
| Display earned badges | Delivered; becomes the **badges** widget |
| Manually award or revoke a badge | Delivered by RFC 0010 / Milestone 16 |

## Proposed Design

### 1. Widget registry (`packages/shared/domain/dashboard/`)

One table, read by the API, the web and the deploy preflight:

```typescript
type WidgetType =
  | 'level' | 'streak' | 'ranking' | 'daily_quests' | 'missions'
  | 'weekly_challenges' | 'badges' | 'roadmap' | 'continue' | 'recommendations';

interface WidgetDefinition<C> {
  type: WidgetType;
  version: number;                          // current config version
  configSchema: z.ZodType<C>;               // strict: unknown keys are a 400
  migrate(fromVersion: number, raw: unknown): unknown; // vN → current, pure
  multiple: boolean;                        // may appear more than once in a layout
  scopes: ReadonlyArray<'label' | 'group' | 'student'>; // where it may be configured
}
```

| Type | Config | Multiple | Notes |
|---|---|---|---|
| `level`, `streak`, `ranking`, `daily_quests`, `weekly_challenges`, `badges`, `missions` | `{}` | no | Today's blocks, same data, same look |
| `roadmap` | `{ startTopicId: string \| null }` (`null` = roots) | yes | §5 |
| `continue` | `{}` | no | §6 |
| `recommendations` | `{ title?: string, items: { topicId: string, reason: string }[] }` | yes | §7; configurable at `group` scope only |

Limits live in `packages/shared/domain/dashboard/limits.ts`, the single source of truth like
`domain/media/limits.ts`: **12 instances per layout**, **10 items per recommendations widget**,
**280 characters per reason** (trimmed, non-empty).

### 2. Layout document

```typescript
interface WidgetInstance {
  id: string;          // stable within the layout (uuid); keys the per-widget data in the response
  type: WidgetType;
  version: number;
  config: unknown;     // validated against the type's schema after migration
  locked?: boolean;    // defaults only; a student copy carries it but cannot change it
}

interface DashboardLayout {
  widgets: WidgetInstance[]; // order = render order; mobile stacks the same order
}
```

**Reading tolerates, writing is strict.** On read, each instance is migrated to its current version
and validated; an unknown type or an invalid config drops **that instance only** and logs its id and
type — the rest of the layout renders. On write (`PUT`), the whole document must validate, or the
request is `400` with the failing path.

### 3. Layout resolution

```
code default ─▶ label default ─▶ group default ─▶ student copy
(always valid)   (profile, env var) (DB, top-priority group) (DB, after "customise")
```

1. **Code default** — the current arrangement, in `domain/dashboard/default-layout.ts`. Always valid.
2. **Label default** — `dashboard.defaultLayout` in `config/labels/<label>.jsonc`. The deploy CLI
   validates it with the shared schema in its preflight (an invalid layout **blocks the deploy**) and
   passes it to the Worker as `DASHBOARD_DEFAULT_LAYOUT` (`wrangler deploy --var`). At runtime, if the
   var is absent the code default applies; if it is present but invalid, the code default applies and
   the error is logged — the student never loses the dashboard. Changing it is a PR and a deploy.
3. **Group default** — `dashboard_group_layouts (group_id PK → user_groups ON DELETE CASCADE,
   priority INTEGER NOT NULL, layout TEXT NOT NULL, updated_at, updated_by)`. For a student in several
   groups with a default, the one with the **highest `priority`** wins; ties break by `group_id`
   ascending. Defaults are never merged.
4. **Student copy** — `dashboard_user_layouts (user_id PK → users ON DELETE CASCADE, layout TEXT NOT
   NULL, based_on TEXT NOT NULL, based_on_updated_at TEXT NOT NULL, updated_at)`. Created the first
   time the student saves in Settings, as a **copy** of the default they were seeing (`based_on` =
   `code`, `label` or `group:<id>`). Later changes to that default do not alter the copy.

**New default notice.** When the default that *would* apply now differs from `based_on`, or its
`updated_at` is later than `based_on_updated_at`, the response carries `layoutSource.newDefault =
true`; Settings shows "your instructor updated the default dashboard" with **Restore default**
(deletes the student row).

**Locks.** An instance with `locked: true` in the applicable default must be present in the student
copy: a `PUT` that removes it is `409 WIDGET_LOCKED`; reordering it is allowed. If a default gains a
locked instance after the copy was made, it is appended to the copy on read until the student saves.

**Live recommendations.** A `recommendations` instance in a student copy stores only its `id`; its
`items` are always read from the group default that currently applies to the student. If no
applicable group default holds an instance with that id, the widget renders nothing. The student can
hide or move it (unless locked), never edit it.

### 4. API

| Method | Path | Role | Outcome |
|---|---|---|---|
| `GET` | `/v1/me/dashboard` | authenticated | Effective layout + data per enabled instance |
| `GET` | `/v1/me/dashboard/layout` | authenticated | Effective layout, its source, `newDefault`, and the widget types the student may add |
| `PUT` | `/v1/me/dashboard/layout` | authenticated | Save the student copy (strict validation, locks enforced) |
| `DELETE` | `/v1/me/dashboard/layout` | authenticated | Restore default |
| `GET` | `/v1/admin/groups/{groupId}/dashboard-layout` | `admin`, `content_creator` | Group default or `404` |
| `PUT` | `/v1/admin/groups/{groupId}/dashboard-layout` | `admin` | Create/replace the group default with its `priority` |
| `DELETE` | `/v1/admin/groups/{groupId}/dashboard-layout` | `admin` | Remove the group default |
| `GET` | `/v1/admin/dashboard/label-default` | `admin`, `content_creator` | Read-only view of the deployed label default |

The admin read/write split follows the M27 precedent: `content_creator` reads, `admin` writes.
Recommendation topic ids are validated on write against `topic_nodes` (existence, not archived);
access is filtered per student on read.

**Dashboard response:**

```typescript
interface DashboardResponse {
  layout: WidgetInstance[];   // effective, after migration and lock reconciliation
  layoutSource: { kind: 'code' | 'label' | 'group' | 'student'; groupId?: string; newDefault: boolean };
  widgets: Record<string /* instance id */, WidgetData | null>; // null = that widget failed
}
```

Each widget type declares its `WidgetData` shape in the registry with a real Zod schema — this
retires the `z.any()` fields and the hand-written web types. The controller computes data **only for
enabled instances**, in parallel, each in its own failure boundary. The ranking and roadmap data move
into this response, so the web makes **one** call instead of four. The layout routes send
`Cache-Control: private, no-store`; the dashboard keeps `private, max-age=15`, and a layout
`PUT`/`DELETE` returns the new effective layout so the client does not depend on that cache.

### 5. Roadmap widget

- **Stages** — the direct children of `startTopicId` (or the roots when `null`) that the student can
  access, in `sort_order`.
- **Progress per stage** — completed accessible leaves of the stage's subtree ÷ accessible leaves of
  that subtree, as an integer percentage; a stage that is itself a leaf is 0 or 100 from its own
  status. Status: `completed` at 100, `in_progress` above 0 or when any node of the subtree has
  progress, else `not_started`.
- **Computed on the server**, from one recursive query over `topic_nodes` restricted to the effective
  access set, joined to the student's `topic_progress`. Bounded by the subtree; the Phase 1 budget
  applies.
- **Unavailable start topic** — archived, unpublished, deleted or outside the student's access: the
  widget data is `{ unavailable: true }` with no title or id; the web shows "this content is not
  available" and a link to Settings. The config is kept, so the widget works again when access
  returns.
- **Several instances** — e.g. one roadmap rooted at "Kihon" and one at "Kata".

### 6. Continue widget

- A migration adds `topic_progress.last_visited_at TEXT NULL` and an index on
  `(user_id, last_visited_at)`. Every successful visit stamps it — **including a visit to a completed
  topic**, which today returns before touching the row; the status stays monotonic.
- The widget shows the accessible, published, non-archived topic with the latest `last_visited_at`:
  title, a link to `/catalog/{id}` and its status. No visit yet → an empty state pointing to the
  catalog.
- Depends on backlog `user-experience/10` (visit on page mount) so text-only topics count. RFC 0023,
  if accepted, may refine the signal without changing this widget's contract.

### 7. Recommendations widget

- Authored by an admin inside a **group default** (backoffice group page → Dashboard): an optional
  title and up to 10 `{ topicId, reason }` items, in order. The reason is a single tenant-authored
  string, rendered as plain text and not translated — like topic titles.
- On read, items whose topic is not in the student's effective access set (or is unpublished /
  archived) are **omitted** — no title, no placeholder. This differs from mission steps, which show a
  redacted step, because a mission step is part of a required sequence while a recommendation is an
  optional suggestion; an omitted item reveals nothing.
- Duplicates within one instance are rejected on write. Across groups no merge happens — only the
  winning default applies — so cross-group deduplication does not arise.
- No table of its own: the recommendation lives in the group layout document.

### 8. Web

- **Dashboard** — `DashboardContent` renders `layout` in order through a `widget type → component`
  map; on `lg` the widgets flow in two columns, on mobile in one, same order. Stat-type widgets
  (`level`, `streak`, `ranking`) keep their card look.
- **Settings → Dashboard** — list of instances with show/hide, move up/down, configure (roadmap: a
  topic picker reusing `SingleTopicPicker`), add from the addable types, a lock icon on locked
  instances, the "new default" notice and **Restore default**.
- **Admin → Groups → Dashboard** — the same editor at group scope, plus `priority`, lock toggles and
  the recommendations editor; a read-only preview of the label default.
- All strings in `dict-en.ts` / `dict-pt.ts`; no hard-coded user-facing text.

## Alternatives Considered

1. **Keep the fixed dashboard and add a recommendations section** (the 2026-09-30 candidate).
   Rejected by the owner: it answers one need, leaves the roadmap, ranking and personalisation
   problems in place, and every future block would be another fixed section.
2. **Recommendations in their own table with CRUD** (`topic_recommendations`). Rejected: once group
   defaults exist, a recommendation is a widget config; a second store would need its own ordering,
   lifecycle and multi-group rules that the layout model already provides.
3. **Use `assigned` missions as recommendations.** Rejected: missions carry a window, XP, completion
   and a teaser for non-members; a recommendation is a lightweight suggestion with none of these.
4. **Free grid layout.** Rejected for now: high cost, poor on mobile, and nothing asked for needs
   absolute placement.
5. **Store layouts in `localStorage`.** Rejected: lost across devices and invisible to the defaults.
6. **Normalised widget table** (one row per instance). Rejected: every new config field would need a
   migration; a versioned JSON document validated by the shared schema evolves in code.
7. **Merge the layouts of all a student's groups.** Rejected: noisy, duplicate-prone and hard to
   explain; explicit priority is deterministic.
8. **Label default in the database.** Rejected by the owner: the label default is product
   configuration, reviewed in a PR and shipped with the deploy, like the rest of the profile.
9. **Supersede RFC 0008 and open a new RFC.** Rejected by the owner: the reframed scope continues
   0008's dashboard and recommendation goals; the history is kept in this document.

## Implementation Plan

One milestone, three phases; each phase ends shippable.

### Phase 1 — Widget foundation and student layout

1. Shared: registry, layout schema, limits, code default layout, per-widget data schemas.
2. Measure the current `GET /v1/me/dashboard` p95 on the demo-seed fixture and record the baseline
   and the target (D22).
3. API: migration for `dashboard_user_layouts`; layout routes; dashboard aggregate rebuilt on the
   layout (code default only); ranking and roots-only roadmap moved server-side.
4. Web: widget host, the eight current blocks as widgets (no visual change), one dashboard call,
   Settings → Dashboard.

### Phase 2 — Defaults and locks

1. Label profile `dashboard.defaultLayout`; deploy preflight validation; `DASHBOARD_DEFAULT_LAYOUT`
   injection; runtime fallback.
2. Migration for `dashboard_group_layouts`; admin routes; priority resolution; locks; `newDefault`.
3. Web: Admin → Groups → Dashboard; lock icons and restore in Settings.

### Phase 3 — New widgets

1. Roadmap with `startTopicId`, server-side subtree progress and the unavailable state.
2. `last_visited_at` migration and the visit change; continue widget (after backlog
   `user-experience/10`).
3. Recommendations widget: group-scope editor and live, access-filtered read.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| A recommendation or roadmap leaks a restricted topic | Every topic reference is filtered through the effective access set on read; an unavailable start topic and omitted items carry no title or id; integration tests for each case |
| The aggregate gets slower as widgets grow | Data only for enabled instances; per-widget failure boundary; Phase 1 baseline and a measured target every phase must meet |
| The roadmap subtree query is expensive on large trees | One recursive CTE restricted to the access set; indexed; capped by the 12-instance limit |
| A label profile with a bad layout reaches production | Deploy preflight validates with the same shared schema; runtime falls back to the code default |
| `DASHBOARD_DEFAULT_LAYOUT` exceeds the Worker var size limit | 12 small instances stay far below it; the preflight checks the serialised size |
| Copy-on-customise hides instructor updates | `newDefault` notice and one-click restore; locked widgets reconciled on read |
| Old layouts break when a widget evolves | Per-instance `version` + pure `migrate`; tolerant read drops only the bad instance |
| Students confuse the dashboard and `/missions` | The missions widget stays a summary linking to `/missions`; no new duplicate actions |
| A group deletion orphans its default | `ON DELETE CASCADE`; students fall back to the next tier; their own copy is unaffected |

## Success Criteria

- With no label, group or student layout, `/dashboard` renders exactly today's blocks, in today's
  order, from **one** API call.
- A student hides the ranking and moves the roadmap first in Settings; after a reload and on another
  device the dashboard shows that layout.
- A `PUT` with 13 instances, an unknown type or an unknown config key is `400` and stores nothing.
- A label profile with an invalid `dashboard.defaultLayout` fails the deploy preflight; with a valid
  one, students of that label without a copy see it.
- A student in groups A (priority 10) and B (priority 20) with defaults sees B's; on a priority tie
  the lower `group_id` wins.
- After the admin edits B's default, a student with a copy sees `newDefault: true`; **Restore
  default** shows B's new layout.
- A locked instance cannot be removed by the student (`409 WIDGET_LOCKED`) but can be moved.
- A roadmap rooted at topic T shows T's accessible children with leaf-based percentages; when T is
  archived or access is revoked, the widget shows the unavailable state without T's title, and works
  again when access returns.
- Visiting a completed topic makes it the continue widget's topic; its status stays `completed`.
- A recommendations widget with topics X (accessible) and Y (not) shows only X, with its reason.
  Editing the group default changes it for every student on the next uncached read, including those
  with a copy.
- A failure in one widget's data leaves the others rendering.
- `content_creator` reads group defaults and gets `403` on writes.
- EN/PT dictionaries keep identical keys; `make lint`, `make build` and the API/web suites pass.
- The dashboard p95 meets the target recorded in Phase 1.

## Resolved Decisions

All taken by the product owner on **2026-10-12**.

| # | Decision |
|---|---|
| D1 | The admin defines defaults; the student adjusts their own layout in Settings |
| D2 | First delivery: enable/disable, order and per-widget config; no free grid |
| D3 | A layout is a list of instances; a type may appear more than once when the registry allows it |
| D4 | Layouts are stored server-side as a JSON document validated by a shared Zod schema |
| D5 | Defaults exist per label and per group; the group default overrides the label default |
| D6 | A student in several groups gets the default of the group with the highest explicit priority, with a deterministic tie-break |
| D7 | Customising creates a copy; later default changes do not alter it; the student is notified and can restore |
| D8 | The roadmap shows the start topic's direct children, with progress by completed leaves, computed on the server |
| D9 | Version 1 ships the eight current widgets, the configurable roadmap, continue and recommendations |
| D10 | An unavailable start topic shows an empty state without revealing the title, with a link to reconfigure; the config is kept |
| D11 | Admin writes defaults; `content_creator` reads them (M27 precedent) |
| D12 | RFC 0008 is rewritten in place as the configurable widget dashboard, keeping its history |
| D13 | Recommendations are a widget whose content is read live from the group default; no own table; the student can hide, not edit |
| D14 | An admin can lock a widget: reorderable, not removable |
| D15 | One aggregated `GET /v1/me/dashboard` returns only enabled widgets, each degrading independently |
| D16 | One milestone in three phases: foundation + current widgets, defaults + locks, new widgets |
| D17 | The label default lives in `config/labels/<label>.jsonc` and ships with the deploy |
| D18 | An invalid label default blocks the deploy; at runtime the code default applies and the error is logged |
| D19 | "Continue" is the last visited topic, through a new `topic_progress.last_visited_at` |
| D20 | The recommendation reason is a single tenant-authored string, not translated |
| D21 | Limits: 12 widgets per layout, 10 topics per recommendations widget, 280-character reason |
| D22 | Performance: Phase 1 measures the baseline on the demo seed, then fixes the target |
| D23 | Each instance carries `version`; migration happens on read; an invalid instance is dropped with a log |
| D24 | Mobile uses the same order in a single column |

## Open Questions

None blocking. To settle during the milestone breakdown:

1. The exact p95 target, once the Phase 1 baseline is measured (D22).
2. Whether the group editor lives on the admin groups page or on a dedicated dashboard-defaults page
   (UX detail, no contract impact).

## References

- [Milestone 5 — Engagement & Student Progress](../milestones/5-engagement-and-student-progress/milestone.md)
- [Milestone 7 — Gamification Engine & Learner UX](../milestones/7-gamification-engine-and-learner-ux/milestone.md)
- [RFC 0009 — Gamification Catalog Administration](./0009-gamification-catalog-administration.md) / Milestone 15
- [RFC 0010 — Player Progression Administration](./0010-player-progression-administration.md) / Milestone 16
- [RFC 0022 — Mission requirements](./0022-mission-requirements-evidence-driven-missions-with-ordered-s.md) — role-split and redaction precedents
- [RFC 0023 — Media acknowledgment](./0023-media-acknowledgment-read-and-watched-marks-as-mission-evide.md) — future refinement of the continue signal
- [RFC 0007 — Deployment preflight](./0007-deployment-preflight-and-config-validation.md) and [RFC 0011 — Branded deploy CLI](./0011-branded-deploy-cli-label-parametrized-ci-independent-release.md)
- Backlog `user-experience/10` — record a topic visit on page mount
- Current code: `packages/shared/types/dashboard.ts`, `apps/api/src/controllers/me-dashboard.controller.ts`,
  `apps/api/src/core/progress/progress-service.ts`, `apps/web/src/lib/dashboard-api.ts`,
  `apps/web/src/components/dashboard/`, `apps/api/migrations/0010_create_progress_tables.sql`,
  `apps/api/migrations/0011_create_enrollment_tables.sql`
