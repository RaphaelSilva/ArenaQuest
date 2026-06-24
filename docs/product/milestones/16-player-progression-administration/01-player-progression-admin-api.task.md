# Task 01 — Backend: Player progression admin API (Phase 1)

**Status:** ✅ Done
**Milestone:** [16 — Player Progression Administration](./milestone.md)
**RFC:** [RFC 0010](../../RFCs/0010-player-progression-administration.md)
**Team:** Backend API

## Summary

Deliver the per-user gamification administration API: a new
`admin-progression` controller + router mounted under the existing admin
umbrella (`authGuard`, gated to `ADMIN` only). It exposes a progression read
(`GET /admin/players/{userId}/progression` → total XP, resolved level/rank,
earned badges, recent XP events), badge award (reusing the existing award path)
and a new badge revoke, a ledger-backed XP adjustment, and a single-user
recompute. XP adjustments are written exclusively through the existing
`appendXpEvent` (`source_kind = 'admin_adjustment'`, `source_id` = acting admin
id, fresh UUID idempotency key) so the append-only `xp_events` ledger and its
atomic `user_xp` sync stay the single source of truth — `user_xp` is never
written directly except by the recompute action, which only repairs the read
model from the ledger. Negative adjustments are permitted but clamp
`user_xp.total_xp` at 0; revoke removes the `user_badges` row only and never
auto-claws its `xp_reward`. The Frontend task (02) builds the `/admin/players`
screen on top of this contract.

## Dependencies

- None — independent. (The Frontend task 02 depends on this one; it does not
  depend on task 02.) Reuses the existing `awardBadge` controller path and the
  `appendXpEvent` / `getUserXp` repository surface already in place.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/admin-progression.controller.ts` — new controller
    returning `ControllerResult<T>` for get / revokeBadge / adjustXp /
    recomputeXp (award reuses the existing badges controller path).
  - `apps/api/src/routes/admin/progression.ts` — new router (HTTP concerns only:
    param parsing, auth guard, response shaping).
  - `apps/api/src/routes/admin/index.ts` — mount the new router under the admin
    umbrella.
  - `apps/api/src/adapters/db/d1-badge-repository.ts` — add `listUserBadges`,
    `revokeBadge`.
  - `apps/api/src/adapters/db/d1-gamification-repository.ts` — add
    `listRecentXpEvents`, `recomputeUserXp` (the XP write reuses the existing
    `appendXpEvent`).
  - `packages/shared/types/entities.ts` and/or the relevant ports — the
    `PlayerProgression` response shape and the new repository method signatures.
  - `apps/api/test/**` — controller and adapter specs.
- **No migration.** This task adds no schema; `xp_events`, `user_xp`, and
  `user_badges` already exist. If a migration appears necessary, stop and revisit
  scope.
- **Ports & Adapters.** The new persistence behaviour belongs to the repository
  ports (`IBadgeRepository`, the gamification repository port); only the D1
  adapters know the concrete store. No D1/Cloudflare symbol leaks into a port or
  controller.
- **Ledger invariant.** XP changes go through `appendXpEvent` (atomic
  event-insert + `user_xp` sync); the controller never writes `user_xp`
  standalone. The only direct `user_xp` write is `recomputeUserXp`, which rewrites
  `total_xp` from `MAX(0, SUM(xp_events.points))` and appends no event.
- **Validation & results.** The XP-adjustment body
  (`{ points: number, reason: string }`, reason required/non-empty) is validated
  via `@ValidateBody(schema)` / `@Body()`; the controller returns
  `ControllerResult<T>` with explicit branches for validation (400), auth/role
  (403), and not-found (404, e.g. revoke of a badge the user lacks).
- **Authorization.** Every endpoint is gated to `ADMIN` only — `CONTENT_CREATOR`
  must be rejected (stricter than the RFC 0009 catalog gate).

## Scope

In:
- `GET /admin/players/{userId}/progression` returning the `PlayerProgression`
  shape: `userId`, `xp` (`totalXp`, `level`, `rankTitle` resolved from level
  definitions), `badges[]`, and `recentXpEvents[]`.
- `POST /admin/players/{userId}/badges/{badgeId}` — award, reusing the existing
  `awardBadge` path.
- `DELETE /admin/players/{userId}/badges/{badgeId}` — revoke; deletes the
  `user_badges` row, returns `404 NotFound` when the user does not hold it; does
  not touch XP.
- `POST /admin/players/{userId}/xp-adjustments` — append an `admin_adjustment`
  `xp_events` row (admin id as `source_id`, fresh idempotency key), with
  `total_xp` clamped at 0; reject missing/empty reason with `400`.
- `POST /admin/players/{userId}/xp-recompute` — rewrite `user_xp.total_xp` to
  `MAX(0, SUM(xp_events.points))`, append no event, return
  `{ previousTotal, newTotal }`.
- Repository additions: `listUserBadges`, `revokeBadge` (badge repo);
  `listRecentXpEvents`, `recomputeUserXp` (gamification repo).
- Vitest coverage for each branch incl. negative-clamp, revoke-404,
  recompute before/after with no new event, and non-`ADMIN` rejection.

Out:
- The `/admin/players` screen, hub card, client namespace, and i18n keys — task
  02 (Frontend), which depends on this contract.
- Streak / quest / mission progress, bulk operations, and bulk/scheduled
  reconciliation — fenced out by the milestone guardrail.

## Acceptance Criteria

- [x] `GET /admin/players/{userId}/progression` returns the documented
      `PlayerProgression` shape with correct total XP, resolved level/rank,
      earned badges, and recent XP events for a seeded user.
- [x] `DELETE /admin/players/{userId}/badges/{badgeId}` removes the
      `user_badges` row (subsequent read omits it) and returns `404` when the
      user never had that badge.
- [x] A positive and a negative XP adjustment each insert exactly one
      `xp_events` row with `source_kind = 'admin_adjustment'` and the admin id as
      `source_id`; `user_xp.total_xp` reflects the new total and never drops
      below 0.
- [x] A missing/empty `reason` is rejected `400 BadRequest` and writes no ledger
      row.
- [x] After drifting `user_xp.total_xp`, `xp-recompute` restores it to
      `MAX(0, SUM(xp_events.points))`, returns the before/after, and appends no
      new `xp_events` row.
- [x] All endpoints reject non-`ADMIN` callers (including `CONTENT_CREATOR`).
- [x] No provider-specific (D1) import leaks into a port or controller.
- [x] Changed files lint clean; `make test-api` green for the affected specs.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — the new controller and adapter specs pass, including the
   negative-clamp, revoke-404, recompute (before/after, no new event), and
   role-gate cases.
2. `make dev-api` — exercise each endpoint (Bruno or curl) as an `ADMIN`:
   read progression, award then revoke a badge (and the 404 path), apply a
   positive and a negative XP adjustment (verify the ledger row and clamp),
   and recompute after a manual drift.
3. Confirm a `CONTENT_CREATOR` token is rejected on every endpoint.
4. `git diff --stat` confirms only scope-guardrail files changed.
