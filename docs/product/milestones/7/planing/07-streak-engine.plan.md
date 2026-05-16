# Plan — 07-streak-engine

**Task:** [07-streak-engine.task.md](../07-streak-engine.task.md)
**Milestone:** 7
**Assigned personas:** backend-developer
**Branch:** feature/m7/07-streak-engine.task (from feature/m7/candidate)

## Objective

Build a pure-domain `StreakEngine` service that tracks consecutive-day engagement per user. The engine receives the current UTC timestamp and the user's IANA timezone (stored on their profile), converts to local date, and compares to `last_active_local_date` stored in the `user_streak` table (via `IGamificationRepository`). The three transitions are: same local day → no-op (idempotent); next day (+1) → increment `current_days`; gap > 1 day → reset to 1. `best_days` only ever moves forward. The engine is then wired into every call site that already fires an XP event: login, stage check-in, topic complete, comment posted, and video watched.

## Affected areas

- **New file:** `packages/shared/domain/gamification/streak-engine.ts`
- **New file:** `packages/shared/domain/time/local-date.ts` (or reuse existing `packages/shared/domain/time/` helper if one exists — check first)
- **Modified:** `apps/api/src/index.ts` — instantiate `StreakEngine` alongside `XpEngine`
- **Modified:** `apps/api/src/routes/index.ts` — thread `streakEngine` through `AppDeps`
- **Modified:** `apps/api/src/routes/progress.router.ts` — call `streakEngine.recordActivity()` after XP award in stage-checkin and topic-complete handlers
- **Modified:** `apps/api/src/routes/topics.router.ts` — call after video-watched / comment-posted XP award
- **Modified:** `apps/api/src/routes/auth.router.ts` (or auth controller) — call after successful login
- **New test file:** `packages/shared/domain/gamification/streak-engine.spec.ts` (or `apps/api/test/core/gamification/streak-engine.spec.ts`)

Out of scope: read endpoint (`/me/streak` — Task 10), badge rule evaluation on `streak_days` (Task 09).

## Step-by-step

### Backend

1. **Check for existing time helper** — inspect `packages/shared/domain/time/` for a UTC→local-date utility. If absent, create `packages/shared/domain/time/local-date.ts` that exports `toLocalDateString(utcDate: Date, timezone: string): string` returning an ISO date string (`YYYY-MM-DD`) using `Intl.DateTimeFormat` (no external deps, works in V8/Workers).

2. **Create `StreakEngine`** in `packages/shared/domain/gamification/streak-engine.ts`:
   - Constructor: `(repo: IGamificationRepository, getUserTimezone: (userId: string) => Promise<string | null>)`
   - Public method: `recordActivity(userId: string, nowUtc: Date): Promise<void>`
   - Logic inside `recordActivity`:
     a. Fetch timezone via `getUserTimezone(userId)` (default `'UTC'` if null).
     b. Compute `todayLocal = toLocalDateString(nowUtc, timezone)`.
     c. Fetch current streak via `repo.getUserStreak(userId)`.
     d. If streak is null or `lastActivityDate` is null → upsert `{ currentStreak: 1, longestStreak: 1, lastActivityDate: todayLocal }`.
     e. If `lastActivityDate === todayLocal` → no-op (return).
     f. Compute date diff: parse both as local dates, diff in days.
        - diff === 1 → `newCurrent = current + 1`
        - diff > 1 → `newCurrent = 1`
     g. `newLongest = Math.max(newCurrent, existing.longestStreak)`.
     h. Upsert `{ currentStreak: newCurrent, longestStreak: newLongest, lastActivityDate: todayLocal }`.
   - Date diff must compare `YYYY-MM-DD` strings as calendar dates (parse to UTC midnight to avoid DST skew in the diff itself).

3. **Wire `StreakEngine` in `apps/api/src/index.ts`**:
   - Import `StreakEngine`.
   - Instantiate after `xpEngine`: `const streakEngine = new StreakEngine(gamificationRepo, (userId) => users.findById(userId).then(u => u?.timezone ?? null))`.
   - Pass to `AppRouter` deps alongside `xpEngine`.

4. **Thread through `apps/api/src/routes/index.ts`**:
   - Add `streakEngine?: StreakEngine` to `AppDeps`.
   - Pass to the four routers that accept `xpEngine`.

5. **Hook into `apps/api/src/routes/progress.router.ts`**:
   - After each `xpEngine.award(...)` call (stage-checkin and topic-complete), add:
     ```ts
     if (streakEngine) await streakEngine.recordActivity(userId, new Date());
     ```

6. **Hook into `apps/api/src/routes/topics.router.ts`**:
   - After the `video-watched` (or `topic_complete`) XP award, add the same `streakEngine.recordActivity(userId, new Date())` guard.
   - If comment-posted XP is awarded here, hook there too.

7. **Hook into login path** (`apps/api/src/routes/auth.router.ts` or `auth.controller.ts`):
   - Locate the successful-login code path (after token issuance).
   - Add `if (streakEngine) await streakEngine.recordActivity(userId, new Date()).catch(() => {})` — fire-and-forget with silent catch so streak errors never break login.

8. **Write tests** in `packages/shared/domain/gamification/streak-engine.spec.ts` (Vitest):
   - Mock `IGamificationRepository` and `getUserTimezone`.
   - Test cases:
     a. First activity ever → streak `{ current: 1, longest: 1 }`.
     b. Same local day → no-op (upsert not called again).
     c. Next day (+1) → `current` increments, `longest` updates if new record.
     d. Gap > 1 day → `current` resets to 1, `longest` unchanged if old record was higher.
     e. Timezone edge: user in `America/Sao_Paulo` (UTC-3) — simulate nowUtc at 02:30 UTC (= 23:30 local previous day) vs 03:30 UTC (= 00:30 local next day) to confirm day boundary.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| Two activities on same local day keep `current_days` unchanged | Step 2e + Test 8b | backend | Unit test: same day no-op |
| Activity on day N+1 increments `current_days` and updates `last_active_local_date` | Step 2f + Test 8c | backend | Unit test: +1 day case |
| Activity after 2-day gap resets `current_days` to 1 | Step 2f + Test 8d | backend | Unit test: gap > 1 |
| `best_days` only moves forward | Step 2g + Test 8d | backend | Unit test: reset leaves longest intact |
| America/Sao_Paulo midnight boundary works | Step 1 + Test 8e | backend | Unit test: timezone edge case |

## Risks & open questions

- `users.findById` must expose `timezone` — verify `D1UserRepository.findById` returns it. If not, add it to the query.
- `IGamificationRepository.upsertUserStreak` currently takes a `userId` + `UpsertUserStreakParams` — confirm the D1 adapter implements this; it was scaffolded in Task 01.
- The `Intl.DateTimeFormat` approach for timezone conversion is the correct zero-dep approach for V8/Workers. Confirm it works in the `@cloudflare/vitest-pool-workers` test environment.

## Verification

- `make lint && make test-api`
- Manual: login twice in the same day → streak stays at 1; login next day → streak becomes 2.

## Out of scope

- `/me/streak` read endpoint (Task 10).
- Badge rule evaluation on `streak_days` (Task 09).
- Best-streak rewards.
