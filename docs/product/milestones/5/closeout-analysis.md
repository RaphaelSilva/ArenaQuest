# Milestone 5 — Close-out Analysis

**Date:** 2026-05-06
**Scope:** `docs/product/milestones/5/` — Engagement & Student Progress
**Goal:** Decide whether the project can advance to Milestone 6.

---

## 1. Executive Summary

All **10 tasks** listed in `milestone.md` are marked **Completed**, and every technical requirement for Milestone 5 has been met. The system now supports a full learner engagement loop, from enrollment and effective access to stage check-ins and progress visualization.

| Suite | Files | Tests | Status |
|-------|-------|-------|--------|
| `apps/api` (Vitest + Pool Workers) | 40 | **524** | ✅ pass |
| `apps/web` (Vitest + RTL) | 16 | **127** | ✅ pass |

**Recommendation:** The milestone's functional and technical contracts are met. The platform is now a functional LMS core with progress tracking and access control. The project **may advance to Milestone 6** (Portability Testing & Launch).

---

## 2. Acceptance Criteria — Milestone Level

| # | Criterion | State | Evidence |
|---|-----------|-------|----------|
| 1 | Student enrollment restricts content visibility | ✅ | `getEffectiveAccessTopicIds` CTE + `PublicTasksController` filters |
| 2 | Stage check-ins are sequential and idempotent | ✅ | `progress-service.spec.ts` + `tasksApi.checkIn` logic |
| 3 | Final stage check-in completes the task | ✅ | `task_progress` table state update |
| 4 | Dashboard shows live summary and "Continue" list | ✅ | `DashboardClient.tsx` with SWR and `progressApi` |
| 5 | Topic roll-up accurately calculates tree progress | ✅ | `topic-rollup.ts` unit tests |
| 6 | Recursive CTE handles 1,000+ topics efficiently | ✅ | Performance test in `d1-enrollment-repository.spec.ts` (<50ms) |

---

## 3. Test Coverage Analysis

### 3.1 What *is* covered

**Backend (`apps/api`)** — 524 tests:
- `adapters/db/d1-progress-repository.spec.ts` — Topic and Task progress upserts and aggregates.
- `adapters/db/d1-enrollment-repository.spec.ts` — Recursive CTE for effective access and cascade revoke.
- `core/progress/progress-service.spec.ts` — Business logic for check-ins, status transitions, and ordering.
- `routes/progress.router.spec.ts` — `/me/progress/*` endpoints for student dashboard.

**Frontend (`apps/web`)** — 127 tests:
- `components/dashboard/__tests__/dashboard-client.test.tsx` — SWR caching, loading states, and summary rendering.
- `lib/__tests__/topic-rollup.test.ts` — Recursive progress calculation for the topic tree.
- `components/tasks/__tests__/student-task-detail.test.tsx` — Stage check-in flow and error handling.

---

## 4. Outstanding Activities

- **Gamification (Future Phase):** Points, badges, and rewards are not yet implemented (deferred as per Phase 5 spec).
- **Tutor Review (M6+):** Peer review stages are currently auto-advanced; tutor-gated stages are deferred.
- **Materialized Views:** If recursive CTE performance degrades at 10,000+ nodes, consider a materialized `effective_access` table in a future hardening sprint.

---

## 5. Security Audit Findings

| # | Severity | Finding | Location | Mitigation |
|---|----------|---------|----------|------------|
| S-13 | Medium | Access Leak via Root topics | `EnrollmentService` | Verified that revoking a root topic correctly cascades and removes access to all descendants. | ✅ **Closed** |
| S-14 | Low | Information Disclosure (Unenrolled) | `PublicTasksController` | Verified that unenrolled students receive 404/403 for tasks/topics they cannot see, preventing existence disclosure. | ✅ **Closed** |

---

## 6. Go / No-Go for Milestone 6

| Gate | Status |
|------|--------|
| All Milestone 5 tasks closed | ✅ |
| All acceptance criteria met | ✅ |
| Test suites green | ✅ |
| Performance targets met (CTE <50ms) | ✅ |

**Decision:** **GO** to Milestone 6 (Portability Testing & Launch).
