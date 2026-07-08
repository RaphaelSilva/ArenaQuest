# Plan — Task 05: Quests & levels screens + gamification hub cards

**Task:** [05-quests-and-levels-screens-and-gamification-hub-car.task.md](../05-quests-and-levels-screens-and-gamification-hub-car.task.md)
**Persona:** `frontend-developer`
**Branch:** `feature/m15/05-quests-and-levels-screens-and-gamification-hub-car.task` (stacked on task 04)

## Goal

Complete the catalog admin surface: `/admin/quests` (grouped by kind) and
`/admin/levels` (editable curve grid, ADMIN-only), and wire a "Gamification" card
group into the `/admin` hub. Last task — also lands polish (empty/error states,
active-toggle optimistic UX, i18n parity).

## Current state (verified)

- The client already exposes `client.adminGamification.quests` (list/create/
  update/delete) and `.levels` (list/replaceAll PUT — returns a BARE array, not
  `{ data }`), built in task 04 (`apps/web/src/lib/admin-gamification-api.ts`).
  Do NOT redefine the client.
- The badges/missions pages (task 04) are the shell to mirror: `'use client'`,
  `useHasRole`, `useDict()`, `useApiClient().adminGamification.*`, inline form,
  `flex-1 overflow-y-auto` wrapper, parsed-params preview + current-period help.
- The `/admin` hub (`apps/web/src/app/(protected)/admin/page.tsx`) renders cards
  conditionally on `isAdmin`/`isContentCreator`, each `<Link>` + `<Button>`,
  strings from `dict.admin.dashboard.*`. Add a Gamification group there.
- Quest wire shape: kind('daily'|'weekly'), title, description, predicateKind,
  predicateParams, xpReward, active. Level row: level:int, rankTitle, minXp:int,
  maxXp:int|null.
- i18n under `admin:` in `dict-en.ts`/`dict-pt.ts`; task 04 added
  `admin.badges`/`admin.missions`. Keys must stay identical across the two dicts;
  `apps/web/scripts/check-i18n-coverage.js` enforces no hardcoded strings.

## Approach

1. **`/admin/quests`** — `apps/web/src/app/(protected)/admin/quests/page.tsx`,
   `'use client'`, gated `useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR)`. List
   grouped by `kind` (two sections: daily, weekly). Inline create/edit/delete
   form: kind select, title, description, predicateKind, predicateParams (JSON),
   xpReward (disabled for non-ADMIN — economy gate), active toggle. Parsed-
   `predicateParams` preview (best-effort JSON.parse + inline parse error) and the
   "edits affect the current period" help text. `flex-1 overflow-y-auto` wrapper.
2. **`/admin/levels`** — `apps/web/src/app/(protected)/admin/levels/page.tsx`,
   `'use client'`, gated `useHasRole(ROLES.ADMIN)` ONLY (mirror backend ADMIN-only;
   render an access-denied / nothing for non-admin). Editable grid of the full
   curve (level, rankTitle, minXp, maxXp). Client-side validation BEFORE enabling
   Save: levels contiguous, minXp strictly increasing, each non-final maxXp ===
   next minXp and > minXp, exactly one maxXp === null as the last row. Show the
   validation error inline; Save calls `levels.replaceAll(rows)`. Server remains
   source of truth (surface a server 400 if it still rejects).
3. **Hub cards** — in `apps/web/src/app/(protected)/admin/page.tsx`, add a
   "Gamification" group: cards for Badges, Quests, Missions (gated
   `isAdmin || isContentCreator`) and Levels (gated `isAdmin` only), each linking
   to its page, mirroring the existing card markup. Strings from new dict keys.
4. **i18n** — add `admin.quests`, `admin.levels`, and the hub card strings
   (e.g. under `admin.dashboard` for the new cards, or a `admin.dashboard.gamification`
   sub-group) to BOTH dicts, identical keys.
5. **Polish** — empty states + error states on both new screens; active-toggle
   optimistic update on quests (revert on failure).
6. **Tests** — component tests for both pages: quests renders grouped + create
   payload + xpReward disabled for non-admin; levels renders the grid, blocks Save
   on an invalid curve, and issues `replaceAll` with the rows on a valid one;
   non-admin is denied `/admin/levels`. Mock `useApiClient`/`useHasRole`.

## Files in scope

- `apps/web/src/app/(protected)/admin/quests/page.tsx` (new)
- `apps/web/src/app/(protected)/admin/levels/page.tsx` (new)
- `apps/web/src/app/(protected)/admin/page.tsx` (hub cards)
- `apps/web/src/components/**`, `apps/web/src/hooks/**` (grid/list pieces if needed)
- `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts`
- web test files for the two pages

## Out of scope

- Any `apps/api` / `packages` change. The client (`admin-gamification-api.ts`)
  is already built — only CALL it, do not modify it (unless a missing method is
  discovered, in which case note it; none expected).
- badges/missions pages — task 04.

## Verification

- `make lint`; `make test-web`; `node apps/web/scripts/check-i18n-coverage.js`.
- `make dev-web` + `make dev-api` walkthrough: quests grouped list + create;
  levels grid save + invalid-curve block; hub shows the Gamification cards for an
  admin and links to all four pages.
- `git diff --stat` — only scope files; nothing under `apps/api`/`packages`.
