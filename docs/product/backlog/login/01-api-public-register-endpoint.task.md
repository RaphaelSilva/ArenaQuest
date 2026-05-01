# Task 01: Public Self-Registration Endpoint (User created as INACTIVE)

## Metadata
- **Status:** Done
- **Complexity:** Medium
- **Area:** `apps/api`
- **Depends on:** existing `IUserRepository`, `JwtAuthAdapter` (PBKDF2), Hono router, controller pattern (`docs/product/backlog/refactoring/01-move-route-logic-to-controllers.task.md`)
- **Blocks:** Task 02 (activation email), Task 03 (web login page update)

---

## Summary

Today the only way to create a user is via the admin-only `POST /admin/users` route. This task introduces a **public, unauthenticated** endpoint that lets a visitor register themselves. The new account is **never usable until it has been activated** — it is persisted with `status = INACTIVE` and zero capability to log in.

The activation email itself (token generation, mailer, link click handling) is **out of scope here** — it lives in Task 02. This task focuses on:

1. The HTTP contract (`POST /auth/register`).
2. Persisting an `INACTIVE` user with a hashed password and the default `student` role.
3. Emitting a domain event / hook the activation-email task can plug into (a single function call, not a queue — keep it simple).
4. Hardening: rate limiting, email-enumeration safety, password policy.

---

## Technical Constraints

- **Public route** — no auth middleware, no admin role check. Mounted under `/auth/register` so it sits alongside `/auth/login`, `/auth/logout`, `/auth/refresh`.
- **No login on success** — the response must NOT return an access token or set a refresh-token cookie. The only way for the user to obtain a session is to activate the account first (Task 02), then log in.
- **Login must keep rejecting INACTIVE users** — `AuthService.login` already throws `AuthError('ACCOUNT_INACTIVE')` and the controller maps that to `401 InvalidCredentials`. Verify with a regression test; do not change that behavior.
- **Cloud-agnostic** — the controller stays Hono-free (returns `ControllerResult<T>`). Repository writes go through `IUserRepository.create({ status: UserStatus.INACTIVE, roleNames: ['student'] })`.
- **Web Crypto only** — reuse `JwtAuthAdapter.hashPassword` (PBKDF2, 100k iters). Do **not** introduce `bcrypt`/`argon2` (see CLAUDE.md "No external auth deps").
- **Email enumeration** — when the email is already taken, return the **same shape and status** as a successful registration. The activation email task is responsible for sending a "someone tried to register with your email" notice instead of a fresh activation link. Do not leak which addresses are registered through the public API.
- **Rate limiting** — wrap the route with `KvRateLimiter` keyed by client IP (e.g. `5 req / 15 min`). Registration is a known abuse vector (spam signups, password-spray reconnaissance).
- **Password policy** — minimum 8 characters, at least one digit. Validate with Zod in the controller; reject with `400 BadRequest` and a structured `{ field, code }` error so the frontend can render inline messages.

---

## Scope

### Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/register` | none | Create a self-registered user with `status=INACTIVE` |

### Request / Response Contracts

**POST /auth/register**

Request body (Zod-validated):
```jsonc
{
  "name": "Joana Silva",         // required, 2–80 chars, trimmed
  "email": "joana@example.com",  // required, RFC-5322-ish, lowercased before persist
  "password": "correct horse 9"  // required, min 8 chars, at least one digit
}
```

Response — **always 202 Accepted** on a well-formed request, regardless of whether the email was free or already taken:
```jsonc
{ "status": "pending_activation" }
```

Error responses:
- `400 BadRequest` — body fails schema validation. Body: `{ "error": "ValidationFailed", "fields": [{ "field": "password", "code": "TooShort" }] }`.
- `429 TooManyRequests` — rate limiter rejected the call.

### Files to add / change

- **New** `apps/api/src/controllers/register.controller.ts`
  - `RegisterController` with `register(input)` returning `ControllerResult<{ status: 'pending_activation' }>`.
  - Owns the Zod schema (`RegisterSchema`) and the password-policy regex.
  - Constructor injects `IUserRepository` and `IAuthAdapter` (for hashing).
  - On `findByEmail` hit: do **not** create a duplicate; still return `ok: true`. Emit a `USER_REGISTRATION_DUPLICATE` event (Task 02 listens to send the "your email was used" notice).
  - On miss: hash password, call `userRepository.create({ ..., status: INACTIVE, roleNames: ['student'] })`, emit `USER_REGISTRATION_CREATED` event with the new user's id and email.
  - Events for now can be a thin in-process emitter — a callback registered at app construction time. Do **not** introduce a queue, Durable Object, or cron yet. Keep the surface small enough that Task 02 can swap it for a real outbox if needed.

- **New** `apps/api/src/routes/register.router.ts`
  - Hono sub-router mounting `POST /register`.
  - Applies the `kvRateLimiter` middleware before the controller call.
  - Maps `ControllerResult` → HTTP (`202` on ok, `400`/`429` on errors).

- **Update** `apps/api/src/routes/auth.router.ts`
  - Mount `register.router.ts` at `/auth/register` (or compose under the same `/auth` Hono instance — match whatever the existing auth router does).

- **Update** `apps/api/src/index.ts`
  - Construct `RegisterController` with the per-request adapters.
  - Wire the in-process registration-event emitter and pass it to the controller.

- **No DB migration required** — `users.status` already supports `inactive` (see `Entities.Config.UserStatus.INACTIVE` in `packages/shared/types/entities.ts`).

### Out of scope (handled by Task 02)
- Generating activation tokens.
- Sending any email.
- The `GET/POST /auth/activate` endpoint that flips status to `ACTIVE`.

---

## Acceptance Criteria

- [x] `POST /auth/register` with a valid, unused email creates a user with `status = INACTIVE`, role `student`, password stored as a PBKDF2 hash, and returns `202 { status: 'pending_activation' }`.
- [x] `POST /auth/register` with an email already present in `users` returns the **same** `202 { status: 'pending_activation' }` response (no enumeration leak) and does **not** insert a duplicate row.
- [x] `POST /auth/register` with a malformed body returns `400` with field-level `ValidationFailed` errors.
- [x] `POST /auth/register` exceeding the rate limit returns `429` and never touches the DB.
- [x] `POST /auth/login` with the new user's credentials returns `401 InvalidCredentials` until the user is activated (regression — must keep failing).
- [x] The registration-event emitter is invoked exactly once per accepted request, with the discriminator `USER_REGISTRATION_CREATED` for new users and `USER_REGISTRATION_DUPLICATE` for duplicates.
- [x] `RegisterController` has zero `hono` imports.

---

## Test Plan

### Unit tests — `apps/api/test/controllers/register.controller.spec.ts`
1. **Happy path** — fresh email + valid body → returns `ok` result, `userRepository.create` called with `status: INACTIVE`, `roleNames: ['student']`, hash present (≠ raw password), event emitter called with `USER_REGISTRATION_CREATED`.
2. **Email enumeration** — `findByEmail` returns existing record → result is still `ok`, `create` is **not** called, event emitter called with `USER_REGISTRATION_DUPLICATE`.
3. **Validation failures** — drive each branch (missing name, malformed email, password < 8 chars, password without a digit) → result is `{ ok: false, status: 400, error: 'ValidationFailed' }` with the offending field listed.
4. **Email casing / trimming** — `"  Joana@Example.COM  "` is persisted as `joana@example.com` and the duplicate check is case-insensitive.
5. **Hashing isolation** — the captured `passwordHash` is not equal to the raw password and not equal to a SHA-256 of it (sanity check that PBKDF2 was used, not a placeholder).

### Integration tests — `apps/api/test/routes/register.router.spec.ts` (Vitest + `@cloudflare/vitest-pool-workers`)
1. **End-to-end happy path** — `POST /auth/register` → `202`, then `SELECT status FROM users WHERE email = ?` returns `inactive`, then `POST /auth/login` with the same credentials returns `401 InvalidCredentials`.
2. **Duplicate email** — register the same email twice; second call returns `202`, `SELECT count(*)` is `1`.
3. **Schema rejection** — `{ "email": "not-an-email", "password": "short", "name": "" }` returns `400` with three field errors.
4. **Rate limit** — burst 6 requests from the same IP within the window; 6th returns `429`. Reset KV between tests so other specs aren't affected.
5. **No tokens leaked** — response body has no `accessToken` field, no `Set-Cookie: refresh_token=...` header.
6. **Regression** — existing `auth.router.spec.ts` suite still passes.

### Manual verification
1. `make dev-api` (Worker on `:8787`).
2. `curl -i -X POST http://localhost:8787/auth/register -H 'content-type: application/json' -d '{"name":"Test","email":"test@arena.local","password":"hunter22a"}'` → expect `202` and `{ "status": "pending_activation" }`.
3. `wrangler d1 execute arenaquest-dev --local --command "SELECT id, email, status FROM users WHERE email='test@arena.local'"` → row exists with `status = inactive`.
4. `curl -X POST http://localhost:8787/auth/login -H 'content-type: application/json' -d '{"email":"test@arena.local","password":"hunter22a"}'` → expect `401 InvalidCredentials`.
5. Repeat the registration call 6× quickly → 6th call returns `429`.

### Definition of Done
- [x] All unit + integration tests green (`make test-api`).
- [x] No new `hono` imports outside `routes/`.
- [x] No new external auth/crypto dependencies in `apps/api/package.json`.
- [x] Event emitter contract documented inline (JSDoc on the emitter type) so Task 02 can subscribe without re-reading this spec.
