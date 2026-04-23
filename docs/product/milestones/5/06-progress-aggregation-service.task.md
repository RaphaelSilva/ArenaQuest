# Task 06: Progress Aggregation Service & `/me/progress/*` API

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 5 — Engagement & Student Progress
- **Dependencies:** Task 01, Task 02, Task 03, Task 04

---

## Summary

Implement the read-only progress API that powers the student dashboard. All responses are automatically scoped to the student's effective access, ensuring percentages reflect completion of content the student can actually see — not the global catalogue.

---

## Architectural Context

- **Router:** Extends `apps/api/src/routes/progress.router.ts`.
- **Service:** Extends `apps/api/src/core/progress/progress-service.ts`.
- **Security:** `authGuard` (any authenticated student).
- **Shared Types:** Response shapes must be defined in `packages/shared/types/api.ts` for cross-client use.

---

## Requirements

### 1. Progress Summary Endpoint (`GET /me/progress/summary`)

Returns a high-level overview of the student's overall progress:
- **Topics:** Total accessible, completed, in-progress, and completion percentage.
- **Tasks:** Total accessible, completed, in-progress, and completion percentage.
- **Last Activity:** Timestamp of the most recent progress update.

### 2. Topic Progress List (`GET /me/progress/topics`)

Returns the student's individual progress record for each topic within their effective access. Topics outside the access set must never appear.

### 3. Task Progress List (`GET /me/progress/tasks`)

Returns the student's individual progress record for each accessible task (published tasks whose linked topics are within the student's access set).

### 4. Calculation Rules

- **Denominator:** The "total" for percentages is the count of accessible, published content items — not all content globally.
- **Division by Zero:** When total is 0, percentage must be 0 (never `NaN` or an error).
- **Caching:** `Cache-Control: private, max-age=15` on all three routes.

---

## Acceptance Criteria

- [ ] All three endpoints are implemented and guarded by `authGuard`.
- [ ] Percentages are deterministic and handle the zero-total edge case.
- [ ] Response shapes match the shared types in `packages/shared`.
- [ ] No data from outside the student's effective access leaks into any response.
- [ ] Integration tests verify percentage correctness and access scoping.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter api test` — integration suite for `me-progress.spec.ts`.

### Manual Verification
- Seed a fixture with 10 topics and 5 tasks with known progress states, then confirm the summary percentages match expectations via `curl`.
