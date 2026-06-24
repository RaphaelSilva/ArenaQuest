# Task 02 — Frontend: Player progression admin screen (Phase 2)

**Status:** ✅ Done
**Milestone:** [16 — Player Progression Administration](./milestone.md)
**RFC:** [RFC 0010](../../RFCs/0010-player-progression-administration.md)
**Team:** Frontend Web
**Depends On:** [Task 01](./01-player-progression-admin-api.task.md)

## Summary

Deliver the `/admin/players` screen: an `ADMIN`-gated client page where an
operator searches for a user (reusing the existing `/admin/users` lookup) and,
on select, sees a progression panel — XP total, resolved level/rank, an
earned-badge grid with award (from the catalog) and revoke actions, an
XP-adjustment form (points + a required reason), a "Recompute from ledger"
action that shows the before/after total on completion, and a read-only
recent-XP-events list. Every mutation confirms first; revoke and negative XP
adjustments show an explicit confirmation that surfaces the reason field. The
page consumes the new `progression` namespace on
`apps/web/src/lib/admin-gamification-api.ts` (the backend contract from task 01)
and adds a "Player Progression" card to the `/admin` hub, gated to `ADMIN`. No
backend change — task 01 owns the endpoints.

## Dependencies

- [Task 01](./01-player-progression-admin-api.task.md) — provides the
  progression read, badge revoke, XP-adjustment, and recompute endpoints this
  screen calls. Do not ship ahead of that contract.
- Extends `apps/web/src/lib/admin-gamification-api.ts` (the RFC 0009 catalog
  client) with a `progression` namespace, and reuses the existing `/admin/users`
  lookup client.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/players/page.tsx` — the new screen.
  - `apps/web/src/app/(protected)/admin/page.tsx` — the new "Player Progression"
    hub card (gated to `ADMIN`).
  - `apps/web/src/lib/admin-gamification-api.ts` — extended with the
    `progression` namespace returning the `PlayerProgression` shape (no new
    endpoint — task 01 owns those).
  - The navigation entry point(s) for the screen (the admin sidebar / mobile
    drawer used by the RFC 0009 screens).
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are
    typed) — the new dictionary keys.
  - `apps/web/src/components/**` only if a small shared piece is genuinely
    needed; prefer composing within the page.
- **App Router conventions.** `/admin/players` is a Client Component
  (`'use client'`) for its interactive state; root `<main>` is
  `flex-1 overflow-y-auto` per the protected-layout scroll contract.
- **Role gating.** The screen and the hub card are gated to `ADMIN` only —
  `CONTENT_CREATOR` does not see the card or reach the route (mirrors the
  backend gate).
- **i18n.** No hardcoded user-facing strings under
  `apps/web/src/{app,components,hooks}/**`; labels/messages read from the
  dictionary via `useDict()`; `dict-en.ts` and `dict-pt.ts` keep identical keys;
  `check-i18n-coverage.js` passes.
- **Cloud-agnostic.** No provider SDK; the UI calls the existing client which
  targets `NEXT_PUBLIC_API_URL`.
- **Confirmation UX.** Every mutating action (award, revoke, adjust, recompute)
  confirms before firing; revoke and negative adjustments show an explicit
  confirmation including the reason field. The UI states that revoke does not
  auto-claw back the badge's XP; it may offer a one-click shortcut that pre-fills
  a `−xp_reward` adjustment (still a separate, labeled action).

## Scope

In:
- The `/admin/players` page: user search → progression panel (XP/level/rank,
  badge grid with award + revoke, XP-adjustment form with required reason,
  recompute action with before/after, recent-events list).
- The `progression` namespace on `admin-gamification-api.ts` wiring to task 01's
  endpoints.
- The "Player Progression" hub card and the nav entry point, both `ADMIN`-gated.
- EN + PT dictionary keys for every new string.
- Component test(s) covering render, the search→detail flow, and that a revoke /
  adjustment issues the expected request payload with confirmation.

Out:
- Any backend change — task 01 owns the endpoints and the `PlayerProgression`
  shape.
- Catalog screens (RFC 0009) and streak/quest/mission surfaces — fenced out by
  the milestone guardrail.

## Acceptance Criteria

- [x] `/admin/players` performs user search → progression detail and renders XP
      total, resolved level/rank, earned badges, and recent XP events.
- [x] Award, revoke, XP adjustment, and recompute each work end-to-end against
      the task 01 endpoints, each behind a confirmation; revoke and negative
      adjustments surface the reason in their confirmation; recompute shows the
      before/after total.
- [x] The screen and the "Player Progression" hub card are visible/reachable for
      `ADMIN` and hidden/blocked for `CONTENT_CREATOR`.
- [x] No hardcoded user-facing string; the new keys exist in both `dict-en.ts`
      and `dict-pt.ts`; `check-i18n-coverage.js` passes.
- [x] The surface is responsive and keyboard-usable where interactive; root
      `<main>` is `flex-1 overflow-y-auto`.
- [x] Changed files lint clean; `make test-web` green for the affected component
      tests.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web` + `make dev-api` and open `/admin/players` as an `ADMIN`;
   search a user, confirm the progression panel renders.
2. Exercise award, revoke (incl. the 404 feedback), a positive and a negative XP
   adjustment (confirm the reason is required), and recompute (confirm the
   before/after); verify each confirmation step.
3. Confirm the hub card and route are hidden/blocked for a `CONTENT_CREATOR`.
4. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`; confirm labels translate.
5. `make test-web` — component tests green; run `check-i18n-coverage.js`.
6. Resize to mobile and confirm the panel stays usable.
7. `git diff --stat` confirms only scope-guardrail files changed.
