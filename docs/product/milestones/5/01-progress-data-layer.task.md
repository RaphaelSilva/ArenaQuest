# Task 01: Progress Data Layer

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 5 — Engagement & Student Progress
- **Dependencies:** Milestone 3 Task 01 (topics), Milestone 4 Task 01 (tasks & stages)

---

## Summary

Introduce the three progress tracking entities into the data layer. This is the foundational task for all engagement and progress features in Milestone 5.

---

## Architectural Context

- **Pattern:** Ports and Adapters — port in `packages/shared/ports/`, adapter in `apps/api/src/adapters/db/`.
- **Migration:** `apps/api/migrations/0009_progress.sql`.
- **Design Principle:** Append-only for stage check-ins (no updates, no deletes). Topic and task progress use upsert semantics (last write wins).

---

## Requirements

### 1. `TopicProgress` Entity

Tracks a student's progress on a specific topic.

**Fields:** `id`, `userId`, `topicNodeId`, `status` (`not_started` | `in_progress` | `completed`), `completedAt` (nullable), `createdAt`, `updatedAt`.

**Constraint:** One row per `(userId, topicNodeId)` pair (unique index).

### 2. `TaskProgress` Entity

Tracks a student's overall progress through a task.

**Fields:** `id`, `userId`, `taskId`, `status` (`not_started` | `in_progress` | `completed`), `currentStageId` (nullable), `completedAt` (nullable), `createdAt`, `updatedAt`.

**Constraint:** One row per `(userId, taskId)` pair.

### 3. `TaskStageProgress` Entity (Stage Check-In)

An immutable, append-only log of a student checking into a task stage.

**Fields:** `id`, `userId`, `taskId`, `stageId`, `checkedInAt`.

**Constraint:** One row per `(userId, stageId)` — a stage can only be checked into once per user.

### 4. Repository Operations (`IProgressRepository`)

- **Topic Progress:** Get, list, and upsert for a user's topic progress.
- **Task Progress:** Get, list, and upsert for a user's task progress.
- **Stage Check-Ins:** Check existence, list by task, and create (idempotent).
- **Aggregates:** Count completed topics and tasks for a user (filtered by a provided ID list).

---

## Acceptance Criteria

- [ ] Database migration applies cleanly to a fresh local database.
- [ ] `IProgressRepository` is exported from `packages/shared/index.ts`.
- [ ] Adapter passes all integration tests, including idempotency and cascade deletion.
- [ ] No D1-specific types leak beyond the adapter layer.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter api test` — adapter integration suite.

### Manual Verification
- Apply the migration and verify the schema matches the defined entities.
