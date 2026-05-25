# Plan — 08-refactor-admin-users-pair

**Task:** [08-refactor-admin-users-pair.task.md](../08-refactor-admin-users-pair.task.md)
**Source:** Milestone 8
**Assigned personas:** backend-developer
**Branch:** feature/m8/08-refactor-admin-users-pair.task (from feature/m8/07-refactor-admin-media-pair.task)

## Objective

Apply the router-vs-controller convention to the `admin-users` pair as far as the architecture allows. Key constraint: `AdminUsersController` only exposes `resetPassword` — all CRUD operations (create, list, update, delete) and business guards (lockout, session revocation) are implemented inline in the router. The convention can therefore only be fully applied to the `reset-password` endpoint. Everything else stays in the router spec because there is no controller to migrate to.

Changes:
1. Replace inline `MIGRATION_SQL` with `applyMigrations()`.
2. Remove `studentToken` (unused after removing the redundant 403 auth test).
3. Remove 9 business-rule tests from the `reset-password` describe that are already covered in `admin-users.controller.spec.ts`.
4. No changes to the controller spec (already covers all removed scenarios).

## Affected areas

- `apps/api/test/routes/admin-users.router.spec.ts` — inline migrations → helper; remove 9 tests
- `apps/api/test/controllers/admin-users.controller.spec.ts` — no changes needed

Out of scope: `apps/api/src/**`, any other spec file.

## Step-by-step

### Backend

1. **Replace inline MIGRATION_SQL** in `admin-users.router.spec.ts`:
   - Remove the `const MIGRATION_SQL = [...]` array (lines 11–50)
   - Add import: `import { applyMigrations } from '../helpers/apply-migrations';`
   - In `beforeAll`, replace `await env.DB.batch(MIGRATION_SQL.map((sql) => env.DB.prepare(sql)));` with `await applyMigrations(env.DB);`

2. **Remove `studentToken`**:
   - Remove `let studentToken: string;` declaration
   - Change `[adminToken, studentToken] = await Promise.all([...])` to `adminToken = await adapter.signAccessToken(...)` (just the admin token)
   - Remove the studentToken signAccessToken call from the Promise.all

3. **Remove 9 tests from `POST /admin/users/:id/reset-password` describe**:

   | Test to remove | Controller coverage |
   |---|---|
   | `'returns 403 with student token'` | auth-guard.spec.ts covers 403 matrix generically |
   | `'returns 422 when admin tries to reset own password'` | `resetPassword > returns 422 when admin tries to reset own password` |
   | `'returns 404 when user not found'` | `resetPassword > returns 404 when user not found` |
   | `'returns 404 when user is inactive'` | `resetPassword > returns 404 when user is inactive` |
   | `'revokes refresh tokens for target user after reset'` | `resetPassword > revokes all refresh tokens for target user` |
   | `'returns 400 when adminNote exceeds 500 chars'` | `resetPassword > returns 400 when adminNote exceeds max length` |
   | `'returns 400 when sendEmail is not boolean'` | `resetPassword > returns 400 when sendEmail is not boolean` |
   | `'accepts adminNote up to 500 chars'` | `resetPassword > returns 400 when adminNote exceeds max length` (boundary) |
   | `'generates unique temporary passwords on multiple resets'` | `resetPassword > returns unique temporary password each time` |

   **Keep in router** (2 tests remain in reset-password):
   - `'returns 401 without token'` (auth smoke)
   - `'resets user password and returns temporary password'` (200 + DTO shape)

4. **Why CRUD/lockout/S-02 tests stay**: `AdminUsersController` only has `resetPassword`. The CRUD logic, session revocation (S-02), and admin lockout guards (S-05) are implemented inline in the router — there is no controller to migrate them to. Moving them would require adding controller methods (production code change, out of scope).

5. **Run verification:**
   ```bash
   cd /home/my-ubuntu/projects/ArenaQuest && make lint && make test-api
   ```

## Expected test count delta

| Change | Delta |
|--------|-------|
| Remove 9 tests from admin-users.router.spec.ts | −9 |
| **Total** | **−9** |

Expected new total: 653 − 9 = **644 tests**.

## Verification

```bash
make lint
make test-api
```

## Out of scope

- Tasks 09–11. `apps/api/src/**`.
- Adding controller methods for CRUD/lockout/revocation (would require production code changes).
