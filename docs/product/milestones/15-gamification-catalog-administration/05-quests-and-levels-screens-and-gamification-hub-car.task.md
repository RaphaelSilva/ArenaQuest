# Task 05 — Frontend: Quests and levels screens and gamification hub cards (Phase 3)

**Status:** ✅ Done
**Milestone:** [15 — Gamification Catalog Administration](./milestone.md)
**RFC:** [RFC 0009](../../RFCs/0009-gamification-catalog-administration.md)
**Team:** Frontend Web
**Depends On:** [Task 04](./04-gamification-web-client-and-badges-and-missions-sc.task.md)

## Summary

Complete the catalog admin surface with the two screens that sit on the new
backend APIs and wire the whole group into the `/admin` hub. `/admin/quests`
lists quest definitions grouped by `kind` (daily/weekly) with a create/edit form
matching the task-02 contract (`kind`, `title`, `description`, `predicateKind`,
`predicateParams` as validated JSON, `xpReward`, `active`). `/admin/levels` is an
editable grid of the full curve (level, rankTitle, minXp, maxXp) with client-side
monotonicity validation, saved via the task-03 `PUT` endpoint; the whole levels
screen is `ADMIN`-gated. Both consume the `quests`/`levels` namespaces of the
client built in task 04 and follow the same admin pattern (`useHasRole` gate,
`useDict()`, `flex-1 overflow-y-auto` root). Finally, the `/admin` hub gains a
"Gamification" group of cards linking to all four pages, visible only to
`ADMIN || CONTENT_CREATOR`. This is the last task; it also lands the polish
(empty/error states, active-toggle optimistic UX, i18n parity).

## Dependencies

- [Task 04](./04-gamification-web-client-and-badges-and-missions-sc.task.md) —
  hard dependency: reuses the `admin-gamification-api.ts` client (its `quests`
  and `levels` namespaces) and the shared catalog list/form pattern.
- Transitively depends on the task-02 quests API and the task-03 levels API the
  client calls.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/quests/page.tsx` and
    `apps/web/src/app/(protected)/admin/levels/page.tsx` — the two new screens.
  - `apps/web/src/app/(protected)/admin/page.tsx` — add the "Gamification" card
    group linking to all four catalog pages.
  - `apps/web/src/components/**` and `apps/web/src/hooks/**` — the quests-by-kind
    list, the levels grid editor, and any shared pieces these screens introduce.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are
    typed) — the new dictionary keys for these screens and the hub group.
- **No client-file ownership conflict.** This task only *calls* the `quests`/
  `levels` namespaces of `admin-gamification-api.ts` (built in task 04); it does
  not redefine the client.
- **App Router conventions.** Client components only where the grid/form state
  requires it; root `<main>` is `flex-1 overflow-y-auto`.
- **Role gate.** `/admin/quests` gates on `ADMIN || CONTENT_CREATOR` with
  `xpReward` editable only by `ADMIN`; `/admin/levels` is `ADMIN`-only end to
  end; the hub card group is visible only to `ADMIN || CONTENT_CREATOR`.
- **Client-side curve validation.** The levels grid validates strict `minXp`
  monotonicity, no gaps, and exactly one open-ended final row before enabling
  save, mirroring the server invariant (the server remains the source of truth).
- **i18n.** No hardcoded user-facing strings under
  `apps/web/src/{app,components,hooks}/**`; `dict-en.ts`/`dict-pt.ts` keep
  identical keys; `check-i18n-coverage.js` must pass.
- **Help text.** Each screen surfaces the "edits affect the current period"
  warning and previews the parsed `predicateParams` value before save.

## Scope

In:
- `/admin/quests` screen: list grouped by `kind` + create/edit form per the
  task-02 contract, with the parsed-`predicateParams` preview.
- `/admin/levels` screen: editable curve grid with client-side monotonicity
  validation, saved via the `PUT` endpoint; `ADMIN`-gated.
- `/admin` hub "Gamification" card group linking to badges/quests/missions/levels,
  gated to `ADMIN || CONTENT_CREATOR`.
- Empty/error states, active-toggle optimistic UX, the new EN+PT dictionary keys,
  and component tests covering render and the request payload for each screen.

Out:
- Any backend change — tasks 02/03 own the endpoints.
- The badges/missions screens and the client itself — task 04.

## Acceptance Criteria

- [x] `/admin/quests` renders for `ADMIN`/`CONTENT_CREATOR`, lists quests grouped
      by `kind`, and completes a create/edit/delete round-trip; `xpReward` is
      `ADMIN`-only and `predicateParams` is previewed parsed before save.
- [x] `/admin/levels` renders `ADMIN`-only, shows the full curve as an editable
      grid, blocks save on a non-monotonic/gapped/no-open-row curve client-side,
      and persists a valid curve via `PUT`.
- [x] The `/admin` hub renders the Gamification card group only for
      `ADMIN || CONTENT_CREATOR`, linking to all four pages.
- [x] Both screens' root `<main>` scrolls (`flex-1 overflow-y-auto`); empty and
      error states render.
- [x] No hardcoded user-facing string; the new keys exist in both `dict-en.ts`
      and `dict-pt.ts`; `check-i18n-coverage.js` passes.
- [x] The surfaces are responsive and keyboard-usable where interactive.
- [x] Changed files lint clean; `make test-web` green for the affected component
      tests.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web` + `make dev-api` and open `/admin/quests` and `/admin/levels`;
   confirm the grouped list, the create/edit happy path, the parsed-params
   preview, and the levels grid save.
2. Enter an invalid curve and confirm save is blocked client-side with clear
   feedback; confirm a `CONTENT_CREATOR` cannot reach `/admin/levels`.
3. Open `/admin` and confirm the Gamification cards appear for an admin and link
   to all four pages.
4. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`; confirm labels translate.
5. `make test-web` — component tests green; run `check-i18n-coverage.js`.
6. Resize to mobile and confirm the screens scroll and the grid stays usable.
7. `git diff --stat` confirms only scope-guardrail files changed.
