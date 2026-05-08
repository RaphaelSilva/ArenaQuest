# Task 10: E2E Extension — Task Authoring → Student View

## Metadata
- **Status:** Pending
- **Complexity:** Low
- **Milestone:** 4 — Task Engine & Interconnection
- **Dependencies:** Task 07, Task 08, Task 09 (and the M3 Playwright scaffold, Task 11)

---

## Summary

Extend the Playwright E2E suite from Milestone 3 with a new scenario covering the complete Task lifecycle — from admin authoring through to student consumption and cross-navigation to the content catalogue.

---

## Architectural Context

- **Framework:** Extends the existing `e2e/` workspace. No new scaffolding or CI jobs required.
- **Isolation:** Each test run seeds a unique topic tree and task via API helpers to ensure determinism and parallel-safe execution.
- **CI:** The existing `e2e.yml` GitHub Actions workflow automatically picks up new spec files.

---

## Requirements

### 1. New E2E Fixture Helpers

The API fixture helpers need to be extended to support the Milestone 4 operations:
- Create a Task via the API.
- Add a Stage to a Task.
- Link topics to a Stage.
- Publish a Task.

### 2. Core E2E Scenario

The new spec must cover the following happy path:
1. **Admin Seeds Content:** Uses API helpers to create published topics, create a task with stages, link topics to stages, and publish the task.
2. **Student Browses:** Logs in as a student and navigates to `/tasks`.
3. **Task Visibility:** Verifies the published task appears in the list.
4. **Task Detail:** Opens the task and verifies the title, stages, and topic chips are correct.
5. **Catalogue Deep Link:** Clicks a topic chip and verifies successful navigation to the correct `/catalog/:topicId` page.

### 3. Performance Budget

- The new spec must complete in under 45 seconds on a warm local start.
- The total E2E suite must remain under 3 minutes on a cold start.

---

## Acceptance Criteria

- [ ] New spec passes locally via `make e2e`.
- [ ] New spec passes in CI on a PR.
- [ ] Playwright traces and screenshots are captured on a forced test failure.
- [ ] Total E2E suite duration remains within the 3-minute budget.
- [ ] Tests use semantic selectors (`getByRole`) rather than brittle CSS selectors.
- [ ] Codebase remains lint-clean.

---

## Verification Plan

### Automated Tests
- `make e2e` — both the M3 smoke test and the new M4 spec must pass.

### Manual Verification
- Deliberately introduce a broken assertion (e.g., wrong task title) and verify that the failure generates a useful Playwright trace in the test-results directory.
