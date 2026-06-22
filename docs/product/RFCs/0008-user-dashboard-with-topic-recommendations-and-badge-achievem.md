# RFC 0008: User Dashboard with Topic Recommendations and Badge Achievements

**Date:** 2026-06-20
**Status:** Draft
**Author:** raphaelsilva
**Affected:**
- `apps/api/src/routes/` (new endpoints for badge management and recommendations)
- `apps/api/src/controllers/` (badge and recommendation controllers)
- `apps/api/src/adapters/db/` (repositories for badges and recommendations)
- `packages/shared/ports/` (new port interfaces for badge and recommendation repositories)
- `packages/shared/types/entities.ts` (new badge and recommendation entity types)
- `apps/web/src/app/(protected)/dashboard/` (dashboard UI components)
- `apps/web/src/app/(admin)/` (admin badge approval and recommendation configuration)

---

## Summary

This RFC proposes a user dashboard with personalized topic recommendations and a badge achievement system for recognizing user progress. The dashboard displays the user's current topic, their last-watched topic, and admin-curated recommendations per user group. The badge system allows admins to define achievement milestones (single topic or topic sets), approve eligible users manually, and display earned badges to users as transparent symbols of achievement (similar to martial arts belt ranks). Together, these features increase user engagement by showing learning progress and providing guided pathways through the content.

## Motivation

ArenaQuest currently lacks a unified place where users can see their learning journey and receive personalized guidance. Key scenarios:

| Scenario | Motivation |
|----------|-----------|
| User logs in but doesn't know what to do next | Dashboard shows current/last topic and recommendations |
| Admin wants to encourage group learning paths | Admins can configure topic recommendations per group |
| User completes a skill set or achievement | Badge system recognizes milestones with visual symbols |
| Admin needs to control badge awards | Manual approval prevents unearned achievements |
| User wants to showcase progress transparently | Badge display (like martial arts belts) shows clear achievement levels |

Without these features, users have no structured progression, admins cannot guide learning paths, and achievements are invisible to the community.

## Goals & Non-Goals

**Goals**
- Implement a user dashboard showing current topic, last-watched topic, and recommendations.
- Create admin configuration for per-group topic recommendations.
- Build a badge system where admins define achievement triggers (topic completion).
- Implement manual admin approval workflow for badge awards.
- Display earned badges on user profiles with transparent achievement symbols.
- Provide admin UI to view eligible users and approve badge awards.

**Non-Goals**
- Automatic badge awards (always requires manual admin approval).
- Leaderboards or competitive ranking (may be a future feature).
- Notification system for recommendations (users see them on dashboard login).
- Badge expiration or revocation mechanics (out of scope for v1).
- Complex badge hierarchies or conditional logic beyond topic completion.

## Current State (for reference)

- User topic progress is tracked via `TopicProgress` and `TaskProgress` entities (`packages/shared/types/entities.ts`).
- No dashboard exists; users navigate catalog directly.
- No badge system or achievement tracking.
- No topic recommendation system or admin configuration for recommendations.
- User profiles exist but do not display achievements or badges.

## Proposed Design

### 1. Dashboard Data Model

Add to `packages/shared/types/entities.ts`:

```typescript
namespace Entities {
  export interface DashboardData {
    currentTopic: TopicNode | null;
    lastWatchedTopic: TopicNode | null;
    recommendations: {
      topicId: string;
      reason: string; // e.g., "Recommended by group admin"
    }[];
  }

  export interface Badge {
    id: string;
    groupId: string;
    name: string;
    description: string;
    icon: string; // URL to badge icon/symbol
    completionTrigger: {
      type: 'single_topic' | 'topic_set';
      topicIds: string[];
    };
    createdAt: Date;
  }

  export interface UserBadgeAward {
    id: string;
    userId: string;
    badgeId: string;
    status: 'pending' | 'approved' | 'rejected';
    awardedAt: Date | null;
    approvedBy: string | null;
    approvedAt: Date | null;
  }

  export interface TopicRecommendation {
    id: string;
    groupId: string;
    topicId: string;
    reason: string;
    createdAt: Date;
  }
}
```

### 2. Database Schema (D1 Migrations)

```sql
-- Badges table
CREATE TABLE badges (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT NOT NULL,
  completion_trigger_type TEXT NOT NULL CHECK(completion_trigger_type IN ('single_topic', 'topic_set')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES user_groups(id)
);

-- Badge topic requirements (for topic sets)
CREATE TABLE badge_topics (
  badge_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  PRIMARY KEY (badge_id, topic_id),
  FOREIGN KEY (badge_id) REFERENCES badges(id),
  FOREIGN KEY (topic_id) REFERENCES topic_nodes(id)
);

-- User badge awards
CREATE TABLE user_badge_awards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  awarded_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (badge_id) REFERENCES badges(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- Topic recommendations per group
CREATE TABLE topic_recommendations (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES user_groups(id),
  FOREIGN KEY (topic_id) REFERENCES topic_nodes(id)
);
```

### 3. Repository Ports

Add to `packages/shared/ports/`:

```typescript
// badges.ts
export interface IBadgeRepository {
  create(badge: Entities.Badge): Promise<void>;
  getById(badgeId: string): Promise<Entities.Badge | null>;
  listByGroup(groupId: string): Promise<Entities.Badge[]>;
  update(badge: Entities.Badge): Promise<void>;
  delete(badgeId: string): Promise<void>;
}

export interface IUserBadgeAwardRepository {
  create(award: Entities.UserBadgeAward): Promise<void>;
  getById(awardId: string): Promise<Entities.UserBadgeAward | null>;
  listPendingByBadge(badgeId: string): Promise<Entities.UserBadgeAward[]>;
  listApprovedByUser(userId: string): Promise<Entities.UserBadgeAward[]>;
  updateStatus(awardId: string, status: 'approved' | 'rejected', approvedBy: string): Promise<void>;
}

// recommendations.ts
export interface ITopicRecommendationRepository {
  create(recommendation: Entities.TopicRecommendation): Promise<void>;
  listByGroup(groupId: string): Promise<Entities.TopicRecommendation[]>;
  delete(recommendationId: string): Promise<void>;
}

// dashboard.ts
export interface IDashboardRepository {
  getCurrentTopic(userId: string): Promise<TopicNode | null>;
  getLastWatchedTopic(userId: string): Promise<TopicNode | null>;
}
```

### 4. API Endpoints

**Dashboard:**
- `GET /api/dashboard` — returns current topic, last-watched topic, and recommendations for user's group

**Badges (Admin only):**
- `POST /api/admin/badges` — create badge
- `GET /api/admin/badges/:groupId` — list badges for group
- `PUT /api/admin/badges/:badgeId` — update badge
- `DELETE /api/admin/badges/:badgeId` — delete badge
- `GET /api/admin/badges/:badgeId/pending-awards` — list pending badge awards with eligible users
- `POST /api/admin/badge-awards/:awardId/approve` — approve badge award
- `POST /api/admin/badge-awards/:awardId/reject` — reject badge award

**Recommendations (Admin only):**
- `POST /api/admin/recommendations` — create recommendation for group
- `GET /api/admin/recommendations/:groupId` — list recommendations
- `DELETE /api/admin/recommendations/:recommendationId` — delete recommendation

**User Badges:**
- `GET /api/users/:userId/badges` — get user's approved badges

### 5. Frontend Components

**Dashboard Page** (`apps/web/src/app/(protected)/dashboard/page.tsx`):
- Display current topic
- Display last-watched topic (with link to resume)
- Display personalized recommendations from user's group

**User Profile Badge Display** (`apps/web/src/components/user-badge-display.tsx`):
- Render approved badges as icons/symbols
- Show badge name and description on hover

**Admin Badge Management** (`apps/web/src/app/(admin)/badges/`):
- List badges per group
- Create/edit/delete badges
- View pending badge awards
- Approve/reject awards with user eligibility list

**Admin Recommendation Configuration** (`apps/web/src/app/(admin)/recommendations/`):
- Configure recommended topics per group
- Add/remove recommendations

## Alternatives Considered

1. **Automatic badge awards based on topic completion**
   - Rejected: Manual approval ensures badges maintain value and prevents unintended awards. Admins need visibility into who earns what.

2. **User-facing badge request system (users request, admin approves)**
   - Deferred: Could be added in v2, but v1 focuses on admin-controlled discovery and validation.

3. **Leaderboards alongside badges**
   - Rejected: Out of scope for this RFC and requires different UX design. Deferred to future RFC.

4. **Individual topic recommendations vs. group recommendations**
   - Chosen: Group-level recommendations. Rejected per-user manual recommendations as not scalable; per-user algorithmic recommendations deferred to future feature.

5. **Badge conditions: time-based, completion percentage, sequential**
   - Rejected for v1: Start with simple topic-completion triggers. Complex conditions deferred.

6. **Dashboard as separate page vs. card on profile**
   - Chosen: Separate dashboard page for prominence and discoverability. Profile cards can show badges separately.

## Implementation Plan

**Total estimate: ~8-10 dev days**

### Phase 1 — Foundation: Data Models & Repositories (~3 days)
- Create D1 migrations for `badges`, `badge_topics`, `user_badge_awards`, `topic_recommendations` tables.
- Implement D1 repository adapters for all four ports.
- Add entity types to `packages/shared/types/entities.ts`.
- Add repository ports to `packages/shared/ports/`.
- Unit tests for repositories.

### Phase 2 — Backend APIs (~3 days)
- Implement dashboard controller (`GET /api/dashboard`).
- Implement badge management endpoints (create, list, update, delete).
- Implement badge award endpoints (list pending, approve, reject).
- Implement recommendation endpoints (create, list, delete).
- Add Zod validators for all payloads.
- Integration tests for all endpoints.

### Phase 3 — Frontend: Dashboard & Admin UI (~3 days)
- Build dashboard page with current topic, last-watched topic, and recommendations.
- Build admin badge management screens (CRUD, pending awards).
- Build admin recommendation configuration.
- Build user badge display component.
- Integration tests for UI flows.

### Phase 4 — Polish & Deployment (~1-2 days)
- End-to-end testing (admin creates badge → user completes topics → award appears → user sees badge).
- Documentation (API docs, admin guide).
- Staging deployment and validation.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| Manual badge approval becomes admin bottleneck at scale | Phase 2: bulk-award feature; monitoring for admin workload; queue system if needed |
| Recommendation fatigue if too many per group | UI limits (e.g., max 5 recommendations); admin curation guidelines |
| Badge proliferation devalues achievements | Governance: document badge creation criteria; require admin review before deployment |
| Dashboard queries (current, last-watched, recommendations) add DB load | Add indexes on `topic_progress.user_id`, `topic_recommendations.group_id`; cache recommendations (low churn) |
| Users confused by badge conditions | Clear badge description & completion criteria in UI; tooltip showing progress |

## Success Criteria

- **Phase 1:** All repositories tested; migrations apply cleanly to fresh D1.
- **Phase 2:** All API endpoints respond correctly; manual tests confirm badge award workflow (create badge → approve user → user sees badge).
- **Phase 3:** Dashboard loads and displays current, last-watched, and recommendations correctly; admin UI allows full badge lifecycle (create, award, approve).
- **Phase 4:** End-to-end flow works in staging: admin creates badge with topic triggers → user completes topics → badge appears in pending awards → admin approves → user sees badge on profile.
- **Deployment:** Zero regressions in existing topic progress tracking; new tables indexed properly; no N+1 queries in dashboard.

## Open Questions

1. **Badge icon storage:** Should icons be stored as URLs (external CDN), base64 in DB, or uploaded to R2? (Owner: design/infra)
2. **Badge eligibility detection:** Should the system auto-detect eligible users (users who completed topic set) for approval, or should admins manually select? (Owner: product)
3. **Recommendation persistence:** Should recommendations be per-user (flexible but admin-heavy) or per-group (scalable)? RFC assumes per-group; per-user deferred. (Owner: product)
4. **Dashboard caching:** Should recommendations be cached in browser/API cache, or always fresh? (Owner: backend)
5. **Badge failure modes:** If a topic is deleted, what happens to badges that reference it? Soft-delete or migration? (Owner: backend)

## References

- Topic progress tracking: `packages/shared/types/entities.ts` (Entities.TopicProgress, Entities.TaskProgress)
- User & group entities: `packages/shared/types/entities.ts` (Entities.Identity)
- Repository ports pattern: `packages/shared/ports/` (IUserRepository, etc.)
- Cloudflare Workers auth: `apps/api/src/adapters/auth/jwt-adapter.ts`
- D1 migration pattern: `apps/api/migrations/` (existing migrations)
- Related RFCs: RFC 0001 (Enrollment & Visibility), RFC 0002 (User Groups & Management)
