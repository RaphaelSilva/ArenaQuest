# Task 01: Tasks & Stages Data Layer

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 4 — Task Engine & Interconnection
- **Dependencies:** Milestone 3 Task 01 (topics table must exist so FKs are valid later)

---

## Summary

Introduce the two backbone entities of Milestone 4 — `Task` and `TaskStage` — into the data layer. This includes defining the ports (interfaces), creating the D1-backed adapters, and applying the database migration.

---

## Architectural Context

- **Pattern:** Ports and Adapters — ports live in `packages/shared/ports/`, adapters in `apps/api/src/adapters/db/`.
- **Migration:** `apps/api/migrations/0007_tasks_and_stages.sql`.
- **Status Enum:** Extend `packages/shared/types/entities.ts` with a `TaskStatus` enum (`draft`, `published`, `archived`), mirroring the existing `TopicNodeStatus` pattern.

---

## Requirements

### 1. `Task` Entity

**Fields:** `id`, `title`, `description`, `status` (TaskStatus), `createdBy` (user ID), `createdAt`, `updatedAt`.

**Repository Operations:**
- `findById(id)`
- `list({ status?, limit?, offset? })`
- `create(input)`
- `update(id, patch)` — allows updating `title`, `description`, and `status`.
- `delete(id)`

### 2. `TaskStage` Entity

**Fields:** `id`, `taskId`, `label`, `order` (integer), `createdAt`.

**Repository Operations:**
- `listByTask(taskId)`
- `findById(id)`
- `create(input)`
- `update(id, patch)` — allows updating `label` and `order`.
- `delete(id)`
- `reorder(taskId, orderedIds[])` — atomically rewrites stage order.

### 3. Data Integrity Rules

- Stages are deleted when their parent Task is deleted (`ON DELETE CASCADE`).
- Stage order must be unique within a Task (enforced by unique index on `task_id, order`).

---

## Acceptance Criteria

- [ ] Database migration applies cleanly to a fresh local database.
- [ ] `ITaskRepository` and `ITaskStageRepository` are exported from `packages/shared/index.ts`.
- [ ] `TaskStatus` enum is added to the shared types.
- [ ] Both adapters pass their integration test suites.
- [ ] No D1-specific types leak beyond the adapter layer.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter api test` — new suites for both adapters.

### Manual Verification
- Apply the migration to a local dev database and verify the schema is correct.
- Confirm the architecture guard: no D1 imports outside the adapter directory.
