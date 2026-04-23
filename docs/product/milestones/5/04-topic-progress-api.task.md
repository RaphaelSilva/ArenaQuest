# Task 04: Topic Progress API

## Metadata
- **Status:** Pending
- **Complexity:** Low
- **Milestone:** 5 — Engagement & Student Progress
- **Dependencies:** Task 01, Task 02

---

## Summary

Implement two lightweight endpoints for explicit topic-level progress signals. These allow students to mark topics as visited or completed independently of task check-ins.

---

## Architectural Context

- **Endpoints:** `POST /topics/:id/visit` and `POST /topics/:id/complete`.
- **Security:** `authGuard` (any authenticated student).
- **Service:** Extends `apps/api/src/core/progress/progress-service.ts`.

---

## Requirements

### 1. Visit Endpoint (`POST /topics/:id/visit`)

- Signals that a student has opened a topic.
- Transitions status from `not_started` to `in_progress`.
- **Monotonic:** Never demotes a status. If the topic is already `completed`, this is a no-op.
- Idempotent: Repeated calls are safe and return `200 OK`.

### 2. Complete Endpoint (`POST /topics/:id/complete`)

- Explicitly marks a topic as fully read/completed by the student.
- Transitions status to `completed` regardless of current state.
- Idempotent: Repeated calls are safe and return `200 OK`.

### 3. Access & Visibility Guards

- **Enrollment Check:** Both endpoints return `403` if the topic is not in the student's effective-access set.
- **Draft/Archived Guard:** Both endpoints return `404` for non-published topics (to prevent information disclosure about the existence of hidden content).

### 4. Response Shape

Both endpoints return `{ topicProgress, changed }`, where `changed` indicates whether the status was actually updated, allowing the UI to decide whether to refresh related views.

---

## Acceptance Criteria

- [ ] Both endpoints are implemented and guarded correctly.
- [ ] The monotonic status contract is covered by a test (visit on a completed topic must not change status).
- [ ] The `changed` flag correctly distinguishes mutations from no-ops.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter api test` — integration suite for topic progress endpoints.

### Manual Verification
- As a seeded, enrolled student: visit a topic (becomes `in_progress`), complete it, then visit again and verify it stays `completed`.
