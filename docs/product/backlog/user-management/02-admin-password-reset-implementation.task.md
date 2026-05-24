# Task: Implement Admin Password Reset Capability

**Status:** Open  
**Type:** Feature  
**Milestone:** Backlog (extends Milestone 2 & 6)  
**Complexity:** Medium (2 sessions: backend + frontend)  
**Priority:** Medium  

**Related Story:** [01-admin-password-reset.story.md](./01-admin-password-reset.story.md)

---

## 1. Summary

Implement an admin-initiated password reset mechanism allowing system administrators to reset user passwords for account maintenance. The feature includes:
- Secure temporary password generation
- Email notification to the user
- Session invalidation for the target user
- Audit logging of the reset action
- Frontend UI in the Admin User Detail page
- Comprehensive test coverage

This task maintains the cloud-agnostic architecture and builds on existing password hashing (PBKDF2) and email infrastructure.

---

## 2. Dependencies

**Must be completed BEFORE:**
- Any user-facing admin enhancements requiring password management

**Depends on (already in develop):**
- Milestone 2: User Repository + Admin User CRUD endpoints
- Milestone 6: Password Management APIs (forgot-password, change-password)
- Existing PBKDF2 password hashing adapter
- Existing email sending infrastructure (used in forgot-password)
- Existing session/refresh token management

**No blocking dependencies:** This task is additive to existing APIs.

---

## 3. Technical Constraints

### Architecture
- **Adapter Pattern:** Password generation and hashing must use existing `IAuthAdapter` implementations; no new external libraries beyond what Milestone 6 already uses.
- **Cloud Agnostic:** No provider-specific imports outside `apps/api/src/adapters/`.
- **Email Provider Independence:** Reuse existing email adapter from Milestone 6 (forgot-password flow).

### Security
- **Entropy:** Temporary password must have at least 128 bits of entropy (use `crypto.getRandomValues()` for 16+ random bytes, base62-encoded).
- **No Plaintext Storage:** Temporary password is shown once in API response; never stored plaintext in database.
- **Role Validation:** Only `admin` role can call this endpoint. Non-admins receive 403 Forbidden.
- **Self-Reset Prevention:** Admin cannot reset their own password via this endpoint (returns 422 Unprocessable Entity).
- **Session Revocation:** All existing refresh tokens for the target user are immediately invalidated (atomic operation with password update).
- **Audit Trail:** Every reset attempt (success or failure) is logged with: admin user ID, target user ID, timestamp, IP address, result.

### Database
- **No schema changes required.** Reuse existing `users` table and refresh token storage.
- **Audit table (optional):** If audit logging to database, use or extend existing audit table structure (from Milestone 5 or create new).

### Email
- **Template:** Reuse "Password Reset" email template from Milestone 6 OR create new "Admin Reset" variant with subject: *"Your ArenaQuest password has been reset by an administrator"* and note from admin (if provided).
- **Fallback:** If email sending fails, API returns 500 but password IS updated (not rolled back). Admin retains the temporary password to communicate manually.

---

## 4. Scope (No Implementation Code)

### Backend (API)

**New Endpoint:**
```
POST /admin/users/:userId/reset-password
Authorization: Bearer <admin_jwt>
Body: {
  "sendEmail": boolean,
  "adminNote"?: string (optional, max 500 chars, sent in email to user)
}
Response (200 OK): {
  "userId": string,
  "temporaryPassword": string,
  "emailSent": boolean,
  "resetAt": ISO8601 timestamp
}
```

**Implementation Checklist:**
- [ ] Route handler validates `admin` role (returns 403 if not admin)
- [ ] Route handler checks that `:userId` is not the authenticated admin's own ID (returns 422 if self)
- [ ] Route handler validates user exists and is active (returns 404 if not found or inactive)
- [ ] Generate cryptographically secure temporary password (16+ random bytes, base62-encoded)
- [ ] Controller calls `IAuthAdapter.hashPassword()` with temporary password
- [ ] Controller updates user record: set password hash, update `passwordUpdatedAt` timestamp
- [ ] Controller revokes all refresh tokens for target user (atomic transaction with password update)
- [ ] If `sendEmail === true`, queue or send email with temporary password and optional admin note
- [ ] Create audit log entry: admin ID, target user ID, timestamp, IP, "password_reset_by_admin"
- [ ] Return 200 with temporary password (shown once, never stored)
- [ ] Validate input: `adminNote` length, `sendEmail` boolean type
- [ ] Error handling: Return 400 Bad Request for invalid input, 404 for missing user, 422 for self-reset, 500 if email fails but password updated

**Email Flow:**
- [ ] If email sending fails, log warning but don't fail the API response
- [ ] Email template includes: temporary password, "change this password immediately", link to Settings page, admin's optional note
- [ ] Subject line differs from user-initiated reset (admin-initiated variant)

**Audit Logging:**
- [ ] Log successful reset: admin ID, target user ID, timestamp, IP, "success"
- [ ] Log failed attempts: same info, reason (e.g., "self-reset-attempted", "unauthorized-role", "user-not-found")
- [ ] Audit logs queryable by admin (for compliance, but NOT required in this task; just ensure structure supports it)

---

### Frontend (Web Admin Panel)

**New UI Component:**
- [ ] User Detail page: Add "Reset Password" button (only visible if logged-in user is admin)
- [ ] Button opens confirmation modal with:
  - [ ] Heading: "Reset Password for [User Name]?"
  - [ ] Warning text: "This will invalidate all active sessions for this user."
  - [ ] Checkbox: "Send notification email to user"
  - [ ] Text field: "Optional note to include in email" (max 500 chars)
  - [ ] Cancel and Confirm buttons
- [ ] On confirm:
  - [ ] Call `POST /admin/users/:userId/reset-password`
  - [ ] Display temporary password in a success modal (copyable text, not visible password field)
  - [ ] Include: "Share this password with the user. They can change it in Settings after logging in."
  - [ ] Copy button for temporary password
  - [ ] Close button hides modal and refreshes user detail page
- [ ] Error handling:
  - [ ] 403 Unauthorized: "You do not have permission to reset passwords."
  - [ ] 404 Not Found: "User not found."
  - [ ] 422 Unprocessable Entity: "You cannot reset your own password. Use Settings → Change Password instead."
  - [ ] 500 Server Error: "An error occurred. The password may have been updated but the email failed to send."

**Frontend Checklist:**
- [ ] Modal component is reusable (accepts user data, disabled state)
- [ ] Temporary password is shown in plaintext (not masked) for easy copying
- [ ] Keyboard shortcut: Escape closes modal
- [ ] Button is grayed out if not admin role (checked from context)
- [ ] After reset, page auto-refreshes user data (call refresh function)
- [ ] Loading state during API call (button disabled, spinner shown)
- [ ] No sensitive data left in local state after modal closes

---

### Testing

**Backend API Tests:**
- [ ] Happy path: Admin resets user password, temporary password returned, email sent
- [ ] Happy path: Admin resets password with note, email includes note
- [ ] Happy path: Email send fails, password updated, API returns 500 but includes password
- [ ] Authorization: Non-admin calls endpoint, returns 403
- [ ] Authorization: Student role calls endpoint, returns 403
- [ ] Self-reset prevention: Admin tries to reset own password, returns 422
- [ ] User not found: Invalid userId, returns 404
- [ ] Inactive user: Reset request for archived/inactive user, returns 404 or 422
- [ ] Session invalidation: After reset, old refresh token of target user is rejected
- [ ] Session invalidation: Other users' tokens remain valid
- [ ] Audit log: Reset event recorded with correct metadata
- [ ] Input validation: adminNote exceeds 500 chars, returns 400
- [ ] Input validation: sendEmail is not boolean, returns 400
- [ ] Idempotency: Resetting same user twice returns 200 both times (stateless)

**Frontend Tests:**
- [ ] Modal renders when "Reset Password" button clicked
- [ ] Modal closes when Cancel clicked
- [ ] Modal closes when Escape pressed
- [ ] Confirmation modal shows user name correctly
- [ ] Email checkbox toggles between checked/unchecked
- [ ] Admin note text field accepts input (max length enforced in UI or server)
- [ ] Confirm button calls API with correct payload
- [ ] API response modal shows temporary password (copyable)
- [ ] Copy button copies password to clipboard
- [ ] Error modal displays for 403, 404, 422, 500
- [ ] Button is hidden if user is not admin
- [ ] Button is hidden if page is loading
- [ ] Page refreshes user data after reset completes

**Integration Tests (Optional but recommended):**
- [ ] Admin logs in → navigates to Users → selects a user → clicks Reset → enters note → confirms → sees temp password → copy button works
- [ ] Target user logs in with temp password → can access dashboard → goes to Settings → changes password → logout → logs in with new password → succeeds

---

## 5. Acceptance Criteria

- [ ] **Backend:** `POST /admin/users/:userId/reset-password` endpoint implemented and tested
- [ ] **Backend:** Only `admin` role can call endpoint (403 for others)
- [ ] **Backend:** Admin cannot reset own password via endpoint (422 for self-reset)
- [ ] **Backend:** Temporary password generated with sufficient entropy (16+ random bytes)
- [ ] **Backend:** Temporary password is returned in response and never stored plaintext
- [ ] **Backend:** All refresh tokens for target user are revoked atomically with password update
- [ ] **Backend:** Email sent to user (if requested) with password and admin note
- [ ] **Backend:** Audit log entry created for each reset attempt
- [ ] **Backend:** Error handling for invalid input, missing user, authorization failures
- [ ] **Frontend:** User Detail page has "Reset Password" button (admin only)
- [ ] **Frontend:** Confirmation modal displays with optional email and note fields
- [ ] **Frontend:** Success modal shows temporary password (copyable)
- [ ] **Frontend:** Error messages display for all error codes (403, 404, 422, 500)
- [ ] **Frontend:** Page refreshes user data after reset
- [ ] **Testing:** All API tests pass (happy path, auth, validation, idempotency)
- [ ] **Testing:** All frontend tests pass (modal interactions, API calls, error handling)
- [ ] **Lint & Build:** `make lint` and `make test` pass cleanly
- [ ] **No Regressions:** Existing password reset flows (forgot-password, change-password) remain unchanged
- [ ] **Documentation:** Admin guide or CONTRIBUTING.md updated with new capability

---

## 6. Verification Plan

### Manual Testing Checklist

1. **As Admin User:**
   - [ ] Log in to admin dashboard
   - [ ] Navigate to Users list → select any non-admin user
   - [ ] Click "Reset Password" button → modal appears
   - [ ] Leave email unchecked, click Confirm → temporary password shown
   - [ ] Copy password to clipboard (use copy button)
   - [ ] Close modal, page refreshes

2. **As Target User (New Session):**
   - [ ] Log out or use private window
   - [ ] Log in with target user email + copied temporary password
   - [ ] Verify login succeeds, redirected to dashboard
   - [ ] Go to Settings → Change Password
   - [ ] Enter any new password, submit
   - [ ] Log out and log back in with new password → succeeds

3. **Email Notification (if toggled):**
   - [ ] As admin, reset password with "Send email" checked + note
   - [ ] Check target user's inbox (or test email provider logs)
   - [ ] Verify email contains: temp password, admin note, link to Settings
   - [ ] Verify email subject differs from "Forgot Password" emails

4. **Error Cases:**
   - [ ] As non-admin user, try navigating to reset endpoint directly → 403
   - [ ] As admin, try resetting own password → error modal, no reset occurs
   - [ ] Reset invalid user ID → error modal "User not found"
   - [ ] Reset with adminNote > 500 chars → validation error

5. **Session Invalidation:**
   - [ ] Log in as target user in two browsers/devices
   - [ ] From admin, reset target user password
   - [ ] Both existing sessions should be logged out (if they try to make API calls, they get 401)

### Automated Verification

```bash
# Run tests
make test-api      # Verify new endpoint tests pass
make test-web      # Verify frontend modal tests pass
make lint          # Ensure no linting errors
make build         # Ensure project builds cleanly
```

### Compliance Checks

- [ ] No hardcoded passwords in code or tests
- [ ] No plaintext temporary passwords logged (password shown in API response only)
- [ ] Audit log includes admin ID (who reset) and target user ID (who was reset)
- [ ] PBKDF2 password hashing is used (existing adapter, no plaintext storage)

---

## 7. Implementation Notes for Developer

### Getting Started

1. Review Milestone 2 admin user CRUD endpoints (reference structure for `/admin/users/:userId`)
2. Review Milestone 6 password reset logic (forgot-password, change-password, email flow)
3. Review session/refresh token invalidation logic (used in logout, password change)
4. Check existing audit logging patterns (if any, or establish new pattern)

### Key Files to Touch

**Backend:**
- `apps/api/src/routes/admin/users.ts` — add new POST `/admin/users/:userId/reset-password` route
- `apps/api/src/controllers/admin-users.ts` — implement reset logic, call auth adapter
- `apps/api/src/adapters/email/` — reuse existing email adapter
- `apps/api/migrations/` — audit table (if new)
- `apps/api/test/` — new test file or extend admin-users.test.ts

**Frontend:**
- `apps/web/src/components/admin/UserDetail.tsx` (or similar) — add Reset button + modal
- `apps/web/src/components/admin/ResetPasswordModal.tsx` (new) — modal component
- `apps/web/src/lib/admin-users-api.ts` — add function to call reset endpoint
- `apps/web/__tests__/admin/UserDetail.test.tsx` (or similar) — modal interaction tests

### Recommended Order

1. **Backend password reset logic** (controller + route)
2. **Backend tests** (mock email, verify token revocation, audit log)
3. **Frontend modal component**
4. **Frontend integration** (button on user detail page)
5. **Frontend tests** (modal interactions, error states)
6. **Manual end-to-end test** (admin → reset → target user logs in)
7. **Code review & lint**

---

## 8. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Admin resets own password and locks self out | Prevent self-reset in code (return 422). Provide clear error message. |
| Temporary password is weak | Use cryptographic RNG (crypto.getRandomValues) with 16+ bytes, base62-encoded. |
| Temp password exposed in logs | Never log plaintext password. Log only reset event metadata. |
| Email fails silently | Log warning, return 500, but include password in response so admin can share manually. |
| Target user's old sessions remain active | Atomically revoke all refresh tokens in same transaction as password update. |
| Non-admin users can reset passwords | Strict role check in route handler; test with non-admin credentials. |

---

## 9. Future Enhancements (Out of Scope)

- Temporary password expiry (e.g., 24-hour forced change)
- Batch password reset for multiple users
- Password reset history/audit dashboard
- Integration with external password managers (1Password, Dashlane)
- MFA reset by admin
- Webhook notifications for password resets (SIEM integrations)

