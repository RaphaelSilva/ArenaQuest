# Task 03: Stage Check-in API

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 5 — Engagement & Student Progress
- **Dependencies:** Task 01, Task 02

---

## Summary

Implement the primary student-facing write action: checking into a task stage. This endpoint is the core engagement mechanic, triggering stage completion, automatic topic progress updates, and task completion when the final stage is reached.

---

## Architectural Context

- **Endpoint:** `POST /tasks/:id/stages/:stageId/check-in`
- **Security:** `authGuard` (any authenticated student).
- **Service:** `apps/api/src/core/progress/progress-service.ts` — contains the business logic; the HTTP handler stays thin.

---

## Requirements

### 1. Access Gate

Before processing any check-in logic, verify the student is enrolled in the topics linked to this task. If not enrolled, return `403 NOT_ENROLLED`. This check must happen first to avoid leaking task structure to unenrolled users.

### 2. Ordering Enforcement

Students must check into stages in sequential order. If the requested stage is not the next expected stage, return `409 OUT_OF_ORDER` with details about which stage should be completed first.

### 3. Idempotency

Checking into the same stage twice is safe. The first call returns `201 Created`; subsequent calls for the same `(user, stage)` return `200 OK` with the same response shape.

### 4. Side Effects (Atomic)

A successful check-in must atomically:
1. Create the stage check-in record.
2. Update the task's overall progress (status and current stage pointer).
3. Mark all topics linked to the completed stage as `completed` in the student's topic progress.
4. If this was the final stage, mark the task as `completed`.

---

## Acceptance Criteria

- [ ] The endpoint enforces enrollment, ordering, and idempotency.
- [ ] All side effects are atomic — no partial updates on failure.
- [ ] Stage check-in correctly propagates topic completion.
- [ ] Completing the final stage marks the task as `completed`.
- [ ] Integration tests cover: happy path, out-of-order, idempotency, unenrolled user, and concurrent requests.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter api test` — integration suite for the check-in endpoint.

### Manual Verification
- As a seeded, enrolled student: check in stage 1 (201), repeat (200), attempt stage 3 before stage 2 (409), complete all stages and verify task completion.
