# Task 06: Admin — User CRUD Endpoints

## Metadata
- **Status:** Complete
- **Complexity:** Medium
- **Milestone:** 2 — Authentication & User Management
- **Dependencies:**
  - `docs/product/milestones/2/02-seed-roles-and-rbac-constants.task.md`
  - `docs/product/milestones/2/05-api-auth-middleware.task.md`

---

## Summary

Expose a fully-protected set of CRUD endpoints (`/admin/users`) that only users with the
`admin` role can reach. These endpoints back the Admin Dashboard UI and satisfy the
milestone's "User Lifecycle Management" objective.

---

## Technical Constraints

- **RBAC Enforcement:** Every endpoint in this router must be guarded by both `authGuard`
  and `requireRole(ROLES.ADMIN)`.
- **No Business Logic in Handlers:** Handlers call `IUserRepository` methods directly (user
  management is pure CRUD with no complex domain logic at this stage). If it grows in
  complexity later, extract a `UserService`.
- **Input Validation:** Use `zod` for request body validation. Add `zod` to
  `apps/api/package.json` dependencies.
- **Password Hashing on Create:** The `POST /admin/users` endpoint hashes the initial
  password using `IAuthAdapter.hashPassword()` before persisting. Plain passwords never go
  to the repository.

---

## Scope

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/users` | List all users (paginated) |
| `GET` | `/admin/users/:id` | Get a single user |
| `POST` | `/admin/users` | Create user (with role assignment) |
| `PATCH` | `/admin/users/:id` | Update name, status, or roles |
| `DELETE` | `/admin/users/:id` | Soft-delete (set status to `inactive`) |

### Request Schemas (Zod)

```ts
const CreateUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  roles: z.array(z.enum(['admin', 'content_creator', 'tutor', 'student'])).default(['student']),
});

const UpdateUserSchema = z.object({
  name: z.string().min(2).optional(),
  status: z.enum(['active', 'inactive', 'pending', 'banned']).optional(),
  roles: z.array(z.enum([...])).optional(),
});
```

### Router — `apps/api/src/routes/admin-users.router.ts`

```ts
export function buildAdminUsersRouter(
  users: IUserRepository,
  auth: IAuthAdapter,
): Hono { ... }
```

---

## Acceptance Criteria

- [x] All five endpoints return `401` when called without a token.
- [x] All five endpoints return `403` when called with a non-admin token.
- [x] `POST /admin/users` with valid body creates a user and returns the new `User` entity
  (no `passwordHash` in the response).
- [x] `POST /admin/users` with an existing email returns `409 Conflict`.
- [x] `PATCH /admin/users/:id` with `{ roles: ['student'] }` updates roles correctly.
- [x] `DELETE /admin/users/:id` sets `status` to `inactive` (not a hard delete).
- [x] `GET /admin/users` returns a paginated list (`{ data: User[], total: number }`).
- [x] Integration tests in `apps/api/test/routes/admin-users.router.spec.ts` cover all
  acceptance criteria using `@cloudflare/vitest-pool-workers`.
- [x] `pnpm --filter api test` — green.

---

## Verification Plan

1. `pnpm --filter api test` — green.
2. `wrangler dev` + Postman collection (or `curl` script):
   - Create an admin user → log in → use access token.
   - Create a student user via `POST /admin/users`.
   - Update the student's role to `tutor`.
   - Verify the student's own token cannot reach `/admin/users`.
