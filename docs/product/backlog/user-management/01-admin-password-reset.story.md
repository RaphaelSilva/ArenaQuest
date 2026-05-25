# User Story: Admin Password Reset for User Maintenance

**Status:** Open  
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

- [ ] Admin can navigate to a user's detail page in the Admin Panel
- [ ] Admin can trigger a "Reset Password" action (distinct from the user self-resetting)
- [ ] Admin receives a generated temporary password OR a reset link to send to the user
- [ ] The temporary/reset password is secure (randomly generated, sufficient entropy)
- [ ] The password reset is logged for audit purposes (admin ID, timestamp, target user ID)
- [ ] User is notified via email that their password was reset (optional note from admin)
- [ ] Session invalidation: all existing refresh tokens for that user are revoked
- [ ] Admin cannot reset their own password via this mechanism (use Settings → Change Password instead)
- [ ] The admin performing the reset must have `admin` role

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

- [ ] Backend: `POST /admin/users/:userId/reset-password` endpoint implemented
- [ ] Backend: Response includes temporary password or reset link
- [ ] Backend: Audit log created with reset event
- [ ] Backend: All refresh tokens for target user are invalidated
- [ ] Backend: Endpoint requires `admin` role; returns 403 if called by non-admin
- [ ] Backend: Admin cannot reset own password via this endpoint
- [ ] Backend: Input validation on user ID, role check
- [ ] Frontend: User Detail page has "Reset Password" button
- [ ] Frontend: Button opens confirmation modal (prevents accidental clicks)
- [ ] Frontend: Modal allows optional note to user
- [ ] Frontend: After reset, displays generated password or confirmation of reset link sent
- [ ] Email: Optional notification email sent to user (if toggled in modal)
- [ ] Tests: API endpoint tests (success, validation, authorization)
- [ ] Tests: Frontend modal interaction tests
- [ ] Docs: `CONTRIBUTING.md` or admin guide updated with this new capability
- [ ] `make lint` and `make test` pass
- [ ] No provider-specific imports outside adapters
