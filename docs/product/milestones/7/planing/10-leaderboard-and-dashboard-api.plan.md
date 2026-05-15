# Plan — 10-leaderboard-and-dashboard-api

**Task:** [10-leaderboard-and-dashboard-api.task.md](../10-leaderboard-and-dashboard-api.task.md)
**Milestone:** 7
**Assigned personas:** backend-developer
**Branch:** feature/m7/10-leaderboard-and-dashboard-api.task (from feature/m7/candidate)

## Objective

Expose the read-only endpoints consumed by the Dashboard UI: individual `/me/*` endpoints for XP, streak, daily/weekly quests, active missions, and earned badges, plus a `GET /leaderboard` with scope/period filtering and pagination, and an aggregate `GET /me/dashboard` that composes all of the above in a single call.

## Affected areas

**New files:**
- `apps/api/src/controllers/me-gamification.controller.ts` — XP + streak + badges
- `apps/api/src/controllers/me-quests.controller.ts` — daily + weekly quest listings
- `apps/api/src/controllers/me-missions.controller.ts` — active missions with progress
- `apps/api/src/controllers/me-dashboard.controller.ts` — aggregate delegating to the above
- `apps/api/src/controllers/leaderboard.controller.ts` — ranked list + caller's me-block
- `apps/api/src/routes/me-gamification.router.ts` — mounts all `/me/*` gamification routes
- `apps/api/src/routes/leaderboard.router.ts` — mounts `GET /leaderboard`
- `packages/shared/types/dashboard.ts` — exports `DashboardShape` TypeScript type
- `apps/api/test/routes/me-gamification.spec.ts` — integration tests
- `apps/api/test/routes/leaderboard.spec.ts` — integration tests

**Modified files:**
- `packages/shared/ports/i-gamification-repository.ts` — add `getLeaderboard` + `getUserRank` methods
- `apps/api/src/adapters/db/d1-gamification-repository.ts` — implement the two new methods
- `apps/api/src/routes/index.ts` — wire the two new routers + pass `gamificationRepo` and `missionRepo` into `AppRouter.register()`
- `packages/shared/ports/index.ts` — re-export new types

**Out of scope:**
- Web rendering (Task 13)
- Any data-mutation endpoints
- New DB migrations (all required tables — `user_xp`, `user_streak`, `xp_events`, `user_badges`, `quests`, `missions`, `mission_progress` — are already created by tasks 01–09)

## Step-by-step

### Backend

1. **Extend `IGamificationRepository` port** (`packages/shared/ports/i-gamification-repository.ts`):
   - Add `LeaderboardRow` interface: `{ userId: string; totalXp: number; level: number; rankTitle: string; lastXpEventAt: string | null }`.
   - Add `getLeaderboard(params: { scope: 'global' | 'topic'; topicId?: string; period: 'all_time' | 'week'; weekStart?: string; limit: number; offset: number }): Promise<{ rows: LeaderboardRow[]; total: number }>`.
   - Add `getUserRank(userId: string, params: { scope: 'global' | 'topic'; topicId?: string; period: 'all_time' | 'week'; weekStart?: string }): Promise<{ rank: number; totalXp: number; level: number; rankTitle: string }>`.

2. **Implement in `D1GamificationRepository`** (`apps/api/src/adapters/db/d1-gamification-repository.ts`):
   - `getLeaderboard`: `SELECT ux.user_id, ux.total_xp, ld.level, ld.rank_title, MAX(xe.earned_at) AS last_xp_event_at FROM user_xp ux JOIN level_definitions ld ON ux.total_xp >= ld.min_xp AND (ld.max_xp IS NULL OR ux.total_xp <= ld.max_xp) LEFT JOIN xp_events xe ON xe.user_id = ux.user_id [WHERE xe.earned_at >= ? for week filter OR INNER JOIN enrollments for topic scope] GROUP BY ux.user_id ORDER BY ux.total_xp DESC, last_xp_event_at ASC LIMIT ? OFFSET ?`. Return `rows` + `total` (COUNT query).
   - `getUserRank`: Count users with higher XP (+ tie-break) to compute 1-based rank. Return rank + XP + level/rankTitle resolved via the same `level_definitions` join.

3. **Export `DashboardShape` from `packages/shared`** (`packages/shared/types/dashboard.ts`):
   ```ts
   export interface DashboardShape {
     xp: { totalXp: number; level: number; rankTitle: string; xpToNext: number | null } | null;
     streak: { currentStreak: number; longestStreak: number; lastActivityDate: string | null } | null;
     questsDaily: QuestWithProgress[] | null;
     questsWeekly: QuestWithProgress[] | null;
     missions: MissionWithProgress[] | null;
     badges: UserBadgeSummary[] | null;
   }
   ```
   Re-export from `packages/shared/index.ts`.

4. **`MeGamificationController`** (`apps/api/src/controllers/me-gamification.controller.ts`):
   - `getXp(userId)`: fetch `getUserXp` + `listLevelDefinitions` → compute level via `LevelTable`, return `{ totalXp, level, rankTitle, xpToNext }` or `null`.
   - `getStreak(userId)`: fetch `getUserStreak` → return `{ currentStreak, longestStreak, lastActivityDate }` or `null`.
   - `getBadges(userId)`: fetch `listUserBadges` joined with badge details → return array or `null` (empty → `null`).

5. **`MeQuestsController`** (`apps/api/src/controllers/me-quests.controller.ts`):
   - `getDailyQuests(userId, nowIso, periodKey)`: `questRepo.listActiveQuestsForUser(userId, 'daily', periodKey)` → `null` if empty.
   - `getWeeklyQuests(userId, nowIso, periodKey)`: same for `'weekly'`.
   - Use `periodKey` helpers from `packages/shared/domain/time/` or derive inline (`YYYY-WW` for weekly, `YYYY-MM-DD` for daily).

6. **`MeMissionsController`** (`apps/api/src/controllers/me-missions.controller.ts`):
   - `getMissions(userId, nowIso)`: `missionRepo.listActiveMissions(nowIso)` then for each, `missionRepo.findProgress(userId, mission.id)` → shape `{ mission, progress }[]` or `null`.

7. **`LeaderboardController`** (`apps/api/src/controllers/leaderboard.controller.ts`):
   - Zod schema: `{ scope: enum(['global','topic']).default('global'), topicId: string().optional(), period: enum(['all_time','week']).default('all_time'), limit: number().int().min(1).max(100).default(50), offset: number().int().min(0).default(0) }`.
   - Resolve `weekStart` from caller's `timezone` (from `users.findById` or fallback UTC).
   - Call `getLeaderboard` + `getUserRank` in parallel.
   - Return `{ rows: TopEntry[], me: { rank, totalXp, level, rankTitle }, total, limit, offset }`.

8. **`MeDashboardController`** (`apps/api/src/controllers/me-dashboard.controller.ts`):
   - Single `getDashboard(userId, nowIso)` method: call all five controllers (xp, streak, badges, dailyQuests, weeklyQuests, missions) **in parallel** via `Promise.all`.
   - Return `DashboardShape`.

9. **`MeGamificationRouter`** (`apps/api/src/routes/me-gamification.router.ts`):
   - `GET /xp` → `MeGamificationController.getXp`
   - `GET /streak` → `MeGamificationController.getStreak`
   - `GET /quests/daily` → `MeQuestsController.getDailyQuests`
   - `GET /quests/weekly` → `MeQuestsController.getWeeklyQuests`
   - `GET /missions` → `MeMissionsController.getMissions`
   - `GET /badges` → `MeGamificationController.getBadges`
   - `GET /dashboard` → `MeDashboardController.getDashboard`
   - All guarded by `authGuard`. Set `Cache-Control: private, max-age=15`.

10. **`LeaderboardRouter`** (`apps/api/src/routes/leaderboard.router.ts`):
    - `GET /` → `LeaderboardController.getLeaderboard`
    - Guarded by `authGuard`.

11. **Wire in `AppRouter.register`** (`apps/api/src/routes/index.ts`):
    - Add `gamificationRepo: IGamificationRepository` and `missionRepo: IMissionRepository` to `deps`.
    - Import and mount `buildMeGamificationRouter` at `/me`.
    - Import and mount `buildLeaderboardRouter` at `/leaderboard`.

12. **Wire in `buildApp`** (`apps/api/src/index.ts`):
    - Pass `gamificationRepo` and `missionRepo` (already instantiated) into `AppRouter.register(...)`.

13. **Integration tests** (`apps/api/test/routes/me-gamification.spec.ts`, `leaderboard.spec.ts`):
    - Use `SELF.fetch` pattern (see `test/index.spec.ts`).
    - Cover: auth guard (401 on each endpoint), empty states return `null`, XP + streak happy paths, leaderboard sort (total_xp DESC, tie-break ASC), `me.rank` is global not page-relative, `limit`/`offset` pagination, `period=week` filter.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| `/leaderboard` rows sorted by `total_xp DESC`, ties on `last_xp_event_at ASC` | Steps 2, 7, 13 | backend | Integration test with seeded tie-break users |
| `/leaderboard` `me.rank` is global rank, not page-relative | Steps 2, 7, 13 | backend | Test: seed 10 users, request page 2, verify me.rank = actual position |
| `/me/dashboard` returns `null` for empty sections | Steps 4–8, 13 | backend | Test: fresh user with no data → all sections null |
| Unauthenticated callers receive `401` | Steps 9, 10, 13 | backend | Test: omit Authorization on each endpoint |
| No provider-specific imports outside adapters | Steps 4–10 | backend | Code review + lint |

## Risks & open questions

- **`level_definitions` JOIN in leaderboard**: The tie-break on `last_xp_event_at` could be NULL for users who have XP from sources other than `xp_events`. Use `COALESCE(last_xp_event_at, '1970-01-01')` to ensure consistent ordering.
- **`period=week` and timezone**: The task says "caller's local week". The user's `timezone` field (added in migration 0023) should be used to shift the week boundary. Fallback to UTC if null.
- **Topic-scoped leaderboard**: Requires joining with the `enrollments` table. Confirm `enrollments` schema before implementing the SQL.
- **`MissionWithProgress` type**: Check `packages/shared/domain/mission.ts` for the canonical shape before defining the dashboard type.

## Verification

- Backend: `make lint && make test-api`
- Manually verify leaderboard ordering with seeded data via `make dev-api`

## Out of scope

- Web rendering (Task 13)
- Mutation endpoints
- New DB migrations
