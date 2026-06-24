# RFC 0009: Gamification Catalog Administration

**Date:** 2026-06-23
**Status:** Draft
**Author:** raphaelsilva
**Affected:**
- `apps/web/src/app/(protected)/admin/page.tsx` (new hub cards for the catalog screens)
- `apps/web/src/app/(protected)/admin/badges/page.tsx` (new — badge CRUD UI)
- `apps/web/src/app/(protected)/admin/quests/page.tsx` (new — quest-definition CRUD UI)
- `apps/web/src/app/(protected)/admin/missions/page.tsx` (new — mission CRUD UI)
- `apps/web/src/app/(protected)/admin/levels/page.tsx` (new — level-definition editor)
- `apps/api/src/controllers/admin-quests.controller.ts` (new — quest CRUD controller)
- `apps/api/src/controllers/admin-levels.controller.ts` (new — level-definition controller)
- `apps/api/src/routes/admin/quests.ts`, `apps/api/src/routes/admin/levels.ts` (new routers)
- `apps/api/src/routes/admin/index.ts` (mount the new routers)
- `apps/api/src/adapters/db/d1-quest-repository.ts` (extend with admin write methods)
- `apps/web/src/lib/admin-gamification-api.ts` (new — typed client for the catalog endpoints)
- `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts` (new strings)

---

## Summary

Add admin-facing screens under `/admin` for authoring the **gamification
catalog** — the definition entities that drive rewards: **badges**,
**quest_definitions**, **missions**, and **level_definitions**. Badges and
missions already have backend admin APIs but no UI; quests and levels have no
admin surface at all. This RFC delivers the missing backend endpoints for
quests and levels and a consistent set of CRUD screens for all four, so
non-engineers can manage the reward catalog without writing seed migrations.
Per-user records (awarded badges, accumulated XP) are out of scope here and are
covered by RFC 0010.

## Motivation

Today the only way to change a badge, quest, mission, or level curve is to
write and apply a SQL seed migration (`0017_seed_level_definitions.sql`,
`0019_seed_quests.sql`, `0021_seed_badges.sql`). That blocks product/content
owners from iterating on the gamification loop and couples reward tuning to
engineering deploys.

| Case | Covered by this RFC? |
|---|---|
| Create/edit/deactivate a badge and its earn rule | ✅ (UI over existing API) |
| Create/edit/deactivate a daily/weekly quest definition | ✅ (new API + UI) |
| Create/edit/deactivate/delete a time-boxed mission | ✅ (UI over existing API) |
| Edit the XP→level curve and rank titles | ✅ (new API + UI) |
| Award a badge to a specific user | ❌ → RFC 0010 |
| Manually adjust a user's XP total | ❌ → RFC 0010 |

## Goals & Non-Goals

**Goals**
- A `/admin` hub entry and dedicated pages for badges, quests, missions, and
  levels, gated to `ADMIN` / `CONTENT_CREATOR` like the rest of the backoffice.
- Backend admin CRUD for `quest_definitions` and `level_definitions`, matching
  the `ControllerResult` + OpenAPI router conventions already used by
  `admin-badges` and `admin-missions`.
- A single typed web client (`admin-gamification-api.ts`) for all catalog
  endpoints.
- Full i18n coverage (EN + PT) with identical keys.

**Non-Goals**
- Per-user progression management (`user_xp`, `user_badges`, streaks,
  `quest_progress`, `mission_progress`) — see RFC 0010.
- Changing the predicate/rule evaluation engine or XP curve math. Screens edit
  existing fields (`predicate_kind`, `predicate_params`, `rule_kind`,
  `rule_params`, `min_xp`/`max_xp`); they do not introduce new rule kinds.
- A visual rule builder. `predicate_params` / `rule_params` are edited as
  validated JSON / scalar text in this iteration.

## Current State (for reference)

- **Schema** — all four catalog tables exist: `badges` + `user_badges`
  (`migrations/0020_create_badges.sql`), `quest_definitions` + `quest_progress`
  (`0018_create_quests.sql`), `missions` + `mission_progress`
  (`0024_create_missions.sql`), `level_definitions` (`0017_seed_level_definitions.sql`).
- **Types** — `Entities.Gamification.LevelDefinition` exists in
  `packages/shared/types/entities.ts:231`. Badge/Quest/Mission records are
  currently typed at the repository/router layer rather than in the shared
  namespace.
- **Backend, present**:
  - `AdminBadgesController` (`apps/api/src/controllers/admin-badges.controller.ts`)
    — `list`, `create`, `update`, `awardBadge`; mounted at `/admin/badges`
    (`apps/api/src/routes/admin/badges.ts`).
  - `AdminMissionsController` (`apps/api/src/controllers/admin-missions.controller.ts`)
    — `list`, `create`, `update`, `delete`; mounted at `/admin/missions`.
- **Backend, missing**: no admin controller/router for `quest_definitions`
  (only the participant-facing `me-quests.controller.ts` and the read-side
  `d1-quest-repository.ts`) and none for `level_definitions`.
- **Frontend, missing**: `apps/web/src/app/(protected)/admin/` contains
  `users`, `topics`, `tasks`, `groups`, `access` — no badges/quests/missions/
  levels pages. The hub (`admin/page.tsx`) lists four cards and does not link to
  any gamification screen.

## Proposed Design

### 1. Backend — new admin endpoints

Two new modules, following the exact shape of `admin-missions` (OpenAPIHono
router → controller returning `ControllerResult<T>` → D1 repository).

**Quests** — `apps/api/src/routes/admin/quests.ts` + `admin-quests.controller.ts`:

| Method | Path | Controller |
|---|---|---|
| GET | `/admin/quests` | `list()` → `QuestDefinition[]` |
| POST | `/admin/quests` | `create(body)` |
| PATCH | `/admin/quests/{id}` | `update(id, body)` |
| DELETE | `/admin/quests/{id}` | `delete(id)` |

Body (Zod): `kind` (`'daily' | 'weekly'`), `title`, `description`,
`predicateKind`, `predicateParams` (JSON string, validated parseable),
`xpReward` (int ≥ 0), `active` (bool, default true). `d1-quest-repository.ts`
gains `create`/`update`/`delete` write methods alongside its current reads.

**Levels** — `apps/api/src/routes/admin/levels.ts` + `admin-levels.controller.ts`:

| Method | Path | Controller |
|---|---|---|
| GET | `/admin/levels` | `list()` → `LevelDefinition[]` (ordered by `level`) |
| PUT | `/admin/levels` | `replaceAll(rows)` — full-table upsert in one tx |

The level curve is a small, contiguous, monotonic table edited as a whole, so a
single transactional `PUT` (validate `min_xp` strictly increasing, exactly one
`max_xp = NULL` final row, no gaps) is safer than per-row CRUD. The controller
rejects with `400 BadRequest` on a non-monotonic or gapped curve.

Both routers mount in `apps/api/src/routes/admin/index.ts` under the existing
`authGuard` + `requireRole(ADMIN, CONTENT_CREATOR)` umbrella:

```ts
app.route('/quests', buildAdminQuestsRouter(container));
app.route('/levels', buildAdminLevelsRouter(container));
```

### 2. Shared types

Promote the catalog record shapes into `Entities.Gamification`
(`Badge`, `QuestDefinition`, `Mission`) so the web client and API share one
definition instead of re-declaring Zod-inferred shapes per file. `LevelDefinition`
already lives there.

### 3. Frontend — `/admin` screens

Four pages, each a client component matching the existing admin pattern
(`useHasRole` gate, `useDict()` strings, list + create/edit modal or inline
form). Per RFC 0008's layout contract and the recent scroll fix, each page's
root `<main>` is a `flex-1 overflow-y-auto` scroll region under the protected
layout.

- `/admin/badges` — table (icon, name, slug, rule, xpReward, active toggle);
  create/edit form for `name`, `slug`, `iconEmoji`, `description`, `ruleKind`,
  `ruleParams`, `xpReward`, `active`.
- `/admin/quests` — table grouped by `kind` (daily/weekly); create/edit form as
  in §1.
- `/admin/missions` — table with `startAt`/`endAt` window and optional
  `badgeId` (select from badges); create/edit/delete over the existing API.
- `/admin/levels` — editable grid of the full curve (level, rankTitle, minXp,
  maxXp) with client-side monotonicity validation, saved via the `PUT` endpoint.

The `/admin` hub (`admin/page.tsx`) gains a "Gamification" group of cards
linking to the four pages, gated to `ADMIN || CONTENT_CREATOR`.

### 4. Web API client

`apps/web/src/lib/admin-gamification-api.ts` exposes `badges`, `quests`,
`missions`, `levels` namespaces over the centralized api-client, returning the
shared `Entities.Gamification.*` types.

## Alternatives Considered

1. **One combined "Gamification" RFC covering catalog + per-user records.**
   Rejected — the two areas have different UX (catalog CRUD vs. per-user lookup
   and adjustment), different risk profiles (editing definitions vs. mutating
   earned player state), and can ship independently. Split into 0009 (this) and
   0010.

2. **Per-row CRUD for `level_definitions`.** Rejected for the curve table —
   levels must stay contiguous and monotonic; piecemeal edits invite an invalid
   intermediate state (gap or overlap). A whole-table transactional `PUT` keeps
   the invariant atomic. Deferred fallback: if editors need partial saves, add
   per-row PATCH later behind the same validation.

3. **Visual predicate/rule builder.** Deferred, not rejected — valuable but
   large; this RFC ships validated JSON/scalar text fields so the screens are
   usable now, and a builder can layer on without schema change.

4. **Seed-migration-only (status quo).** Rejected — couples reward tuning to
   engineering deploys and excludes content owners, which is the whole
   motivation.

## Implementation Plan

Total: ~4–5 dev days.

### Phase 0 — Shared types (~0.5d)
Add `Badge`, `QuestDefinition`, `Mission` to `Entities.Gamification`; refactor
existing badge/mission routers to import them.

### Phase 1 — Backend quests + levels (~1.5d)
New controllers, routers, repository write methods, OpenAPI schemas, Vitest
coverage (Workers pool). Mount under the admin umbrella.

### Phase 2 — Web client + badges/missions UI (~1d)
`admin-gamification-api.ts`; ship the two screens whose APIs already exist,
proving the pattern end-to-end.

### Phase 3 — Quests + levels UI + hub cards (~1d)
The two new screens on the Phase 1 APIs; add the Gamification card group to the
hub; i18n keys in both dictionaries.

### Phase 4 — Polish (~0.5d)
`check-i18n-coverage.js` green, empty/error states, active-toggle optimistic UX.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| Editing a definition mid-period changes in-flight `quest_progress`/`mission_progress` semantics | Surface an "edits affect current period" warning; favor `active` toggling + new definition over destructive edits; document in screen help text |
| Raw JSON `predicate_params`/`rule_params` lets an admin save an unparseable or unsupported rule | Server validates JSON-parseable + known `*_kind`; reject with `400`; client previews parsed value before save |
| Invalid level curve (gap/overlap/missing final NULL) breaks level resolution | Transactional `PUT` validates strict monotonicity and exactly one open-ended final row before commit |
| `CONTENT_CREATOR` editing economy-wide reward values | Same role gate as existing tasks/topics admin; if finer control is needed later, narrow levels/XP-bearing edits to `ADMIN` (open question) |

## Success Criteria

- An admin can create, edit, and deactivate a badge, quest, and mission, and
  edit the level curve, entirely from `/admin` with no SQL.
- `GET/POST/PATCH/DELETE /admin/quests` and `GET/PUT /admin/levels` are covered
  by Vitest and appear in the OpenAPI document.
- The level `PUT` rejects a non-monotonic or gapped curve with `400`.
- `make lint`, `make test`, and `check-i18n-coverage.js` pass; EN and PT
  dictionaries have identical keys.

## Open Questions

- _None outstanding._

## Resolved Decisions

- **2026-06-23 (product)** — Deactivating a definition (`active = 0`) does
  **not** cascade-hide in-flight progress; existing rows age out by period.
  Concretely: setting `active = 0` only stops the definition from being handed
  out in future periods. The participant read path resolves a definition as
  visible when `active = 1` **OR** the current user already has a
  `quest_progress` row for the current `period_key` (resp. a `mission_progress`
  row inside the mission's `start_at`/`end_at` window). Already-`completed` rows
  keep their reward. This honors in-flight progress (no mid-period rug-pull) and
  keeps the read path simple.
- **2026-06-23 (raphaelsilva)** — Economy-affecting edits (level curve and
  `xpReward` fields) are restricted to `ADMIN` only; `CONTENT_CREATOR` may
  manage non-economy catalog fields but not reward values. The level editor
  (`/admin/levels`) is `ADMIN`-gated end to end.
- **2026-06-23 (raphaelsilva)** — No audit trail of catalog edits in this
  iteration. Deferred to a future *general* admin audit-log RFC covering
  topics/tasks/users/gamification under one consistent mechanism, rather than a
  gamification-only audit table. Per-user XP changes remain auditable via the
  `xp_events` ledger (see RFC 0010).

## References

- Migrations: `apps/api/migrations/0017_seed_level_definitions.sql`,
  `0018_create_quests.sql`, `0020_create_badges.sql`, `0024_create_missions.sql`
- Existing admin controllers: `apps/api/src/controllers/admin-badges.controller.ts`,
  `apps/api/src/controllers/admin-missions.controller.ts`
- Admin router mount: `apps/api/src/routes/admin/index.ts`
- Shared types: `packages/shared/types/entities.ts:206` (`Gamification` namespace)
- Related RFCs: RFC 0008 (User Dashboard — consumes this catalog),
  RFC 0010 (Player Progression Administration — per-user `user_xp`/`user_badges`)
