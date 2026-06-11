# Task 06: Align API Tests to `/v1` & Remove the Legacy-Rewrite Shim (RFC 0003 — R4)

## Metadata
- **Status:** Open
- **Complexity:** Medium
- **Team:** Backend API
- **Milestone:** RFC 0003 — Route reorganization & OpenAPI (remaining work R4)
- **Dependencies:** **Task 05** (`05-frontend-v1-prefix-alignment--frontend.task.md`) must be merged before the shim is removed, so the web app keeps working. Independent of Tasks 03/04, but ideally lands after them so the suite is already green.
- **Category:** Refactoring / Test Alignment
- **Source:** `docs/product/RFCs/0003-apps-api-route-organization-and-openapi.md` §7, §5 (R4)

---

## Summary

The API test suite (~64 spec files) hits **un-prefixed** literal paths (`/admin/topics`, `/topics`, `/auth/login`, `/me/...`) against the real `worker` from `src/index`. Those tests pass **only** because of the transparent legacy-rewrite shim in `apps/api/src/index.ts:42-55`. This task points the tests at `/v1` **explicitly** (via a centralized helper, not ~117 scattered edits) and then **removes the shim** — the final step of the RFC 0003 cutover. Deleting the shim is what proves the cutover is complete: nothing depends on the un-prefixed paths anymore.

---

## Problem Statement

### Current behavior
- `apps/api/test/**` contains ~64 spec files / ~803 tests, integration-style: each builds a request and calls `worker.fetch(request, env, ctx)` through a per-file `req()` helper using literal paths (e.g. `req('POST', '/admin/topics', …)`).
- ~117 hardcoded path literals across ~13 route specs reference the affected prefixes (`/auth/login` ×~20, `/admin/users` ×~23, `/admin/topics` ×~15, `/topics`, `/me/*`, …). **Zero** reference `/v1`.
- They pass because `src/index.ts:42-55` rewrites un-prefixed `/auth|/me|/admin|/topics|/tasks|/leaderboard|/catalog` to `/v1/...`.

### Expected behavior
- Tests target `/v1/...` directly, with the version prefix expressed in **one** shared place (a path-constants helper, or `/v1` prepended inside the shared `req()` helper) rather than duplicated across every spec.
- The legacy-rewrite shim is **deleted** from `src/index.ts`; the worker serves business routes **only** under `/v1` (plus the unversioned `/health`, `/openapi.json`, `/docs`).
- The full suite stays green, now validating the real, un-shimmed contract.

---

## Architectural Context

### Cloud-Agnostic / Ports & Adapters Alignment
- **Backend + tests only.** No port/adapter/DB change. The only production-code change is **removing** the shim block in `src/index.ts` (a simplification, not a new dependency).
- Removing the shim eliminates the last piece of backward-compat machinery the RFC flagged as unnecessary pre-production (RFC §5).

### Why Task 05 is a hard prerequisite for the shim removal
The same shim also covers the **web app** in local/staging. If the shim is removed before the frontend targets `/v1` (Task 05), the web app 404s. Therefore: migrate tests to `/v1` (safe anytime) but only delete the shim once Task 05 is merged.

### Files in scope
- `apps/api/test/helpers/` — add a small path-constants / base-path helper (e.g. a `v1(path)` builder or a `/v1` prefix applied inside each spec's `req()` helper).
- `apps/api/test/routes/*.spec.ts` — switch literal paths to the helper / `/v1`-prefixed paths (the ~13 route specs listed in RFC §7).
- `apps/api/src/index.ts` — **remove** the legacy-rewrite block (lines ~42-55), leaving the plain `buildApp(env).fetch(...)` path.

### Out of scope
- Any route/controller behavior change (Tasks 03/04 own those).
- Frontend changes (Task 05).
- The `oasdiff` CI contract gate — deferred until production (RFC §9, PD3).

---

## Requirements
1. **Centralized prefix in tests.** Introduce one shared mechanism so a single edit controls the `/v1` prefix across specs; avoid ~117 independent string edits where the helper can absorb them.
2. **Migrate paths.** All affected route specs hit `/v1/...`. Unversioned endpoints (`/health`, `/openapi.json`, `/docs`) stay un-prefixed.
3. **Remove the shim.** Delete the rewrite block in `src/index.ts`; the worker no longer accepts un-prefixed business paths.
4. **Prove the cutover.** Add at least one test asserting that an **un-prefixed** business path (e.g. `GET /topics`) now returns `404` (the shim is truly gone), and that its `/v1` counterpart works.
5. **Green suite.** The entire suite passes against the un-shimmed worker.

---

## Technical Constraints
- **No new runtime dependencies.**
- Do not change request/response bodies or status codes — only the **path** the tests target and the removal of the shim.
- Coordinate merge order: this task's **shim removal** must not merge before Task 05.

---

## Impact on Existing Tests
- This task *is* the test change: the ~13 route specs are updated to `/v1`.
- After shim removal, any spec still using an un-prefixed business path will fail — that failure is the desired signal; fix the path, do not re-add the shim.
- E2E suites in `docs/product/backlog/test-debt/` hit the app through the web/HTTP layer; if any reference the API directly with un-prefixed paths, include them in the sweep.

---

## Acceptance Criteria
- [ ] A shared helper centralizes the `/v1` prefix for tests; no spec hardcodes the prefix ad hoc.
- [ ] All affected route specs target `/v1/...`; `grep -rn "req('[A-Z]*', '/\(auth\|topics\|tasks\|me\|admin\|leaderboard\)" apps/api/test` shows no un-prefixed business paths.
- [ ] The legacy-rewrite block is removed from `apps/api/src/index.ts`.
- [ ] A test asserts an un-prefixed business path now `404`s and its `/v1` counterpart succeeds.
- [ ] Task 05 is merged before the commit that removes the shim.
- [ ] `make lint`, `make test-api`, `make build` pass; full suite green against the un-shimmed worker.

---

## Verification Plan
1. **Phase A (safe anytime):** migrate specs to `/v1`; `make test-api` green **with the shim still present**.
2. **Phase B (after Task 05 merged):** remove the shim from `src/index.ts`; `make test-api` green again, now including the new un-prefixed-`404` assertion.
3. `grep -n "url.pathname = \`/v1" apps/api/src/index.ts` — returns nothing (shim gone).
4. `make dev-api`; `curl localhost:8787/topics` → `404`; `curl localhost:8787/v1/topics` (with a token) → `200`; `curl localhost:8787/health` → `200`.
5. Smoke the web app (`make dev`) once more to confirm Task 05 already made it `/v1`-native and nothing regressed after shim removal.
