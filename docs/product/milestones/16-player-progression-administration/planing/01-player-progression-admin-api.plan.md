# Plan — Task 01: Player progression admin API

**Task:** [01-player-progression-admin-api.task.md](../01-player-progression-admin-api.task.md)
**Persona:** `backend-developer` (apps/api + packages/shared only)
**Branch:** `feature/m16/01-player-progression-admin-api.task`
**Migration:** none (uses existing `xp_events` / `user_xp` / `user_badges`; highest is `0025`).

## Context discovered in the codebase

- **Admin umbrella** (`apps/api/src/routes/admin/index.ts`) applies
  `authGuard` + `requireRole(ADMIN, CONTENT_CREATOR)` to all sub-routers. This
  milestone is **ADMIN-only**, so the progression router must add an extra
  `requireRole(ROLES.ADMIN)` guard on `*` inside the router (defense-in-depth on
  top of the umbrella).
- **Acting admin id** is available in route handlers as `c.get('user').sub`
  (`VerifiedToken`). Pass it into `adjustXp` as `source_id`.
- **`appendXpEvent`** (`d1-gamification-repository.ts`) already does the atomic
  event-insert + `user_xp` sync via `INSERT OR IGNORE` + `ON CONFLICT` upsert.
  Reuse it verbatim for adjustments — never write `user_xp` directly there.
- **`listUserBadges(userId)` already exists** in both the port
  (`i-badge-repository.ts`) and `D1BadgeRepository` — do **not** re-add it. Only
  `revokeBadge` is new.
- **`user_badges`** uses `earned_at` (mapped to `earnedAt` on `UserBadgeRecord`);
  there is no `awarded_at`. The progression badge entries should carry
  `earnedAt`.
- **Level/rank resolution** uses the shared `LevelTable`
  (`@arenaquest/shared/domain/gamification/level-table`), as in
  `me-gamification.controller.ts` (`table.forXp(totalXp)` → `{ definition }`).
  Reuse it; do not re-derive level math.
- **Existing award path** is `AdminBadgesController.awardBadge` /
  `D1BadgeRepository.awardBadge` (`INSERT OR IGNORE` into `user_badges`). The new
  router exposes award at the new path by reusing this repo method.
- **Result/route conventions:** controllers return `ControllerResult<T>`; routes
  use `OpenAPIHono` + `createRoute` + `respondWith(c, result)`; body validation
  via the router `defaultHook` (Zod) as in `badges.ts`. Routes are versioned
  (`v1(...)` in tests). `respondNoContent` exists for 204.
- **Container:** `container.gamification` exposes `{ badgeRepo, gamificationRepo,
  ... }`. Construct the new controller from those.

## Endpoints (new router `apps/api/src/routes/admin/progression.ts`, mounted in `admin/index.ts` at `/players`)

| Method | Path | Handler | Notes |
|---|---|---|---|
| GET | `/players/{userId}/progression` | `get` | XP total + level/rank (LevelTable), badges (join `listUserBadges` × `listAll`), recent XP events |
| POST | `/players/{userId}/badges/{badgeId}` | `awardBadge` | reuse `badgeRepo.awardBadge` |
| DELETE | `/players/{userId}/badges/{badgeId}` | `revokeBadge` | new repo method; 404 when row absent |
| POST | `/players/{userId}/xp-adjustments` | `adjustXp` | `appendXpEvent` with `source_kind='admin_adjustment'`, `source_id=adminId`, fresh `crypto.randomUUID()` idempotency key; clamp via recompute-after if needed |
| POST | `/players/{userId}/xp-recompute` | `recomputeXp` | `recomputeUserXp`; returns `{ previousTotal, newTotal }`; no event appended |

### `PlayerProgression` response shape (controller-local type)

```
{ userId, xp: { totalXp, level, rankTitle },
  badges: { badgeId, slug, name, earnedAt }[],
  recentXpEvents: { id, sourceKind, points, earnedAt }[] }
```

## Repository additions

- **`d1-badge-repository.ts` + `i-badge-repository.ts`:** `revokeBadge(userId,
  badgeId): Promise<boolean>` — `DELETE FROM user_badges WHERE user_id=? AND
  badge_id=?`; return `result.meta.changes > 0` so the controller can map a
  no-op delete to 404.
- **`d1-gamification-repository.ts` + `i-gamification-repository.ts`:**
  - `listRecentXpEvents(userId, limit): Promise<XpEventRecord[]>` — `SELECT * FROM
    xp_events WHERE user_id=? ORDER BY earned_at DESC LIMIT ?`.
  - `recomputeUserXp(userId): Promise<{ previousTotal: number; newTotal: number }>`
    — read current `user_xp.total_xp` (0 if absent), compute
    `newTotal = MAX(0, SUM(xp_events.points))`, upsert `user_xp` to `newTotal`
    (set, not increment), return before/after. Appends no event.

## Clamp policy for `adjustXp`

`appendXpEvent` always records the true delta in the ledger. After appending the
`admin_adjustment` event, if the resulting `user_xp.total_xp` would be negative
(negative adjustment exceeding current total), clamp the **read model** to 0 by
calling `recomputeUserXp` semantics (`MAX(0, SUM(points))`) — the ledger keeps
the true negative delta. Simplest correct implementation: after `appendXpEvent`,
read `getUserXp`; if `< 0`, set `user_xp.total_xp = 0` via the same write
`recomputeUserXp` uses. Document that the ledger sum may be negative while the
cache is clamped at 0 (matches recompute's `MAX(0, …)`).

## Validation

- `XpAdjustmentBodySchema` (Zod): `points: z.number().int()` (may be negative,
  reject 0? — allow any non-zero int; 0 is a no-op but harmless — keep
  `z.number().int()`), `reason: z.string().trim().min(1)`. Missing/empty reason →
  400 via the router `defaultHook`.

## Tests (`apps/api/test/routes/admin-progression.router.spec.ts`)

Follow `admin-levels.router.spec.ts`: `applyMigrations(env.DB)`, sign an
`admin` and a `content_creator` token, `v1(path)` requests. Cover:
- GET progression shape (seed `user_xp`, a badge award, a couple `xp_events`).
- DELETE badge removes row; second read omits it; revoke of absent badge → 404.
- POST adjustment positive then negative: each inserts exactly one
  `admin_adjustment` row with `source_id = admin sub`; `user_xp.total_xp` never < 0.
- Missing/empty `reason` → 400, no ledger row written.
- Recompute after manual drift restores `MAX(0, SUM(points))`, returns
  before/after, appends no new event (assert `xp_events` count unchanged).
- `content_creator` token → 403 on every endpoint.

Optionally add focused adapter tests in `apps/api/test/db/` for `revokeBadge`,
`listRecentXpEvents`, `recomputeUserXp`.

## Verification (parent)

`make lint` → `make test-api` (new spec + the existing gamification specs green).
`git diff --stat` confined to scope-guardrail files.
