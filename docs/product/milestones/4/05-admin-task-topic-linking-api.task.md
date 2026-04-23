# Task 05: Admin Task-Topic Linking API

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 4 — Task Engine & Interconnection
- **Dependencies:** Task 02, Task 03, Task 04

---

## Summary

Implement the HTTP endpoints that manage the topic associations for a Task and its individual Stages. These "replace-set" endpoints allow content authors to define exactly which parts of the content catalogue are covered by a given task or stage.

---

## Architectural Context

- **Router:** Extends `apps/api/src/routes/admin-tasks.router.ts`.
- **Service:** Extends `apps/api/src/core/engagement/task-service.ts`.
- **Semantics:** Replace-style operations — each request provides the complete desired set, which the server mirrors exactly.
- **Security:** Inherits `authGuard + requireRole(ADMIN, CONTENT_CREATOR)`.

---

## Requirements

### 1. Topic Linking Endpoints

| Method | Path                                          | Body                     | Description                         |
|--------|-----------------------------------------------|--------------------------|-------------------------------------|
| `POST` | `/admin/tasks/:id/topics`                     | `{ topicIds: string[] }` | Replaces the full task-level topic link set.  |
| `POST` | `/admin/tasks/:id/stages/:stageId/topics`     | `{ topicIds: string[] }` | Replaces the stage-level topic link set. |

### 2. Validation & Consistency Rules

- **Topic Existence:** All provided `topicIds` must correspond to existing Topic Nodes (`400 UNKNOWN_TOPIC_IDS` with the list of offending IDs).
- **Stage Subset:** Stage-level topics must be a subset of the parent Task's topic set. Violations are rejected with `409 STAGE_TOPIC_NOT_IN_TASK`.
- **Publish Consistency:** When the parent Task is `published`, any newly linked topic must also be `published` (`409 LINKED_TOPIC_NOT_PUBLISHED`). Draft tasks can link to draft topics freely.
- **Cascade Shrink:** When the task-level topic set is reduced, any stage-level topic sets that reference removed IDs must be automatically pruned to maintain the subset invariant.

---

## Acceptance Criteria

- [ ] Both endpoints are implemented and tested.
- [ ] The cascade-shrink behavior (task-level shrink automatically prunes stage-level sets) is covered by an explicit test.
- [ ] All validation rules return the correct error codes.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter api test` — integration suite for `admin-task-linking.spec.ts`.

### Manual Verification
- Create a task, link two topics, add a stage, link the stage to both topics, then shrink the task's topic set to one, and verify the stage's set is automatically pruned.
