# Task 01: Password Reset Data Layer

## Metadata
- **Status:** Completed
- **Complexity:** Small
- **Milestone:** 6 — Auth Self-Service & Social Login
- **Dependencies:**
  - Milestone 2 Task 01 — `IUserRepository` and `users` table must exist
  - Milestone 2-extends Task 01 — `sha256Hex` hashing utility must exist in `apps/api/src/adapters/db/hash.ts`

---

## Summary

Introduce the persistence layer for password-reset tokens. A user who requests a password reset gets a one-time, time-limited token emailed to them. The token is never stored in plaintext — only its SHA-256 hash is persisted, following the same pattern established for `user_activation_tokens` (M3-extends) and `refresh_tokens` (M2-extends Task 01).

---

## Architectural Context

- **Pattern:** Ports and Adapters. The port (`IPasswordResetTokenRepository`) lives in `packages/shared/src/ports/`. The adapter (`D1PasswordResetTokenRepository`) lives in `apps/api/src/adapters/db/`. No D1-specific types may cross the adapter boundary.
- **Migration:** a new numbered migration file in `apps/api/migrations/`.
- **Hashing:** reuse the existing `sha256Hex` utility — do not introduce a new dependency or algorithm.
- **Cloud-Agnostic:** the port contract is storage-agnostic. Swapping D1 for any SQL database requires only a new adapter.

---

## Scope

### 1. Database Migration

Create a new migration that adds a `password_reset_tokens` table with the following logical fields:

- Token hash (primary key — hashed value, never plaintext)
- User ID (foreign key referencing `users`, cascade delete)
- Expiry timestamp
- Consumed-at timestamp (nullable — null means unused)
- Created-at timestamp

Add an index on `user_id` to support efficient lookups when invalidating outstanding tokens.

### 2. Port: `IPasswordResetTokenRepository`

Define the interface in `packages/shared/src/ports/` and export it from the shared package index. Required operations:

- **create** — persist a new hashed token for a user with a given expiry date.
- **consumeByPlainToken** — atomically validate and consume a token by its plaintext value; return a discriminated result: `invalid` | `expired` | `already_used` | `consumed` (with `userId`).
- **purgeExpired** — delete all rows whose expiry timestamp is in the past (for scheduled clean-up).
- **invalidateAllForUser** — delete all outstanding (unconsumed) reset tokens for a given user (called before issuing a new token to prevent stale links).

### 3. Adapter: `D1PasswordResetTokenRepository`

Implement the port against Cloudflare D1:

- `create`: hash the plaintext token with `sha256Hex`, then insert.
- `consumeByPlainToken`: hash the plaintext, fetch the row, check expiry and `consumed_at`, then use an atomic conditional UPDATE (`WHERE consumed_at IS NULL`) to claim the token. Mirror the CAS pattern from `D1ActivationTokenRepository` to handle concurrent requests safely.
- `purgeExpired` and `invalidateAllForUser`: straightforward DELETEs.

### 4. Wire into `buildApp`

Register `D1PasswordResetTokenRepository` in `apps/api/src/index.ts` inside `buildApp(env)`, following the existing adapter wiring pattern. Do not instantiate adapters at module scope.

---

## Acceptance Criteria

- [x] Migration applies cleanly to a fresh local D1 database.
- [x] `IPasswordResetTokenRepository` is exported from `packages/shared/index.ts`.
- [x] Adapter integration tests cover: create → consume (success), consume expired token, consume already-consumed token, concurrent double-consume (only one succeeds), `purgeExpired` removes only expired rows, `invalidateAllForUser` removes only that user's rows.
- [x] No D1-specific types or imports leak outside `apps/api/src/adapters/`.
- [x] `make lint` and `make test` pass.

---

## Verification Plan

### Automated
- `cd apps/api && pnpm test` — adapter integration suite against the Cloudflare Workers pool.

### Manual
- Apply the migration locally (`make db-migrations-dev`) and inspect the schema with `wrangler d1 execute`.
