# Plan — 02-google-oauth-callback-404

**Task:** [02-google-oauth-callback-404.task.md](../02-google-oauth-callback-404.task.md)
**Source:** Backlog | security
**Assigned personas:** frontend-developer
**Branch:** feature/backlog/security/02-google-oauth-callback-404.task

## Objective

Move the Google OAuth callback page in the Next.js App Router from `/callback` to `/auth/callback` by shifting the directory structure from `apps/web/src/app/(auth)/callback` to `apps/web/src/app/(auth)/auth/callback`. This aligns the frontend route with the API's expected redirect URL (`<WEB_BASE_URL>/auth/callback?accessToken=…`) and resolves the 404 error encountered during E2E federated login.

## Affected areas

- **Directories to create:**
  - `apps/web/src/app/(auth)/auth/callback`
- **Files to move:**
  - `apps/web/src/app/(auth)/callback/page.tsx` -> `apps/web/src/app/(auth)/auth/callback/page.tsx`
- **Directories to delete:**
  - `apps/web/src/app/(auth)/callback`

## Step-by-step

### Frontend

1. **Move files**: Create `apps/web/src/app/(auth)/auth/callback` directory and move `apps/web/src/app/(auth)/callback/page.tsx` into it.
2. **Delete obsolete folder**: Remove `apps/web/src/app/(auth)/callback` directory.
3. **Verify locally**: Run frontend linting, TypeScript compiler, and tests to confirm there are no import regressions.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| Navigating to `http://localhost:3000/auth/callback?accessToken=<token>` stores session | Step 1, 2 | frontend | Checked via manual/E2E login flow |
| Navigating without a valid token shows the error UI with a link to `/login` | Step 1, 2 | frontend | Check directly in browser |
| The callback page inherits the `(auth)` layout | Step 1 | frontend | Style inherits naturally due to parent `(auth)` route group |
| The previous URL path (`/callback`) no longer resolves (returns 404) | Step 2 | frontend | Navigating to `/callback` gives 404 |
| `make lint` passes with no errors | Step 3 | frontend | `make lint` |

## Risks & open questions

- **Import resolution**: Ensure the relative imports within `page.tsx` (like `@web/hooks/use-auth` and `@web/components/spinner`) are either absolute (using path aliases) or, if relative, updated to account for being one level deeper.
  * *Mitigation*: The imports in `page.tsx` use the `@web/` alias prefix (e.g. `import { useAuth } from '@web/hooks/use-auth';`), so they are absolute and will resolve correctly from any location under the `web` workspace without needing updates!

## Verification

- Frontend: `make lint && make test-web`
- Verification of 404 removal via running local dev environment.

## Out of scope

- Direct modification of the backend API code or configuration.
- Modifying redirect URIs in Google Cloud Console.
