# Task 10: Test Seed Accounts

## Metadata
- **Status:** Completed
- **Complexity:** Small
- **Milestone:** 6 — Auth Self-Service & Social Login
- **Dependencies:**
  - M2 Task 01 — `users`, `roles`, and `user_roles` tables must exist
  - M2 Task 02 — role IDs (`admin`, `student`, `tutor`, `content_creator`) must be seeded

---

## Summary

Provide three pre-configured local user accounts that any developer can provision with a single command. The accounts cover all three access personas: Admin, Student, and Professor (tutor + content creator). The seed must be explicitly excluded from production to prevent test credentials from ever reaching a live environment.

---

## Architectural Context

- **Dev-only migration pattern:** follows the production-guard pattern established in Milestone 2-extends Task 08 (`08-production-seed-guard.task.md`). The migration file must check the environment or be gated by a dedicated Makefile target that only runs against local D1.
- **Password storage:** passwords must be pre-hashed using PBKDF2 (100,000 iterations, SHA-256, Web Crypto API) — the same algorithm used by the registration flow. The seed script that generates the hashes must be run offline; only the resulting hash values are committed. Plain-text passwords are documented in `CONTRIBUTING.md`, not in migration files.
- **Cloud-Agnostic:** no provider-specific steps. The Makefile target uses `wrangler d1 execute --local`, which works the same regardless of the cloud provider used for production.

---

## Scope

### 1. Seed Migration File

Create `apps/api/migrations/seed/0001_test_users.sql` (in a `seed/` subdirectory, never in the main `migrations/` folder that runs in production CI/CD).

The migration inserts the following accounts and role assignments:

| Display Name | Email | Role(s) |
|---|---|---|
| Admin Test | `admin@arenaquest.dev` | `admin` |
| Student Test | `student@arenaquest.dev` | `student` |
| Professor Test | `professor@arenaquest.dev` | `tutor`, `content_creator` |

All users: `status = active`.

Use `INSERT OR IGNORE` so re-running the migration is idempotent.

### 2. Password Hash Generation Script

Create `apps/api/scripts/generate-seed-hashes.ts` — a one-off script a developer runs locally to produce the PBKDF2 hashes for the seed passwords. The script is not part of the test suite or build pipeline; it is a developer tool. The output hashes are committed into the seed migration.

Document the credentials and how to regenerate hashes in `CONTRIBUTING.md`.

### 3. Makefile Target

Add to the root `Makefile`:

```makefile
db-seed-dev:
    wrangler d1 execute arenaquest-db --local --file ./apps/api/migrations/seed/0001_test_users.sql
```

The target name (`db-seed-dev`) makes it clear this is dev-only. Add a comment in the Makefile explicitly stating it must not be run against staging or production.

### 4. CONTRIBUTING.md Update

Add a "Local Test Accounts" section documenting:

- The three credentials (email + plain-text password).
- The command to provision them: `make db-seed-dev`.
- A clear warning: these accounts are for local development only and must never be seeded in staging or production.
- How to regenerate hashes if the passwords are changed: run `apps/api/scripts/generate-seed-hashes.ts` and update the migration.

---

## Acceptance Criteria

- [x] `make db-seed-dev` on a clean local DB creates all three accounts with correct roles.
- [x] Running `make db-seed-dev` twice does not produce duplicate rows or errors.
- [x] All three accounts can log in via `POST /auth/login` with their documented credentials.
- [x] The Admin account can access admin-only endpoints; the Student cannot; the Professor can access content-creator and tutor routes.
- [x] The seed migration file is in `migrations/seed/`, not in the main `migrations/` folder.
- [x] No plain-text passwords appear in any committed migration or TypeScript file.
- [x] `CONTRIBUTING.md` has the "Local Test Accounts" section with credentials and usage instructions.
- [x] `make lint` passes.

---

## Verification Plan

### Manual
1. Delete (or wipe) the local D1 database.
2. Run `make db-migrations-dev` (applies production migrations).
3. Run `make db-seed-dev` (applies the seed).
4. Log in as each of the three accounts and confirm access matches the documented roles.
5. Run `make db-seed-dev` a second time and confirm no errors and no duplicate rows.
