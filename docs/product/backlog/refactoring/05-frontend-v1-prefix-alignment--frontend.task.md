# Task 05: Align Web Clients to the `/v1` Contract & Adopt Generated Types — Frontend (RFC 0003 — R3)

## Metadata
- **Status:** Open
- **Complexity:** Medium
- **Team:** Frontend Web
- **Milestone:** RFC 0003 — Route reorganization & OpenAPI (remaining work R3)
- **Depends On:** Builds on `refactoring/01-frontend-api-client-class.task.md` (✅ Done) and `02-frontend-direct-fetch-cleanup.task.md` (✅ Done). No backend prerequisite — the API already serves `/v1`.
- **Category:** Refactoring / Frontend Architecture
- **Source:** `docs/product/RFCs/0003-apps-api-route-organization-and-openapi.md` §6, §5 (R3)

---

## Summary

The API now serves every business route under `/v1`, but the web app still calls **un-prefixed** paths (`/topics`, `/auth/login`, …). This only works today because a transparent **legacy-rewrite shim** in `apps/api/src/index.ts:42-55` rewrites un-prefixed paths to `/v1/...` — backward-compat machinery the RFC intends to delete. This task makes the frontend call `/v1` **explicitly** (so the shim can later be removed in Task 06) by centralizing the version prefix in one place, and adopts the already-generated `api-types.gen.ts` so request/response types derive from the OpenAPI contract.

---

## Problem Statement

### Current behavior
- `apps/web/src/lib/api-client.ts:30` builds every request as `${process.env.NEXT_PUBLIC_API_URL}${path}` with **no version segment**; domain modules pass un-prefixed paths (e.g. `topics-api.ts:20` → `http('GET', '/topics')`).
- `apps/web/src/lib/auth-api.ts` is standalone (pre-auth, bypasses the transport) and calls `${API_URL}/auth/login`, `/auth/refresh`, etc. — also un-prefixed.
- A hardcoded OAuth link in `apps/web/src/app/(auth)/login/page.tsx:265` points at `${NEXT_PUBLIC_API_URL}/auth/google`.
- `NEXT_PUBLIC_API_URL` is `http://localhost:8787` (no `/v1`) in `.env.example` / `.env` / `.env.local`.
- `apps/web/src/lib/api-types.gen.ts` (generated from `apps/api/openapi.json`, keyed by `/v1/...`) exists but **is not consumed** by any client.

The whole thing functions only because the API shim rewrites the un-prefixed calls. Once that shim is removed (Task 06), the web app would break unless it targets `/v1` directly.

### Expected behavior
- All web → API calls hit `/v1/...` **explicitly**, independent of the API shim.
- The `/v1` prefix is defined in **one** place (the transport), not duplicated across every `*-api.ts` path string.
- Request/response types are sourced from `api-types.gen.ts` so backend contract drift surfaces at **compile time**, not runtime.
- The app keeps working after the legacy shim is removed.

---

## Architectural Context

### Cloud-Agnostic / Next.js Alignment
- **Frontend-only.** No backend route/controller/adapter change.
- Reinforces the `ApiClient` boundary from Tasks 01/02: the version prefix belongs to the transport, not to scattered call sites.
- No new runtime dependencies (`openapi-typescript` is a dev-time generator already producing `api-types.gen.ts`).

### Decision: centralize, don't sprinkle
Prefer injecting `/v1` **once** in the `HttpTransport` (`api-client.ts`) rather than editing ~60 path strings. Two call sites bypass the transport and need their own update:
- `auth-api.ts` (standalone pre-auth client),
- `login/page.tsx:265` (hardcoded OAuth anchor).

Resolve in planning whether the prefix is best expressed as a constant prepended in the transport, or by setting `NEXT_PUBLIC_API_URL` to include `/v1`. **Recommendation:** keep `NEXT_PUBLIC_API_URL` as a bare origin and prepend a `/v1` constant in code — env vars that smuggle path segments are easy to misconfigure across environments, and a code constant is testable.

### Files in scope (web)
- `apps/web/src/lib/api-client.ts` — central `/v1` prefix in the transport.
- `apps/web/src/lib/auth-api.ts` — prefix the standalone auth calls.
- `apps/web/src/app/(auth)/login/page.tsx` — fix the OAuth link.
- `apps/web/src/lib/*-api.ts` — adopt `api-types.gen.ts` types (replace hand-mirrored request/response shapes where a generated type exists): `topics-api.ts`, `tasks-api.ts`, `comments-api.ts`, `progress-api.ts`, `dashboard-api.ts`, `account-api.ts`, `admin-{topics,tasks,users,media,enrollment}-api.ts`.
- `apps/web/.env.example` (and document the expected value) — confirm/clarify the base-URL convention chosen above.

### Out of scope
- Any backend change, including **removing** the legacy shim (that is Task 06, gated on this task).
- New UI, pages, or UX changes.
- Regenerating `api-types.gen.ts` (the file already exists; regeneration is a backend concern in Tasks 03/04 when the contract changes).

---

## Requirements
1. **Single-source `/v1`.** All transport-routed calls resolve to `/v1/...` via one change in `api-client.ts`; no domain module hardcodes `/v1`.
2. **Cover the bypass paths.** `auth-api.ts` and `login/page.tsx` OAuth link target `/v1/auth/...`.
3. **Adopt generated types.** Where `api-types.gen.ts` provides a request/response type for an endpoint, the corresponding `*-api.ts` method uses it instead of a hand-written shape; a backend field rename then fails the web build.
4. **Env clarity.** `.env.example` documents the agreed base-URL convention so local/staging/prod are unambiguous.
5. **No double prefix.** Guard against `/v1/v1/...` (e.g. while the API shim still exists, a `/v1/topics` request must not be re-rewritten — confirm the shim only matches un-prefixed paths; it does, per `index.ts:43-51`).

---

## Technical Constraints
- **No new runtime dependencies.**
- **No backend changes.**
- All user-facing strings already i18n'd; this task introduces none. If any are touched, follow the `dict-en.ts`/`dict-pt.ts` convention (CLAUDE.md).
- Must build on the edge runtime (the catalog page is `runtime = 'edge'`); changes are transport/type-level and edge-safe.

---

## Impact on Existing Tests
- Frontend tests that assert request URLs or mock the transport must expect `/v1/...`.
- Tests that mock `auth-api.ts` endpoints update to the `/v1/auth/...` paths.
- Adopting generated types may surface pre-existing shape mismatches — treat each as a real contract bug to reconcile, not a test to loosen.

---

## Acceptance Criteria
- [ ] Every transport-routed call resolves to `/v1/...`; the prefix is defined in exactly one place in `api-client.ts`.
- [ ] `auth-api.ts` and the `login/page.tsx` OAuth link target `/v1/auth/...`.
- [ ] No `*-api.ts` module hardcodes `/v1` in individual path strings.
- [ ] At least the public/catalog and comments client methods consume types from `api-types.gen.ts`.
- [ ] `.env.example` documents the base-URL convention; no `/v1/v1` double-prefix can occur.
- [ ] `make lint`, `make test-web`, `make build` pass.
- [ ] Manual smoke test passes against a local API **with the shim still present** (this task does not remove it).

---

## Verification Plan
1. `make test-web` — updated transport/auth tests pass; type adoption compiles cleanly.
2. `grep -rn "'/topics\|'/auth\|'/tasks\|'/me\|'/admin\|'/leaderboard" apps/web/src/lib` — confirm no path string already carries `/v1` (prefix is centralized) and the bypass files are handled.
3. `make dev` (web + api) — exercise login, catalog list/detail, comments list/post, tasks, dashboard, an admin CRUD; confirm all requests in the Network tab hit `/v1/...` and succeed.
4. Confirm no `/v1/v1/...` requests appear in the Network tab.
5. Hand-off note for Task 06: once this task is merged, the legacy shim in `apps/api/src/index.ts:42-55` can be removed.
