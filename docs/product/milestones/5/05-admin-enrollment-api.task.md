# Task 05: Admin Enrollment API

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 5 — Engagement & Student Progress
- **Dependencies:** Task 02

---

## Summary

Expose the administrative endpoints for managing student access to topic content. Administrators can grant and revoke topic access for individual users or entire user groups.

---

## Architectural Context

- **Router:** `apps/api/src/routes/admin-enrollment.router.ts`.
- **Service:** `apps/api/src/core/enrollment/enrollment-service.ts`.
- **Security:** Guarded by `authGuard + requireRole(ADMIN, CONTENT_CREATOR)`.
- **Audit:** Every grant and revoke must emit a structured log entry (no new DB table in M5).

---

## Requirements

### 1. User Enrollment Endpoints

| Method   | Path                                          | Description                                     |
|----------|-----------------------------------------------|-------------------------------------------------|
| `GET`    | `/admin/users/:userId/enrollments`            | List direct topic grants for a user.            |
| `POST`   | `/admin/users/:userId/enrollments`            | Grant a topic (and its subtree) to a user.      |
| `DELETE` | `/admin/users/:userId/enrollments/:topicId`   | Revoke a topic grant from a user.               |

### 2. Group Enrollment Endpoints

| Method   | Path                                          | Description                                     |
|----------|-----------------------------------------------|-------------------------------------------------|
| `GET`    | `/admin/groups/:groupId/enrollments`          | List direct topic grants for a group.           |
| `POST`   | `/admin/groups/:groupId/enrollments`          | Grant a topic to a group.                       |
| `DELETE` | `/admin/groups/:groupId/enrollments/:topicId` | Revoke a topic grant from a group.              |

### 3. Business Rules

- **Idempotent Grants:** Granting the same `(user/group, topic)` twice is a no-op, returning `200 OK` with the existing record (first call returns `201 Created`).
- **Cascade Revoke:** The revoke endpoints accept a `?cascade=true` query parameter that also removes explicit descendant grants for the same subject.
- **Audit Logging:** Every grant and revoke action emits a structured log entry with the actor, subject, topic, and cascade flag.

---

## Acceptance Criteria

- [ ] All six endpoints are implemented, tested, and registered in the router.
- [ ] Idempotency and cascade semantics are covered by integration tests.
- [ ] Structured log entries are emitted for every grant and revoke action.
- [ ] Non-admin roles receive `403` on all routes.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter api test` — integration suite for `admin-enrollment.spec.ts`.

### Manual Verification
- As an admin: grant a topic subtree to a student, then view the student's effective access to confirm subtree expansion. Revoke with and without cascade and verify correct behavior.
