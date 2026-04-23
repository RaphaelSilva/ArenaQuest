# Task 07: Access-aware Read Filter on `/tasks` and `/topics`

## Metadata
- **Status:** Pending
- **Complexity:** Low-Medium
- **Milestone:** 5 — Engagement & Student Progress
- **Dependencies:** Task 02

---

## Summary

Tighten the student-facing read APIs to enforce enrollment-based access control. Previously, students could see all published content. After this task, students only see topics they are enrolled in and tasks whose content is fully within their access set.

---

## Architectural Context

- **Affected Services:** `TopicReadService` (M3) and `TaskReadService` (M4).
- **Access Lookup:** Computed once per request from `IEnrollmentRepository.getEffectiveAccessTopicIds()` and cached on request context.
- **Role Bypass:** Admins and content creators bypass this filter entirely.

---

## Requirements

### 1. Enrollment-based Visibility

- **Topics (`/topics`, `/catalog`):** A student can only see topics within their effective-access set.
- **Tasks (`/tasks`):** A student can only see tasks where the complete linked-topic set is a subset of their effective-access set. Tasks with any inaccessible linked topic are fully hidden.
- **No Silent Trimming:** Tasks are either fully shown or fully hidden. Never return a task with a partial set of stages or topics.

### 2. Access Lookup Efficiency

- The effective-access set must be computed only once per incoming request and stored on the request context for reuse by any handler that needs it.

### 3. Backwards Compatibility (Fixture Updates)

This change affects existing tests and E2E scenarios. All fixtures that assume "published = visible" must be updated to also enroll the test student user into the relevant topic subtree:
- M3 Playwright fixtures: enroll the seeded student when creating topics.
- M4 Playwright fixtures: enroll the seeded student before checking task visibility.
- Dev seed data: grant the demo student access to the demo root topic.

---

## Acceptance Criteria

- [ ] Students see only enrolled topics and eligible tasks.
- [ ] Admins and content creators see all content regardless of enrollment.
- [ ] M3 and M4 Playwright E2E scenarios remain green after fixture updates.
- [ ] Integration tests verify both visibility and invisibility for unenrolled students.
- [ ] Codebase remains lint-clean; all unit, integration, and E2E tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter api test` — updated visibility test suites for topics and tasks.
- `make e2e` — all M3, M4 scenarios pass with updated fixtures.

### Manual Verification
- As an unenrolled student: verify `/tasks` and `/topics` return empty results.
- Grant access and verify the content becomes visible.
- Revoke access and verify content disappears.
