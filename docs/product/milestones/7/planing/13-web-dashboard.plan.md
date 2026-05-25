# Plan — 13-web-dashboard

**Task:** [13-web-dashboard.task.md](../13-web-dashboard.task.md)
**Milestone:** 7
**Assigned personas:** backend-developer + frontend-developer
**Branch:** feature/m7/13-web-dashboard.task (from feature/m7/candidate)

## Objective

The dashboard components (`StatCardLevel`, `StatCardStreak`, `StatCardRanking`, `DailyTasks`, `WeeklyChallenges`, `MissionsList`, `BadgesGrid`, `Roadmap`) and RTL tests already exist and pass. The remaining work is: (1) a one-field backend addition to expose `xpInLevel` from the `/me/dashboard` endpoint, (2) update the `getDashboard()` frontend adapter to map the real API response shapes to the `DashboardPayload` used by the components, and (3) add parallel leaderboard + topics fetches so the page renders from coordinated (non-waterfall) calls.

## Affected areas

### Backend
- `packages/shared/types/dashboard.ts` — add `xpInLevel: number` to `DashboardXp`
- `apps/api/src/controllers/me-gamification.controller.ts` — compute and return `xpInLevel`

### Frontend
- `apps/web/src/lib/dashboard-api.ts` — update types, `getDashboard()` adapter
- `apps/web/src/components/dashboard/DashboardContent.tsx` — null-safe rendering for all sections
- `apps/web/src/components/dashboard/StatCardLevel.tsx` — use `xpInLevel` from the updated type

Out of scope:
- Creating any new dashboard component (all components exist)
- Backend-only routes

## Step-by-step

### Backend
1. **`packages/shared/types/dashboard.ts`** — add `xpInLevel: number` to `DashboardXp`:
   ```ts
   export interface DashboardXp {
     totalXp: number;
     level: number;
     rankTitle: string;
     xpToNext: number | null;
     xpInLevel: number;  // ← add
   }
   ```

2. **`apps/api/src/controllers/me-gamification.controller.ts`** — in `getXp()`, after calling `table.forXp(xpRecord.totalXp)`, add `xpInLevel: xpRecord.totalXp - definition.minXp` to the returned data object.

### Frontend
3. **`apps/web/src/lib/dashboard-api.ts`** — align the frontend `DashboardXp` type with the shared type (rename `xpInLevel`/`xpToNextLevel` fields), update `DashboardStreak` to match API (`currentStreak`→`currentDays`, `longestStreak`→`longestDays`, add `weekPips` computation), update quest/mission/badge types to match API shapes.

4. **`getDashboard()` in `dashboard-api.ts`** — update to:
   - Call `GET /me/dashboard` for core gamification data
   - Call `GET /leaderboard?scope=global&period=all_time&limit=5` in parallel
   - Call `GET /topics` in parallel for roadmap nodes
   - Use `Promise.all([...])` — not sequential — to avoid waterfall
   - Map the three responses into the unified `DashboardPayload`; provide safe defaults (empty arrays, zeros) for any null API fields

5. **`computeWeekPips(lastActivityDate, currentStreak)`** — helper function inside `dashboard-api.ts` that returns a `boolean[7]` representing the last 7 calendar days. A day is `true` if it falls within a streak window ending on `lastActivityDate`.

6. **`DashboardContent.tsx`** — wrap each data-section render in a null/empty-array guard using the already-existing empty-state components. The `DashboardPayload` fields that come from the API as nullable (`xp`, `streak`, `daily`, `weekly`, `missions`, `badges`) must never be passed as `undefined` to components that expect non-null props.

7. **`StatCardLevel.tsx`** — update XP progress bar computation to use `xpInLevel` (from the updated type) and `xpToNext ?? 0` for the range.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| All seven sections render against a seeded test fixture | 3–6 | frontend | RTL tests (existing) pass with real fixture |
| Empty states never display NaN/undefined/broken bars | 4, 6, 7 | frontend | RTL: `xpToNextLevel: 0` test already exists |
| No client-side request waterfall | 4 | frontend | Single `Promise.all` in `getDashboard()` |
| Theme toggle persists in localStorage | (already done — ThemeToggle exists) | — | Existing test |
| `make lint` passes; RTL covers level card + daily-task list | (tests already exist) | — | `make test-web` |
| Layout matches wireframe | (components already styled with AQ tokens) | — | Visual check |

## Risks & open questions

- `LevelDefinitionRecord.minXp` is the XP floor of the level; `xpInLevel = totalXp - definition.minXp` is correct only if `minXp` is the floor. Confirm by reading `LevelTable.forXp()` — yes it is.
- The leaderboard response has `{ rows: LeaderboardRow[], me: UserRankRecord, total }`. `LeaderboardRow` has `{ userId, totalXp, level, rankTitle, lastXpEventAt }` — no `name` or `initials`. The frontend `StatCardRanking` needs `name` and `initials`. Map `userId` → first two chars as initials placeholder; or show `userId.slice(0, 6)` as name until user profiles are added. Do not crash.
- `/topics` returns `TopicNode[]` with `parentId`; filter for roots only (`parentId === null`) for the roadmap.
- Progress % per roadmap node: call `GET /me/progress/topics` in parallel and join by topicId; treat missing progress as `0%`.

## Verification

- Backend: `make lint && make test-api`
- Frontend: `make lint && make test-web`

## Out of scope

- New dashboard components
- Backend leaderboard / mission routes
- Profile names/avatars in leaderboard rows (placeholder initials are acceptable)
