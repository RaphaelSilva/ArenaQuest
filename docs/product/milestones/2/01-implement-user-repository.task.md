# Task 01: Implement User Repository (Port + D1 Adapter)

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 2 — Authentication & User Management
- **Dependencies:** None (foundational for this milestone)

---

## Summary

Define the `IUserRepository` port (interface) in `packages/shared/ports` and create its
concrete Cloudflare D1 adapter in `apps/api/src/adapters/db/`. This task is the data
foundation that all Milestone 2 features depend on (login, CRUD, RBAC).

The `User` domain entity already exists in `packages/shared/types/entities.ts`. This task
wires it to a real persistence layer without leaking D1-specific code into business logic.

---

## Technical Constraints

- **Ports/Adapters:** `IUserRepository` interface lives in `packages/shared/ports/`. No
  Cloudflare-specific types (`D1Database`, etc.) may appear there.
- **Cloud-Agnostic:** The concrete `D1UserRepository` adapter is the only file that imports
  `@cloudflare/workers-types`. Business logic calls the port interface only.
- **Password storage:** The `users` table stores only the hashed password string (output of
  `IAuthAdapter.hashPassword`). Plain-text passwords never touch the repository layer.
- **D1 schema migration:** The SQL migration file must be committed alongside the adapter so
  the schema is version-controlled and reproducible.

---

## Scope

### 1. Port — `packages/shared/ports/i-user-repository.ts`

```ts
export interface IUserRepository {
  findById(id: string): Promise<Entities.Identity.User | null>;
  findByEmail(email: string): Promise<UserRecord | null>; // includes passwordHash
  create(data: CreateUserInput): Promise<Entities.Identity.User>;
  update(id: string, data: Partial<UpdateUserInput>): Promise<Entities.Identity.User>;
  delete(id: string): Promise<void>;
  list(opts?: { limit?: number; offset?: number }): Promise<Entities.Identity.User[]>;
}
```

> `UserRecord` extends `Entities.Identity.User` with a `passwordHash: string` field — it is
> kept separate from the public entity to prevent accidentally serialising the hash.

### 2. D1 Schema — `apps/api/migrations/0001_create_users.sql`

Tables required:
- `users` — id (UUID), name, email (UNIQUE), password_hash, status, created_at
- `roles` — id (UUID), name (UNIQUE), description, created_at
- `user_roles` — user_id (FK), role_id (FK)

### 3. Adapter — `apps/api/src/adapters/db/d1-user-repository.ts`

Implements `IUserRepository` using `D1Database` binding from the Worker `env`.

### 4. Wire into `AppEnv` — `apps/api/src/index.ts`

Add `DB: D1Database` to `AppEnv` and include a `db` adapter instance in `buildAdapters()`.

---

## Acceptance Criteria

- [ ] `IUserRepository` interface exported from `packages/shared/ports/index.ts`.
- [ ] `D1UserRepository` implements every method of the interface with no TypeScript errors.
- [ ] SQL migration file exists at `apps/api/migrations/0001_create_users.sql`.
- [ ] `wrangler.jsonc` declares the D1 binding (`database_name`, `database_id`).
- [ ] `AppEnv` in `apps/api/src/index.ts` exposes `DB: D1Database`.
- [ ] Unit test (`apps/api/test/db/d1-user-repository.spec.ts`) covers:
  - `create` + `findByEmail` round-trip.
  - `findById` returns `null` for unknown id.
  - `delete` removes the record.
- [ ] All tests pass: `pnpm --filter api test`.

---

## Verification Plan

1. Run `pnpm --filter api test` — all unit tests must pass.
2. Apply migration locally: `wrangler d1 execute api-db --local --file ./migrations/0001_create_users.sql`.
3. Smoke-test with a one-off script that creates a user and retrieves it by email.
