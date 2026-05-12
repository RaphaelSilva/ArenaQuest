# Task 05: Web — Password Self-Service Pages

## Metadata
- **Status:** Completed
- **Complexity:** Medium
- **Milestone:** 6 — Auth Self-Service & Social Login
- **Dependencies:**
  - M6 Task 02 — `POST /auth/forgot-password` endpoint must exist
  - M6 Task 03 — `POST /auth/reset-password` endpoint must exist
  - M6 Task 04 — `POST /account/change-password` endpoint must exist
  - M2 Task 07 — auth context and hooks must exist
  - M2 Task 08 — `(auth)` layout group and login page must exist

---

## Summary

Implement the three user-facing password self-service surfaces in the Next.js frontend:
1. **Forgot Password page** — public, in the `(auth)` group.
2. **Reset Password page** — public, in the `(auth)` group, reads token from the URL.
3. **Change Password form** — protected, accessible from a new Settings page.

All three surfaces follow the existing design system and component conventions established in Milestones 2–5.

---

## Architectural Context

- **App Router:** pages follow Next.js 15 App Router conventions. Auth pages go under `src/app/(auth)/`; the settings page goes under `src/app/(protected)/settings/`.
- **API client:** add password-related calls to `src/lib/auth-api.ts` (forgot + reset) and create or extend an `account-api.ts` for authenticated calls (change password).
- **Auth guard:** the Settings page is inside `(protected)` and is covered by the existing middleware — no custom guard needed.
- **No new libraries:** use existing form patterns, error state conventions, and UI components already in the repo. No form library is required if existing patterns are simple controlled inputs.

---

## Scope

### 1. Forgot Password Page — `src/app/(auth)/forgot-password/page.tsx`

- Single email input field with a submit button.
- On submit: call `POST /auth/forgot-password`.
- After submit (regardless of result): replace the form with a neutral confirmation message — e.g., "If that email is registered, you'll receive a reset link shortly." Do **not** indicate whether the email was found.
- Loading state while the request is in flight.
- Add a "Forgot password?" link on the existing login page pointing to this page.

### 2. Reset Password Page — `src/app/(auth)/reset-password/page.tsx`

- Reads `?token=` from the URL search params.
- If no token is present in the URL: show an error message with a link back to `/forgot-password`.
- Form with `New Password` and `Confirm Password` fields.
- Client-side validation: both fields required, match check, minimum 8 characters.
- On submit: call `POST /auth/reset-password` with `{ token, newPassword }`.
- On success: redirect to `/login` with a URL param or toast indicating the password was reset successfully.
- On `400` (expired/invalid token): show an error with a link back to `/forgot-password` to request a new link.

### 3. Change Password Form — `src/app/(protected)/settings/page.tsx`

- New Settings page. For this milestone, it contains only the Change Password section. Future settings (profile, notifications, etc.) can be added later without restructuring.
- Form with `Current Password`, `New Password`, and `Confirm Password` fields.
- Client-side validation: all fields required, new password min 8 chars, new and confirm must match.
- On submit: call `POST /account/change-password`.
- On success: show a success toast and clear the form.
- On `400 InvalidCurrentPassword`: show an inline error on the Current Password field.
- Add a "Settings" link in the navigation (`src/components/layout/nav.tsx`) visible to all authenticated users.

### 4. API Client Functions

Add to `src/lib/auth-api.ts`:
- `forgotPassword(email: string): Promise<void>`
- `resetPassword(token: string, newPassword: string): Promise<void>`

Add to `src/lib/account-api.ts` (create if not present):
- `changePassword(currentPassword: string, newPassword: string): Promise<void>`

---

## Acceptance Criteria

- [x] `/forgot-password` submits without revealing whether the email exists; form is replaced by a confirmation message after submit.
- [x] `/reset-password?token=<valid>` successfully resets the password and redirects to `/login`.
- [x] `/reset-password?token=<expired>` shows an error with a link to `/forgot-password`.
- [x] `/reset-password` with no token param shows an error immediately without making an API call.
- [x] `/settings` is not accessible without authentication (redirects to `/login`).
- [x] Successful password change from `/settings` shows a success toast and clears the form.
- [x] Wrong current password shows an inline error on the correct field.
- [x] `make lint` passes (TypeScript strict mode, no unused imports).

---

## Verification Plan

### Automated
- Existing `apps/web` test suite must continue to pass.
- Add component tests for the new pages using the existing RTL setup (form submission, error state rendering, success state rendering).

### Manual
- Start `make dev` and walk through all three flows end-to-end.
- Confirm "Forgot password?" link is visible on the login page.
- Confirm "Settings" link is visible in the nav when authenticated and absent when not authenticated.
