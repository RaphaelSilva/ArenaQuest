# Plan — Task 02: Player progression admin screen

**Task:** [02-player-progression-admin-screen.task.md](../02-player-progression-admin-screen.task.md)
**Persona:** `frontend-developer` (apps/web only)
**Branch:** `feature/m16/02-player-progression-admin-screen.task` (cut from task 01 HEAD)
**Depends on:** Task 01 (backend contract already merged into this stacked branch).

## Backend contract (from task 01, this branch) — exact response shapes

All paths are versioned by the api-client transport (no `/api/v1` prefix needed
in the client call; mirror the existing namespaces which pass `/admin/...`).

- `GET /admin/players/{userId}/progression` → **bare** `PlayerProgression`
  (no `{ data }` envelope; `respondWith` returns the data directly):
  ```
  { userId, xp: { totalXp, level, rankTitle },
    badges: { badgeId, slug, name, earnedAt }[],
    recentXpEvents: { id, sourceKind, points, earnedAt }[] }
  ```
- `POST /admin/players/{userId}/badges/{badgeId}` → **bare** `UserBadgeRecord`
  (`{ id, userId, badgeId, earnedAt }`), 200.
- `DELETE /admin/players/{userId}/badges/{badgeId}` → **204** on success, **404**
  (`{ error: 'NotFound' }`) when the user lacks the badge.
- `POST /admin/players/{userId}/xp-adjustments` body
  `{ points: number, reason: string }` → **bare** `{ previousTotal, newTotal }`;
  **400** `{ error: 'ValidationError', issues }` on missing/empty reason.
- `POST /admin/players/{userId}/xp-recompute` → **bare**
  `{ previousTotal, newTotal }`.

## Client — extend `apps/web/src/lib/admin-gamification-api.ts`

Add a `progression` namespace to the object returned by
`createAdminGamificationApi(http)` (the api-client getter `adminGamification`
already exposes it; no `api-client.ts` change needed). Add wire types
`PlayerProgression`, `ProgressionBadge`, `RecentXpEvent`, `XpAdjustmentResult`.
Methods (reuse the existing `rejectWith` + `AdminGamificationApiError`):
- `get(userId): Promise<PlayerProgression>` — GET, bare body.
- `awardBadge(userId, badgeId): Promise<void>` — POST (ignore returned record or
  type it; the screen reloads progression after).
- `revokeBadge(userId, badgeId): Promise<void>` — DELETE; on `!res.ok` call
  `rejectWith` (404 surfaces as `AdminGamificationApiError` with status 404 so
  the UI can show a "user didn't have it" message).
- `adjustXp(userId, { points, reason }): Promise<XpAdjustmentResult>` — POST.
- `recomputeXp(userId): Promise<XpAdjustmentResult>` — POST.

Use the **badges catalog** (`client.adminGamification.badges.list()`) to render
the award picker (badge name + emoji), as the progression payload only carries
earned badges.

User search reuses `client.adminUsers.list(page, pageSize)`
(`createAdminUsersApi`) — there is no dedicated search endpoint; filter
client-side by name/email over the paged list (same approach the users screen
uses), or page through. Keep it simple: list + a client-side filter input.

## Screen — `apps/web/src/app/(protected)/admin/players/page.tsx`

`'use client'` component, following `admin/badges/page.tsx` conventions:
- Imports: `useApiClient` (`@web/context/auth-context`), `useDict`
  (`@web/context/dict-context`), `useAuth` + `useHasRole`
  (`@web/hooks/use-auth`), `useRouter`, design-system `Button`, `Input`,
  `Badge`, `Spinner`.
- **Role gate (ADMIN only):** `const isAdmin = useHasRole(ROLES.ADMIN)`. In a
  `useEffect`, if `!authLoading && !isAdmin` → `router.replace('/dashboard')`.
- **Root layout:** the admin `layout.tsx` `<main>` is
  `flex flex-1 flex-col overflow-hidden`; the page root must be
  `flex-1 overflow-y-auto` (scroll region) with `p-6 md:p-8` padding.
- **Sections:**
  1. **User search** — `Input` filter + a result list (reuse adminUsers.list);
     selecting a user loads their progression.
  2. **Progression panel** — XP total, level, rankTitle; badge grid (earned
     badges with revoke action; an "award" control listing catalog badges not
     yet earned); XP-adjustment form (`points` number incl. negative, required
     `reason` textarea); "Recompute from ledger" button showing
     `previousTotal → newTotal` on completion; read-only recent-events list.
- **Confirmation before every mutation.** No shared modal component exists
  (`ResetPasswordModal` is a one-off); implement a lightweight inline
  confirmation (a confirm panel/state, or `window.confirm` with **dict** strings
  — never hardcoded). Revoke and **negative** XP adjustments must surface the
  reason in the confirmation copy. State in the UI that revoke does **not**
  auto-claw back the badge's XP (and optionally offer a one-click shortcut that
  pre-fills a `-xpReward` adjustment as a separate labeled action).
- Optimistic-ish flow: after each mutation, reload progression; show
  success/error feedback (reuse the error/`Spinner` patterns from badges page).

## Hub card — `apps/web/src/app/(protected)/admin/page.tsx`

Add a "Player Progression" card. Place it in the existing user-management /
admin-only grid (top grid, gated by `isAdmin`) OR add to gamification group but
gate with `isAdmin` only. Recommended: add to the top `isAdmin` grid next to
"User Management" linking to `/admin/players`. Use new dict keys
`admin.dashboard.playersTitle/playersDesc/playersButton`.

## Navigation entry point

Add the screen to the admin sidebar / mobile drawer used by the other admin
screens (the RFC 0009 screens registered links in
`apps/web/src/components/layout/admin-sidebar.tsx` + `nav.tsx`). Gate the entry
to `ADMIN` only. Confirm the exact files/role-gating helper by reading those
components; match their pattern.

## i18n — `dict-en.ts` + `dict-pt.ts` (identical keys)

Add an `admin.players` section (search placeholder, panel labels: total XP,
level, rank, badges, award, revoke, adjust points, reason, recompute,
before/after, recent events, empty/error states, confirmation copy incl. the
"XP not auto-clawed" note) and the three `admin.dashboard.players*` card keys.
Keep EN and PT key sets identical; run `check-i18n-coverage.js`.

## Tests — `apps/web/src/app/(protected)/admin/players/__tests__/`

Follow `admin/badges/__tests__` / `__tests__/app/admin/users.test.tsx`:
- Renders the search; selecting a user renders the progression panel from a
  mocked `adminGamification.progression.get`.
- A revoke action triggers confirmation then calls
  `progression.revokeBadge` with the right ids.
- An XP adjustment with empty reason is blocked client-side (or surfaces the
  400) and a valid one calls `adjustXp` with `{ points, reason }`.
- (Optional) non-admin redirect.

## Verification (parent)

`make lint` → `make test-web` → `check-i18n-coverage.js` green. Browser
walkthrough via `/run` or `/verify` on `make dev-web` (+ `make dev-api`): search
→ panel → award/revoke/adjust/recompute, and PT/EN toggle. `git diff --stat`
confined to `apps/web/**` scope-guardrail files (no `apps/api/src/` changes).
