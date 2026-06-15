# Plan — 06-api-test-v1-paths-and-remove-legacy-shim

**Task:** [06-api-test-v1-paths-and-remove-legacy-shim.task.md](../06-api-test-v1-paths-and-remove-legacy-shim.task.md)
**Source:** Backlog — refactoring
**Assigned personas:** backend-developer
**Branch:** feature/backlog/refactoring/06-api-test-v1-paths-and-remove-legacy-shim.task

## Objective

The API test suite hits un-prefixed business paths (`/auth/login`, `/admin/topics`, etc.) and only passes because a transparent legacy-rewrite shim in `src/index.ts` rewrites them to `/v1/...` before dispatching. This plan centralizes the `/v1` prefix inside a new shared helper (`apps/api/test/helpers/v1.ts`), updates each of the 15 affected spec files to apply the helper inside their local request-builder functions (zero call-site changes), then removes the shim block from `src/index.ts` entirely. A cutover assertion is added to `docs.spec.ts` proving un-prefixed business paths now return 404 while their `/v1` counterparts succeed.

## Affected areas

**New file:**
- `apps/api/test/helpers/v1.ts` — exports `v1(path)` helper

**Modified — test helpers (apply `v1()` inside URL construction):**
- `apps/api/test/routes/auth.router.spec.ts`
- `apps/api/test/routes/register.router.spec.ts`
- `apps/api/test/routes/activate.router.spec.ts`
- `apps/api/test/routes/password.router.spec.ts`
- `apps/api/test/routes/oauth.router.spec.ts`
- `apps/api/test/routes/account.router.spec.ts`
- `apps/api/test/routes/admin-topics.router.spec.ts`
- `apps/api/test/routes/admin-users.router.spec.ts`
- `apps/api/test/routes/admin-badges.router.spec.ts`
- `apps/api/test/routes/admin-missions.router.spec.ts`
- `apps/api/test/routes/admin-media.router.spec.ts`
- `apps/api/test/routes/admin-enrollment.router.spec.ts`
- `apps/api/test/routes/topics.router.spec.ts`
- `apps/api/test/routes/comments.spec.ts`
- `apps/api/test/routes/leaderboard.spec.ts`
- `apps/api/test/routes/me-gamification.spec.ts`

**Modified — cutover assertion:**
- `apps/api/test/routes/docs.spec.ts` — add shimless-cutover describe block

**Modified — production code (shim removal):**
- `apps/api/src/index.ts` — delete lines 42-55 (legacy-rewrite block), simplify `fetch` handler to a single `buildApp(env).fetch(request, env, ctx)` call

**Out of scope:**
- Any route/controller behavior change
- Frontend changes
- `oasdiff` CI contract gate
- `cors.router.spec.ts`, `parse-cookie-samesite.spec.ts`, `docs.spec.ts` helper functions (they only hit `/health`, `/openapi.json`, `/docs` — unversioned, kept as-is)

## Step-by-step

### Backend

1. **Create `apps/api/test/helpers/v1.ts`.**
   Export a single pure function:
   ```ts
   export const v1 = (path: string): string => `/v1${path}`;
   ```
   This is the single source of truth for the test prefix.

2. **Update each of the 15 route spec files.**
   For every spec file listed in "Affected areas", locate each local request-builder function (`req()`, `request()`, `post()`, `get()`, `del()`, `patch()`, etc.) that constructs a URL of the form `` `http://example.com${path}` `` or `` `http://localhost${path}` ``. Apply two targeted edits:
   - Add import at the top of the file: `import { v1 } from '../helpers/v1';`
   - Change the URL construction inside the builder function body from `` `http://example.com${path}` `` → `` `http://example.com${v1(path)}` `` (and `http://localhost` equivalents).
   - Do NOT change any test call sites — the call sites continue to pass paths like `/auth/login` and the `v1()` wrapping is transparent inside the builder.

3. **Add cutover assertion to `apps/api/test/routes/docs.spec.ts`.**
   Append a new `describe('Legacy-shim cutover', ...)` block that:
   - Asserts `GET /topics` (un-prefixed) → 404 (shim is gone, no route registered).
   - Asserts `GET /v1/topics` (prefixed, unauthenticated) → 401 (route exists, auth guard fires — proving the `/v1` path is live).
   - Both assertions call `worker.fetch` directly without a `req()` wrapper to keep them self-contained and not affected by any per-spec helper.

4. **Verify Phase A: `make test-api` must pass with shim still present.**
   At this point the shim is still in `src/index.ts`. All tests must be green (they now prepend `/v1` themselves, and the shim still rewrites un-prefixed paths — but the tests no longer emit un-prefixed paths, so the shim is simply a no-op). The cutover assertion's un-prefixed `GET /topics → 404` will FAIL here because the shim is still active.

   **Resolution:** The cutover assertion block should be wrapped in a `describe.skipIf` or a conditional so it only runs after shim removal. Use the pattern:
   ```ts
   // Skip while legacy shim is present; enable after src/index.ts shim removal
   describe.skip('Legacy-shim cutover — enable after shim is removed', () => { ... });
   ```
   After shim removal in step 5, remove the `.skip`.

5. **Remove the shim from `apps/api/src/index.ts`.**
   Delete lines 42-55 (the `if (path.startsWith('/auth') || ...)` block and its `return buildApp(env).fetch(rewrittenRequest, env, ctx);`).
   Simplify the `fetch` handler to:
   ```ts
   export default {
     async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
       return buildApp(env).fetch(request, env, ctx);
     },
   } satisfies ExportedHandler<AppEnv>;
   ```
   Also remove the now-unused `url` and `path` local variables.

6. **Enable the cutover assertion.**
   In `docs.spec.ts`, change `describe.skip(...)` → `describe(...)` to activate the shimless cutover tests.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| Shared helper centralizes `/v1` prefix; no spec hardcodes prefix ad hoc | 1, 2 | backend | `grep -rn "v1/auth\|v1/admin\|v1/me\|v1/topics" apps/api/test/routes/` returns nothing (prefix only in helper) |
| All affected route specs target `/v1/...` | 2 | backend | `grep -rn "req('[A-Z]*', '/\(auth\|topics\|tasks\|me\|admin\|leaderboard\)" apps/api/test` → empty |
| Legacy-rewrite block removed from `src/index.ts` | 5 | backend | `grep -n "url.pathname = \`/v1" apps/api/src/index.ts` → empty |
| Test asserts un-prefixed path → 404, `/v1` counterpart → 401/200 | 3, 6 | backend | cutover describe block in `docs.spec.ts` passes |
| Full suite green against un-shimmed worker | 5, 6 | backend | `make lint && make test-api` green |

## Risks & open questions

- **`admin-enrollment.router.spec.ts`** defines multiple helpers (`post`, `get`, `del`, and potentially `noAuthGet`). All of them must be updated — verify the full list before committing.
- **`auth.router.spec.ts`** uses a `request()` helper (not `req()`). Confirm the URL construction pattern before editing.
- **`describe.skip` approach**: Using `.skip` allows Phase A (tests pass with shim present) without blocking CI. This is intentional and documented in the commit message.

## Verification

- Backend: `make lint && make test-api && make build`
- Manual spot-check: `curl localhost:8787/topics` → 404; `curl localhost:8787/v1/topics` (with auth) → 401 or 200; `curl localhost:8787/health` → 200.

## Out of scope

- Any route/controller behavior or response contract change
- Frontend changes (handled by Task 05, which is a prerequisite already merged)
- `oasdiff` CI gate (RFC §9, PD3 — deferred to production)
- `cors.router.spec.ts`, `parse-cookie-samesite.spec.ts` — their helpers already target `/health` (unversioned); no change needed
