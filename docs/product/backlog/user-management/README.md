# User Management Backlog

This folder contains product stories and implementation tasks for user account management features that enhance or extend core identity functionality.

## Current Features

### Completed (Milestones 2 & 6)
- ✅ User creation and profile management (Milestone 2)
- ✅ User password self-service (Milestone 6)
  - Forgot password with email reset link
  - Authenticated user can change own password
- ✅ Role-based access control (Milestone 2)
- ✅ Google OAuth social login (Milestone 6)

## Open Backlog

### 1. Admin Password Reset for User Maintenance
**Story:** [01-admin-password-reset.story.md](./01-admin-password-reset.story.md)  
**Implementation Task:** [02-admin-password-reset-implementation.task.md](./02-admin-password-reset-implementation.task.md)

**What:** Allow system administrators to reset user passwords for account maintenance.

**Why:** 
- Current self-service flows don't cover edge cases (compromised email, inaccessible account)
- Admins need maintenance capability without requiring external intervention
- Improves user support experience and system reliability

**Scope:**
- New API endpoint: `POST /admin/users/:userId/reset-password`
- Generates secure temporary password
- Sends notification email to user
- Invalidates user's active sessions
- Audit logging for compliance
- Frontend UI: Reset button in User Detail admin panel

**Complexity:** Medium (2 development sessions: backend + frontend)  
**Priority:** Medium  
**Status:** Open (ready for planning)

**Implementation Checklist:**
- [ ] Backend endpoint with authorization checks
- [ ] Temporary password generation and email flow
- [ ] Session revocation for target user
- [ ] Audit logging
- [ ] Frontend modal component
- [ ] API integration tests
- [ ] UI interaction tests
- [ ] End-to-end verification

---

## Architecture Notes

All tasks in this folder maintain:
- **Cloud Agnosticism:** No provider-specific libraries outside adapters
- **Adapter Pattern:** Reuse existing password hashing and email infrastructure
- **Security First:** Proper role checks, session management, audit trails
- **Testing:** Comprehensive unit and integration test coverage

---

## How to Contribute

1. Review the relevant story (01-*.story.md) for business context
2. Review the implementation task (02-*.task.md) for technical details
3. Create a feature branch: `feature/backlog/[folder]/[task-name]`
4. Follow the "Scope" section precisely (no code written outside that boundary)
5. Ensure all acceptance criteria are checked
6. Run `make lint` and `make test` before requesting review
7. Update this README if adding new stories or tasks

---

## Questions?

Refer to:
- `docs/product/vision.md` — Project vision and long-term goals
- `docs/product/specification.md` — Functional requirements overview
- `docs/product/milestones/*/milestone.md` — Completed feature sets
- `CONTRIBUTING.md` — Development workflow and standards

