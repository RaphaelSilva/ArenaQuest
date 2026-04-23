# Task 02: Topic Linking Junctions

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 4 — Task Engine & Interconnection
- **Dependencies:** Task 01

---

## Summary

Introduce the junction tables and repository that connect `Task` and `TaskStage` to the `TopicNode` catalogue. This is the core interconnection layer of the milestone, enabling tasks and their stages to reference specific learning content.

---

## Architectural Context

- **Migration:** `apps/api/migrations/0008_task_topic_links.sql`.
- **Port:** `ITaskLinkingRepository` in `packages/shared/ports/`.
- **Adapter:** `apps/api/src/adapters/db/d1-task-linking-repository.ts`.
- **Error Types:** A typed `StageTopicNotInTaskError` must be defined in `packages/shared/ports/` for use by the adapter and service layers.

---

## Requirements

### 1. Linking Model

- **Task ↔ Topic:** A Task can be linked to multiple Topic Nodes (`task_topic_links` junction).
- **Stage ↔ Topic:** A Stage can be linked to a subset of its parent Task's topics (`task_stage_topic_links` junction).
- **Narrowing Invariant:** The set of topics linked to a Stage must always be a subset of the topics linked to its parent Task. Any attempt to violate this must be rejected.

### 2. Data Integrity

- **Cascades (Task/Stage side):** Deleting a Task or Stage removes its topic links.
- **Restriction (Topic side):** Deleting a Topic Node that is referenced by any link must fail loudly, preventing orphaned references. An admin must explicitly detach the topic before deleting it.
- **Uniqueness:** Each `(task, topic)` and `(stage, topic)` pair must be unique.

### 3. Repository Operations

- `setTaskTopics(taskId, topicIds[])` — Atomically replaces the full set of topic links for a task.
- `listTaskTopics(taskId)` — Retrieves all topic IDs linked to a task.
- `setStageTopics(stageId, topicIds[])` — Replaces the topic links for a stage, enforcing the narrowing invariant.
- `listStageTopics(stageId)` — Retrieves all topic IDs linked to a stage.
- `hydrate(taskId)` — Returns an aggregate of both the task-level and all stage-level topic link sets for a given task.

---

## Acceptance Criteria

- [ ] Database migration applies cleanly.
- [ ] `ITaskLinkingRepository` is exported from `packages/shared/index.ts`.
- [ ] The narrowing invariant is enforced and covered by an explicit test.
- [ ] Deleting a referenced Topic Node fails with a clear error.
- [ ] All adapter tests pass under the Workers test pool.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter api test` — adapter integration suite.

### Manual Verification
- Attempt to delete a Topic Node that is currently linked to a Task; verify it fails.
- Apply the migration and verify the schema (foreign keys, unique constraints) in the local DB.
