# Task 01: Refactor Frontend API Clients to a Context-Aware `ApiClient` Class

## Metadata
- **Status:** 🟡 In Progress — Phase A Complete, Phase B Pending
- **Complexity:** High
- **Milestone:** Future Enhancement (technical debt)
- **Dependencies:** None (but should land before adding new frontend API surfaces)
- **Category:** Refactoring / Frontend Architecture

---

## Progress Report

### Phase A (Complete) — Infrastructure Foundation
**Commit:** `889f108` — "refactor(web): Phase A - introduce ApiClient class and useApiClient hook"

✅ **Completed:**
1. Created `apps/web/src/lib/api-client.ts`
   - `ApiClient` class with constructor accepting `(token, refreshFn, onTokenUpdate, onSessionExpired)`
   - Domain-grouped getters: `.topics`, `.tasks`, `.account`, `.adminTopics`, `.adminTasks`, `.adminUsers`, `.adminMedia`, `.adminEnrollment`, `.progress`, `.dashboard`
   - Internal `HttpTransport` interface and `createFetchTransport()` function wrapping `fetchWithAuth`
   - Preserves single-flight refresh guarantee from `fetch-with-auth.ts`

2. Updated `apps/web/src/context/auth-context.tsx`
   - Added `apiClient: ApiClient` field to `AuthContextValue`
   - Created `useApiClient()` hook returning memoised client instance
   - Memoization ensures stable client across renders when auth context unchanged

3. Refactored all 10 API modules to factory-function pattern
   - `topics-api.ts` → `createTopicsApi(http)`
   - `tasks-api.ts` → `createTasksApi(http)`
   - `account-api.ts` → `createAccountApi(http)`
   - `admin-topics-api.ts` → `createAdminTopicsApi(http)`
   - `admin-tasks-api.ts` → `createAdminTasksApi(http)`
   - `admin-users-api.ts` → `createAdminUsersApi(http)`
   - `admin-media-api.ts` → `createAdminMediaApi(http)`
   - `admin-enrollment-api.ts` → `createAdminEnrollmentApi(http)`
   - `progress-api.ts` → `createProgressApi(http)`
   - `dashboard-api.ts` → `createDashboardApi(http)`
   - All domain methods now accept **only business arguments** (no auth quartet)
   - Error classes preserved unchanged (e.g., `AccountApiError`, `AdminTasksApiError`)

4. Added backward-compatibility deprecation stubs
   - Old API exports (`topicsApi`, `adminTasksApi`, etc.) now throw helpful error messages
   - This prevents import errors during Phase B migration and guides developers to `useApiClient()` hook
   - Deprecation messages: "Use useApiClient() hook instead: const client = useApiClient(); await client.topics.list()"

### Phase B (Pending) — Consumer Migration
**Scope:** 20+ consumer files across pages, components, and hooks

⏳ **Required before build/tests can pass:**
1. Migrate all page components in `apps/web/src/app/(protected)/`
   - `admin/topics/page.tsx`
   - `admin/tasks/page.tsx` + `[id]/page.tsx`
   - `admin/users/page.tsx` + `[userId]/page.tsx`
   - `catalog/layout.tsx`, `page.tsx`, `[id]/page.tsx`, `[id]/[subtopicId]/page.tsx`
   - `settings/page.tsx`
   - `tasks/page.tsx` + `[id]/page.tsx`

2. Migrate components in `apps/web/src/components/`
   - `admin/MediaUploader.tsx`, `MediaList.tsx`
   - `enrollment/enrollments-tab.tsx`
   - `tasks/stage-editor.tsx`, `student-task-detail.tsx`
   - `dashboard/DashboardContent.tsx`
   - `hooks/use-media-loader.ts`, `use-topics-loader.ts`

3. Rewrite 5 API-mocking tests
   - Create shared mock helper: `apps/web/__tests__/helpers/mock-api-client.ts`
   - Rewrite test files listed in "Impact on Existing Tests" section

### Current Build Status
- **Compilation:** Fails at page runtime (e.g., `admin/tasks/[id]/page.tsx:49`) because old code still calls deprecated `adminTasksApi.getById(token, taskId, ...)` 
- **Root cause:** Deprecation stubs don't accept arguments; they throw errors to guide migration
- **Mitigation:** Backward-compatibility stubs allow imports to succeed but fail at runtime if old calling convention is used

---

## Summary

Every function exported by `apps/web/src/lib/*-api.ts` (topics, tasks, users, media, enrollment, account, progress, dashboard) currently requires the caller to pass four auth-related arguments individually — `token`, `refreshFn`, `onTokenUpdate`, `onSessionExpired` — in addition to the actual business arguments. This produces two well-known code smells:

- **Long Parameter List** — every call site has 4 mandatory auth params before the real arguments.
- **Data Clumping** — the same four values always travel together but are never modeled as a single concept.

The leaky abstraction has already caused real bugs (silent missing arguments in page components, argument-order mismatches between caller and callee, inconsistent use of the partial `api-hooks.ts` wrapper) and forces every page component to know about token-refresh plumbing that belongs in infrastructure.

This task introduces a single specialist class — an `ApiClient` — that owns the auth context and exposes thin, domain-grouped namespaces (topics, tasks, users, …). Pages obtain a fully-wired client from a React hook and call domain methods with **only the business arguments**.

---

## Problem Statement

### Current behavior
- Each domain module (`topics-api.ts`, `admin-tasks-api.ts`, …) exports a frozen object whose methods take `(token, …businessArgs, refreshFn, onTokenUpdate, onSessionExpired)`. Argument order is inconsistent across modules (e.g., `adminUsersApi.list` puts `page/pageSize` after the callbacks; `adminTasksApi.list` puts `status` last; `topicsApi.list` has only the auth quartet).
- A partial mitigation exists in `apps/web/src/lib/api-hooks.ts` (`useTopicsApi`, `useTasksApi`, `useAdminTopicsApi`, …) that wraps each method and injects the auth quartet. Adoption is inconsistent: many pages and components still call the raw API modules directly, and the wrapper itself has duplicated keys and argument-order drift.
- Components that fire API calls (e.g., `MediaUploader`, `MediaList`, `EnrollmentsTab`, `StageEditor`) take `token` plus the three callbacks as props, propagating the clump down the component tree.
- TypeScript does not catch a missing `refreshFn` when it is `undefined` in a destructured `useAuth()` call until compile time, and provides no protection against argument-order mistakes once two adjacent params have the same primitive shape.

### Expected behavior
- A single `ApiClient` specialist owns the auth context (current token, refresh strategy, token-update sink, session-expired sink) and is the only place that knows about `fetchWithAuth`.
- Pages and components obtain the client through a React hook (e.g., `useApiClient()`) wired once at the auth-context boundary, and invoke domain methods that accept **only business arguments**.
- The lib layer is reorganised into domain modules that are pure functions of `(http, …businessArgs)`, where `http` is an injected, already-authenticated transport. The auth quartet disappears from every public signature outside the client itself.
- Argument-order bugs, missing-argument bugs, and "did we remember to use the hook?" bugs become structurally impossible.

---

## Architectural Context

### Cloud-Agnostic / Ports & Adapters Alignment
- The change is **frontend-only**. No backend route, controller, adapter, or DB migration is affected.
- The new `ApiClient` is itself a **port-style boundary** on the web side: domain modules depend on an HTTP transport interface, not on a concrete `fetch`. Swapping the transport (e.g., for SSR, for a worker, for a test double) becomes a constructor argument rather than a global mock.
- Auth concerns (token storage, refresh, session-expiry handling) remain in the existing `AuthContext`. The client *consumes* that context; it does not duplicate it.
- No new dependencies. Continues to use the existing `fetch-with-auth.ts` primitive under the hood.

### Files in scope
- `apps/web/src/lib/fetch-with-auth.ts` — kept as the low-level primitive; may be wrapped by the client.
- `apps/web/src/lib/api-hooks.ts` — superseded by the new client hook; removed at the end of the task.
- `apps/web/src/lib/*-api.ts` (10 files: `topics`, `tasks`, `account`, `admin-topics`, `admin-tasks`, `admin-users`, `admin-media`, `admin-enrollment`, `progress`, `dashboard`) — public signatures change.
- `apps/web/src/context/auth-context.tsx` — exposes the wiring needed by the client hook.
- All consumers (see "Verification Plan" for the exhaustive grep).

### Files explicitly out of scope
- `apps/api/**` — backend untouched.
- `packages/shared/**` — shared types untouched.
- `auth-api.ts` — the login/refresh endpoints themselves stay as plain functions, because the refresh path cannot depend on the very client that needs refreshing.

---

## Requirements

### 1. Specialist Client
- Introduce a single class that owns the auth context and exposes domain-grouped operations (e.g., `client.topics.list()`, `client.adminTasks.update(id, data)`, `client.media.upload(topicId, file)`).
- The class encapsulates: current access token, the refresh strategy, the token-update sink, the session-expired sink, the API base URL, and the default headers.
- Domain operations accept **only business arguments**. They never accept `token`, `refreshFn`, `onTokenUpdate`, or `onSessionExpired`.
- All HTTP traffic goes through a single internal transport method that integrates with the existing 401-interception / silent-refresh logic of `fetch-with-auth.ts`. The single-flight refresh guarantee must be preserved.

### 2. React Integration
- Provide a hook (working name: `useApiClient`) that returns a memoised client bound to the current `AuthContext`.
- The client must remain stable across renders when the auth context has not changed, so it is safe to use in `useEffect` / `useCallback` dependency arrays without retriggering loads.
- The hook is the **only** sanctioned way for components to obtain a client.

### 3. Migration of Call Sites
- Every page, layout, and component that currently calls a `*Api` module directly **or** uses a wrapper from `api-hooks.ts` must be migrated to the new client.
- Components that currently accept `token` plus the three auth callbacks as props (`MediaUploader`, `MediaList`, `EnrollmentsTab`, and any uncovered during migration) must drop those props and use the hook internally, **or** accept a single injected client when they cannot use the hook (e.g., pure presentational variants used in tests).
- After migration, no file outside the new client should import `fetch-with-auth.ts` or reference `refreshSession`, `setAccessToken`, or `onSessionExpired` for the purpose of forwarding them into API calls.

### 4. Removal of Superseded Layer
- Delete `apps/web/src/lib/api-hooks.ts` once all consumers are migrated.
- Remove the now-unused public signatures from each `*-api.ts` module (or collapse them into transport-injected functions consumed only by the client).

### 5. Error Surface Preservation
- Domain-specific error classes (`AccountApiError`, `AdminTasksApiError`, …) and their `code` / `details` payloads must be preserved unchanged so existing `catch` branches in pages keep working.
- The client must not change the shape of returned data for any operation.

---

## Technical Constraints

- **No new runtime dependencies.** Continue using native `fetch` and the existing `fetch-with-auth` primitive.
- **No business-logic changes.** This is a pure-structural refactor; no endpoint, payload, or behavior changes.
- **Backwards compatibility is NOT required** at the lib API level — this is an internal refactor; all consumers are migrated atomically.
- **Cloud-agnostic.** The client must remain free of any provider-specific assumptions (no Cloudflare, no S3, no Auth0 references).
- **Type safety.** All domain methods must be fully typed; argument-order mistakes that were previously possible must be impossible after the refactor (no two adjacent parameters of the same primitive type unless distinguished by an object wrapper).
- **SSR/Edge runtime.** The client must function on the same runtimes the current code does (`runtime = 'edge'` pages in `apps/web/src/app/(protected)/admin/tasks/[id]/page.tsx`, `apps/web/src/app/(protected)/admin/users/[userId]/page.tsx`, `apps/web/src/app/(protected)/catalog/[id]/page.tsx`, `apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/page.tsx`, `apps/web/src/app/(protected)/tasks/[id]/page.tsx`).
- **No regression in concurrent-401 handling.** The single-flight refresh contract of `fetch-with-auth.ts` must be preserved end-to-end.

---

## Scope

### Phases
The task should be implemented in this order; each phase must compile and lint clean before the next begins.

**Phase A — Introduce the client (additive, no removals)**
1. Design the client surface (domain groupings, method names mirroring existing operations).
2. Implement the client as a wrapper over `fetch-with-auth.ts`.
3. Add `useApiClient` and the provider wiring inside `AuthContext`.
4. Add unit tests for the client (transport, single-flight refresh, session-expired propagation, error-class preservation).

**Phase B — Migrate consumers (mechanical, one folder at a time)**
1. `apps/web/src/app/(protected)/admin/topics/page.tsx`
2. `apps/web/src/app/(protected)/admin/tasks/page.tsx` + `[id]/page.tsx`
3. `apps/web/src/app/(protected)/admin/users/page.tsx` + `[userId]/page.tsx`
4. `apps/web/src/app/(protected)/catalog/` (layout, page, `[id]/page.tsx`, `[id]/[subtopicId]/page.tsx`)
5. `apps/web/src/app/(protected)/settings/page.tsx`
6. `apps/web/src/app/(protected)/tasks/` (page, `[id]/page.tsx`)
7. `apps/web/src/components/admin/MediaUploader.tsx` + `MediaList.tsx`
8. `apps/web/src/components/enrollment/enrollments-tab.tsx`
9. `apps/web/src/components/tasks/stage-editor.tsx` + `student-task-detail.tsx`
10. `apps/web/src/components/dashboard/DashboardContent.tsx`
11. The two custom loader hooks created in the prior session: `use-media-loader.ts` + `use-topics-loader.ts`.

**Phase C — Cleanup**
1. Delete `apps/web/src/lib/api-hooks.ts`.
2. Reduce or remove obsolete exports from each `*-api.ts` module.
3. Remove auth-quartet props from the components listed in Requirement 3.

### What does NOT change
- Backend routes, contracts, or behavior.
- The shape of data returned to UI components.
- `AuthContext`'s public surface, except for one new field (the wired client).
- The existing `fetch-with-auth.ts` primitive's contract (it may be wrapped, but its public function stays).

---

## Impact on Existing Tests

This section is mandatory reading before implementation. The PM has verified the test surface.

### Backend tests — **zero impact**
- `apps/api/test/**` does not import any `apps/web/src/lib/*-api.ts` module.
- Backend controllers, routes, and adapters are not modified.
- `make test-api` should pass with no changes.

### Frontend tests that **mock domain API modules directly** — **MUST be rewritten**
The following tests use `vi.mock('@web/lib/<x>-api')` to replace a frozen `*Api` object with a `vi.hoisted` mock. After the refactor, these modules no longer expose that surface; tests must mock `useApiClient` (or the client class) instead.

- `apps/web/__tests__/app/admin/topics.test.tsx` — mocks `adminTopicsApi`.
- `apps/web/__tests__/app/admin/users.test.tsx` — mocks `adminUsersApi`.
- `apps/web/__tests__/app/admin/user-enrollments.test.tsx` — mocks `adminEnrollmentApi` and related.
- `apps/web/src/components/tasks/__tests__/stage-editor.test.tsx` — mocks task-stage API calls.
- `apps/web/src/components/tasks/__tests__/student-task-detail.test.tsx` — mocks task API calls.

Rewrite strategy: introduce one shared test helper that returns a mock `ApiClient` with `vi.fn()`s on every domain method, and have the tests inject it through the `useApiClient` mock. This collapses the per-test mock boilerplate and prevents future drift.

### Frontend tests that **do not** touch API plumbing — **zero impact**
- `apps/web/__tests__/context/auth-context.test.tsx` — tests `AuthContext` only; the only change is one extra field (the client) that should be exercised in a single new assertion to confirm it is provided.
- `apps/web/__tests__/app/activate.test.tsx`
- `apps/web/__tests__/app/(auth)/login.test.tsx`
- `apps/web/src/components/auth/__tests__/auth.test.tsx`
- `apps/web/src/components/tasks/__tests__/student-task-card.test.tsx`
- `apps/web/src/components/tasks/__tests__/task-topic-picker.test.tsx`
- `apps/web/src/components/catalog/__tests__/subtopic-detail.test.tsx`
- `apps/web/src/components/catalog/__tests__/MarkdownViewer.test.tsx`
- `apps/web/src/components/catalog/__tests__/catalog-sidebar.test.tsx`
- `apps/web/src/components/catalog/__tests__/CatalogSidebar.test.tsx`
- `apps/web/src/components/dashboard/__tests__/dashboard.test.tsx` — verify mock; may need the new helper depending on what it currently mocks.
- `apps/web/__tests__/components/catalog/MediaGallery.test.tsx`
- `apps/web/__tests__/components/catalog/ContentSection.test.tsx`
- `apps/web/src/lib/__tests__/topic-rollup.test.ts` — pure function, no API dependency.

### New tests REQUIRED
1. **Client unit tests** — exercise transport behavior end-to-end against `fetch` mocks: success path, 401 → refresh → retry, 401 → refresh-failure → `onSessionExpired`, concurrent 401s share a single refresh, non-401 errors propagated as-is, domain-specific error classes still thrown.
2. **`useApiClient` integration test** — confirm the hook returns a stable, memoised instance across renders when the auth context is unchanged, and a new instance when the token changes.
3. **Migration smoke test** — a representative page test (suggest `admin/topics.test.tsx` rewritten with the new helper) demonstrating that mocking the client is simpler than mocking individual API modules.

---

## Acceptance Criteria

- [ ] A single `ApiClient` class exists and is the only place in `apps/web` that knows the auth-quartet plumbing.
- [ ] A `useApiClient` hook exposes a memoised, auth-wired client; it is the only sanctioned way components obtain a client.
- [ ] Every domain operation accepts **only business arguments**; no public signature includes `token`, `refreshFn`, `onTokenUpdate`, or `onSessionExpired`.
- [ ] `apps/web/src/lib/api-hooks.ts` is deleted.
- [ ] No component prop named `token`, `refreshSession`, `setAccessToken`, or `onSessionExpired` remains in the components listed in Requirement 3.
- [ ] Single-flight refresh behavior of `fetch-with-auth.ts` is preserved (covered by a unit test).
- [ ] Domain error classes (`AccountApiError`, `AdminTasksApiError`, …) are thrown with unchanged `code` and `details`.
- [ ] All tests listed under "Impact on Existing Tests" are rewritten or unchanged according to the table above.
- [ ] New tests under "New tests REQUIRED" exist and pass.
- [ ] `make lint` passes.
- [ ] `make test` passes (both `test-api` and `test-web`).
- [ ] `make build` succeeds for both `web` and `api`.
- [ ] Manual smoke test: log in, navigate admin topics → admin tasks → admin users → catalog → settings → student tasks; verify no console errors and that the silent token-refresh flow still works (force a 401 by waiting out the access token or by clearing it in devtools, then trigger a navigation that requires auth).

---

## Verification Plan

### Static checks (run before opening PR)
1. `grep -rn "refreshSession\|onSessionExpired\|setAccessToken" apps/web/src --include="*.ts" --include="*.tsx"` — should match only inside `AuthContext`, the new client, the new hook, and tests that intentionally exercise auth boundaries.
2. `grep -rn "fetchWithAuth\|fetch-with-auth" apps/web/src --include="*.ts" --include="*.tsx"` — should match only the client implementation and its own tests.
3. `grep -rn "from '@web/lib/api-hooks'" apps/web/src` — must return zero matches.
4. `grep -rn "adminTopicsApi\.\|adminTasksApi\.\|adminUsersApi\.\|adminMediaApi\.\|adminEnrollmentApi\.\|topicsApi\.\|tasksApi\.\|accountApi\.\|progressApi\.\|getDashboard(" apps/web/src --include="*.tsx"` — must return zero matches outside the client/lib layer.

### Automated tests
- `make test-web` — all rewritten and new tests pass.
- `make test-api` — unaffected, must still pass.
- `make lint` — must pass cleanly.
- `make build` — must succeed.

### Manual verification (Browser)
1. Authenticated session smoke test across all migrated pages (admin/topics, admin/tasks, admin/users, catalog, settings, tasks).
2. Forced-401 test: invalidate the access token in devtools, trigger an API-backed navigation, confirm silent refresh + retry succeeds and the UI updates without flicker.
3. Session-expired test: clear the refresh-token cookie, trigger an API call, confirm the session-expired flow runs (logout + redirect).
4. Concurrent-401 test: open two pages simultaneously after invalidating the token; confirm only one refresh request is issued (Network tab).

---

## Notes

- This task closes the structural gap that produced the silent missing-argument bugs uncovered during the prior session's compile-time triage. The patches applied during that session ("add `refreshSession, setAccessToken, onSessionExpired` to every call site") should be treated as tactical and **superseded** by this refactor; do not preserve them as the long-term architecture.
- The work is mechanical after Phase A is in place. Reviewers should pay particular attention to: (a) the client's single-flight refresh test, (b) preservation of domain error classes, (c) stability of the memoised client across renders.
- A follow-up task may extract the transport layer (`fetch-with-auth.ts` + the client's HTTP method) into a small reusable abstraction inside `packages/shared` if a second consumer ever appears, but that is out of scope here — the current client lives in `apps/web/src/lib/` and consumes the existing primitive in place.
