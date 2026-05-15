# Plan — extend-03-mission-data-layer

**Task:** [03-mission-data-layer.task.md](../03-mission-data-layer.task.md)
**Milestone:** 7
**Assigned personas:** backend-developer
**Branch:** feature/m7/extend-03-mission-data-layer.task (from feature/m7/candidate)

## Objective

Complete the missing Admin CRUD API for Missions. While the database migrations and basic repository methods for student progress are already in place, the administrative management layer (Create, Read, Update, Delete) is missing from the API.

## Affected areas

- `packages/shared/ports/i-mission-repository.ts`: Add Admin CRUD methods.
- `apps/api/src/adapters/db/d1-mission-repository.ts`: Implement Admin CRUD methods.
- `apps/api/src/controllers/admin-missions.controller.ts`: New controller for mission management.
- `apps/api/src/routes/admin-missions.router.ts`: New router for `/admin/missions`.
- `apps/api/src/routes/index.ts`: Register the new router.
- `apps/api/test/integration/admin-missions.spec.ts`: Integration tests for the new endpoints.

## Step-by-step

### Backend
1. **Repository Port**: Update `IMissionRepository` to include:
    - `findById(id: string): Promise<Mission | null>`
    - `create(mission: Omit<Mission, 'id' | 'createdAt' | 'updatedAt'>): Promise<Mission>`
    - `update(id: string, mission: Partial<Omit<Mission, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Mission>`
    - `listAll(): Promise<Mission[]>`
2. **Repository Implementation**: Implement these methods in `D1MissionRepository`. Ensure `update` and `create` handle the JSON stringification of `predicate_params`. Ensure `delete` (soft) is handled via `active = 0` if needed, or provided as a specific update.
3. **Controller**: Create `AdminMissionsController` in `apps/api/src/controllers/`. It should implement:
    - `createMission`: validates dates (`endAt > startAt`).
    - `updateMission`: prevents shortening `endAt` below `now` for active missions.
    - `listMissions`: returns all missions.
    - `deleteMission`: soft delete by setting `active = 0`.
4. **Zod Schemas**: Define validation schemas for `CreateMission` and `UpdateMission` payloads.
5. **Routes**: Create `apps/api/src/routes/admin-missions.router.ts` using the controller. Apply `authGuard` and `requireRole('admin', 'content_creator')`.
6. **Registration**: Wire the router in `apps/api/src/routes/index.ts` under `/admin/missions`.
7. **Integration Tests**: Create `apps/api/test/integration/admin-missions.spec.ts`. Cover:
    - Successful creation and listing.
    - `400` for invalid dates.
    - `403` for non-admin users.
    - Soft delete verification.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| `POST /admin/missions` rejects payloads where `end_at <= start_at` with `400`. | 3, 4, 5, 7 | backend | Integration test |
| Non-admin callers receive `403`. | 5, 7 | backend | Integration test |
| `PATCH /admin/missions/:id` allows updating `end_at` to extend a running mission but rejects shortening it below `now`. | 3, 4, 5, 7 | backend | Integration test |
| `DELETE /admin/missions/:id` sets `active = 0` (soft); the row remains for audit. | 2, 3, 5, 7 | backend | Integration test |
| No provider-specific imports outside adapters. | All | backend | `make lint` |

## Risks & open questions

- **Idempotency**: The task doesn't explicitly require an idempotency key for *creating* missions, but it's good practice. Given the ACs, we'll focus on the date logic first.
- **Time Zones**: Date strings should be handled as ISO strings.

## Verification

- Backend: `make lint && make test-api`
- Specific test: `npx vitest apps/api/test/integration/admin-missions.spec.ts`

## Out of scope

- Predicate evaluation against user actions (Task 08).
- Frontend admin authoring UI.
