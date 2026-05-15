---
name: project-dashboard-m7
description: M7 Task 13 gamified dashboard — implementation summary and key decisions
metadata:
  type: project
---

Task 13 rebuilt `/dashboard` as a gamified XP/streak/ranking/missions/badges/roadmap page.

**Key decisions:**
- `DashboardContent` is a `'use client'` component (not RSC) because the access token is only available in React state. It makes ONE call to `/me/dashboard` (no waterfall).
- `DashboardSkeleton` renders on initial load while the fetch resolves.
- `ThemeToggle` uses a lazy `useState(readDark)` initializer (reads localStorage) + a pure DOM-sync `useEffect` to avoid the `react-hooks/set-state-in-effect` lint error.
- CSS design tokens are `var(--aq-bg*)`, `var(--aq-text*)`, etc. The old `dashboard-client.tsx` used undefined `var(--bg*)` variables — those were wrong.
- Light theme is toggled via `document.documentElement.dataset.theme = 'light'`, overriding `--aq-*` variables defined in `[data-theme="light"]` block in `globals.css`.
- `DASHBOARD_FIXTURE` in `dashboard-api.ts` is the dev/test fixture for the `/me/dashboard` response shape.
- Task 10 (the backend API) is not yet implemented — the frontend degrades gracefully with an error banner.

**Files created:**
- `apps/web/src/lib/dashboard-api.ts` — types + fetch + DASHBOARD_FIXTURE
- `apps/web/src/components/dashboard/DashboardContent.tsx` — main client container
- `apps/web/src/components/dashboard/StatCardLevel.tsx`
- `apps/web/src/components/dashboard/StatCardStreak.tsx`
- `apps/web/src/components/dashboard/StatCardRanking.tsx`
- `apps/web/src/components/dashboard/DailyTasks.tsx`
- `apps/web/src/components/dashboard/WeeklyChallenges.tsx`
- `apps/web/src/components/dashboard/MissionsList.tsx`
- `apps/web/src/components/dashboard/BadgesGrid.tsx`
- `apps/web/src/components/dashboard/Roadmap.tsx`
- `apps/web/src/components/dashboard/DashboardSkeleton.tsx`
- `apps/web/src/components/dashboard/ThemeToggle.tsx`
