# Plan — 09-badge-engine

**Task:** [09-badge-engine.task.md](../09-badge-engine.task.md)
**Milestone:** 7
**Assigned personas:** backend-developer
**Branch:** feature/m7/09-badge-engine.task (from feature/m7/candidate)

## Objective

Build a pure-domain `BadgeEngine` service that evaluates all active badges for a user after each XP event and awards any whose rules are newly met. Award is idempotent at the DB level (`UNIQUE(user_id, badge_id)`) and the engine guards with a pre-check. Awarding a badge with `xp_reward > 0` emits a `badge_award` `xp_event` through the XP engine.

## Affected areas

**New files:**
- `packages/shared/domain/gamification/badge-engine.ts`
- `apps/api/test/core/gamification/badge-engine.spec.ts`

**Modified files:**
- `packages/shared/ports/i-gamification-repository.ts` — add `countXpEventsBySource(userId, sourceKind, since?): Promise<number>` and `countCompletedTopics(userId): Promise<number>` for the `topic_completed` and `videos_watched_in_period` rule kinds
- `apps/api/src/adapters/db/d1-gamification-repository.ts` — implement the two new methods
- `packages/shared/ports/i-mission-repository.ts` — add `countCompletedMissions(userId): Promise<number>`
- `apps/api/src/adapters/db/d1-mission-repository.ts` — implement it
- `apps/api/src/index.ts` — instantiate `BadgeEngine`
- `apps/api/src/routes/index.ts` — thread `badgeEngine` through AppDeps
- `apps/api/src/routes/progress.router.ts`, `topics.router.ts`, `auth.router.ts` — hook after quest evaluator

**Out of scope:** admin authoring UI (Task 04 already delivers admin CRUD), HTTP read surfaces (Task 10).

## Step-by-step

### Backend

#### 1. Extend IGamificationRepository

Add two methods:
```ts
countXpEventsBySource(userId: string, sourceKind: string, since?: string): Promise<number>;
countAllCompletedTopics(userId: string): Promise<number>;
```
- `countXpEventsBySource`: counts `xp_events` for the user where `source_kind = ?` (optionally since an ISO datetime). Used for `videos_watched_in_period`.
- `countAllCompletedTopics`: counts topic_progress rows with `status = 'completed'` for user. Used for `topic_completed` rule kind.

#### 2. Extend IMissionRepository

Add:
```ts
countCompletedMissions(userId: string): Promise<number>;
```
SQL: `SELECT COUNT(*) FROM mission_progress WHERE user_id = ? AND completed = 1`.

#### 3. Implement new methods in D1 adapters

`D1GamificationRepository`:
- `countXpEventsBySource`: `SELECT COUNT(*) as cnt FROM xp_events WHERE user_id = ? AND source_kind = ?` (add `AND earned_at >= ?` when `since` is provided).
- `countAllCompletedTopics`: `SELECT COUNT(*) as cnt FROM topic_progress WHERE user_id = ? AND status = 'completed'`.

`D1MissionRepository`:
- `countCompletedMissions`: `SELECT COUNT(*) as cnt FROM mission_progress WHERE user_id = ? AND completed = 1`.

#### 4. BadgeEvaluationContext

Inside `badge-engine.ts`, define a private context type:
```ts
interface BadgeEvalCtx {
  streakDays: number;
  totalXp: number;
  completedTopicCount: number;
  videosWatchedThisWeek: number;
  completedMissionCount: number;
  earnedBadgeIds: Set<string>;
}
```

#### 5. BadgeEngine domain service

```ts
export class BadgeEngine {
  constructor(
    private readonly badgeRepo: IBadgeRepository,
    private readonly gamificationRepo: IGamificationRepository,
    private readonly missionRepo: IMissionRepository,
    private readonly xpEngine: XpEngine,
  ) {}

  async evaluate(userId: string, nowUtc: Date): Promise<void>
}
```

Logic in `evaluate(userId, nowUtc)`:
1. Load all active badges: `badgeRepo.listActive()`.
2. If empty → return early.
3. Gather context:
   - `streak = await gamificationRepo.getUserStreak(userId)` → `streakDays = streak?.currentStreak ?? 0`
   - `xp = await gamificationRepo.getUserXp(userId)` → `totalXp = xp?.totalXp ?? 0`
   - `completedTopicCount = await gamificationRepo.countAllCompletedTopics(userId)`
   - `weekStart = startOfWeek(nowUtc)` (Monday 00:00 UTC of current ISO week)
   - `videosWatchedThisWeek = await gamificationRepo.countXpEventsBySource(userId, 'video', weekStart.toISOString())`
   - `completedMissionCount = await missionRepo.countCompletedMissions(userId)`
   - `earnedBadgeIds = new Set((await badgeRepo.listUserBadges(userId)).map(b => b.badgeId))`
4. For each active badge, evaluate its rule:
   - `streak_days`: `streakDays >= rule.days`
   - `topic_completed`: `completedTopicCount >= rule.count`
   - `videos_watched_in_period`: `videosWatchedThisWeek >= rule.count` (rule.period is always `'week'` in M7)
   - `total_xp`: `totalXp >= rule.min_xp`
   - `mission_completed`: `completedMissionCount >= rule.count`
   - Unknown rule kinds → skip with debug log
5. If rule met AND `!earnedBadgeIds.has(badge.id)`:
   - `await badgeRepo.awardBadge(userId, badge.id)`
   - If `badge.xpReward > 0`: `await xpEngine.award({ userId, action: 'badge_award', sourceKind: 'badge_award', sourceId: badge.id, customPoints: badge.xpReward })`

`startOfWeek(date)` helper: find Monday 00:00 UTC of the ISO week containing `date`. Use same ISO week logic as `QuestEvaluator`'s week key.

#### 6. Wire in `apps/api/src/index.ts`

```ts
const badgeEngine = new BadgeEngine(badgeRepo, gamificationRepo, missionRepo, xpEngine);
```

Pass `badgeEngine` to `AppRouter.register`.

#### 7. Thread through `apps/api/src/routes/index.ts`

Add `badgeEngine?: BadgeEngine` to AppDeps. Pass to the four routers.

#### 8. Hook into call sites

After the quest evaluator call in `progress.router.ts` (stage-checkin, topic-complete), `topics.router.ts` (video-watched), `auth.router.ts` (login):
```ts
if (badgeEngine) {
  try {
    await badgeEngine.evaluate(userId, new Date());
  } catch (err) {
    console.error('[badge] evaluate failed:', err);
  }
}
```

#### 9. Tests

`apps/api/test/core/gamification/badge-engine.spec.ts` (all mocked):
- a. `streak_days` badge: streak = 7, badge rule `{days:7}` → award called.
- b. `streak_days` badge already earned → `awardBadge` NOT called (idempotency).
- c. `topic_completed` badge: completedTopics = 5, rule `{count:5}` → award called.
- d. `total_xp` badge: totalXp = 500, rule `{min_xp:500}` → award called.
- e. Disabled badge (`active:false`) excluded → award not called.
- f. `xp_reward > 0` on badge award → XP engine called with `badge_award` and `customPoints`.
- g. Rule threshold not met → no award.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| `streak_days = 7` awards "Semana Perfeita" exactly once | Steps 5+9a,9b | backend | Unit test |
| `topic_completed` badge for topic X awards once, re-completing X doesn't re-award | Steps 3+5+9c | backend | Unit test: idempotency |
| `total_xp ≥ 500` awards at threshold crossing | Steps 3+5+9d | backend | Unit test |
| Disabling badge excludes from future evaluations | Step 5 (listActive filters) + 9e | backend | Unit test: inactive badge skipped |

## Risks & open questions

- `countAllCompletedTopics` queries `topic_progress` table — verify the column is `status = 'completed'` (check migration 0010).
- `videos_watched_in_period` with `period: 'week'` uses xp_events for source_kind `'video'`; the XP event source_kind in the codebase is `'video'` (from `topics.router.ts` `video_watched` award with `sourceKind: 'video'`). Confirm alignment.

## Verification

- `make lint && make test-api`

## Out of scope

- Admin badge authoring UI (already done in Task 04).
- HTTP read endpoints (Task 10).
