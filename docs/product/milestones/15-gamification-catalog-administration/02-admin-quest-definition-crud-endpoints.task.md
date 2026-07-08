# Task 02 — Backend: Admin quest-definition CRUD endpoints (Phase 1)

**Status:** ✅ Done
**Milestone:** [15 — Gamification Catalog Administration](./milestone.md)
**RFC:** [RFC 0009](../../RFCs/0009-gamification-catalog-administration.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-shared-gamification-catalog-types.task.md)

## Summary

Deliver the admin CRUD surface for `quest_definitions`, which currently has no
admin controller or router — only the participant-facing read path. Following
the exact shape of `admin-missions` (OpenAPIHono router → controller returning
`ControllerResult<T>` → D1 repository), this task adds `GET`, `POST`, `PATCH`,
and `DELETE` under `/admin/quests`, extends the quest repository with
create/update/delete write methods alongside its existing reads, and mounts the
new router under the admin `authGuard` + `requireRole(ADMIN, CONTENT_CREATOR)`
umbrella. Because `xpReward` is an economy-affecting field, edits to it are
restricted to `ADMIN`. The web client (task 04) and the quests screen (task 05)
consume this contract.

## Dependencies

- [Task 01 — Shared gamification catalog types](./01-shared-gamification-catalog-types.task.md)
  — hard dependency: the controller and router type their responses against
  `Entities.Gamification.QuestDefinition`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/admin-quests.controller.ts` — new controller with
    `list`, `create`, `update`, `delete`, each returning `ControllerResult<T>`.
  - `apps/api/src/routes/admin/quests.ts` — new OpenAPIHono router handling only
    HTTP concerns and the OpenAPI schema for the four operations.
  - `apps/api/src/routes/admin/index.ts` — mount the new router under the
    existing `authGuard` + `requireRole(ADMIN, CONTENT_CREATOR)` umbrella.
  - `apps/api/src/adapters/db/d1-quest-repository.ts` — add `create`, `update`,
    and `delete` write methods alongside the current reads; the corresponding
    port interface gains those methods.
  - `apps/api/test/**` — controller and router specs (Workers pool).
- **No schema change.** The `quest_definitions` table already exists
  (`migrations/0018_create_quests.sql`); no migration is added.
- **Ports & Adapters.** The write methods belong to the quest repository port;
  only the D1 adapter knows the concrete store. No D1 symbol leaks into the
  controller or router.
- **Validation & results.** Body validated via `@ValidateBody(schema)` / `@Body()`:
  `kind` ∈ {`daily`, `weekly`}, `title`, `description`, `predicateKind`,
  `predicateParams` (a JSON string that must parse), `xpReward` (integer ≥ 0),
  `active` (boolean, default `true`). The controller returns explicit branches
  for validation (`400`), auth (`401`/`403`), and not-found (`404` on
  PATCH/DELETE of an unknown id).
- **Role split.** `xpReward` edits are `ADMIN`-only; a `CONTENT_CREATOR` may
  create/update the non-economy fields but not set or change a reward value.

## Scope

In:
- Quest repository port + D1 adapter `create`/`update`/`delete` write methods.
- `AdminQuestsController` with `list`/`create`/`update`/`delete` returning
  `ControllerResult`.
- `/admin/quests` OpenAPIHono router (`GET`/`POST`/`PATCH /{id}`/`DELETE /{id}`)
  mounted under the admin umbrella and present in the OpenAPI document.
- Vitest coverage for each verb plus the validation, not-found, and
  `CONTENT_CREATOR`-rejected-`xpReward` branches.

Out:
- Any frontend change — the web client (task 04) and the quests screen (task 05)
  consume this endpoint.
- Level-definition endpoints (task 03) and per-user `quest_progress` (RFC 0010).

## Acceptance Criteria

- [x] `GET/POST/PATCH/DELETE /admin/quests` round-trip a quest definition under
      Vitest (Workers pool) and the four operations appear in the OpenAPI doc.
- [x] `POST`/`PATCH` reject a missing/invalid `kind`, an unparseable
      `predicateParams`, or a negative `xpReward` with `400`.
- [x] `PATCH`/`DELETE` of an unknown id return `404`.
- [x] A `CONTENT_CREATOR` setting or changing `xpReward` is rejected, while a
      non-economy field edit by the same role succeeds — both covered by a test.
- [x] No provider-specific (D1) import leaks into the controller or router.
- [x] Changed files lint clean; `make test-api` green for the affected specs.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — the quest controller/router specs pass, including the
   validation, not-found, and role-split branches.
2. `make dev-api` — exercise `GET/POST/PATCH/DELETE /admin/quests` with curl or
   Bruno, including the `400` (bad body), `403` (`CONTENT_CREATOR` reward edit),
   and `404` (unknown id) cases.
3. Confirm the four operations render in the OpenAPI document.
4. `git diff --stat` confirms only scope-guardrail files changed.
