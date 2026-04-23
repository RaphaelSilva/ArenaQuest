# Task 10: Frontend — Admin Enrollment Panel

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 5 — Engagement & Student Progress
- **Dependencies:** Task 05

---

## Summary

Provide administrators with a UI to manage student topic access. This includes an enrollment tab on the user detail page and a minimal group management interface for group-based access grants.

---

## Architectural Context

- **User Enrollment:** Extends `/admin/users/:userId` page with a new "Enrollments" tab.
- **Group Management:** New pages at `/admin/groups` and `/admin/groups/:groupId` (if group entity exists server-side; otherwise, flag as a follow-up).
- **Security:** Client-side role gate via `useHasAnyRole(ADMIN, CONTENT_CREATOR)`.
- **Reuse:** Leverages the `TopicPicker` component from M4 for topic selection.

---

## Requirements

### 1. User Enrollment Tab (`/admin/users/:userId`)

A new "Enrollments" tab on the existing user detail page with:

- **Directly Granted Topics:** An editable list of topics explicitly granted to this user. Each row has a revoke button.
- **Add Grant:** A "Grant topic access" button that opens the Topic Picker for single-topic selection.
- **Effective Access (Read-only):** A collapsible section showing the full set of topics the user can access (direct + group grants + all descendants), visually distinguished from direct grants.
- **Cascade Revoke:** The revoke confirmation dialog includes a "Also revoke descendant grants" toggle mapping to the API's `cascade=true` flag.

### 2. Group Management (Minimal Viable)

- `/admin/groups` — A table listing existing groups with a "New group" action.
- `/admin/groups/:groupId` — Group detail showing name, member list, and granted topics, with add/remove actions for both.
- **Scope Carve-out:** If groups do not yet exist server-side, this work is scoped as a follow-up and flagged to the reviewer. The user enrollment tab is still delivered in this task.

---

## Acceptance Criteria

- [ ] Admin can grant and revoke topic access for a user from the user detail page.
- [ ] The cascade revoke toggle is visible and correctly passed to the API.
- [ ] Effective access is visually distinct from direct grants.
- [ ] The group enrollment UI exists for basic grant/revoke operations.
- [ ] Non-admin users cannot access the enrollment tab.
- [ ] Component tests cover grant flow, cascade revoke, and role-based access.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter web test` — component tests for the enrollment panel.

### Manual Verification
- As an admin: grant a root topic to a student and verify the effective access list shows the full subtree.
- Revoke with cascade unchecked; verify only the explicit grant is removed.
- Log in as the student and verify access matches what the admin configured.
