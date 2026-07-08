# Plan — Task 04: Gamification web client + badges & missions screens

**Task:** [04-gamification-web-client-and-badges-and-missions-sc.task.md](../04-gamification-web-client-and-badges-and-missions-sc.task.md)
**Persona:** `frontend-developer`
**Branch:** `feature/m15/04-gamification-web-client-and-badges-and-missions-sc.task` (stacked on task 03)

## Goal

Add the typed web client for the whole gamification catalog and ship the
`/admin/badges` and `/admin/missions` screens (whose backend APIs already exist),
proving the pattern end-to-end. Task 05 reuses the client for quests/levels and
adds the hub cards.

## Current state (verified)

- API client pattern: each `apps/web/src/lib/*-api.ts` exports a
  `create<Name>Api(http: HttpTransport)` factory returning async methods that
  call `http(method, path)` and read `body.data`. They are registered as getters
  on `ApiClient` in `apps/web/src/lib/api-client.ts`; pages obtain the client via
  `useApiClient()` (`@web/context/auth-context`) and call e.g.
  `client.adminGroups.list()`.
- Admin list pages follow `apps/web/src/app/(protected)/admin/tasks/page.tsx`:
  `'use client'`, `useDict()`, `useApiClient()`, `useHasRole(ROLES...)`,
  list+detail/inline-edit, loading via `Spinner`, error string state.
- Design system (`@web/components/design-system`): `Button`, `Badge`, `Table`
  (+ `TableHeader/Body/Row/Cell`), `Input`, `Card`. No Modal — follow the
  existing inline-form / detail-pane pattern, not a modal.
- Backend wire shapes (from tasks 01–03 + existing routers), all wrapped `{ data }`:
  - badges: `GET /admin/badges`, `POST /admin/badges`
    (slug, name, iconEmoji, description?, xpReward?, ruleKind, ruleParams?),
    `PATCH /admin/badges/{id}` (name?, iconEmoji?, description?, xpReward?,
    ruleKind?, ruleParams?, active? — slug NOT updatable).
  - missions: `GET/POST /admin/missions`, `PATCH /admin/missions/{id}`,
    `DELETE /admin/missions/{id}` (soft). Fields: title, description, startAt,
    endAt, predicateKind, predicateParams, xpReward, badgeId?, active.
  - quests: `GET/POST /admin/quests`, `PATCH`/`DELETE /admin/quests/{id}`.
  - levels: `GET /admin/levels`, `PUT /admin/levels`.
- i18n: keys live in `apps/web/src/i18n/dict-en.ts` + `dict-pt.ts` under the
  `admin:` namespace (e.g. `admin.dashboard`, `admin.tasks`); the two dicts MUST
  stay key-identical; `apps/web/scripts/check-i18n-coverage.js` enforces no
  hardcoded strings under `src/{app,components,hooks}`.

## Scope decision (deviation noted)

The task guardrail lists `admin-gamification-api.ts` but not `api-client.ts`.
Registering the new namespace as a getter on `ApiClient` (one block, mirroring
`get adminGroups()`) is required for the client to be "over the centralized
api-client" and for pages to reach it via `useApiClient()`. I therefore add
`apps/web/src/lib/api-client.ts` to scope for that single registration. Recorded
here so a reviewer expects that one-block diff.

## Approach

1. **Client** — `apps/web/src/lib/admin-gamification-api.ts`:
   `createAdminGamificationApi(http)` returning `{ badges, quests, missions,
   levels }`. Type the record shapes from the shared `Entities.Gamification.*`
   (import from `@arenaquest/shared/...`) where practical; otherwise local types
   mirroring the wire shape (ids/dates as strings). Methods:
   - `badges.list/create/update`
   - `missions.list/create/update/delete`
   - `quests.list/create/update/delete`
   - `levels.list/replaceAll` (PUT)
   Each reads `body.data`; throw a typed error on `!res.ok` like the existing
   clients. Register `get adminGamification()` on `ApiClient`.
2. **`/admin/badges` page** — `apps/web/src/app/(protected)/admin/badges/page.tsx`,
   `'use client'`, gated `useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR)`. Table
   columns: icon, name, slug, rule (ruleKind/ruleParams), xpReward, active toggle.
   Create/edit inline form for name, slug, iconEmoji, description, ruleKind,
   ruleParams, xpReward, active. The `xpReward` input is disabled / hidden for a
   non-`ADMIN` (mirror the backend economy gate). Surface the "edits affect the
   current period" help text and a parsed-`ruleParams` preview before save. Root
   `<main>` (or wrapper) is `flex-1 overflow-y-auto`.
3. **`/admin/missions` page** — `apps/web/src/app/(protected)/admin/missions/page.tsx`,
   same shell. Table with startAt/endAt window + optional badgeId. Create/edit/
   delete. `badgeId` is a `<select>` populated from `badges.list()`. Same scroll
   region + help text.
4. **i18n** — add an `admin.badges` and `admin.missions` key group to BOTH
   `dict-en.ts` and `dict-pt.ts` (identical keys). No hardcoded strings.
5. **Tests** — component tests for both pages (render gated, list renders from a
   mocked client, create issues the expected payload). Follow the web test
   convention the repo already uses (RTL + Vitest); mock `useApiClient`.

## Files in scope

- `apps/web/src/lib/admin-gamification-api.ts` (new)
- `apps/web/src/lib/api-client.ts` (register namespace — see deviation)
- `apps/web/src/app/(protected)/admin/badges/page.tsx` (new)
- `apps/web/src/app/(protected)/admin/missions/page.tsx` (new)
- `apps/web/src/components/**`, `apps/web/src/hooks/**` (shared catalog pieces if needed)
- `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts`
- web test files for the two pages

## Out of scope

- `/admin/quests`, `/admin/levels`, and the hub cards — task 05.
- Any `apps/api` change — tasks 01–03 own the endpoints.

## Verification

- `make lint`; `make test-web`; `node apps/web/scripts/check-i18n-coverage.js`.
- `make dev-web` + `make dev-api` browser walkthrough of both screens (via /run
  or /verify) — list + create/edit (+ mission delete) happy paths, active toggle.
- `git diff --stat` — only scope files changed; nothing under `apps/api/src`.
