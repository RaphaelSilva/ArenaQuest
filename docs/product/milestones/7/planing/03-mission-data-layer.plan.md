# Plan — 03-mission-data-layer

**Task:** [03-mission-data-layer.task.md](../03-mission-data-layer.task.md)
**Milestone:** 7
**Assigned persona:** backend-developer
**Branch:** feature/m7/03-mission-data-layer.task (from feature/m7/candidate)

## Objective

Add the persistence and admin API layer for Missions. Missions are time-bound challenges (with start/end dates) that users can complete to earn XP and badges. This task focuses on the database schema, the repository implementation, and the admin-only CRUD endpoints for managing missions.

## Affected areas

- `packages/shared/types/entities.ts`: Add `Mission` and `MissionProgress` types.
- `packages/shared/ports/i-mission-repository.ts`: Define the mission repository interface.
- `packages/shared/ports/index.ts`: Export the mission repository.
- `apps/api/migrations/0020_create_missions.sql`: Migration for `missions` and `mission_progress` tables.
- `apps/api/src/adapters/db/d1-mission-repository.ts`: D1 implementation of the mission repository.
- `apps/api/src/controllers/missions-controller.ts`: Admin mission management logic.
- `apps/api/src/routes/admin/missions.ts`: Admin mission routes with validation.
- `apps/api/src/routes/index.ts`: Route registration.
- `apps/api/test/missions/admin-missions.spec.ts`: Integration tests for admin CRUD.

## Step-by-step

1. **Shared Types**: Update `packages/shared/types/entities.ts` to include `Mission` and `MissionProgress` under `Entities.Engagement` (or a new `Entities.Gamification` as per Milestone 7 doc).
2. **Repository Port**: Create `packages/shared/ports/i-mission-repository.ts` with methods for CRUD (list, find, create, update, delete) and export it.
3. **Database Migration**: Create `apps/api/migrations/0020_create_missions.sql` creating the `missions` and `mission_progress` tables with the specified columns and constraints.
4. **Repository Implementation**: Implement `apps/api/src/adapters/db/d1-mission-repository.ts` ensuring clean SQL and proper error handling.
5. **Controller**: Create `apps/api/src/controllers/missions-controller.ts`. It should use `MissionsController` returning `ControllerResult<T>`.
6. **Routes & Validation**: Create `apps/api/src/routes/admin/missions.ts`. Use Zod schemas for validation and `@ValidateBody`. Implement the rules for `end_at > start_at` and extending/shortening missions.
7. **Route Registration**: Wire up the new admin routes in `apps/api/src/routes/index.ts`.
8. **Integration Tests**: Create `apps/api/test/missions/admin-missions.spec.ts` to cover the acceptance criteria (rejection cases, admin role check, soft delete).

## Acceptance Criteria mapping

| AC | Plan step(s) | Verification |
|---|---|---|
| `POST /admin/missions` rejects payloads where `end_at <= start_at` with `400`. | 6, 8 | Integration test |
| Non-admin callers receive `403`. | 6, 8 | Integration test |
| `PATCH /admin/missions/:id` allows updating `end_at` to extend a running mission but rejects shortening it below `now`. | 6, 8 | Integration test |
| `DELETE /admin/missions/:id` sets `active = 0` (soft); the row remains for audit. | 4, 5, 6, 8 | Integration test + DB check |
| No provider-specific imports outside adapters. | All | `make lint` |

## Risks & open questions

- **Date handling**: Ensuring D1 (SQLite) date comparisons work correctly with ISO strings or Unix timestamps. Use Unix timestamps (seconds) for consistency with other tables.
- **Role check**: Ensure `requireRole('admin', 'content_creator')` is correctly applied.

## Verification

- `make lint`
- `make test-api`
- Specific test: `npx vitest apps/api/test/missions/admin-missions.spec.ts`

## Out of scope

- Predicate evaluation (Task 08).
- Frontend UI.
- Awarding logic (Task 08).
