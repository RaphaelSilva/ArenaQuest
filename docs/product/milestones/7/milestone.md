# Milestone 7: Gamification Engine & Learner UX Overhaul

**Status:** Planning
**Scope:** Implements the gamification layer (XP, levels, streaks, daily/weekly tasks, missions, badges, leaderboard), a discussion thread per topic, and three redesigned web surfaces (Login/Register, Dashboard, Content browser, Topic Detail) derived from the wireframes in `docs/product/web/wire/`.

> Note: The "Portability Testing & Launch" milestone originally listed as M7 (after M6's renumbering) is deferred to **Milestone 8**. This milestone closes the engagement-loop gap and unlocks the visual identity defined by the wireframes — both are prerequisites for a public-facing launch.

---

## 1. Objectives

- **Gamification Engine:** Award XP for participant actions (video watch, subtopic completion, stage check-in, comment, daily login), accumulate XP into levels with named ranks, track consecutive-day streaks, and surface a per-tenant leaderboard.
- **Quests:** Daily tasks (reset every 24 h), weekly challenges (reset Monday 00:00 local), and time-bound special missions authored by instructors/admins. Each quest grants XP and optional badge rewards on completion.
- **Badges:** Rule-based achievement unlocks (e.g., "Complete topic X", "Hit 7-day streak", "Watch 10 videos in a week"). A badge catalog is seeded; new badges are admin-authored.
- **Discussion:** A threaded comment surface attached to each TopicNode (subtopic). Replies one level deep, likes, instructor badge on author chip.
- **Web — Login & Register redesign:** Hero side panel, 2-step register (account → role), real-time password strength meter, terms acceptance. Reuses M6 auth APIs unchanged.
- **Web — Gamified Dashboard:** Greeting, XP/level card, streak card, ranking card, daily tasks, weekly challenges, special missions, learning roadmap, badges grid.
- **Web — Content browser redesign:** Sidebar tree (topic → subtopic), global progress, search, role pill (Participant/Instructor), topic header with stats, badges strip, subtopic cards with progress + status.
- **Web — Topic Detail page:** Breadcrumb, header with meta + progress, media tabs (videos with playlist, files, photos), comments thread, right sidebar with subtopic navigation and prev/next.

Out of scope (deliberate):
- Push or email notifications for badge/level unlocks — only the in-app bell indicator visual is reserved; routing/transport is deferred.
- Mobile-native (iOS/Android) builds.
- Tournament / season-based competitions.
- Avatar customization beyond initials.
- Markdown editor for comments — plain text in M7.

---

## 2. Functional Requirements

### 2.1 XP & Levels

- Every awarded action emits an immutable `xp_event` row `(id, user_id, source_kind, source_id, points, awarded_at, idempotency_key)`. The `idempotency_key` prevents double-credit for the same source event (e.g., the same stage check-in cannot award XP twice).
- Aggregated `user_xp` (read model) returns `(user_id, total_xp, level, rank_title, xp_in_level, xp_to_next_level)` computed deterministically from a configurable level table.
- Level table seeded by config (e.g., level 1: 0 XP, level 2: 100, …) and exposed through a port so future tuning replaces values, not code.

### 2.2 Streaks

- A streak increments when a user records any qualifying action on a new local-day. Two consecutive missed days reset the streak to 0. Today's status is computed at read time from the user's local time zone (stored on the user profile).
- Read model `user_streak (user_id, current_days, best_days, last_active_local_date)`.

### 2.3 Quests (Daily / Weekly / Mission)

- **Daily:** A small fixed roster (≤ 5) defined per tenant. Each user's progress on a daily quest resets at the user's local midnight. Completing a daily quest awards XP.
- **Weekly:** Larger goals (e.g., "Watch 10 videos this week"). Resets at the start of the user's local week.
- **Mission:** Admin-authored, with a start/end timestamp, a description, an XP reward, an optional badge reward, and a target predicate (e.g., "complete module N"). Each user sees missions where `now ∈ [start, end]`.
- All three share an evaluator: when an `xp_event` is recorded, the quest engine re-evaluates the user's active quests against the event and persists incremental progress.

### 2.4 Badges

- `badges` catalog: `(id, slug, name, icon_emoji, description, xp_reward, rule_kind, rule_params, active)`.
- Supported `rule_kind` in M7: `streak_days`, `topic_completed`, `videos_watched_in_period`, `total_xp`, `mission_completed`.
- `user_badges (user_id, badge_id, earned_at)`. Awarding is idempotent on `(user_id, badge_id)`.

### 2.5 Discussion

- `topic_comments (id, topic_node_id, user_id, parent_comment_id, body, created_at, deleted_at)`.
- `comment_likes (comment_id, user_id, liked_at)`, unique on the pair.
- One level of nesting (replies cannot have replies). Soft-delete; deleted comments render as "[removed]" but keep tree shape.

### 2.6 Leaderboard

- `GET /leaderboard?scope=global|topic&topicId=…&period=all_time|week` returns the top N (default 50) ordered by XP, plus the caller's rank.

### 2.7 API surface

All under `authGuard`. Admin/content-creator routes use `requireRole(...)`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/me/dashboard` | One-shot aggregate for the dashboard surface. |
| `GET` | `/me/xp` | Total XP, level, rank title, progress to next level. |
| `GET` | `/me/streak` | Current streak, best streak, week pip array. |
| `GET` | `/me/quests/daily` | Today's daily quests with per-user progress. |
| `GET` | `/me/quests/weekly` | This week's weekly quests with progress. |
| `GET` | `/me/missions` | Active missions visible to caller. |
| `GET` | `/me/badges` | Earned + locked badges. |
| `GET` | `/leaderboard` | Ranking with caller position. |
| `GET` | `/topics/:id/comments` | Threaded comment list. |
| `POST` | `/topics/:id/comments` | Create comment or reply (body `{ parentCommentId? }`). |
| `POST` | `/comments/:id/like` | Toggle like. |
| `DELETE` | `/comments/:id` | Soft-delete (author or admin). |
| `POST` | `/admin/missions` | Admin: create mission. |
| `PATCH` | `/admin/missions/:id` | Admin: update mission. |
| `DELETE` | `/admin/missions/:id` | Admin: end / remove mission. |
| `POST` | `/admin/badges` | Admin: create badge rule. |
| `PATCH` | `/admin/badges/:id` | Admin: update badge. |

### 2.8 Frontend — pages

- `/(auth)/login` and `/(auth)/register` redesigned per `Login.html` (hero panel + tabs + 2-step register).
- `/(protected)/dashboard` rebuilt per `Dashboard.html`.
- `/(protected)/catalog` rebuilt per `Content.html` (tree sidebar, role pill, instructor edit affordances).
- `/(protected)/catalog/[topicId]/[subtopicId]` new per `TopicDetail.html` (or equivalent route consolidating topic + subtopic views).

---

## 3. Acceptance Criteria

- [ ] Completing the last stage of a 3-stage task awards exactly one `xp_event` even if the request is replayed twice.
- [ ] `GET /me/xp` returns `level`, `rank_title`, `xp_in_level`, `xp_to_next_level` consistent with the seeded level table.
- [ ] Logging in on three consecutive local days yields `current_days = 3`; skipping two days resets to 0.
- [ ] A daily quest "Complete 1 subtopic" marks complete after a topic-progress completed event and credits its XP, and resets the next local day.
- [ ] A weekly quest progress bar reflects all qualifying events in the active week and resets at the start of the next week.
- [ ] An admin creates a mission window `[now, now+72h]` with XP reward 1000; a user who completes the predicate inside the window receives one XP event of 1000 and the mission is no longer "active" for them.
- [ ] Reaching a 7-day streak unlocks the "Semana Perfeita" badge exactly once; re-evaluating the same state does not duplicate the row.
- [ ] `GET /leaderboard` returns a sorted top-N and the caller's rank even when the caller is outside the top-N.
- [ ] A user posts a top-level comment, another user replies, the first user likes the reply; the GET returns the tree with the like count and `likedByMe = true` for the liker.
- [ ] Soft-deleting a comment keeps its `id` in the tree and shows body as `null`.
- [ ] Login & Register pages match the wireframe behaviour: tab switch, 2-step register, password strength meter, terms checkbox blocks submit until checked.
- [ ] `/dashboard` renders all sections from `Dashboard.html` populated from `/me/dashboard` and degrades gracefully when a section is empty.
- [ ] Content sidebar tree supports expand/collapse, search filter, and an instructor toggle that surfaces "Novo Subtópico"/"Novo Tópico" affordances (no-op stubs allowed at frontend level if backend CRUD pre-exists from M3).
- [ ] Topic Detail page switches between Videos / Files / Photos tabs and persists last-played video position only in component state (no backend in M7).
- [ ] `make lint`, `make test`, and `make e2e` green in CI.
- [ ] No provider-specific imports outside `apps/api/src/adapters/`.

---

## 4. Specific Stack

- **Database (D1):** new tables `xp_events`, `user_xp`, `user_streak`, `quest_definitions`, `quest_progress`, `missions`, `mission_progress`, `badges`, `user_badges`, `topic_comments`, `comment_likes`. Level table seeded via migration; recursive aggregates avoided (precompute on event in the gamification service).
- **Ports:** `IGamificationRepository`, `IQuestRepository`, `IBadgeRepository`, `ICommentRepository` in `packages/shared/ports/`. The XP engine itself is a pure-domain service in `packages/shared/domain/gamification/` so it can be reused if a non-D1 store is plugged in.
- **Types:** extend `Entities.Engagement` with `Quest`, `Mission`, `QuestProgress`, and add a new `Entities.Gamification` namespace (`XpEvent`, `UserXp`, `Streak`, `Badge`, `UserBadge`, `Comment`, `CommentLike`).
- **Frontend:** Next.js 15 / Tailwind v4. The wireframes use plain SVG/CSS — keep that. No new chart library. Light/dark theme already in the design system.
- **Time zones:** user's `timezone` is read from the profile (already present); all "today/this week" logic uses that zone via the shared `domain/time` helpers.

---

## 5. Task Breakdown

| # | Task File | Status |
|---|-----------|--------|
| 01 | [Gamification Data Layer (XP events + user XP + streak + level table)](./01-gamification-data-layer.task.md) | ⏳ Pending |
| 02 | [Quest Data Layer (daily/weekly definitions + per-user progress)](./02-quest-data-layer.task.md) | ⏳ Pending |
| 03 | [Mission Data Layer + Admin CRUD API](./03-mission-data-layer.task.md) | ⏳ Pending |
| 04 | [Badge Data Layer + seeded catalog + Admin CRUD API](./04-badge-data-layer.task.md) | ⏳ Pending |
| 05 | [Discussion Data Layer (comments + likes)](./05-discussion-data-layer.task.md) | ⏳ Pending |
| 06 | [XP Engine & event hooks on existing controllers](./06-xp-engine.task.md) | ⏳ Pending |
| 07 | [Streak Engine (daily login tracker + local-time evaluator)](./07-streak-engine.task.md) | ⏳ Pending |
| 08 | [Quest & Mission Evaluator (reacts to xp_event)](./08-quest-mission-evaluator.task.md) | ⏳ Pending |
| 09 | [Badge Unlock Engine (rule evaluator + idempotent award)](./09-badge-engine.task.md) | ⏳ Pending |
| 10 | [Leaderboard API + `/me/dashboard` aggregate](./10-leaderboard-and-dashboard-api.task.md) | ⏳ Pending |
| 11 | [Comments API (list/create/like/delete + threading)](./11-comments-api.task.md) | ⏳ Pending |
| 12 | [Web: Login & Register redesign (hero panel, 2-step register, strength meter)](./12-web-login-register.task.md) | ⏳ Pending |
| 13 | [Web: Gamified Dashboard page](./13-web-dashboard.task.md) | ⏳ Pending |
| 14 | [Web: Content browser redesign (tree sidebar, role pill, badges strip)](./14-web-content-browser.task.md) | ⏳ Pending |
| 15 | [Web: Topic Detail page (media tabs, video playlist, files, photos, comments)](./15-web-topic-detail.task.md) | ⏳ Pending |

Dependency graph:

```
01 ─┬─ 06 ─┬─ 08 ─┬─ 10
    │      │      │
07 ─┘      ├─ 09 ─┘
           │
02 ────────┘
03 ────────┘
04 ────────┘
05 ── 11 ──┐
           │
10, 11 ────┴─ 13, 14, 15 (parallel)
12 (independent)
```

**Recommended execution order:** `01, 02, 03, 04, 05, 12` (parallel) → `06, 07, 11` (parallel) → `08, 09` (parallel) → `10` → `13, 14, 15` (parallel).

---

## 6. Definition of Done (milestone level)

- [ ] All 15 tasks marked `✅ Done` with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test`, and `make e2e` green in CI.
- [ ] Demo walk-through: a fresh participant logs in, checks into a stage, watches a video, posts a comment, returns to the dashboard, and sees: XP increase, daily-quest progress, streak pip lit for today, comment count incremented on the topic, leaderboard reflecting the new position.
- [ ] Closeout note authored at `docs/product/milestones/7/closeout-analysis.md` (same template as M5/M6).
- [ ] Agnosticism contract preserved: no provider SDK imports outside `apps/api/src/adapters/`.
- [ ] No regression on Milestones 2 – 6 suites.
