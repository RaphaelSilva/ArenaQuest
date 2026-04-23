# Task 02: Enrollment Data Layer

## Metadata
- **Status:** Pending
- **Complexity:** Medium-High
- **Milestone:** 5 — Engagement & Student Progress
- **Dependencies:** Milestone 3 Task 01 (topics)

---

## Summary

Implement the enrollment system that controls which topics each student can access. This includes direct user grants, group-based grants, and the critical "Effective Access" calculation that determines the full set of topics a student can see — including all descendants of any granted subtree.

---

## Architectural Context

- **Pattern:** Ports and Adapters — port in `packages/shared/ports/`, adapter in `apps/api/src/adapters/db/`.
- **Migration:** `apps/api/migrations/0010_enrollments.sql`.
- **Key Dependency:** Requires `user_groups` and `user_group_members` tables. Verify these exist before starting; if not, add a minimal migration and flag as a scope-slip from M2.

---

## Requirements

### 1. Enrollment Model

- **Direct User Grants:** A specific user is granted access to a specific topic node.
- **Group Grants:** A user group is granted access to a topic node; all members inherit that access.
- **Audit Trail:** Every grant records who issued it (`grantedBy`) and when (`grantedAt`).
- **Uniqueness:** Each `(user, topicNode)` and `(group, topicNode)` grant pair is unique.

### 2. Effective Access Calculation

The core contract of this data layer:

> **`getEffectiveAccessTopicIds(userId)`** returns the complete set of topic IDs a student can access: the union of their direct grants, their group grants, AND all descendants of any granted topic subtree.

- **Performance Target:** This query must complete in under 50ms against a fixture of 1,000 topics and 20 grants. A recursive query strategy is expected; verify and document performance at the start of the task.
- **No Materialized Cache in M5:** Compute on every request. Revisit with caching in M6 if dashboard p95 exceeds 500ms.

### 3. Repository Operations (`IEnrollmentRepository`)

- **User Grants:** List, grant, and revoke for a specific user.
- **Group Grants:** List, grant, and revoke for a specific group.
- **Revoke Cascade:** A `cascade=true` option on revoke also removes any descendant grants for the same subject.
- **Idempotency:** Granting the same `(user, topic)` twice is a no-op (returns existing record).

---

## Acceptance Criteria

- [ ] Database migration applies cleanly.
- [ ] `IEnrollmentRepository` is exported from `packages/shared/index.ts`.
- [ ] `getEffectiveAccessTopicIds` correctly expands to all descendants.
- [ ] Performance test passes: effective access query under 50ms on a 1,000-topic fixture.
- [ ] Cascade revoke behavior is covered by an explicit test.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter api test` — adapter integration suite, including the performance assertion.

### Manual Verification
- Seed 1,000 topics and verify the effective access query performance locally.
- Apply migration and inspect the schema (foreign keys, unique constraints, cascade semantics).
