# Task 07: Frontend — Admin Tasks Dashboard

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 4 — Task Engine & Interconnection
- **Dependencies:** Task 03, Task 05

---

## Summary

Build the admin interface for managing Tasks. Consists of a list page for an overview of all tasks and a detail editor page for authoring task metadata, content, and topic associations.

---

## Architectural Context

- **Paths:** `/admin/tasks` (list) and `/admin/tasks/:id` (editor).
- **Security:** Accessible to `admin` and `content_creator` roles. Students are redirected to `/dashboard`.
- **Stage Editing:** The stage management UI is a separate implementation (Task 08); this task renders a placeholder slot for it within the editor layout.

---

## Requirements

### 1. Tasks List Page

- Displays all tasks (draft, published, archived) with status chips, stage counts, and last-updated timestamps.
- Provides a "New Task" action that creates a draft and navigates to the editor.
- Includes an "Archive" action with a confirmation step for each task row.
- Shows skeleton loaders while fetching data.

### 2. Task Editor Page

- **Metadata Fields:** Title, description (with Markdown preview using the M3 sanitization helper).
- **Topic Association:** A multi-select Topic Picker that allows associating published topics with the task. When the task is a draft, it can also select from draft topics.
- **Status Toggle:** Allows authors to change the task status. On publish failure (e.g., `409 TASK_NOT_PUBLISHABLE`), inline error messages display the specific reasons from the API response.
- **Stage Editor Slot:** Renders a clearly marked placeholder for the Stage Editor component (Task 08).

---

## Acceptance Criteria

- [ ] The list and editor pages compile and are accessible to authorized roles.
- [ ] The editor correctly saves title, description, status, and task-level topic links.
- [ ] Publish validation errors from the API are surfaced as readable inline messages.
- [ ] Students are redirected away from admin task routes.
- [ ] Component tests cover list rendering, archive flow, and publish error surfacing.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter web test` — component tests for the task list and editor.

### Manual Verification
- Log in as an admin, create a task, add topic links, and verify state is preserved after a page reload.
- Attempt to publish a task without stages and verify the inline error message.
