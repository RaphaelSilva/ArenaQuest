# Task 03 — Mission Data Layer + Admin CRUD API

**Status:** ⏳ Pending
**Milestone:** [7](./milestone.md)

## Summary

Add the time-bound mission entity: admin-authored, with a start/end window, predicate, XP and optional badge reward, plus per-user progress. Expose admin CRUD endpoints.

## Dependencies

Task 01 (XP source kinds) preferred but not blocking — can be developed in parallel.

## Technical Constraints

- `missions (id, title, description, start_at, end_at, predicate_kind, predicate_params, xp_reward, badge_id?, active, created_by)`.
- `mission_progress (id, user_id, mission_id, value, completed_at?)` with unique on `(user_id, mission_id)`.
- Route under `/admin/missions` guarded by `requireRole('admin', 'content_creator')`.
- All HTTP shaping in `src/routes/admin/missions.ts`; business logic in a `MissionsController` returning `ControllerResult<T>`; Zod schemas validated via `@ValidateBody`.
- Awarding logic (granting XP / badge on completion) belongs to Task 08, not here.

## Scope

In:
- Migrations and `IMissionRepository` port + D1 adapter.
- Controller + routes for create/list/update/end.
- Zod schemas for the create/update bodies.
- Integration tests under `apps/api/test/`.

Out:
- Predicate evaluation against user actions (Task 08).
- Frontend admin authoring UI (only verified via API in M7; UI can land in a follow-up if needed — list available missions to the user in Task 10's `/me/missions`).

## Acceptance Criteria

- [ ] `POST /admin/missions` rejects payloads where `end_at <= start_at` with `400`.
- [ ] Non-admin callers receive `403`.
- [ ] `PATCH /admin/missions/:id` allows updating `end_at` to extend a running mission but rejects shortening it below `now`.
- [ ] `DELETE /admin/missions/:id` sets `active = 0` (soft); the row remains for audit.
- [ ] No provider-specific imports outside adapters.

## Verification Plan

1. Vitest integration suite covers happy path + the three rejection cases above.
2. `make lint` and `make test-api` pass.
