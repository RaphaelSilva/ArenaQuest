# Task 03: Admin Tasks CRUD API

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 4 — Task Engine & Interconnection
- **Dependencies:** Task 01

---

## Summary

Expose the HTTP endpoints for authoring and managing Tasks under `/admin/tasks`. This covers the full Task lifecycle management; Topic linking and Stage management are handled in Tasks 05 and 04 respectively.

---

## Architectural Context

- **Router:** `apps/api/src/routes/admin-tasks.router.ts`.
- **Service:** `apps/api/src/core/engagement/task-service.ts` — orchestrates repositories.
- **Security:** Guarded by `authGuard + requireRole(ADMIN, CONTENT_CREATOR)`.
- **Content Safety:** Task descriptions must be sanitized (via the M3 shared helper) before persistence.

---

## Requirements

### 1. Task Management Endpoints

| Method   | Path               | Description                                     |
|----------|--------------------|-------------------------------------------------|
| `GET`    | `/admin/tasks`     | List all tasks with optional status filter.     |
| `POST`   | `/admin/tasks`     | Create a new task (starts as `draft`).          |
| `GET`    | `/admin/tasks/:id` | Retrieve a single task with its stages and linked topics. |
| `PATCH`  | `/admin/tasks/:id` | Update task metadata (title, description, status). |
| `DELETE` | `/admin/tasks/:id` | Archive the task (soft delete; sets status to `archived`). |

### 2. Validation Rules

- **Title:** max 200 characters.
- **Description:** max 20,000 characters (post-sanitization).
- **Input Validation:** Zod schemas on all request bodies with clear field-level errors.

### 3. Status Lifecycle & Transition Guards

Transitions are enforced server-side:
- **`draft → published`:** Requires at least one Stage AND all linked Topics must be `published`. Fails with `409 TASK_NOT_PUBLISHABLE` with a machine-readable `reasons` list (e.g., `NO_STAGES`, `LINKED_TOPIC_NOT_PUBLISHED`).
- **`published → archived`:** Always permitted.
- **`archived → draft`:** Always permitted.
- **`archived → published`:** Forbidden (`409 INVALID_TRANSITION`).

---

## Acceptance Criteria

- [ ] All five endpoints are implemented and correctly RBAC-protected.
- [ ] Status transition guards are enforced and return the correct error codes and reasons.
- [ ] Content sanitization is active; submitting malicious content results in a sanitized, stored value.
- [ ] Integration tests cover CRUD, status guards, and role-based access.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter api test` — integration suite for `admin-tasks.router.spec.ts`.

### Manual Verification
- Create a draft task, attempt to publish without stages, and verify the 409 response with reasons.
- Confirm architecture guard: repository types are referenced through ports, not raw SQL.
