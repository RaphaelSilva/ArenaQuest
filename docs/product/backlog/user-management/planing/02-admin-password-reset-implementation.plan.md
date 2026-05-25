# Plan — 02-admin-password-reset-implementation

**Task:** [02-admin-password-reset-implementation.task.md](../02-admin-password-reset-implementation.task.md)  
**Source:** Backlog  
**Assigned personas:** backend-developer (first), then frontend-developer  
**Branch:** feature/backlog/02-admin-password-reset-implementation.task

## Objective

Implement a secure admin-initiated password reset capability allowing system administrators to reset user passwords for account maintenance. Includes temporary password generation, optional email notification, session invalidation, and audit logging. Backend implements the API endpoint first; frontend adds the UI component and integration.

## Affected areas

### Backend
- `apps/api/src/routes/admin/users.ts` — add POST `/admin/users/:userId/reset-password` route
- `apps/api/src/controllers/admin-users.ts` — password reset controller logic (or create if doesn't exist)
- `apps/api/src/core/result.ts` — reuse ControllerResult pattern (already exists)
- `apps/api/src/core/decorators.ts` — reuse @ValidateBody and @Body (already exists)
- `apps/api/src/adapters/auth/` — use existing IAuthAdapter for password hashing
- `apps/api/src/adapters/email/` — reuse existing email adapter for notifications
- `apps/api/test/admin-users.test.ts` or extend existing admin tests

### Frontend
- `apps/web/src/components/admin/` — new ResetPasswordModal.tsx component
- `apps/web/src/pages/admin/` or `src/app/admin/` — find User Detail page, add Reset button
- `apps/web/src/lib/admin-users-api.ts` — add reset endpoint function
- `apps/web/__tests__/admin/` — add modal and integration tests

### Out of scope
- Temporary password expiry enforcement
- Batch password resets
- MFA reset
- OAuth integration changes
- Database schema migrations (reuse existing tables)

## Step-by-step

### Backend

1. **Create admin password reset controller function**
   - File: `apps/api/src/controllers/admin-users.ts`
   - Accept `userId` (target), `sendEmail` boolean, optional `adminNote` string
   - Validate: admin role required, prevent self-reset (422), user exists (404)
   - Generate temporary password: 16+ random bytes, base62-encoded via crypto.getRandomValues()
   - Hash temp password using IAuthAdapter.hashPassword()
   - Update user table: password hash + passwordUpdatedAt timestamp
   - Revoke all refresh tokens for target user (atomic with password update)
   - Return response: userId, temporaryPassword (shown once), emailSent, resetAt timestamp

2. **Create admin password reset route**
   - File: `apps/api/src/routes/admin/users.ts`
   - Route: `POST /admin/users/:userId/reset-password`
   - Auth guard: require admin role (return 403 if not admin)
   - Input validation: @ValidateBody schema with sendEmail boolean, adminNote string (max 500)
   - Call controller from step 1
   - Return 200 with response object or error codes (400, 403, 404, 422, 500)

3. **Implement email notification (optional)**
   - If sendEmail === true, queue/send email to user
   - Template: "Your ArenaQuest password has been reset by an administrator"
   - Include: temporary password, admin note (if provided), link to Settings
   - If email fails: log warning, don't fail response (return 500 but include password)

4. **Implement audit logging**
   - Log successful reset: admin user ID, target user ID, timestamp, IP, "password_reset_by_admin"
   - Log failures: same + reason (self-reset-attempted, unauthorized-role, user-not-found)
   - Use existing audit infrastructure or create new audit log entry

5. **Write backend tests**
   - Happy path: admin resets user, temp password returned
   - Happy path with email: verify email sent with password
   - Email failure: password updated, API returns 500 with password
   - Authorization: non-admin returns 403
   - Self-reset: admin tries to reset own password, returns 422
   - User not found: returns 404
   - Session invalidation: old refresh token rejected after reset
   - Audit log: reset recorded with correct metadata
   - Input validation: adminNote > 500 chars, sendEmail not boolean

6. **Verify backend**
   - `make test-api` — all new tests pass
   - `make lint` — no linting errors

### Frontend

7. **Create ResetPasswordModal component**
   - File: `apps/web/src/components/admin/ResetPasswordModal.tsx`
   - Modal phases: confirmation → loading → success OR error
   - Confirmation phase: show user name, checkbox for "Send notification email", text field for optional note
   - Success phase: display temporary password in copyable plaintext, include copy button
   - Error phase: display error message from API (403, 404, 422, 500)
   - Keyboard: Escape closes modal

8. **Integrate Reset button on User Detail page**
   - File: User Detail component (find in `apps/web/src/app/admin/` or `src/pages/admin/`)
   - Add "Reset Password" button (visible only if logged-in user is admin)
   - Button opens ResetPasswordModal with target user data
   - After reset completes, refresh user detail page

9. **Create admin API client function**
   - File: `apps/web/src/lib/admin-users-api.ts` or similar
   - Function: `resetUserPassword(userId, sendEmail, adminNote?)` 
   - Call `POST /admin/users/:userId/reset-password`
   - Return temporary password and status

10. **Write frontend tests**
    - Modal renders on button click
    - Modal closes on Cancel/Escape
    - Email checkbox toggles
    - Note text field accepts input
    - Confirm calls API with correct payload
    - Success modal displays temp password (copyable)
    - Copy button copies to clipboard
    - Error messages display for 403, 404, 422, 500
    - Button hidden if user is not admin
    - Page refreshes after reset

11. **Verify frontend**
    - `make test-web` — all new tests pass
    - `make lint` — no linting errors
    - Manual walkthrough: admin resets user password, sees temp password, copy works

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| Backend endpoint implemented | 1–2 | backend | make test-api passes |
| Only admin role authorized | 2 | backend | 403 test for non-admin |
| Self-reset prevented | 1 | backend | 422 test for self-reset |
| Temp password generated securely | 1 | backend | entropy test (16+ bytes) |
| Temp password returned, not stored plaintext | 1 | backend | response + code review |
| Refresh tokens revoked | 1 | backend | session invalidation test |
| Email sent (optional) | 3 | backend | email sent test |
| Audit logging | 4 | backend | audit log test |
| Error handling (400, 403, 404, 422, 500) | 2 | backend | error case tests |
| User Detail has Reset button | 8 | frontend | visual check + test |
| Modal confirmation phase | 7 | frontend | modal interaction test |
| Modal success phase with temp password | 7 | frontend | copy button test |
| Modal error handling | 7 | frontend | error message test |
| Frontend API integration | 9 | frontend | API call test |
| Tests pass | 5–6, 10–11 | both | make test-api, make test-web |
| No regressions | 5–6, 10–11 | both | full test suite |

## Risks & open questions

- **Self-reset during reset:** If admin tries to reset own password while their session is valid, code must reject before any DB changes. Mitigation: 422 check happens in controller before DB write.
- **Email template:** Check if existing "Password Reset" template from Milestone 6 can be reused or if new template needed. Early decision saves iteration.
- **Audit table:** If audit logging doesn't yet exist, clarify whether to log to database (new audit table) or to application logs. Current task assumes logging exists or can be added.
- **Session revocation atomicity:** Ensure password update and token revocation happen in single transaction or are otherwise atomic to prevent race conditions.

## Verification

- **Backend:** `make test-api` — all new endpoint tests pass (happy path, auth, validation, sessions, audit)
- **Frontend:** `make test-web` + browser walkthrough on `make dev` — modal interactions, error states, copy button work
- **Lint:** `make lint` passes
- **Build:** `make build` succeeds
- **Manual E2E:** Admin resets user password → sees temp password → target user logs in with temp password → changes password → logs in with new password

## Out of scope

- Temporary password expiry enforcement (not in Milestone 6 either)
- Batch password resets
- MFA reset
- OAuth user password resets (separate flow)
- Password reset history/audit dashboard
- Webhook integrations for SIEM
