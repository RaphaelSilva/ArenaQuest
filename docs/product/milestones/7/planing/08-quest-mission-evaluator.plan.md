# Plan — 08-quest-mission-evaluator

**Task:** [08-quest-mission-evaluator.task.md](../08-quest-mission-evaluator.task.md)
**Milestone:** 7
**Assigned personas:** backend-developer
**Branch:** feature/m7/08-quest-mission-evaluator.task (from feature/m7/candidate)

## Objective

Build a pure-domain `QuestEvaluator` service that, given an XP event (source kind), advances the user's active daily and weekly quest progress and evaluates active missions. On completion, the evaluator calls back into the XP engine to issue a reward `xp_event` with a stable idempotency key — so reward XP is recorded exactly once. Task 03 (Mission Data Layer) was never completed; this branch includes it as a prerequisite.

## Affected areas

**New files:**
- `apps/api/migrations/0024_create_missions.sql` — `missions` + `mission_progress` tables
- `packages/shared/ports/i-mission-repository.ts` — `IMissionRepository` port
- `packages/shared/domain/mission.ts` — `Mission`, `MissionProgress` types (parallel to `quest.ts`)
- `packages/shared/domain/gamification/quest-evaluator.ts` — `QuestEvaluator` service
- `apps/api/src/adapters/db/d1-mission-repository.ts` — D1 adapter
- `apps/api/test/core/gamification/quest-evaluator.spec.ts` — unit tests

**Modified files:**
- `packages/shared/ports/index.ts` — re-export `IMissionRepository`
- `apps/api/src/index.ts` — instantiate `D1MissionRepository` + `QuestEvaluator`
- `apps/api/src/routes/index.ts` — thread `questEvaluator` into AppDeps
- `apps/api/src/routes/progress.router.ts` — call evaluator after XP award (stage-checkin, topic-complete)
- `apps/api/src/routes/topics.router.ts` — call after video-watched
- `apps/api/src/routes/auth.router.ts` — call after login (daily_login predicate)
- `apps/api/src/adapters/db/d1-gamification-repository.ts` — add `appendXpEventIdempotent` if not present, used for reward issuance

**Out of scope:** badge unlock evaluation (Task 09), HTTP read endpoints (Task 10), admin missions UI.

## Step-by-step

### Backend

#### 1. Mission data layer (prerequisite)

Create `apps/api/migrations/0024_create_missions.sql`:
```sql
CREATE TABLE IF NOT EXISTS missions (
  id              TEXT    NOT NULL PRIMARY KEY,
  title           TEXT    NOT NULL,
  description     TEXT    NOT NULL DEFAULT '',
  start_at        TEXT    NOT NULL,
  end_at          TEXT    NOT NULL,
  predicate_kind  TEXT    NOT NULL,
  predicate_params TEXT   NOT NULL DEFAULT '{}',
  xp_reward       INTEGER NOT NULL DEFAULT 0,
  badge_id        TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mission_progress (
  user_id       TEXT    NOT NULL,
  mission_id    TEXT    NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  target_value  INTEGER NOT NULL DEFAULT 1,
  completed     INTEGER NOT NULL DEFAULT 0,
  completed_at  TEXT,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, mission_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
);
```

Create `packages/shared/domain/mission.ts`:
```ts
export interface Mission {
  id: string;
  title: string;
  description: string;
  startAt: string;  // ISO datetime string
  endAt: string;    // ISO datetime string
  predicateKind: string;
  predicateParams: string; // raw JSON
  xpReward: number;
  badgeId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MissionProgress {
  userId: string;
  missionId: string;
  currentValue: number;
  targetValue: number;
  completed: boolean;
  completedAt: Date | null;
  updatedAt: Date;
}
```

Create `packages/shared/ports/i-mission-repository.ts`:
```ts
export interface IMissionRepository {
  listActiveMissions(nowIso: string): Promise<Mission[]>;
  findProgress(userId: string, missionId: string): Promise<MissionProgress | null>;
  upsertProgress(userId: string, missionId: string, increment: number, target: number): Promise<MissionProgress>;
  markCompleted(userId: string, missionId: string): Promise<MissionProgress>;
}
```

Re-export from `packages/shared/ports/index.ts`.

Create `apps/api/src/adapters/db/d1-mission-repository.ts` implementing `IMissionRepository`. Follow the same patterns as `D1QuestRepository`.

#### 2. QuestEvaluator domain service

Create `packages/shared/domain/gamification/quest-evaluator.ts`:

```ts
export class QuestEvaluator {
  constructor(
    private readonly questRepo: IQuestRepository,
    private readonly missionRepo: IMissionRepository,
    private readonly xpEngine: XpEngine,
  ) {}

  async evaluate(userId: string, sourceKind: string, nowUtc: Date): Promise<void>
}
```

Predicate → source kind mapping:
| Predicate kind | Matching sourceKind |
|---|---|
| `watch_video` | `video` |
| `complete_subtopic` | `stage` (stage check-in) |
| `post_comment` | `comment` |
| `check_in_stage` | `stage` |
| `daily_login` | `login` |
| `complete_topic` | `topic` |

Logic in `evaluate(userId, sourceKind, nowUtc)`:
1. Compute `dailyPeriod = YYYY-MM-DD` from `nowUtc` (UTC; quests use UTC period keys).
2. Compute `weeklyPeriod = YYYY-Wnn` (ISO week).
3. Fetch active daily quests: `questRepo.listActiveDefinitions(QuestKind.DAILY)`.
4. For each quest whose `predicateKind` maps to `sourceKind`:
   - Compute `periodKey = dailyPeriod`.
   - Fetch current progress: `questRepo.findProgress(userId, quest.id, periodKey)`.
   - If already `completed` → skip.
   - `upsertProgress({ userId, questId: quest.id, periodKey, incrementBy: 1, targetValue: quest.predicateParams parsed target })`.
   - If newly completed (`currentValue >= targetValue`):
     - Award reward XP via `xpEngine.award({ userId, action: ... , sourceKind: 'quest_reward', sourceId: quest.id, version: periodKey })`.
5. Repeat steps 3-4 for weekly quests with `weeklyPeriod`.
6. Fetch active missions: `missionRepo.listActiveMissions(nowUtc.toISOString())`.
   - Filter by `predicateKind` matching `sourceKind`.
   - For each: fetch progress; if completed → skip; increment; if newly completed → award XP.

Idempotency key for reward: `quest_reward:${quest.id}:${periodKey}` and `mission_reward:${mission.id}`.

#### 3. XpEngine `award` call sites hook

The `QuestEvaluator.evaluate` is called **after** the XP event is written. Add it as a post-XP-write step in the same routers where `XpEngine.award` is called:
- `progress.router.ts` — stage-checkin and topic-complete handlers
- `topics.router.ts` — video-watched handler
- `auth.router.ts` — login handler (for `daily_login` predicate)

Add `questEvaluator?: QuestEvaluator` to router function signatures. Use same `try-catch` defensive pattern as streak engine.

The `sourceKind` passed to evaluator matches the `xp_event.source_kind` values:
- stage-checkin → `'stage'`
- topic-complete → `'topic'`
- video-watched → `'video'`
- login → `'login'`

#### 4. Wire in `apps/api/src/index.ts`

```ts
const missionRepo = new D1MissionRepository(env.DB);
const questEvaluator = new QuestEvaluator(questRepo, missionRepo, xpEngine);
```

Pass `questEvaluator` through `AppRouter` deps.

#### 5. Tests

Write `apps/api/test/core/gamification/quest-evaluator.spec.ts`:
- Mock all three dependencies (`IQuestRepository`, `IMissionRepository`, `XpEngine`).
- Test cases:
  a. Daily quest `complete_topic` goes from 0→1 and marks completed on first topic-complete event.
  b. Same quest in same period stays completed — `upsertProgress` not called again after completion.
  c. Crossing UTC midnight: different `dailyPeriod` keys → quest reopened (new period = null progress → increments from 0).
  d. Mission with `endAt` in the past → `listActiveMissions` returns empty → no progress update.
  e. Reward XP issued exactly once (idempotency key matches).
  f. Non-matching `sourceKind` → no quests progress.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| Daily quest 0→1 on topic-complete, marked completed | Step 2 logic + test (a) | backend | Unit test |
| Same quest same day not re-credited | Step 2 completed check + test (b) | backend | Unit test |
| Crossing midnight reopens quest at 0 | Period key rotation + test (c) | backend | Unit test |
| Mission with `end_at` in past skipped | `listActiveMissions` filters by now + test (d) | backend | Unit test |
| Reward XP recorded exactly once | Idempotency key + test (e) | backend | Unit test |

## Risks & open questions

- `predicateParams` is stored as raw JSON; for quests it may encode `{ "target": 3 }` — parse defensively.
- `listActiveMissions(nowIso)` needs to filter: `active = 1 AND start_at <= now AND end_at >= now`.
- ISO week calculation: `YYYY-Wnn` can be derived with a small helper in `packages/shared/domain/time/`.
- The `XpEngine.award` accepts `XpAction` enum — reward XP can't use a random string. Need to add `'quest_reward'` and `'mission_reward'` to `XpAction` and `XP_POINTS` map, or change the award signature to accept a custom points value for rewards. The cleanest approach: add a `awardRaw` method to `XpEngine` that takes explicit points without requiring an `XpAction` enum member.

## Verification

- `make lint && make test-api`
- Integration: login → daily_login quest progresses → reward XP event appears.

## Out of scope

- Badge unlocks on mission completion (Task 09).
- HTTP read endpoints `/me/quests`, `/me/missions` (Task 10).
- Admin mission CRUD UI (future milestone).
