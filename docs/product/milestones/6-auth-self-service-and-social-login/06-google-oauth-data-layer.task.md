# Task 06: Google OAuth Data Layer

## Metadata
- **Status:** Completed
- **Complexity:** Small
- **Milestone:** 6 — Auth Self-Service & Social Login
- **Dependencies:**
  - M2 Task 01 — `users` table and `IUserRepository` must exist
  - M2 Task 02 — `user_roles` table and role seeding must exist

---

## Summary

Introduce the persistence layer for linking OAuth provider identities to local user accounts. A user may have zero or one Google identity record. This table is also designed to accommodate future OAuth providers (GitHub, Apple, etc.) without schema changes.

---

## Architectural Context

- **Pattern:** Ports and Adapters. Port (`IOAuthAccountRepository`) in `packages/shared/src/ports/`. Adapter (`D1OAuthAccountRepository`) in `apps/api/src/adapters/db/`. No D1 types outside the adapter.
- **Migration:** new numbered migration file in `apps/api/migrations/`.
- **Provider-agnostic schema:** the table stores a `provider` discriminator column (e.g., `"google"`) so the same table and port support future providers without migration.
- **Cloud-Agnostic:** the port contract has no Google-specific types. The adapter implements D1 queries; a Postgres adapter could be swapped in without touching business logic.

---

## Scope

### 1. Database Migration

Create a new migration adding an `oauth_accounts` table with the following logical fields:

- `provider` — string identifier for the OAuth provider (e.g., `"google"`).
- `provider_user_id` — the user's unique ID from the provider (e.g., Google `sub` claim).
- `user_id` — foreign key referencing `users`, cascade on delete.
- `email` — the email address returned by the provider at the time of linking (informational, not a join key).
- `created_at` — timestamp.

Primary key: composite `(provider, provider_user_id)`. Add a unique index on `(provider, user_id)` to enforce one provider identity per local user per provider.

### 2. Port: `IOAuthAccountRepository`

Define the interface in `packages/shared/src/ports/` and export it from the shared package index. Required operations:

- **findUserByProvider(provider, providerUserId)** — return the linked local `User` (with roles) or `null`.
- **link(provider, providerUserId, userId, email)** — persist a new `oauth_accounts` row linking a provider identity to a local user.
- **findByUser(provider, userId)** — return the `OAuthAccount` record for a user and provider, or `null` (used to check if a user already has a Google identity linked).

Define a lightweight `OAuthAccount` value type (in `packages/shared/src/types/`) with: `provider`, `providerUserId`, `userId`, `email`, `createdAt`.

### 3. Adapter: `D1OAuthAccountRepository`

Implement the port against D1. All three operations are single-query reads or inserts — no complex transactions needed.

### 4. Wire into `buildApp`

Register `D1OAuthAccountRepository` in `apps/api/src/index.ts` inside `buildApp(env)`.

---

## Acceptance Criteria

- [x] Migration applies cleanly to a fresh local D1 database.
- [x] `IOAuthAccountRepository` and `OAuthAccount` type are exported from `packages/shared/index.ts`.
- [x] `link` correctly creates a row; a second `link` call for the same `(provider, providerUserId)` pair returns a constraint error (not silently ignored).
- [x] `findUserByProvider` returns `null` for an unknown provider/ID and the full user (with roles) for a known one.
- [x] No D1-specific imports leak outside the adapter.
- [x] `make lint` and `make test` pass.

---

## Verification Plan

### Automated
- `cd apps/api && pnpm test` — adapter integration tests covering all operations and the unique constraint.

### Manual
- Apply migration locally and verify schema with `wrangler d1 execute`.
