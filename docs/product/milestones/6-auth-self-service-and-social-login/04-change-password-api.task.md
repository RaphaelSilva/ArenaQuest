# Task 04: Change Password API (Authenticated)

## Metadata
- **Status:** Completed
- **Complexity:** Small
- **Milestone:** 6 — Auth Self-Service & Social Login
- **Dependencies:**
  - M2 Task 03 — `AuthService` with password verification logic must exist
  - M2 Task 05 — `authGuard` middleware must exist
  - M2-extends Task 02 — `IRefreshTokenRepository.deleteAllForUser` must exist

---

## Summary

Expose an authenticated `POST /account/change-password` endpoint that allows a logged-in user to update their own password. The user must supply their current password for verification before the update is applied. All other active sessions are invalidated; the calling session is preserved.

---

## Architectural Context

- **Pattern:** Route (with `authGuard`) → Controller → `IUserRepository` + `IRefreshTokenRepository`. Business logic stays out of the route layer.
- **Hashing:** new password hashed with PBKDF2 (100,000 iterations) via Web Crypto API — identical to registration and password reset.
- **Session handling:** invalidate all refresh tokens for the user *except* the current one. The current refresh token is identified from the `HttpOnly` cookie on the request.
- **Cloud-Agnostic:** no provider-specific libraries for hashing or session management.
- **New router:** add `apps/api/src/routes/account.router.ts` to house account self-service endpoints. This keeps auth (login/logout/refresh) separate from account mutation (password change, future profile updates).

---

## Scope

### 1. Controller Method

Add a `changePassword(userId, currentRefreshToken, input)` method (in a new `AccountController` or extending `AuthController`):

- Accepts `{ currentPassword: string, newPassword: string }`.
- Validates both fields via `@ValidateBody` Zod schema (both required, `newPassword` length ≥ 8).
- Fetches the user by `userId` (from JWT payload, provided by `authGuard`).
- Verifies `currentPassword` against the stored hash using the same PBKDF2 verification used in login. Wrong password → `{ ok: false, status: 400, error: 'InvalidCurrentPassword' }`.
- Hashes the new password with PBKDF2.
- Updates `users.password_hash` via `IUserRepository.update`.
- Deletes all refresh tokens for the user *except* the one matching `currentRefreshToken` (requires an `IRefreshTokenRepository.deleteAllExcept(userId, tokenHash)` operation — add this to the port if it does not already exist).
- Returns `{ ok: true, data: null }`.

### 2. Port Extension (if needed)

If `IRefreshTokenRepository` does not expose `deleteAllExcept(userId, tokenHash)`, add it to the port in `packages/shared/src/ports/` and implement it in `D1RefreshTokenRepository`.

### 3. Route

Register `POST /account/change-password` in a new `apps/api/src/routes/account.router.ts`:

- Apply `authGuard` — this endpoint requires a valid JWT.
- No additional role restriction — any authenticated user can change their own password.
- Map `ControllerResult` to HTTP response.
- Mount the router in `apps/api/src/routes/index.ts`.

---

## Acceptance Criteria

- [x] Valid current password + valid new password → `200 OK`, `password_hash` updated.
- [x] Wrong current password → `400 InvalidCurrentPassword`.
- [x] `newPassword` too short → `400 BadRequest` (Zod).
- [x] Missing JWT → `401 Unauthorized` (authGuard).
- [x] After a successful change, the calling session (refresh token) still works.
- [x] After a successful change, all other refresh tokens for the user are rejected.
- [x] User can log in with the new password and cannot log in with the old password.
- [x] `make lint` and `make test` pass.

---

## Verification Plan

### Automated
- `cd apps/api && pnpm test` — integration tests covering all acceptance criteria above.

### Manual
- Log in on two browser tabs, change password on one, verify the other session is invalidated on next token refresh.
