# Task 04: Admin Task Stages API

## Metadata
- **Status:** Completed
- **Complexity:** Medium
- **Milestone:** 4 — Task Engine & Interconnection
- **Dependencies:** Task 03

---

## Summary

Implement nested REST endpoints for managing `TaskStage` resources under `/admin/tasks/:id/stages`. Includes CRUD operations and a bulk reorder action, with a parent-status guard preventing stage mutations on published tasks.

---

## Technical Constraints

- **Router:** Extends `apps/api/src/routes/admin-tasks.router.ts`.
- **Service:** Logic implemented in `apps/api/src/controllers/admin-task-stages.controller.ts`.
- **Security:** Inherits `authGuard + requireRole(ADMIN, CONTENT_CREATOR)` from the parent task router.

---

## Scope (no code)

### 1. Stage Management Endpoints

| Method   | Path                                     | Description                                     |
|----------|--------------------|-------------------------------------------------|
| `POST`   | `/admin/tasks/:id/stages`                | Add a new stage to a task.                      |
| `PATCH`  | `/admin/tasks/:id/stages/:stageId`       | Update a stage's label.                         |
| `DELETE` | `/admin/tasks/:id/stages/:stageId`       | Remove a stage from a task.                     |
| `POST`   | `/admin/tasks/:id/stages/reorder`        | Rewrite the full ordered sequence of stages.    |

### 2. Business Rules

- **Auto-ordering:** New stages are appended to the end of the list with automatic order allocation.
- **Atomic Reorder:** The reorder endpoint accepts the complete, desired ordered list of stage IDs and replaces the existing order. The request is rejected if the provided set does not exactly match the current set (`409 STAGE_SET_MISMATCH`).
- **Label Validation:** Stage labels must be 1–120 characters, trimmed, with no newlines.
- **Parent-Status Guard:** Stages cannot be deleted when the parent Task has `published` status (`409 STAGE_DELETE_FORBIDDEN`).
- **Ownership Validation:** Any stage operation must verify the stage belongs to the specified Task (otherwise `404`).

---

## Acceptance Criteria

- [x] All four endpoints are implemented and tested.
- [x] Stage reorder is atomic with no duplicate order conflicts.
- [x] The parent-status delete guard is enforced and covered by a test.
- [x] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter api test` — integration suite for `admin-task-stages.spec.ts`.

### Manual Verification
- Create a task, add three stages, reorder them via the API, and verify persistence.
- Publish the task and verify that the delete endpoint returns the correct 409 error.
