# Task 13 — Web: Gamified Dashboard

**Status:** ⏳ Pending
**Milestone:** [7](./milestone.md)

## Summary

Rebuild `/dashboard` per `docs/product/web/wire/Dashboard.html`. Consumes `/me/dashboard` from Task 10 and renders: greeting + date, stat cards (Level/XP, Streak, Ranking), Today's Tasks, Special Missions, Weekly Challenges, Badges grid, and Learning Roadmap.

## Dependencies

Task 10.

## Technical Constraints

- `apps/web/src/app/(protected)/dashboard/page.tsx`. Tailwind v4 design tokens; no new chart library — use plain SVG/CSS as in the wireframe.
- Data fetched server-side via the existing `api-client` helper; client-side hydration only for interactivity (theme toggle, task checkbox optimistic update).
- Daily-task toggle calls the same XP-emitting endpoint as the underlying action (do not invent a new "tick this quest" route — the action itself is the trigger).
- The roadmap maps directly onto top-level topic nodes returned by `/me/dashboard` and links each node to `/catalog/[id]`.
- Light + dark themes mirror the wireframe palette.

## Scope

In:
- The page and its component tree (`StatCardLevel`, `StatCardStreak`, `StatCardRanking`, `DailyTasks`, `WeeklyChallenges`, `MissionsList`, `BadgesGrid`, `Roadmap`).
- Empty states for each section.
- A loading skeleton matching the visual structure.

Out:
- Authoring missions/badges (admin UI — handled by API in M7).
- Notifications bell behaviour (visual only).

## Acceptance Criteria

- [ ] Layout matches the wireframe at ≥ 1280 px within ±8 px.
- [ ] All seven sections render against a seeded test fixture.
- [ ] Empty states never display "NaN", `undefined`, or broken bars when data is null.
- [ ] Theme toggle persists in `localStorage` and applies on next visit.
- [ ] No client-side request waterfall — the page renders from one `/me/dashboard` payload.
- [ ] `make lint` passes; RTL covers at least the level card and the daily-task list.

## Verification Plan

1. Walk the page in `make dev-web` against a seeded local DB with the M7 fixtures.
2. RTL specs.
3. `make lint`.
