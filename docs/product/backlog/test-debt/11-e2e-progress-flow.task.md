# Task 11: E2E Extension — Enroll → Consume → Check-in → Dashboard

## Metadata
- **Status:** Pending
- **Complexity:** Low-Medium
- **Milestone:** 5 — Engagement & Student Progress
- **Dependencies:** Task 07 (fixture updates), Task 08, Task 09, Task 10

---

## Summary

Extend the Playwright E2E suite with a third scenario covering the complete Milestone 5 engagement loop end-to-end: an admin enrolls a student, the student consumes content, checks into all task stages, and the dashboard reflects 100% completion.

---

## Architectural Context

- **Framework:** Extends the existing `e2e/` workspace. No new runner or CI jobs required.
- **Isolation:** Each test run seeds unique topics and tasks via API helpers, with a unique enrollment grant.
- **CI:** The existing `e2e.yml` automatically picks up new spec files.

---

## Requirements

### 1. New E2E Fixture Helpers

The API fixture helpers need to be extended to support M5 enrollment operations:
- Grant topic access to a user via the Admin API.
- Revoke topic access from a user via the Admin API.

### 2. Core E2E Scenario

The new spec must cover the following complete happy path:
1. **Admin Seeds Content:** Creates published topics, a multi-stage task, links topics to stages, and publishes the task.
2. **Admin Enrolls Student:** Grants the student access to the root topic subtree.
3. **Student Checks Dashboard:** Verifies the initial progress shows 0%.
4. **Student Completes Task:** Navigates to the task and checks into every stage in order.
5. **Dashboard Reflects Completion:** Returns to the dashboard and verifies both topic and task progress show 100%.

### 3. Negative-Path Coverage (Recommended)

- Before enrollment, the student should not see the task in `/tasks`.
- After access is revoked (with cascade), the task should disappear again.

### 4. Performance Budget

- The new scenario must complete in under 60 seconds locally on a warm start.
- The full E2E suite (M3 + M4 + M5 scenarios) must remain under 4 minutes on a cold start.

---

## Acceptance Criteria

- [ ] New spec passes locally via `make e2e`.
- [ ] New spec passes in CI on a PR.
- [ ] Playwright traces and screenshots are captured on a forced test failure.
- [ ] Full E2E suite duration remains within the 4-minute budget.
- [ ] Tests use semantic selectors (`getByRole`, `getByText`) exclusively.
- [ ] Codebase remains lint-clean.

---

## Verification Plan

### Automated Tests
- `make e2e` — all three scenario files (M3, M4, M5) must pass.

### Manual Verification
- Break an assertion intentionally and verify a useful Playwright trace is generated.
- Confirm the CI run on a test branch reports the correct pass/fail status.
