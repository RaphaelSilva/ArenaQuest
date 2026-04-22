# Milestone 2 — Close-out Analysis

**Date:** 2026-04-18
**Scope:** `docs/product/milestones/2/` — Authentication & User Management
**Goal:** decide whether the project can advance to Milestone 3.

---

## 1. Executive Summary

All **9 tasks** listed in `milestone.md` are marked **Done/Complete**, and every acceptance
criterion declared in those task files is checked. Both test suites are green.

| Suite | Files | Tests | Status |
|-------|-------|-------|--------|
| `apps/api` (Vitest + `@cloudflare/vitest-pool-workers`) | 9 | **85** | ✅ pass |
| `apps/web` (Vitest + React Testing Library) | 3 | **30** | ✅ pass |

**Recommendation:** the milestone's functional contract is met and the project **may advance
to Milestone 3**, but three items below should be cleared first: the in-plaintext refresh
tokens (section 4.1), the missing refresh-token revocation on deactivation (section 4.2),
and the absence of a "first login" journey (section 3).

---

## 2. Acceptance Criteria — Milestone Level

| # | Criterion | State | Evidence |
|---|-----------|-------|----------|
| 1 | Users can sign in and receive a valid JWT | ✅ | `auth.router.spec.ts`, `auth.controller.spec.ts` |
| 2 | Protected API routes return 401 without a valid token | ✅ | `auth-guard.spec.ts`, `admin-users.router.spec.ts` |
| 3 | UI displays different nav options based on role | ✅ | `CanView` gate + `use-auth.ts` hooks, `nav.tsx` |
| 4 | Admin can create a user and assign "Student" role | ✅ | `admin-users.router.spec.ts`, `users.test.tsx` |
| 5 | Admin-only page is inaccessible to students | ✅ | `requireRole` middleware + redirect in `(protected)/admin/users/page.tsx` |
| 6 | Auth secrets come from env vars, never hardcoded | ✅ | `JwtAuthAdapter` enforces `≥ 32 char` secret; `wrangler.jsonc` declares `JWT_SECRET` |

---

## 3. Test Coverage Analysis

### 3.1 What *is* covered

**Backend (`apps/api`)** — 85 tests across 9 files:

- `core/auth/auth-service.spec.ts` (13) — login success/failure, password check, inactive
  account rejection, refresh rotation, logout revocation.
- `adapters/auth/jwt-auth-adapter` — exercised indirectly through service & route tests.
- `db/d1-user-repository.spec.ts` (6) — create/find/update/delete round-trips against a
  real in-runtime D1 instance via the Workers test pool.
- `middleware/auth-guard.spec.ts` (8) — missing header, expired token, bad token, and
  role-guard positive/negative.
- `controllers/auth.controller.spec.ts` (16) — input validation + error mapping.
- `routes/auth.router.spec.ts` (9) — HTTP contract, cookie flags, refresh rotation.
- `routes/admin-users.router.spec.ts` (26) — full CRUD + RBAC enforcement + Zod
  validation errors.
- `shared-roles.spec.ts` (1) — `ROLES` constant shape.
- `controllers/health.controller.spec.ts` (3) + `index.spec.ts` (3) — worker bootstrap.

**Frontend (`apps/web`)** — 30 tests across 3 files:

- `context/auth-context.test.tsx` (15) — login, logout, session restore, error paths.
- `app/(auth)/login.test.tsx` (6) — field rendering, submit, error messaging.
- `app/admin/users.test.tsx` (9) — table render, create submit, non-admin redirect.

### 3.2 What is **not** covered

| Gap | Severity | Notes |
|-----|----------|-------|
| No end-to-end tests (Playwright / Cucumber) | Medium | Explicitly deferred to Milestone 3 per Task 09's "Note on Cucumber". |
| No coverage report is produced | Low | Vitest is not run with `--coverage`; there is no threshold in CI. Easy to add. |
| `JwtAuthAdapter` has no **direct** unit test file | Low | It is exercised via service/route tests; a dedicated suite would fuzz malformed tokens (non-HS256, missing claims) more cheaply than through the HTTP boundary. |
| `D1RefreshTokenRepository` has no dedicated test file | Low | Covered indirectly by `auth-service` and `auth.router` tests. |
| No contract tests between the web `authApi` client and the API router | Low | Both sides are tested against mocks; a shared schema (e.g. zod) would prevent drift. |
| No load/perf tests on PBKDF2 with concurrent logins | Low | Edge runtime has tight CPU limits; worth a smoke test before scaling. |

### 3.3 Verdict

Coverage is **adequate for the milestone's acceptance criteria**. Every business rule
present in code has at least one test. The main hole is behavioural E2E coverage, which is
appropriate to add alongside Milestone 3 UI work.

---

## 4. Outstanding Activities

### 4.1 Security / hardening — **do before Milestone 3**

1. **Hash refresh tokens at rest.** `d1-refresh-token-repository.ts:13` stores the raw
   token. Task 03 description calls for SHA-256 at rest. A D1 dump would expose live session
   credentials.
2. **Revoke refresh tokens on deactivation / role change.** The admin `PATCH` and
   `DELETE` handlers (`admin-users.router.ts:83,105`) update user status but do not call
   `IRefreshTokenRepository.deleteAllForUser`. A disabled user keeps a valid session
   until the 7-day cookie expires.
3. **Close the login user-enumeration timing leak.** `AuthService.login()`
   (`auth-service.ts:21`) returns early when `findByEmail` returns `null`, skipping the
   ~100 k-iteration PBKDF2 verification. Valid/invalid emails are thus distinguishable by
   latency. Fix: always run a dummy `verifyPassword` when the user is missing.

### 4.2 Functional gaps — can be scheduled into M3 or a dedicated "hardening" sprint

- **No first-login journey.** See section 5.
- **No password-reset / forgot-password flow.**
- **No email verification** for newly-created users (`pending` → `active` transition is
  defined in the status enum but unused).
- **No rate-limiting / account lockout** on `/auth/login`. Only PBKDF2 cost gates brute
  force.
- **No "last-admin" protection.** An admin can deactivate themselves or the only
  remaining admin, locking the backoffice.
- **No refresh-token cleanup job** for expired rows.
- **No initial-admin bootstrap path for production.** The only seed lives at
  `apps/api/scripts/0004_seed_dev_users.sql` with a known password and is *explicitly* for
  local dev. Production needs a documented procedure (`wrangler d1 execute` with a unique
  hash generated through `scripts/gen-hash.ts`, plus a forced password change on first
  login).

### 4.3 Hygiene

- `apps/web/src/lib/auth-api.ts:12` — leftover `console.log('API_URL', API_URL)`; remove.
- Wrangler compat date (`2026-04-14`) is newer than the installed runtime's support date
  (`2026-03-10`). Harmless warning today, but worth aligning.
- `JwtAuthAdapter` defaults to **100 000** PBKDF2 iterations. OWASP's current baseline for
  PBKDF2-SHA256 is **210 000**. The code comments acknowledge this trade-off for edge CPU;
  revisit once perf data exists.
- `apps/web` `middleware.ts` relies on cookie *presence* only (documented trade-off). Fine
  for now — just remember when reasoning about bypass scenarios.

---

## 5. First-Login Journey — Planning Status

**There is no plan and no implementation for a first-login journey.**

### 5.1 Current reality

Admin creates a user via `POST /admin/users` with a chosen password in the request body
(`admin-users.router.ts:61`). The password hash is stored; the user's `status` defaults
to `active`; no email is sent. The admin shares the password out-of-band (chat, email, etc).
The student then reaches `/login`, authenticates, and lands on `/dashboard`.

There is **no**:

- Invitation / activation email.
- Forced password change on first login.
- One-time activation token.
- Use of the `pending` user status defined in `Entities.Config.UserStatus` (it exists only
  in the enum; no transition writes it).

### 5.2 Recommendation for Milestone 3 scope

Create a dedicated task — or a sub-milestone "2.1 Onboarding" — covering:

1. `POST /admin/users` defaults new users to `status = 'pending'` and generates a random
   `activation_token` (one-time, time-boxed).
2. A new table `activation_tokens (token, user_id, expires_at)` mirroring the refresh-token
   pattern.
3. A new endpoint `POST /auth/activate` that accepts `{ token, newPassword }`, sets the
   new hash, flips status to `active`, deletes the token.
4. A UI page `/activate?token=…` with password + confirmation fields.
5. An outbound-email port (`INotificationAdapter`) so the activation link can be dispatched
   — implementation can start as a no-op / console-log adapter and be swapped for a real
   provider later without touching business logic.

This also unlocks a matching password-reset flow with the same primitives.

---

## 6. Security Audit Findings

Ranked by exploitability; CVSS-style severity is approximate.

| # | Severity | Finding | Location | Mitigation |
|---|----------|---------|----------|------------|
| S-01 | **High** | Refresh tokens stored in plaintext in D1 | `apps/api/src/adapters/db/d1-refresh-token-repository.ts` | Hash with SHA-256 on `save`; hash+lookup on `findByToken`. Rotate existing rows on deploy. | ✅ **Closed** — commit `8dde48b` |
| S-02 | **Medium** | Deactivating / role-changing a user does not revoke their active sessions | `apps/api/src/routes/admin-users.router.ts:83,105` | Call `tokens.deleteAllForUser(id)` inside both handlers. | ✅ **Closed** — commit `5697266` |
| S-03 | **Medium** | User-enumeration timing side-channel in login | `apps/api/src/core/auth/auth-service.ts:21` | Always run `verifyPassword` against a dummy hash when the user is absent. | ✅ **Closed** — commit `fe3cf09` |
| S-04 | **Medium** | No rate-limit / lockout on `/auth/login` | `apps/api/src/routes/auth.router.ts:13` | Cloudflare Rate-Limiting binding or per-IP/per-email sliding window in KV; consider a lock-out counter column. | ✅ **Closed** — commit `64d7208` |
| S-05 | Low | No "last-admin" guard; an admin can lock the backoffice out | `apps/api/src/routes/admin-users.router.ts` | Reject PATCH/DELETE when result would leave zero active admins and/or when actor is deactivating self. | ✅ **Closed** — commit `9ba9c44` |
| S-06 | Low | PBKDF2 iteration count (100 000) below current OWASP recommendation (210 000) | `apps/api/src/adapters/auth/jwt-auth-adapter.ts:148` | Raise once P99 login latency is measured; the `pbkdf2:<n>:...` format already supports graceful per-hash upgrades. | ✅ **Closed** — commit `feda632` |
| S-07 | Low | `console.log('API_URL', ...)` leaks config to browser console | `apps/web/src/lib/auth-api.ts:12` | Remove. | ✅ **Closed** — commit `1acf836` |
| S-08 | Low | Dev seed commits a known password hash (`password123`) | `apps/api/scripts/0004_seed_dev_users.sql` | Keep out of prod migrations (it already is); document in README; add a pre-deploy guard that rejects the seed hash in prod. | ✅ **Closed** — commit `012d7b7` |
| S-09 | Info | Edge middleware only checks cookie *presence*, not validity | `apps/web/src/middleware.ts` | Documented trade-off; API rejects invalid cookies. No action required, keep noted. | ✅ **Accepted as designed** |
| S-10 | Info | Hand-rolled JWT implementation — not externally audited | `apps/api/src/adapters/auth/jwt-auth-adapter.ts` | Acceptable at MVP (covered by unit tests); revisit if we add asymmetric keys / multiple issuers. | ✅ **Closed** — adversarial suite added commit `feda632` |

All high-severity findings are closed. The hardening epic (S-01 → S-10) is complete.

---

## 7. Go / No-Go for Milestone 3

| Gate | Status |
|------|--------|
| All Milestone 2 tasks closed | ✅ |
| All acceptance criteria met | ✅ |
| Test suites green | ✅ |
| No high-severity security debt left open | ✅ S-01–S-10 all closed (hardening epic complete) |
| First-login journey designed | ❌ — not required by M2 scope, but M3 should open with it |

**Decision:** **GO**, contingent on closing S-01/S-02/S-03 (a ~1-day scope) and creating a
"2.1 Onboarding" or "3.0 First-Login" task before the content/media work of Milestone 3
starts.
