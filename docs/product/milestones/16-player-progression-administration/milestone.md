# Milestone 16 — Player Progression Administration

**Status:** 📝 Draft
**Scope:** `apps/api` admin endpoints for per-user gamification records (`user_xp` via the `xp_events` ledger, `user_badges`), `apps/web` `/admin/players` progression screen and its typed client extension, plus EN/PT dictionaries. Derived from [RFC 0010](../../RFCs/0010-player-progression-administration.md).

> **Hard scope guardrail — read before opening any task.** This milestone may
> touch only: on the API, the new
> `apps/api/src/controllers/admin-progression.controller.ts`, the new
> `apps/api/src/routes/admin/progression.ts`, the admin mount in
> `apps/api/src/routes/admin/index.ts`, revoke/list extensions to
> `apps/api/src/adapters/db/d1-badge-repository.ts`
> (`listUserBadges`, `revokeBadge`) and read/recompute extensions to
> `apps/api/src/adapters/db/d1-gamification-repository.ts`
> (`listRecentXpEvents`, `recomputeUserXp` — the XP write reuses the existing
> `appendXpEvent`), plus their Vitest specs; on the web, the new
> `apps/web/src/app/(protected)/admin/players/page.tsx`, a new hub card in
> `apps/web/src/app/(protected)/admin/page.tsx`, the new `progression`
> namespace in `apps/web/src/lib/admin-gamification-api.ts`, the navigation
> entry point(s) for the screen, and `apps/web/src/i18n/dict-en.ts` +
> `dict-pt.ts`. It is **not** an opportunity to: manage the reward *catalog*
> (badge/quest/mission/level definitions) — that is RFC 0009; edit
> `user_streak`, `quest_progress`, or `mission_progress` (deferred to a future
> RFC); add bulk/cohort award operations; build a bulk or scheduled `user_xp`
> reconciliation cron (only the **single-user** recompute action is in scope);
> or write `user_xp` directly bypassing the `xp_events` ledger. If a refactor
> opportunity is spotted outside this scope, file a separate task — do not
> bundle it.

---

## 1. Objectives

- **Backend per-user progression read.** New
  `GET /admin/players/{userId}/progression` returning total XP, resolved
  level/rank, earned badges, and recent XP events — the single read powering the
  screen.
- **Badge award + revoke for a user.** Reuse the existing `awardBadge` path via
  `POST /admin/players/{userId}/badges/{badgeId}`; add the missing
  `DELETE /admin/players/{userId}/badges/{badgeId}` which deletes the
  `user_badges` row and returns `404` when the user never had it.
- **Ledger-backed XP adjustment.** New
  `POST /admin/players/{userId}/xp-adjustments` writes an `xp_events` row with
  `source_kind = 'admin_adjustment'`, `source_id = <admin user id>`, a fresh
  UUID `idempotency_key`, and a mandatory reason; the existing atomic sync
  updates `user_xp`, clamped at 0. `user_xp` is never written directly.
- **Single-user recompute.** New
  `POST /admin/players/{userId}/xp-recompute` rewrites `user_xp.total_xp` to
  `MAX(0, SUM(xp_events.points))` to repair cache drift — read-only over the
  ledger, appends no event, returns before/after.
- **`/admin/players` screen.** A client page: user search (reusing the
  `/admin/users` lookup) → progression panel with badge grid (award/revoke), an
  XP-adjustment form (points + required reason), a "Recompute from ledger"
  action showing before/after, and a read-only recent-events list — a
  `flex-1 overflow-y-auto` scroll region per the protected-layout contract.
- **Progression client namespace + hub card.** Extend
  `apps/web/src/lib/admin-gamification-api.ts` with a `progression` namespace
  returning the `PlayerProgression` shape; add a "Player Progression" hub card.
- **Full EN+PT i18n coverage.** Identical keys across `dict-en.ts` and
  `dict-pt.ts`, with `check-i18n-coverage.js` green.

Out of scope (explicit, from RFC 0010 Non-Goals):
- **Reward catalog management** (badge/quest/mission/level *definitions*) —
  covered by RFC 0009; this milestone mutates earned player records only.
- **Streak / quest / mission progress editing** (`user_streak`,
  `quest_progress`, `mission_progress`) — deferred to a future RFC; their
  period-key and recompute edge cases warrant their own pass.
- **Bulk / cohort operations** (award to a group) — single-user only here; a
  later RFC if needed.
- **Bulk or scheduled `user_xp` reconciliation** across all users — a separate
  ops concern; only the single-user recompute action is in scope.

---

## 2. Functional Requirements

- `GET /admin/players/{userId}/progression` returns
  `{ userId, xp: { totalXp, level, rankTitle }, badges[], recentXpEvents[] }`,
  resolving level/rank from the level definitions and listing earned badges and
  the most recent XP events for that user.
- `POST /admin/players/{userId}/badges/{badgeId}` awards a badge to the user
  (reusing the existing award path); `DELETE` of the same path revokes it,
  deleting the `user_badges` row and returning `404 NotFound` when the user does
  not currently hold that badge.
- `POST /admin/players/{userId}/xp-adjustments` accepts
  `{ points: number (may be negative), reason: string (required, non-empty) }`,
  appends an `xp_events` row tagged `admin_adjustment` with the acting admin's id
  as `source_id` and a fresh UUID idempotency key, then reflects the delta in
  `user_xp` with `total_xp` clamped at 0. A missing/empty reason is rejected
  `400 BadRequest`.
- Revoking a badge does **not** auto-claw back its `xp_reward`; any XP removal is
  a separate, explicit `admin_adjustment` (the UI may pre-fill a `−xp_reward`
  adjustment, still written as a distinct ledger event).
- `POST /admin/players/{userId}/xp-recompute` rewrites `user_xp.total_xp` to
  `MAX(0, SUM(xp_events.points))`, appends no ledger event, and returns
  `{ previousTotal, newTotal }`.
- All new endpoints sit under the existing `authGuard` and are gated to `ADMIN`
  only (stricter than the RFC 0009 catalog screens); `CONTENT_CREATOR` does not
  get access to per-user reward mutation.
- `/admin/players` lets an admin search for a user, then view XP total / level /
  rank, the earned-badge grid, recent XP events, and perform award, revoke, XP
  adjustment, and recompute — with confirmation before every mutation; revoke
  and negative adjustments show an explicit confirmation including the reason
  field.
- The `/admin` hub shows a "Player Progression" card gated to `ADMIN`; both i18n
  dictionaries carry identical keys for every new string.

---

## 3. Acceptance Criteria

- [ ] `GET /admin/players/{userId}/progression` returns the documented
      `PlayerProgression` shape with correct total XP, resolved level/rank,
      earned badges, and recent XP events for a seeded user.
- [ ] `DELETE /admin/players/{userId}/badges/{badgeId}` removes the
      `user_badges` row and a subsequent progression read omits it; revoking a
      badge the user never had returns `404`.
- [ ] `POST /admin/players/{userId}/xp-adjustments` with a positive and a
      negative `points` each inserts exactly one `xp_events` row with
      `source_kind = 'admin_adjustment'` and the admin id as `source_id`, and
      `user_xp.total_xp` reflects the new total — never below 0.
- [ ] A missing or empty `reason` on an XP adjustment is rejected
      `400 BadRequest` and writes no ledger row.
- [ ] After artificially drifting `user_xp.total_xp`,
      `POST /admin/players/{userId}/xp-recompute` restores it to
      `MAX(0, SUM(xp_events.points))`, returns the before/after, and appends no
      new `xp_events` row.
- [ ] All new endpoints reject non-`ADMIN` callers (including
      `CONTENT_CREATOR`).
- [ ] `/admin/players` performs user search → progression detail and drives
      award / revoke / adjust / recompute end-to-end, each behind a confirmation;
      negative adjustments and revoke surface the reason in their confirmation.
- [ ] `check-i18n-coverage.js` is green and `dict-en.ts` / `dict-pt.ts` keys
      match.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] No diff outside the files named in the scope guardrail.

---

## 4. Specific Stack

- **Backend:** Cloudflare Workers + Hono; per-request adapters in `buildApp(env)`;
  `admin-progression.controller.ts` returns `ControllerResult<T>`; XP-adjust body
  validated via `@ValidateBody` / `@Body`; XP writes go through the existing
  `appendXpEvent` (atomic event-insert + `user_xp` sync), never a standalone
  `user_xp` write.
- **Shared:** the `PlayerProgression` response shape (and any reused
  `Entities.Gamification` types — `UserXp`, `LevelDefinition`, badge records);
  no new entity tables.
- **Frontend:** Next.js 15 App Router, React 19, Tailwind CSS v4;
  `/admin/players` is a client component using `useDict()`; reuses the
  `/admin/users` lookup; calls the new `progression` namespace on
  `admin-gamification-api.ts`; both i18n dictionaries; `check-i18n-coverage.js`.
- **Tests:** Vitest + `@cloudflare/vitest-pool-workers` (API), covering the
  negative-clamp, revoke-404, recompute before/after, and role-gate cases;
  Vitest + RTL (web) as the existing admin screens are tested.

---

## 5. Task Breakdown

The execution plan. Backend and frontend are split into distinct tasks; the
frontend task depends on its backend contract.

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Player progression admin API](./01-player-progression-admin-api.task.md) | 1 | Backend | ✅ Done |
| 02 | [Player progression admin screen](./02-player-progression-admin-screen.task.md) | 2 | Frontend | ✅ Done |

Dependency graph:

```
01 (backend progression API)
      │
      ▼
02 (frontend /admin/players)
```

**Recommended execution order:** `01` → `02`.

Each task is intended to land as an independent PR with `make lint`,
`make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC 0010 "Resolved Decisions")

1. **XP adjustments go through the `xp_events` ledger, not direct `user_xp`
   writes** — preserves the append-only audit trail and idempotency invariant
   the schema was designed around; `user_xp` is updated only via the existing
   atomic sync.
2. **Single-user "Recompute from ledger" is in scope; bulk/scheduled
   reconciliation is not** — `POST .../xp-recompute` rewrites
   `user_xp.total_xp` to `MAX(0, SUM(xp_events.points))`, read-only over the
   ledger, appends no event, same clamp-at-0 policy as adjustments. Cross-user
   reconciliation stays a separate ops concern.
3. **Badge revoke removes the `user_badges` row only; it does not auto-claw back
   the badge's `xp_reward`** — removing the XP is a separate, explicit
   `admin_adjustment` so each ledger row keeps a single auditable cause and the
   "reward changed since earned" ambiguity is avoided. A one-click UI shortcut
   may pre-fill a `−xp_reward` adjustment, but it is still a distinct, labeled
   ledger event (two events, not one mixed action).
4. **`/admin/players` is restricted to `ADMIN` only** — `CONTENT_CREATOR` does
   not get access to per-user reward mutation (stricter than the RFC 0009
   catalog gate).
5. **Negative adjustments are permitted but clamp `user_xp.total_xp` at 0** —
   the ledger keeps the true delta while the read model never goes negative.

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC 0010 status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items remain backlog.
- [ ] No diff outside the scope declared in the guardrail.
