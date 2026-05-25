# Plan — 01-frontend-api-client-class

**Task:** [01-frontend-api-client-class.task.md](../01-frontend-api-client-class.task.md)
**Source:** Backlog / Refactoring
**Assigned personas:** frontend-developer
**Branch:** feature/backlog/01-frontend-api-client-class.task

## Objective

Consolidate auth-context propagation in the frontend by introducing a single `ApiClient` class that owns the auth quartet (token, refreshFn, onTokenUpdate, onSessionExpired) and exposes domain-grouped operations. Migrate all consumers from function-based APIs to this specialist client accessed via `useApiClient()` hook. This eliminates the long-parameter-list code smell, prevents argument-order bugs, and removes infrastructure plumbing from page components.

## Affected areas

### Create / Modify
- **New:** `apps/web/src/lib/api-client.ts` — the `ApiClient` class and HTTP transport layer
- **New:** `apps/web/src/lib/api-client.test.ts` — unit tests for client, single-flight refresh, error handling
- **Modify:** `apps/web/src/context/auth-context.tsx` — add `useApiClient()` hook and wire client in provider
- **Modify:** `apps/web/src/lib/*-api.ts` (all 10 modules) — refactor to accept `http` (transport) as first param; drop public auth-quartet exports
- **Modify:** All page/component consumers (26+ call sites across admin, catalog, tasks, components, etc.)
- **New tests:** `useApiClient` integration test in auth-context; mock `ApiClient` factory helper in test suite

### Delete
- `apps/web/src/lib/api-hooks.ts` — superseded by client hook

### Out of Scope
- `apps/api/**` — backend untouched
- `packages/shared/**` — no type changes
- `auth-api.ts` — login/refresh endpoints remain standalone

## Step-by-step implementation

### Frontend - Phase A: Introduce the Client (Additive)

1. **Design HTTP transport interface** (`apps/web/src/lib/api-client.ts`)
   - Create internal `HttpTransport` interface: `(method, url, options?) => Promise<Response>`
   - Implement `createFetchTransport()` function wrapping `fetchWithAuth` (preserves single-flight refresh)
   - No public exports of transport; consumed only by `ApiClient`

2. **Implement `ApiClient` class** (`apps/web/src/lib/api-client.ts`)
   - Constructor: `(transport, apiUrl, defaultHeaders?)`
   - Domain namespaces as getters: `topics`, `tasks`, `users`, `adminTopics`, `adminTasks`, `adminUsers`, `adminMedia`, `adminEnrollment`, `progress`, `dashboard`
   - Each namespace delegates to the corresponding `*-api.ts` module, passing `transport` as first argument
   - Single internal method: `async request<T>(method, path, body?, options?) => Promise<T>` — wraps transport, handles response parsing, throws domain error classes
   - Preserve all error classes (`AccountApiError`, `AdminTasksApiError`, etc.) — no change to error shape

3. **Add `useApiClient` hook** in `apps/web/src/context/auth-context.tsx`
   - Extract `{ token, refreshSession, setAccessToken, onSessionExpired }` from `AuthContext`
   - Create transport via `createFetchTransport(token, refreshSession, setAccessToken, onSessionExpired)`
   - Memoize client instance: return same `ApiClient` until auth context changes (use `useMemo` with `[token, refreshSession, setAccessToken, onSessionExpired]` deps)
   - Export hook; document that it is the **only** sanctioned way to obtain a client

4. **Refactor each `*-api.ts` module** to accept `http` transport
   - Signature change: functions become `(http: HttpTransport, ...businessArgs) => Promise<T>`
   - Move all logic into these pure functions; no module-level state or side effects
   - Keep error classes unchanged (throw by name, preserve `code` and `details`)
   - Public exports: **only** the domain namespace object that `ApiClient` will use
   - Example: `topics-api.ts` exports `{ list: (http, ...args) => Promise<...>, get: (...), ... }` — no longer exports individual functions

5. **Write unit tests for `ApiClient`** (`apps/web/src/lib/api-client.test.ts`)
   - Success path: request → response → parsed data returned
   - 401 → `fetchWithAuth` triggers refresh → retry succeeds
   - 401 → refresh fails → `onSessionExpired` called
   - Concurrent 401s: only one refresh issued (single-flight guarantee)
   - Non-401 errors: propagated as-is
   - Domain error classes: thrown with unchanged `code` and `details`
   - Memoization: `useApiClient` returns same instance across re-renders when auth context unchanged

6. **Add `useApiClient` integration test** in `auth-context.test.tsx`
   - Confirm hook returns a client
   - Confirm client is stable (same reference) across renders if auth unchanged
   - Confirm new client created when token changes

### Frontend - Phase B: Migrate Consumers (Mechanical)

Migrate in this order; each group should compile and pass linting before the next.

7. **Admin Topics** — `apps/web/src/app/(protected)/admin/topics/page.tsx`
   - Replace: `import { adminTopicsApi } from '@web/lib/admin-topics-api'`
   - With: `const client = useApiClient()`
   - Replace: `adminTopicsApi.list(token, refreshSession, setAccessToken, onSessionExpired, page, pageSize)`
   - With: `client.adminTopics.list(page, pageSize)`
   - Similar changes for `create`, `update`, `delete`, `getById`
   - Verify no `useAdminTopicsApi` hook import remains

8. **Admin Tasks** — `apps/web/src/app/(protected)/admin/tasks/page.tsx` and `[id]/page.tsx`
   - Migrate `adminTasksApi` calls to `client.adminTasks.*`
   - Update `useAdminTasksApi` hook references

9. **Admin Users** — `apps/web/src/app/(protected)/admin/users/page.tsx` and `[userId]/page.tsx`
   - Migrate `adminUsersApi` → `client.adminUsers`
   - Update enrollment API calls in the enrollments tab

10. **Catalog** — `apps/web/src/app/(protected)/catalog/`
    - Layout, page, `[id]/page.tsx`, `[id]/[subtopicId]/page.tsx`
    - Migrate `topicsApi` → `client.topics`, `mediaApi` → `client.media`

11. **Settings** — `apps/web/src/app/(protected)/settings/page.tsx`
    - Migrate `accountApi` → `client.account`, `adminUsersApi` → `client.adminUsers`

12. **Student Tasks** — `apps/web/src/app/(protected)/tasks/page.tsx` and `[id]/page.tsx`
    - Migrate `tasksApi` → `client.tasks`, `progressApi` → `client.progress`

13. **Media Components** — `apps/web/src/components/admin/MediaUploader.tsx` and `MediaList.tsx`
    - Currently accept `token`, `refreshSession`, `setAccessToken`, `onSessionExpired` as props
    - Add `useApiClient` hook instead; remove prop drilling
    - Update `client.media.upload`, `client.media.list`, etc.

14. **Enrollment Component** — `apps/web/src/components/enrollment/enrollments-tab.tsx`
    - Add `useApiClient` hook; remove auth props
    - Migrate `adminEnrollmentApi` → `client.adminEnrollment`

15. **Task Editor Components** — `apps/web/src/components/tasks/stage-editor.tsx` and `student-task-detail.tsx`
    - Add `useApiClient` hook
    - Migrate `adminTasksApi` → `client.adminTasks`, `tasksApi` → `client.tasks`

16. **Dashboard** — `apps/web/src/components/dashboard/DashboardContent.tsx`
    - Migrate `getDashboard` call (likely via `dashboardApi`) to `client.dashboard.get()`

17. **Custom Loaders** — `apps/web/src/hooks/use-media-loader.ts` and `use-topics-loader.ts`
    - If these wrap API calls, add `useApiClient` hook and update references

### Frontend - Phase B: Update Consumer Tests

18. **Rewrite API-mocking tests** using shared mock helper
    - Create `apps/web/__tests__/helpers/mock-api-client.ts`
    - Export function that returns a mock `ApiClient` with `vi.fn()` on every method
    - Tests to rewrite:
      - `apps/web/__tests__/app/admin/topics.test.tsx`
      - `apps/web/__tests__/app/admin/users.test.tsx`
      - `apps/web/__tests__/app/admin/user-enrollments.test.tsx`
      - `apps/web/src/components/tasks/__tests__/stage-editor.test.tsx`
      - `apps/web/src/components/tasks/__tests__/student-task-detail.test.tsx`
    - Pattern: `vi.mock('@web/lib/api-client', () => ({ useApiClient: () => mockApiClient }))`
    - Verify other tests (`auth-context.test.tsx`, activate, login, etc.) remain unchanged or only add one assertion about client presence

### Frontend - Phase C: Cleanup

19. **Delete `apps/web/src/lib/api-hooks.ts`**
    - Verify no remaining imports via `grep -rn "from '@web/lib/api-hooks'" apps/web/src`

20. **Reduce `*-api.ts` modules** (optional, for clarity)
    - Remove any old public exports of individual functions
    - Ensure each module only exports the domain namespace object used by `ApiClient`
    - Or: keep modules lean by moving all logic into the namespace object

21. **Verification checks**
    - `grep -rn "refreshSession\|onSessionExpired\|setAccessToken" apps/web/src --include="*.tsx" --include="*.ts"` — should only match inside `AuthContext`, `ApiClient`, test setup
    - `grep -rn "fetchWithAuth\|fetch-with-auth" apps/web/src --include="*.tsx" --include="*.ts"` — should only match inside `api-client.ts` and its tests
    - `grep -rn "from '@web/lib/api-hooks'" apps/web/src` — must be zero
    - `grep -rn "adminTopicsApi\.\|adminTasksApi\.\|adminUsersApi\.\|tasksApi\.\|topicsApi\.\|accountApi\." apps/web/src --include="*.tsx"` — must be zero outside lib layer

## Acceptance Criteria mapping

| AC | Plan step(s) | Verification |
|---|---|---|
| Single `ApiClient` class exists | 2 | `apps/web/src/lib/api-client.ts` exists with class definition |
| `useApiClient` hook exposes memoised client | 3, 6 | Hook in auth-context; test confirms stability |
| Domain operations accept only business args | 4 | All `*-api.ts` functions take `http` + business args; no auth quartet |
| `api-hooks.ts` deleted | 19 | File removed; grep returns zero |
| No component prop with auth names | 13–17 | Component signatures checked; props removed |
| Single-flight refresh preserved | 5 | Unit test confirms only one refresh issued on concurrent 401s |
| Domain error classes unchanged | 4, 5 | Error classes thrown by name; `code`/`details` preserved |
| Tests rewritten per spec | 18 | 5 tests use mock helper; others unchanged or +1 assertion |
| New tests exist | 5, 6 | `api-client.test.ts` + integration test in auth-context.test.tsx |
| `make lint` passes | 19–21 | Run after cleanup |
| `make test` passes | 19–21 | Run both `test-api` (zero impact) and `test-web` |
| `make build` succeeds | 19–21 | Full build |
| Manual smoke test | 21 | Browser: login → admin/topics → tasks → users → catalog → settings → student tasks; invalidate token, confirm silent refresh |

## Risks & open questions

- **Test coverage of concurrent 401 handling:** The single-flight guarantee must survive client wrapping. Unit test is critical.
- **Component prop removal:** Some components (`MediaUploader`, `MediaList`) may be used in multiple contexts; ensure all call sites migrated before removing props.
- **Custom loaders:** If `use-media-loader` or `use-topics-loader` are imported by lazy-loaded components, ensure hook migration doesn't break SSR boundaries.
- **Memoization dependency array:** If `AuthContext` value itself changes on every render, client won't memoize correctly. Verify `AuthContext` uses memoization or stable value.

## Verification

- **Lint:** `make lint`
- **Tests:** `make test-web` (also `make test-api` should be unaffected)
- **Build:** `make build`
- **Browser smoke test:** Log in, navigate all migrated pages, force a 401 (clear token in devtools), confirm silent refresh succeeds without UI flicker
- **Grep checks:** Run all four verification queries in step 21 to confirm no stray references

## Out of scope

- Backend API changes
- New types in `packages/shared`
- Changes to `auth-api.ts` (login/refresh endpoints)
- Changes to `fetch-with-auth.ts` itself (may be wrapped, but public signature unchanged)
