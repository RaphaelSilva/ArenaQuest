# Task 03: Reset Password API

## Metadata
- **Status:** Completed
- **Complexity:** Small
- **Milestone:** 6 — Auth Self-Service & Social Login
- **Dependencies:**
  - M6 Task 01 — `IPasswordResetTokenRepository` must exist
  - M2 Task 01 — `IUserRepository.update` (to set new `password_hash`) must exist
  - M2 Task 03 — PBKDF2 hashing logic inside `AuthService` or `JwtAuthAdapter` must be accessible

---

## Summary

Expose a public `POST /auth/reset-password` endpoint that consumes a one-time reset token and updates the user's password. On success, all existing refresh tokens for that user are invalidated to force re-login on all devices.

---

## Architectural Context

- **Pattern:** Route → Controller → `IPasswordResetTokenRepository` + `IUserRepository` + `IRefreshTokenRepository`. No business logic in the route layer.
- **Hashing:** the new password must be hashed with PBKDF2 (100,000 iterations) using Web Crypto API — the same algorithm and iteration count used during registration. Do not introduce `bcrypt` or any external library.
- **Session invalidation:** call `IRefreshTokenRepository.deleteAllForUser(userId)` after updating the password. This is the same approach used in M2-extends Task 02 (revoke sessions on admin mutation).
- **Cloud-Agnostic:** PBKDF2 via Web Crypto API is available on all modern runtimes; no provider-specific crypto.

---

## Scope

### 1. Controller Method

Add a `resetPassword(input)` method:

- Accepts `{ token: string, newPassword: string }`.
- Validates `newPassword` meets minimum requirements (length ≥ 8) via `@ValidateBody` Zod schema.
- Calls `IPasswordResetTokenRepository.consumeByPlainToken(token)`:
  - `invalid` or `expired` or `already_used` → return `{ ok: false, status: 400, error: 'InvalidOrExpiredToken' }`.
  - `consumed` (with `userId`) → proceed.
- Hash the new password with PBKDF2.
- Update `users.password_hash` via `IUserRepository.update(userId, { passwordHash })`.
- Invalidate all refresh tokens via `IRefreshTokenRepository.deleteAllForUser(userId)`.
- Return `{ ok: true, data: null }`.

### 2. Route

Register `POST /auth/reset-password` as a public endpoint in the auth router. No auth guard, no rate limit beyond what the token itself provides (one-time use + 1-hour TTL). Map `ControllerResult` to HTTP response.

---

## Acceptance Criteria

- [x] Valid token + valid password → `200 OK`, `users.password_hash` updated, all refresh tokens for the user deleted.
- [x] Expired token → `400` with `InvalidOrExpiredToken`.
- [x] Already-consumed token → `400` with `InvalidOrExpiredToken`.
- [x] Non-existent token → `400` with `InvalidOrExpiredToken`.
- [x] `newPassword` shorter than 8 characters → `400 BadRequest` (Zod validation).
- [x] After reset, the user can log in with the new password and cannot log in with the old password.
- [x] Concurrent double-submit of the same token: exactly one request succeeds; the other returns `400`.
- [x] `make lint` and `make test` pass.

---

## Verification Plan

### Automated
- `cd apps/api && pnpm test` — integration tests covering all acceptance criteria above.

### Manual
- Full flow: call `POST /auth/forgot-password`, extract token from console mail output, call `POST /auth/reset-password`, then attempt login with old and new passwords.
