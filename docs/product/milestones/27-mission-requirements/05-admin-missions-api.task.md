# Task 05 — Backend: Admin missions API — admin-only writes, typed requirements, start lock, audience, participants (Phase 3)

**Status:** ✅ Done
**Milestone:** [27 — Mission requirements](./milestone.md)
**RFC:** [RFC 0022](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-schema-and-d1-adapters.task.md)

## Summary

Rewrites the admin side of missions around typed requirements and moves the role boundary. In
`apps/api/src/routes/admin/missions.ts`, the three **reads stay open to `admin` and
`content_creator`** through the existing `/admin/*` umbrella — `GET /v1/admin/missions` (list with
requirement, enrolled and completed counts), `GET /v1/admin/missions/{id}` (mission, ordered
requirements, audience) and `GET /v1/admin/missions/{id}/participants` (cursor-paginated
enrollments with per-step progress and `completed_by`) — because the instructor animates the
mission in class (RFC Open Question 1, decided). **Every write is admin-only**, each write route
carrying `requireRole(ROLES.ADMIN)`: `POST /v1/admin/missions` creates a mission with its 1…20
requirements in one batch (mandatory window, `mode`, `enrollmentMode`, mission XP, badge, optional
audience for `assigned`); `PATCH /v1/admin/missions/{id}`; `PUT …/requirements` replaces the
ordered list; `PATCH …/requirements/{reqId}` edits a title; `PUT …/audience` replaces users and
groups (only for `assigned`, `409 MISSION_NOT_ASSIGNED` otherwise; users no longer covered get
`left_at`, keeping progress and rewards); `DELETE` stays a soft delete. A content creator gets
`403` on each of them — the role-boundary change RFC 0022 §8 flags. **Target validation** answers
`400 INVALID_REQUIREMENT_TARGET` with the offending item's index: topics must exist, be published
and not archived; `video_watched` targets must hold a ready video; events must be published and
priced (`EVENT_NOT_CHARGEABLE`); a `shared_only` requirement is refused while the label's
submission sharing is off (`REQUIREMENT_SHARING_DISABLED`). **Start lock**: once now ≥
`start_at`, requirements, mode, enrollment mode, window start and reward values answer
`409 MISSION_STARTED`; title, description, `active` and extending `end_at` stay editable, and the
existing rule refusing to shorten `end_at` below now is kept. New missions store
`predicate_kind = 'requirements'`; `predicateKind` / `predicateParams` leave the request schemas
and are marked deprecated in responses. The reconcile endpoint is Task 08.

## Dependencies

- [Task 04](./04-schema-and-d1-adapters.task.md) — hard code dependency: schema and
  `D1MissionRepository` (Task 02's contracts come with it).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/admin-missions.controller.ts`.
  - `apps/api/src/routes/admin/missions.ts` — routes, per-route admin guard.
  - `apps/api/src/openapi/components/entities.ts` — mission, requirement, audience and
    participant schemas; `apps/api/openapi.json` regenerated with `pnpm dump-openapi`.
  - `apps/api/test/routes/admin-missions.router.spec.ts` and new controller specs under
    `apps/api/test/**`.
- **Reads open, writes admin-only.** The guard sits on each write route, not on the router;
  `apps/api/src/routes/admin/index.ts` is **not** edited (the umbrella keeps admitting both staff
  roles). The spec finally uses the content-creator token it already signs.
- **Validation is `@hono/zod-openapi`** `createRoute` + Zod, reusing the requirement schemas from
  `packages/shared/domain/missions/requirements.ts`; no `@ValidateBody` / `@Body()`.
- **Controller decides**, returning `ControllerResult<T>` for validation, not-found, start-lock and
  audience conflicts; the route only shapes HTTP.
- **Readers of other contexts are ports.** Topic, media, event, price and submission-config checks
  go through existing repositories and `SubmissionConfig`; no SQL in the controller.
- No change to `routes/admin/index.ts`, `quests.ts`, `badges.ts` or `levels.ts`.

## Scope

In:
- The ten admin routes of RFC 0022 §6 except `POST …/reconcile` (Task 08).
- Target validation, start lock, audience replace with `left_at` for removed users, participants
  listing with an opaque cursor (the `routes/_shared/cursor.ts` helper).
- Specs: role matrix (admin `2xx`, content creator `200` on the three reads and `403` on every
  write, student `403` everywhere); each validation error with its index; start lock per field;
  audience on a non-assigned mission; participants page shape; legacy rows still listed with
  their deprecated predicate fields.

Out:
- `POST …/reconcile` — Task 08. Hooks — Task 06. Student routes — Task 07. Admin web — Tasks 09–10.

## Acceptance Criteria

- [x] A content creator gets `403` on `POST`, `PATCH`, `PUT …/requirements`,
      `PATCH …/requirements/{reqId}`, `PUT …/audience` and `DELETE`, and `200` on list, detail and
      participants; an admin gets `201` on create.
- [x] A create with an unknown `kind`, `minCount: 0`, an extra params key, an archived topic, a
      topic with no video for `video_watched`, or an unpriced event answers `400` naming the
      requirement index and the reason.
- [x] A `shared_only` requirement answers `400 REQUIREMENT_SHARING_DISABLED` when
      `SUBMISSIONS_SHARING_ENABLED=false`.
- [x] After `start_at`, `PUT …/requirements` and a `PATCH` of `mode` or `xpReward` answer
      `409 MISSION_STARTED`; a `PATCH` of `title` or a later `endAt` answers `200`.
- [x] `PUT …/audience` on an `auto` mission answers `409 MISSION_NOT_ASSIGNED`; removing a user
      sets their enrollment's `left_at` and leaves their progress rows and `xp_events` intact.
- [x] A created mission reads back with `predicateKind = 'requirements'` and its requirements in
      position order.
- [x] `routes/admin/index.ts` is unchanged; no `@ValidateBody` / `@Body()` in the diff.
- [x] Changed files lint clean; `make test-api` green; `pnpm dump-openapi` leaves no diff.
- [x] No diff outside the scope guardrail.
      _Closed 2026-10-03. Authorized additions: `updateRequirementTitle` on `IMissionRepository` + its D1 implementation (a title edit must keep the requirement id, or progress rows would cascade away), and `D1MissionRepository.update` now persists `mode` / `enrollment_mode` (it silently dropped them). Extra codes: `409 MISSION_LEGACY` on replacing requirements of a legacy mission, `400 BADGE_NOT_FOUND`, `400 AUDIENCE_NOT_ALLOWED`, `400 UNKNOWN_AUDIENCE_TARGET`. The start lock compares values, so resubmitting an unchanged form after start is accepted. Group members are enrolled eagerly on create/audience replace. Follow-up: `list()` and participants count through the ports (one progress read per enrollment); a set-based adapter count is the follow-up if rosters grow. The `curl` walkthrough was not run; the router spec covers the flows end to end._

## Verification Plan

1. `make db-reset-local`; `make dev-api`; log in as the seeded admin and as the seeded content
   creator.
2. `curl` a create with a sequential, two-step mission; read it back; try the same as the content
   creator (`403`) and list it as the content creator (`200`).
3. Create a mission starting now and confirm the start lock on `PUT …/requirements`.
4. `make test-api`; `make lint`; `pnpm dump-openapi`.
5. `git diff --stat` confirms only guardrail files changed.
