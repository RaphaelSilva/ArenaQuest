# Task 08: Frontend — Admin Topic Tree Dashboard

## Metadata
- **Status:** Pending
- **Complexity:** High
- **Milestone:** 3 — Content & Media Core
- **Dependencies:** Task 04

---

## Summary

Build the management dashboard for content creators to manage the topic tree. This interface allows for building, organizing, and editing the educational hierarchy through an intuitive, interactive tree structure.

---

## Architectural Context

- **Path:** `/admin/topics`
- **Security:** Accessible only to `admin` and `content_creator` roles.
- **State Management:** Fetch and persist the tree structure using the Admin Topics API.
- **Component Strategy:** Implement a reusable and interactive tree component for managing hierarchies.

---

## Requirements

### 1. Topic Tree Management

- **Hierarchical Navigation:** Display the full topic tree (roots, children, grandchildren).
- **CRUD Operations:**
    - Create root and child nodes.
    - Inline editing for titles.
    - Detailed editing for content (Markdown), tags, and metadata.
- **Node Lifecycle:** Manage status transitions (`draft` → `published` → `archived`).

### 2. Interactive Organization

- **Drag-and-Drop:** Support reordering siblings and re-parenting nodes via drag-and-drop.
- **Conflict Handling:** Gracefully handle and display errors for illegal operations (e.g., creating circular dependencies).
- **Persistence:** Ensure all organizational changes are persisted immediately to the backend.

### 3. User Experience

- **Detail Pane:** Selecting a node in the tree opens a focused editor for its specific content and metadata.
- **Feedback:** Provide clear visual feedback (loading states, success/error toasts) for all background operations.

---

## Acceptance Criteria

- [ ] The Admin Topic Tree page is functional and restricted to authorized roles.
- [ ] Users can build a multi-level hierarchy from scratch.
- [ ] Drag-and-drop reordering and re-parenting work correctly and persist on reload.
- [ ] Circular dependency attempts are blocked and reported with clear error messages.
- [ ] Node status changes (e.g., publishing) are reflected immediately in the UI.
- [ ] Unit/Component tests cover the tree interaction logic and RBAC guards.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- Component tests for the tree widget: `pnpm --filter web test`.
- Verify role-based redirection logic.

### Manual Verification
- Log in as an admin and perform the following:
    1. Create a root topic and several sub-topics.
    2. Rearrange the hierarchy via drag-and-drop.
    3. Update topic content and verify persistence.
    4. Attempt to drag a parent under its child and verify the error handling.
