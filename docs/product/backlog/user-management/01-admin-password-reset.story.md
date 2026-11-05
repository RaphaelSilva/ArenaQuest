# User Story: Admin Password Reset for User Maintenance

**Status:** Implemented with hardening follow-up open  
**Priority:** Medium  
**Epic:** User & Account Management  
**Participants:** System Admin, End Users  

---

## Problem Statement

As a **system administrator**, I need the ability to **reset or set a password for any user account**, so that I can:
- Resolve user account access issues without requiring the user to use the self-service password reset flow
- Provision new accounts with temporary passwords
- Perform emergency maintenance when a user cannot access their account through normal means

Currently, the only password recovery mechanism is self-service:
1. User requests "Forgot Password" → receives email reset link
2. User resets via link

This works for typical scenarios but leaves admins powerless when:
- A user's email is compromised and password reset emails are intercepted
- A user never received their initial account setup email
- A user claims they cannot access their email
- A mass user provisioning scenario requires initial password setup

---

## Acceptance Criteria (User Story Level)

- [x] Admin can navigate to a user's detail page in the Admin Panel
- [x] Admin can trigger a "Reset Password" action (distinct from the user self-resetting)
- [x] Admin receives a generated temporary password to send to the user
- [x] The temporary password is generated from 16 cryptographically random bytes
- [ ] Every reset attempt is logged with the required audit metadata
- [x] User can be notified by email, including an optional note from the admin
- [x] All existing refresh tokens for the target user are revoked on the successful path
- [x] Admin cannot reset their own password via this mechanism (use Settings → Change Password instead)
- [x] The admin performing the reset must have `admin` role

The feature is usable, but the story is not fully closed: the password update
and token revocation are currently separate writes, and only successful resets
emit an audit line. See
[Task 03 — Admin Password Reset Contract Hardening](./03-admin-password-reset-contract-hardening.task.md).

---

## Related Capabilities

- Extends **Milestone 2** (User Management CRUD endpoints)
- Extends **Milestone 6** (Password Management APIs)
- Complements `POST /account/change-password` (user-initiated)
- Complements `POST /auth/forgot-password` (self-service reset)

---

## Out of Scope

- Temporary password expiry enforcement (admin sets permanent password or user changes on next login)
- Multi-factor authentication reset (separate security concern)
- Batch password reset for multiple users (future admin tooling)
- Integration with external identity providers (OAuth-based users have different reset flow)

---

## Implementation Notes

This feature touches:
1. **Backend API:** New endpoint `POST /admin/users/:userId/reset-password` (requires `admin` role)
2. **Backend Data:** Audit log entry to record who reset which user's password
3. **Frontend UI:** Button on User Detail page in Admin Panel to trigger reset
4. **Email Flow:** Optional notification email to user (subject: "Your password has been reset by an administrator")
5. **Session Management:** Call existing token revocation logic

Architectural guardrail: Maintain provider independence for password hashing (existing PBKDF2 adapter continues).

---

## Related Issues / Discussions

Referenced in: none yet

---

## Definition of Done for Implementation Task

- [x] Backend: `POST /v1/admin/users/:id/reset-password` endpoint implemented
- [x] Backend: Response includes the generated temporary password
- [ ] Backend: Audit record covers successful and failed reset attempts
- [x] Backend: All refresh tokens for target user are invalidated on success
- [x] Backend: Endpoint requires `admin` role; returns 403 if called by non-admin
- [x] Backend: Admin cannot reset own password via this endpoint
- [x] Backend: Input validation on user ID, role check
- [x] Frontend: User Detail page has "Reset Password" button
- [x] Frontend: Button opens confirmation modal (prevents accidental clicks)
- [x] Frontend: Modal allows optional note to user
- [x] Frontend: After reset, displays the generated password
- [x] Email: Optional notification email sent to user (if toggled in modal)
- [x] Tests: Focused API endpoint tests pass
- [x] Tests: Frontend modal interaction tests pass
- [ ] Docs: `CONTRIBUTING.md` or admin guide updated with this new capability
- [ ] Full `make lint` and `make test` reverified on the current tree
- [ ] No provider-specific imports outside adapters

## Verification Evidence

Reconciled on 2026-09-23 from the current tree and Git history:

- `eddba11` — baseline backend endpoint, controller, email template and tests.
- `3178be7` — admin detail integration, modal, API client and UI tests.
- `da3d27a` — historical documentation-only closeout that marked every Task 02
  criterion complete; the current audit supersedes that blanket claim.
- `pnpm test test/controllers/admin-users.controller.spec.ts test/routes/admin-users.router.spec.ts`
  from `apps/api` — 46 passed, 1 skipped.
- `pnpm exec vitest run __tests__/components/admin/ResetPasswordModal.test.tsx`
  from `apps/web` — 16 passed.

No browser-based end-to-end flow, full lint, full test suite or deployed email
delivery was run during this reconciliation.
