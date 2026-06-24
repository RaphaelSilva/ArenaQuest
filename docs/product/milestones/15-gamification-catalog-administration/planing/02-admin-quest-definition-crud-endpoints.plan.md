# Plan — Task 02: Admin quest-definition CRUD endpoints

**Task:** [02-admin-quest-definition-crud-endpoints.task.md](../02-admin-quest-definition-crud-endpoints.task.md)
**Persona:** `backend-developer`
**Branch:** `feature/m15/02-admin-quest-definition-crud-endpoints.task` (stacked on task 01)

## Goal

Add the admin CRUD surface for `quest_definitions` — `GET/POST/PATCH/DELETE
/admin/quests` — mirroring `admin-missions` (OpenAPIHono router → controller
returning `ControllerResult<T>` → D1 repository). No migration: the
`quest_definitions` table already exists.

## Current state (verified)

- `D1QuestRepository` (`apps/api/src/adapters/db/d1-quest-repository.ts`) has only
  read/progress methods (`listActiveDefinitions`, `listActiveQuestsForUser`,
  `findProgress`, `upsertProgress`, `markCompleted`) and a `rowToDefinition`
  mapper. No `listAll`/`create`/`update`/`delete`.
- `IQuestRepository` (`packages/shared/ports/i-quest-repository.ts`) — extend with
  the write methods.
- `QuestDefinition` + `QuestKind` come from `@arenaquest/shared/domain/quest`
  (now aliasing `Entities.Gamification.QuestDefinition` after task 01).
- Reference shape: `apps/api/src/routes/admin/missions.ts` +
  `apps/api/src/controllers/admin-missions.controller.ts` +
  `apps/api/src/adapters/db/d1-mission-repository.ts` (`create`/`update` with
  dynamic field list).
- Admin mount: `apps/api/src/routes/admin/index.ts`; the `/admin` umbrella
  already applies `authGuard` + `requireRole(ADMIN, CONTENT_CREATOR)`.
- Container: `container.gamification.questRepo` is the `IQuestRepository`.
- Role reading inside a handler: `c.get('user').roles` (array of role names);
  `ROLES.ADMIN` from `@arenaquest/shared/constants/roles`.

## Approach

1. **Port** — extend `IQuestRepository` with:
   - `listAll(): Promise<QuestDefinition[]>`
   - `create(input): Promise<QuestDefinition>` (omit id/createdAt/updatedAt)
   - `update(id, partial): Promise<QuestDefinition | null>`
   - `delete(id): Promise<boolean>` (hard delete; quest_definitions has no soft
     flag requirement — but if missions use soft-delete via `active=false`,
     follow the controller's `delete` to flip `active=false` instead. Decision:
     follow RFC table which says `DELETE /admin/quests/{id}` → `delete(id)`; use a
     hard delete of the definition row. Confirm no FK from quest_progress blocks
     it; if a FK exists, soft-delete via `active=0` like missions. Implementer
     picks based on the actual `0018_create_quests.sql` constraints.)
2. **D1 adapter** — implement the four methods on `D1QuestRepository`, reusing
   `rowToDefinition`. `create` generates `crypto.randomUUID()` and inserts
   (kind, title, description, predicate_kind, predicate_params, xp_reward,
   active). `update` builds a dynamic `SET` list like `D1MissionRepository.update`.
3. **Controller** — `AdminQuestsController` with `list`, `create`, `update`,
   `delete`, returning `ControllerResult<T>`. Zod schemas:
   - create: `kind` ∈ {`daily`,`weekly`}, `title` (min 1), `description` (min 1),
     `predicateKind` (min 1), `predicateParams` (string, must `JSON.parse`
     without throwing — refine), `xpReward` (int ≥ 0), `active` (bool, default
     true).
   - update: `.partial()`.
   - `predicateParams` JSON-parseable refinement → `400` on failure.
   - not-found on update/delete of unknown id → `404`.
   - **Economy gate:** the controller receives a `canEditEconomy` boolean
     (caller is ADMIN). If a create sets `xpReward` (> 0 or present) or an update
     changes `xpReward` while `canEditEconomy === false` → `403 Forbidden`. A
     `CONTENT_CREATOR` editing non-economy fields succeeds.
4. **Router** — `apps/api/src/routes/admin/quests.ts` modelled on missions:
   `createRoute` defs for list/create/update/delete with a `QuestSchema` (wire
   shape, dates as ISO strings) and the request-body schemas; OpenAPIHono with
   the `defaultHook` 400 validation envelope (as badges router uses). Each
   handler reads `c.get('user').roles` to compute `canEditEconomy` and passes it
   to the controller.
5. **Mount** — add `app.route('/quests', buildAdminQuestsRouter(container));` in
   `apps/api/src/routes/admin/index.ts` (under the existing umbrella).
6. **Tests** — `apps/api/test/routes/admin-quests.router.spec.ts` (Workers pool),
   mirroring the missions spec: 401 without token; CRUD round-trip; 400 on bad
   `kind` / unparseable `predicateParams` / negative `xpReward`; 404 on unknown
   id for PATCH/DELETE; 403 when a `CONTENT_CREATOR` sets/changes `xpReward` while
   a non-economy edit by the same role succeeds.

## Files in scope

- `packages/shared/ports/i-quest-repository.ts` — write methods on the port.
- `apps/api/src/adapters/db/d1-quest-repository.ts` — write method impls.
- `apps/api/src/controllers/admin-quests.controller.ts` — new controller.
- `apps/api/src/routes/admin/quests.ts` — new router.
- `apps/api/src/routes/admin/index.ts` — mount.
- `apps/api/test/**` — new router spec.

## Out of scope

- Level endpoints (task 03), any `apps/web` change, per-user `quest_progress`
  (RFC 0010), new rule kinds / predicate engine changes.

## Verification

- `make lint`; `make test-api` — the new quests spec + existing specs green.
- `git diff --stat` — only scope-guardrail files changed.
