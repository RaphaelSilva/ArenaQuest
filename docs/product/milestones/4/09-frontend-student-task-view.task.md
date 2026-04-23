# Task 09: Frontend — Student Task View

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 4 — Task Engine & Interconnection
- **Dependencies:** Task 06

---

## Summary

Build the read-only student-facing interface for browsing published Tasks. Students can explore the task list and dive into individual tasks to see their description, stages, and the associated learning content from the catalogue.

> **Note:** Progress tracking and check-in functionality are scoped to Milestone 5. This task delivers the navigation and content view only.

---

## Architectural Context

- **Paths:** `/tasks` (list) and `/tasks/:id` (detail).
- **Security:** Accessible to any authenticated user.
- **Navigation:** A "Tasks" link must be added to the main protected-area sidebar.
- **Content Integration:** Topic chips deep-link into the `/catalog/:topicId` page from Milestone 3.

---

## Requirements

### 1. Task List Page

- Displays published tasks as a card grid/list with the task title, stage count, and a call-to-action.
- Provides a friendly empty-state view when no tasks are available (does not suggest creating tasks, as students cannot).

### 2. Task Detail Page

- **Header:** Task title.
- **Description:** Renders the sanitized Markdown content safely.
- **Stage List:** Ordered list of stages, each showing its label and associated topic links.
- **Topic Chips:** Each topic is a navigable link to `/catalog/:topicId`, styled clearly as interactive.
- **Accessibility:** Stage list uses semantic HTML (`ol`/`li`) so screen readers enumerate stages and their topics meaningfully.

---

## Acceptance Criteria

- [ ] `/tasks` and `/tasks/:id` are accessible to any authenticated user.
- [ ] Draft and archived tasks do not appear (enforced by the server).
- [ ] Markdown content is rendered securely (XSS protected).
- [ ] Clicking a topic chip navigates correctly to the catalogue page.
- [ ] The "Tasks" entry is visible in the main navigation for all signed-in roles.
- [ ] Component tests cover list rendering, detail view, XSS safety, and empty state.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter web test` — component tests for task list and detail views.

### Manual Verification
- Seed a task via the admin UI, log in as a student, and navigate the full experience:
    1. Browse the task list.
    2. Open a task and read its content.
    3. Click a topic chip and verify navigation to the catalogue.
