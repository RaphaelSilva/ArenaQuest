# RFC 0010: Player Progression Administration

**Date:** 2026-06-23
**Status:** Implemented
**Author:** raphaelsilva
**Affected:**
- `apps/web/src/app/(protected)/admin/players/page.tsx` (new — player progression UI)
- `apps/web/src/app/(protected)/admin/page.tsx` (new hub card)
- `apps/api/src/controllers/admin-progression.controller.ts` (new — per-user XP & badge admin)
- `apps/api/src/routes/admin/progression.ts` (new router)
- `apps/api/src/routes/admin/index.ts` (mount the new router)
- `apps/api/src/adapters/db/d1-gamification-repository.ts` (XP adjustment via xp_events)
- `apps/api/src/adapters/db/d1-badge-repository.ts` (revoke / list user badges)
- `apps/web/src/lib/admin-gamification-api.ts` (extend with progression namespace)
- `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts` (new strings)

---

## Summary

Add an admin screen under `/admin` to inspect and adjust an individual user's
**gamification records** — their accumulated XP (`user_xp`) and earned badges
(`user_badges`). Admins can look up a player, view total XP / current level /
awarded badges, **award or revoke** a badge, and **apply a manual XP
adjustment**. Critically, XP adjustments are written as `xp_events` rows (the
existing append-only ledger) rather than by mutating `user_xp` directly, so the
audit trail and idempotency invariant are preserved. This complements RFC 0009,
which manages the reward *catalog*; this RFC manages per-user *records*.

## Motivation

The reward catalog (RFC 0009) defines what badges and XP exist; operators still
need to correct individual player state: grant a badge that an automated rule
missed, revoke one awarded in error, or compensate XP after an incident. Today
none of this is possible without raw D1 queries.

| Case | Covered by this RFC? |
|---|---|
| Look up a user and see XP, level, and earned badges | ✅ |
| Award a specific badge to a user | ✅ (UI over existing `awardBadge` API) |
| Revoke a badge previously awarded to a user | ✅ (new API + UI) |
| Apply a manual +/− XP adjustment with a reason | ✅ (new API + UI) |
| View a user's XP event history | ✅ (read-only ledger) |
| Define new badges / quests / levels | ❌ → RFC 0009 |
| Edit streak counters directly | ❌ (deferred; see Non-Goals) |

## Goals & Non-Goals

**Goals**
- A `/admin/players` screen: user search → progression detail (XP total, level,
  badges, recent XP events), gated to `ADMIN` (see Open Questions on role).
- Award and **revoke** badges for a user; **adjust** a user's XP through the
  `xp_events` ledger with a mandatory reason.
- **Recompute** a single user's `user_xp` from the `xp_events` ledger to repair
  cache drift, applying the same clamp-at-0 policy as adjustments.
- Reuse the existing `awardBadge` endpoint; add the missing revoke and
  XP-adjust endpoints and a read endpoint for per-user progression.
- Full i18n coverage (EN + PT) with identical keys.

**Non-Goals**
- Managing the reward catalog (badges/quests/missions/levels definitions) —
  RFC 0009.
- Direct edits to `user_streak`, `quest_progress`, or `mission_progress`.
  Streak/quest correction is deferred to a future iteration; this RFC covers the
  two entities the request named (`user_xp`, `user_badges`).
- Bulk operations (award to a cohort/group). Single-user only here; bulk is a
  later RFC if needed.
- **Bulk / scheduled** `user_xp` reconciliation across all users (a cron/ops
  job) — separate operational concern. (Note: a **single-user** recompute action
  **is** in scope — see Proposed Design §1.)

## Current State (for reference)

- **XP is a ledger + read model.** `xp_events`
  (`migrations/0014_create_xp_events.sql`) is append-only with a unique index
  on `(user_id, source_kind, idempotency_key)` to prevent double-crediting;
  `user_xp` (`0015_create_user_xp.sql`) is a denormalized total "kept in sync
  atomically when an `xp_events` row is successfully inserted."
- **Badges.** `user_badges` (`0020_create_badges.sql`) has
  `UNIQUE(user_id, badge_id)`. `AdminBadgesController.awardBadge(userId, badgeId)`
  exists and is exposed at `POST /admin/badges/{badgeId}/award/{userId}`
  (`apps/api/src/routes/admin/badges.ts`). There is **no** revoke endpoint.
- **Repository surface.** `D1GamificationRepository`
  (`apps/api/src/adapters/db/d1-gamification-repository.ts`) has
  `appendXpEvent`, `getUserXp`, `getUserStreak`, `listLevelDefinitions`,
  `getUserRank`. `d1-badge-repository.ts` handles badge records and awards.
- **Frontend.** No per-user gamification view exists; `/admin` has no players
  card. User lookup already exists in `admin-users.controller.ts` /
  `/admin/users`.

## Proposed Design

### 1. Backend — `admin-progression` controller + router

New `apps/api/src/routes/admin/progression.ts` and
`admin-progression.controller.ts`, mounted under the admin umbrella
(`authGuard` + `requireRole`):

| Method | Path | Controller | Notes |
|---|---|---|---|
| GET | `/admin/players/{userId}/progression` | `get(userId)` | XP total, resolved level/rank, badges, recent XP events |
| POST | `/admin/players/{userId}/badges/{badgeId}` | `awardBadge(userId, badgeId)` | reuse existing award path |
| DELETE | `/admin/players/{userId}/badges/{badgeId}` | `revokeBadge(userId, badgeId)` | new |
| POST | `/admin/players/{userId}/xp-adjustments` | `adjustXp(userId, body)` | new — ledger write |
| POST | `/admin/players/{userId}/xp-recompute` | `recomputeXp(userId)` | new — repair cache from ledger |

`GET .../progression` returns:

```ts
interface PlayerProgression {
  userId: string;
  xp: { totalXp: number; level: number; rankTitle: string };
  badges: { badgeId: string; slug: string; name: string; earnedAt: string }[];
  recentXpEvents: { id: string; sourceKind: string; points: number; earnedAt: string }[];
}
```

**XP adjustment goes through the ledger.** `adjustXp` body:
`{ points: number /* may be negative */, reason: string /* required */ }`.
The controller calls `appendXpEvent` with `source_kind = 'admin_adjustment'`,
`source_id = <admin user id>`, and a fresh UUID `idempotency_key`, then the
existing atomic sync updates `user_xp`. We never write `user_xp` directly — that
preserves the audit invariant the schema was designed around. A negative
adjustment is permitted but the controller clamps the resulting `total_xp` at 0.

**Revoke** deletes the `user_badges` row for `(userId, badgeId)`; returns
`404 NotFound` if the user did not have it. Revoking does **not** automatically
claw back any `xp_reward` the badge granted — that is a separate explicit XP
adjustment (documented in the UI), to keep the two operations auditable and
independent.

**Recompute** repairs a drifted `user_xp` cache from the ledger (single user):

```ts
// total_xp = MAX(0, SUM(xp_events.points)) — same clamp policy as adjustXp,
// so a recompute never reintroduces a negative total the adjust path forbids.
async recomputeXp(userId): Promise<ControllerResult<{ previousTotal: number; newTotal: number }>>
```

It is read-only over `xp_events` and rewrites only the `user_xp` row — it does
**not** append a ledger event (recompute repairs the read model; it is not an
economy change). The controller returns the before/after so the operator sees
what changed. Bulk/scheduled reconciliation across all users stays out of scope
(see Non-Goals).

Repository additions:
- `d1-badge-repository.ts`: `listUserBadges(userId)`, `revokeBadge(userId, badgeId)`.
- `d1-gamification-repository.ts`: `listRecentXpEvents(userId, limit)` (the
  ledger write reuses `appendXpEvent`); `recomputeUserXp(userId)` —
  `SUM(points)` clamped at 0, written to `user_xp`.

### 2. Frontend — `/admin/players`

A client component: a user search box (reusing the `/admin/users` lookup) →
on select, a progression panel showing XP/level, a badge grid with award (from
catalog) and revoke actions, an XP-adjustment form (points + required reason),
a "Recompute from ledger" action (shows before/after on completion), and a
read-only recent-events list. Root `<main>` is `flex-1 overflow-y-auto`
per the protected-layout scroll contract (consistent with the dashboard scroll
fix). All actions confirm before mutating; revoke and negative XP adjustments
show an explicit confirmation with the reason field.

### 3. Hub + client

`/admin` gains a "Player Progression" card (gated to `ADMIN`). The progression
namespace is added to `admin-gamification-api.ts` (shared with RFC 0009's
catalog client), returning the `PlayerProgression` shape above.

## Alternatives Considered

1. **Mutate `user_xp.total_xp` directly for adjustments.** Rejected — bypasses
   the append-only `xp_events` ledger that exists specifically to make XP
   auditable and idempotent (`migrations/0014`/`0015` comments). Going through
   `appendXpEvent` keeps history and reuses the atomic sync.

2. **Auto-revoke the badge's XP on badge revoke (and vice-versa).** Rejected for
   v1 — coupling the two makes the audit trail ambiguous (was XP removed by the
   badge or by an operator?) and the badge's `xp_reward` may have changed since
   it was earned. Keep badge revoke and XP adjustment as separate, explicit,
   independently-logged actions.

3. **Fold per-user management into RFC 0009's catalog screens.** Rejected —
   different audience workflow (find a player vs. edit a definition) and higher
   blast radius (mutating earned state). Separate screen, separate RFC, and the
   stricter `ADMIN`-only gate can apply here.

4. **Include streak / quest-progress editing now.** Deferred — the request
   named `user_xp` and `user_badges`; streak and per-period progress correction
   have their own edge cases (period keys, recompute) and warrant their own
   pass.

## Implementation Plan

Total: ~3 dev days. Depends on RFC 0009 Phase 2 only for the shared
`admin-gamification-api.ts` scaffold and shared types; otherwise independent.

### Phase 1 — Backend progression API (~1.5d)
`admin-progression` controller + router; repository methods (`listUserBadges`,
`revokeBadge`, `listRecentXpEvents`); `adjustXp` via `appendXpEvent` with
`admin_adjustment` source; Vitest coverage incl. negative-clamp and revoke-404.

### Phase 2 — `/admin/players` screen (~1d)
User search → progression panel; award/revoke/adjust actions with confirmation;
recent-events list; hub card; i18n keys.

### Phase 3 — Polish (~0.5d)
`check-i18n-coverage.js` green; optimistic updates; empty/error states; reason
field validation.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| Manual XP adjustment abused or mis-entered, skewing leaderboards | Mandatory reason; ledger row tagged `admin_adjustment` with admin id as `source_id` for audit; gate to `ADMIN` only |
| Revoking a badge leaves "orphaned" XP from its reward | UI states that XP is not auto-clawed; operator applies an explicit XP adjustment if desired — both logged independently |
| Negative adjustment drives `total_xp` below 0 | Controller clamps `user_xp.total_xp` at 0 while the ledger keeps the true delta |
| Direct ledger writes diverge from `user_xp` if sync path is bypassed | Reuse `appendXpEvent`'s existing atomic event-insert + `user_xp` update; never write `user_xp` standalone; single-user **recompute** action repairs drift from the ledger |
| Recompute reintroduces a negative total the clamp policy forbids | Recompute applies `MAX(0, SUM(points))`, the same clamp as `adjustXp` |
| `CONTENT_CREATOR` granting/removing earned rewards | Default-gate this screen to `ADMIN` only (stricter than catalog), pending Open Question |

## Success Criteria

- An admin can search a user and see total XP, resolved level/rank, earned
  badges, and recent XP events from `/admin/players`.
- Award, revoke, and a signed XP adjustment all work end-to-end; every XP
  adjustment appears as an `admin_adjustment` row in `xp_events` and is
  reflected in `user_xp`.
- Revoking a badge the user lacks returns `404`; a negative adjustment never
  produces a negative `user_xp.total_xp`.
- After artificially drifting a user's `user_xp.total_xp`, recompute restores it
  to `MAX(0, SUM(xp_events.points))` and returns the before/after — without
  appending a ledger event.
- `make lint`, `make test`, and `check-i18n-coverage.js` pass; EN/PT keys match.

## Open Questions

- _None outstanding._

## Resolved Decisions

- **2026-06-23 (raphaelsilva)** — Expose a **single-user** "Recompute from
  ledger" action on `/admin/players` (`POST .../xp-recompute`) that rewrites
  `user_xp.total_xp` to `MAX(0, SUM(xp_events.points))` — read-only over the
  ledger, no new event appended, same clamp-at-0 policy as adjustments. Bulk /
  scheduled reconciliation across all users remains a separate ops concern, out
  of scope here.

- **2026-06-23 (product)** — Badge revoke removes the `user_badges` row **only**;
  it does **not** auto-claw back the badge's `xp_reward`. To remove the XP too,
  the admin makes a separate, explicit manual adjustment, so each `xp_events`
  row keeps a single, auditable cause and the "reward amount changed since
  earned" ambiguity is avoided. The UI **may** offer a one-click convenience
  shortcut that pre-fills a `−xp_reward` adjustment, but it is still written as a
  distinct, labeled `admin_adjustment` ledger event (two events, not one mixed
  action). This mirrors RFC 0009's "age out, don't retroactively reverse"
  stance — no silent retroactive clawback.
- **2026-06-23 (raphaelsilva)** — `/admin/players` is restricted to `ADMIN`
  only; `CONTENT_CREATOR` does not get access to per-user reward mutation.

## References

- Migrations: `apps/api/migrations/0014_create_xp_events.sql`,
  `0015_create_user_xp.sql`, `0020_create_badges.sql`
- Repository: `apps/api/src/adapters/db/d1-gamification-repository.ts`
  (`appendXpEvent`, `getUserXp`), `apps/api/src/adapters/db/d1-badge-repository.ts`
- Existing award path: `apps/api/src/controllers/admin-badges.controller.ts`
  (`awardBadge`), `apps/api/src/routes/admin/badges.ts`
- Shared types: `packages/shared/types/entities.ts:206` (`Gamification` —
  `UserXp`, `LevelDefinition`)
- Related RFCs: RFC 0009 (Gamification Catalog Administration — definitions),
  RFC 0008 (User Dashboard — surfaces the same XP/badge data to participants)
