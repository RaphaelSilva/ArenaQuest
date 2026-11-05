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

## Delivered with Open Hardening

### 1. Admin Password Reset for User Maintenance
**Story:** [01-admin-password-reset.story.md](./01-admin-password-reset.story.md)  
**Baseline Implementation:** [02-admin-password-reset-implementation.task.md](./02-admin-password-reset-implementation.task.md)  
**Hardening Follow-up:** [03-admin-password-reset-contract-hardening.task.md](./03-admin-password-reset-contract-hardening.task.md)

**What:** Allow system administrators to reset user passwords for account maintenance.

**Why:** 
- Current self-service flows don't cover edge cases (compromised email, inaccessible account)
- Admins need maintenance capability without requiring external intervention
- Improves user support experience and system reliability

**Delivered Scope:**
- API endpoint: `POST /v1/admin/users/:id/reset-password`
- Secure temporary-password generation and optional notification email
- Refresh-token revocation for the target user
- Structured success audit line
- Reset button and confirmation/result modal in the User Detail admin panel

**Priority:** Medium  
**Status:** Baseline implemented; contract hardening remains open

**Implementation Checklist:**
- [x] Backend endpoint with admin authorization checks
- [x] Temporary password generation and optional email flow
- [x] Session revocation for target user
- [x] Frontend modal component
- [x] Focused API and UI automated tests
- [ ] Atomic password update and session revocation
- [ ] Audit every reset attempt with the contract metadata
- [ ] End-to-end verification

The baseline was introduced by commits `eddba11` (API) and `3178be7`
(web). The original task was marked done by `da3d27a`, but a source audit found
that the strict atomicity and audit requirements were not implemented. Those
gaps are tracked explicitly in Task 03 rather than silently reopening Task 02.

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
- `docs/product/mission.md` — Project mission, pillars and non-negotiables
- `docs/product/vision.md` — Project vision and long-term goals
- `docs/product/milestones/*/milestone.md` — Completed feature sets
- `CONTRIBUTING.md` — Development workflow and standards


