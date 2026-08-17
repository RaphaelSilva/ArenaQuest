# Task 02: Seed Roles & Define RBAC Constants

## Metadata
- **Status:** Done
- **Complexity:** Low
- **Milestone:** 2 — Authentication & User Management
- **Dependencies:** `docs/product/milestones/2/01-implement-user-repository.task.md`

---

## Summary

Define the canonical role set (`Admin`, `ContentCreator`, `Tutor`, `Student`) as typed
constants in `packages/shared` and create a D1 seed migration that inserts them on first
deploy. This ensures role names are never scattered as magic strings across the codebase.

---

## Technical Constraints

- **Cloud-Agnostic:** Role constants are defined in `packages/shared` so both the API and
  future frontends import from the same source of truth.
- **No hardcoded IDs in app logic:** The seeder uses deterministic UUIDv5 (namespace +
  role name) so IDs are predictable across environments without a sequence.
- **Idempotency:** The seed SQL uses `INSERT OR IGNORE` so re-running it is safe.

---

## Scope

### 1. Constants — `packages/shared/constants/roles.ts`

```ts
export const ROLES = {
  ADMIN: 'admin',
  CONTENT_CREATOR: 'content_creator',
  TUTOR: 'tutor',
  STUDENT: 'student',
} as const;

export type RoleName = typeof ROLES[keyof typeof ROLES];
```

### 2. Seed Migration — `apps/api/migrations/0002_seed_roles.sql`

```sql
INSERT OR IGNORE INTO roles (id, name, description, created_at) VALUES
  ('...uuid...', 'admin',           'Full platform access',         CURRENT_TIMESTAMP),
  ('...uuid...', 'content_creator', 'Can create/edit content',      CURRENT_TIMESTAMP),
  ('...uuid...', 'tutor',          'Can monitor student progress',  CURRENT_TIMESTAMP),
  ('...uuid...', 'student',        'Can consume content and tasks', CURRENT_TIMESTAMP);
```

### 3. Export in `packages/shared/index.ts`

Add re-export of `ROLES` and `RoleName` so consumers import cleanly from `@arenaquest/shared`.

---

## Acceptance Criteria

- [x] `ROLES` constant and `RoleName` type exported from `@arenaquest/shared`.
- [x] Seed migration file exists at `apps/api/migrations/0002_seed_roles.sql`.
- [x] Applying the migration twice produces no error and no duplicate rows.
- [x] Unit test verifies that `ROLES` contains exactly 4 entries.
- [x] No string literals like `"admin"` appear in any `apps/api` source file — only
  `ROLES.ADMIN` references are allowed.

---

## Verification Plan

1. `pnpm --filter api test` — pass.
2. Apply migration: `wrangler d1 execute api-db --local --file ./migrations/0002_seed_roles.sql`.
3. Query `SELECT * FROM roles;` via `wrangler d1 execute api-db --local --command "SELECT * FROM roles"`.
4. Run the  migration a second time and confirm row count remains 4.
