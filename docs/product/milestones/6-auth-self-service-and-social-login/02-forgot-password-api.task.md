# Task 02: Forgot Password API

## Metadata
- **Status:** Completed
- **Complexity:** Small–Medium
- **Milestone:** 6 — Auth Self-Service & Social Login
- **Dependencies:**
  - M6 Task 01 — `IPasswordResetTokenRepository` and migration must exist
  - M3-extends Task 02 — `IMailAdapter` and mail-sending infrastructure must exist
  - M2 Task 01 — `IUserRepository.findByEmail` must exist

---

## Summary

Expose a public `POST /auth/forgot-password` endpoint that accepts an email address, generates a secure one-time reset token, and dispatches a password-reset email. The response is always `200 OK` regardless of whether the email is registered — this prevents user enumeration attacks.

---

## Architectural Context

- **Pattern:** Route → Controller → Domain Services (AuthService / PasswordResetService). No business logic in the route layer.
- **Controller result type:** use the existing `ControllerResult<T>` from `src/core/result.ts`.
- **Mail adapter:** use `IMailAdapter` — do not hard-code a mail provider. The dev environment uses `ConsoleMailAdapter`; production uses `ResendMailAdapter`.
- **Rate limiting:** use the existing `KvRateLimiter` (`IrateLimiter` port). Limit: 3 requests per IP per hour. Return `429` on breach.
- **Token generation:** use Web Crypto API (`crypto.getRandomValues`) — no external libraries.
- **Cloud-Agnostic:** token generation, hashing, and email dispatch are all provider-independent.

---

## Scope

### 1. Mail Template

Create a password-reset email template in `apps/api/src/mail/templates/`. Content requirements:

- Subject: clear identification as a password reset request for ArenaQuest.
- Body: the reset link constructed from `FRONTEND_BASE_URL` env var + `/reset-password?token={plainToken}`.
- Expiry notice: inform the user the link is valid for 1 hour.
- Security note: if the user did not request this, they can safely ignore the email.

### 2. Controller Method

Add a `forgotPassword(input)` method to `AuthController` (or a new `PasswordController`):

- Accepts `{ email: string }`.
- Looks up the user by email via `IUserRepository`.
- If the user exists and is active: call `IPasswordResetTokenRepository.invalidateAllForUser` (revoke any outstanding tokens), then `create` a new token with a 1-hour expiry, then dispatch the email via `IMailAdapter`.
- If the user does not exist or is inactive: do nothing (but do not reveal this to the caller).
- Always return `{ ok: true, data: null }` — the route layer maps this to `200 OK`.
- Validate the email format using the existing `@ValidateBody` / Zod pattern before the controller executes.

### 3. Route

Register `POST /auth/forgot-password` in `apps/api/src/routes/auth.router.ts` (or a new `password.router.ts` if preferred for separation):

- Apply rate-limit middleware before the controller.
- No auth guard — this is a public endpoint.
- Map `ControllerResult` to HTTP response following the existing route pattern.

---

## Acceptance Criteria

- [x] `POST /auth/forgot-password` with a registered email: returns `200`, a reset email is dispatched (visible in console adapter during tests), and a token row exists in the DB.
- [x] `POST /auth/forgot-password` with an unknown email: returns `200`, no email is dispatched, no error is thrown.
- [x] `POST /auth/forgot-password` with an invalid email format: returns `400 BadRequest`.
- [x] Exceeding 3 requests from the same IP within 1 hour returns `429`.
- [x] A second `forgotPassword` call for the same user invalidates the previous token.
- [x] `make lint` and `make test` pass.

---

## Verification Plan

### Automated
- `cd apps/api && pnpm test` — controller unit tests (mock repository + mail adapter) and integration test (real D1 + console mail adapter).

### Manual
- Call the endpoint with `curl` or a REST client against `make dev-api`, observe the token in the console mail adapter output.
