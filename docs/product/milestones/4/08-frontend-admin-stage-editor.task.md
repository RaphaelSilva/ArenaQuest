# Task 08: Frontend — Admin Stage Editor

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 4 — Task Engine & Interconnection
- **Dependencies:** Task 04, Task 05, Task 07

---

## Summary

Implement the interactive Stage Editor component that fills the placeholder slot in the Task Editor (Task 07). Authors can add, rename, reorder, delete, and assign topics to each stage.

---

## Architectural Context

- **Component:** `apps/web/src/components/tasks/stage-editor.tsx` — mounted inside the Task Editor page from Task 07.
- **API:** Extends the admin tasks API client with stage and stage-topic operations.
- **Drag-and-Drop:** Reuses the `@dnd-kit/sortable` library already in place from the Milestone 3 Topic Tree.

---

## Requirements

### 1. Stage List Management

- **Reorderable:** Authors can drag-and-drop stages to reorder them. On drop, the change is persisted immediately. If the reorder fails server-side (e.g., `STAGE_SET_MISMATCH`), the list reverts to the previous state and shows a toast error.
- **Add Stage:** A button to append a new stage, which appears immediately in the list.
- **Rename Stage:** Inline label editing; changes are saved on blur. Validation errors revert the field and show an inline message.
- **Delete Stage:** Only available when the parent task is in `draft` status. When the task is `published`, the delete button is disabled with a clear tooltip explaining why.

### 2. Per-Stage Topic Association

- Each stage row has a Topic Picker constrained to the parent task's topic set.
- Topics outside the task's set are visible but disabled with a hint ("Add this topic to the task first"), guiding authors to widen the task-level set first.

---

## Acceptance Criteria

- [ ] Authors can add, rename, reorder, and delete stages (subject to the parent-status guard).
- [ ] Stage reorder is persisted and reverts gracefully on failure.
- [ ] Per-stage topic association is constrained to the task's link set.
- [ ] The delete button is disabled for published tasks with an informative tooltip.
- [ ] Component tests cover all interactions and guard behaviors.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter web test` — component tests for the stage editor.

### Manual Verification
- Open a draft task with 3 stages, drag to reorder, then reload and verify the new order is persisted.
- Publish the task and verify the delete action is disabled.
