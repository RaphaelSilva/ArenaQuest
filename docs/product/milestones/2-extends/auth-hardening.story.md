# Story: Auth Hardening — Closing Milestone 2's Security Debt

> **Why this file is not `milestone.md`:** this is an **extension** of Milestone 2, not a
> new milestone. Milestone 2's functional contract is already met
> (see [`../2/closeout-analysis.md`](../2/closeout-analysis.md)). This story groups every
> **Security Audit Finding** raised in that close-out document into a single, bounded
> hardening epic so it can be tracked, scheduled, and closed before Milestone 3's content
> work begins.

- **Origin document:** [`docs/product/milestones/2/closeout-analysis.md §6`](../2/closeout-analysis.md#6-security-audit-findings)
- **Scope:** findings **S-01 → S-10** (all severities).
- **Non-goals:** the first-login journey (§5 of the close-out) is *not* part of this story
  — it is product work, not a security fix. It belongs to its own story under
  `milestones/3/` or a `2.1/` onboarding folder.

---

## 1. Objectives

| # | Objective | Tied Findings |
|---|-----------|---------------|
| O-1 | **Sessions remain private even under a partial data breach.** A dump of the `refresh_tokens` table alone must not yield usable session credentials. | S-01 |
| O-2 | **Administrative state changes revoke sessions immediately.** A deactivated user, a demoted admin, or a user with changed roles loses all live sessions without waiting for the 7-day cookie to expire. | S-02 |
| O-3 | **Login is uniform in timing and cost.** Response latency and CPU usage reveal nothing about whether an email exists in the database. | S-03 |
| O-4 | **Brute force is economically infeasible.** `/auth/login` is rate-limited and temporarily locks out after repeated failures, without degrading the UX for honest users. | S-04 |
| O-5 | **The backoffice cannot be locked out by a single admin action.** It is impossible to leave the system with zero active admins or to deactivate oneself. | S-05 |
| O-6 | **Password hashing is forward-compatible.** The cost parameter can be raised without invalidating any existing hash. | S-06 |
| O-7 | **No client-side telemetry leaks configuration or PII.** No stray `console.log` of URLs, tokens, or emails. | S-07 |
| O-8 | **Dev seed data cannot reach production.** A production deploy with the known dev hash fails loudly at deploy-time. | S-08 |
| O-9 | **`JwtAuthAdapter` is exercised by adversarial unit tests.** Malformed headers, wrong algorithms, truncated signatures, and claim-shape mutations are all regression-tested. | S-10 |

S-09 (Edge middleware only checks cookie presence) is **accepted as designed** and remains
documented; no task is created for it.

---

## 2. Functional Requirements

### 2.1 Session storage — FR-HARD-01 *(S-01)*

- Refresh tokens MUST be persisted as a **SHA-256 digest** (hex-encoded).
- The opaque token value is only ever visible to the client (set in the `refresh_token`
  cookie) and must not be re-derivable from the database.
- `IRefreshTokenRepository.findByToken` accepts the plain token and performs the digest
  transparently, so the `AuthService` interface is unchanged.
- A migration hashes any rows already in place; if hashing pre-existing rows is not
  feasible, the rows are dropped (forcing an all-user re-login) and the behaviour is
  documented in the task.

### 2.2 Session revocation — FR-HARD-02 *(S-02)*

- `PATCH /admin/users/:id` MUST call `tokens.deleteAllForUser(id)` whenever either
  `status` transitions away from `active` or `roles` changes.
- `DELETE /admin/users/:id` (soft-delete) MUST revoke all sessions for the target user.
- Auth-related admin paths SHOULD emit an audit log line `{event, userId, actor}` at
  `console.info`; a real audit sink is deferred, but the shape is locked in now.

### 2.3 Constant-time login — FR-HARD-03 *(S-03)*

- `AuthService.login` MUST run a password verification with equivalent CPU cost whether
  or not the email exists. Use a pre-computed dummy `pbkdf2:...` hash and compare against
  it when `findByEmail` returns `null`.
- The resulting error is `AuthError(INVALID_CREDENTIALS)` in both branches.
- A unit test asserts both branches take within ±20 % of each other's runtime on the
  Workers test pool.

### 2.4 Rate-limiting and lockout — FR-HARD-04 *(S-04)*

- Login attempts are counted per `(email, ip)` tuple.
- After **N = 5** failures within **10 min**, the tuple is locked for **15 min** and the
  endpoint returns `429 Too Many Requests` with a `Retry-After` header.
- Counter storage uses a pluggable `IRateLimiter` port with an initial Cloudflare KV
  adapter. The port must keep implementations swappable (Redis, DurableObject, in-memory
  for tests).
- Successful login clears the counter for that tuple.

### 2.5 Admin lockout prevention — FR-HARD-05 *(S-05)*

- `PATCH /admin/users/:id` MUST reject (`409 Conflict`, code `WOULD_LOCK_OUT_ADMINS`) any
  change that leaves zero active users with the `admin` role.
- `PATCH` and `DELETE` MUST reject self-targeted deactivations and self-removal of the
  `admin` role (`409`, code `SELF_LOCKOUT`). The actor id is read from
  `c.get('user').sub`.
- Both rules are enforced server-side only — the UI can surface the error but never
  decides.

### 2.6 PBKDF2 upgrade path — FR-HARD-06 *(S-06)*

- Default iteration count rises to **210 000** for new hashes.
- `AuthService.login`, on a successful verify against a hash whose iteration count is
  lower than the current target, MUST rehash the password and call
  `users.updatePasswordHash(id, newHash)` (new repository method).
- Failed verify never triggers a rehash.
- The `pbkdf2:<iter>:...` format already supports this — no schema change required.

### 2.7 Web logging hygiene — FR-HARD-07 *(S-07)*

- Remove the `console.log('API_URL', …)` in `apps/web/src/lib/auth-api.ts:12`.
- Add an ESLint rule (`no-console` with warn level) to `apps/web` to prevent regressions.
  Exceptions (`console.warn`, `console.error`) are explicitly allowed.

### 2.8 Production seed guard — FR-HARD-08 *(S-08)*

- A deploy-time script inspects the target D1 and fails when any user row matches the
  known dev hash (`pbkdf2:100000:e83835066ab015b5ed4449b68a349b38:8baf9add…`).
- The dev seed SQL is relocated from `apps/api/scripts/` to
  `apps/api/scripts/dev/` and the header comment restates that it is development-only.
- The production bootstrap procedure for the first admin is documented in
  `docs/product/api/bootstrap-first-admin.md`: an operator runs `scripts/gen-hash.ts`
  with a unique password, pastes the `pbkdf2:...` string into a templated SQL statement,
  and executes it via `wrangler d1 execute ... --remote`.

### 2.9 JWT adversarial tests — FR-HARD-09 *(S-10)*

- A dedicated suite `apps/api/test/adapters/auth/jwt-auth-adapter.spec.ts` covers:
  - `alg ≠ HS256` (including `alg: 'none'`).
  - `typ ≠ JWT`.
  - Wrong segment count (1, 2, 4).
  - Invalid base64url in each segment.
  - Signature mismatch.
  - Expired token (`exp` in the past).
  - Missing/extra claim types (non-string `sub`, non-array `roles`).
  - Password-hash format mutations (wrong prefix, short salt, non-hex characters).

---

## 3. Acceptance Criteria

- [x] **AC-1 (O-1).** Dumping `refresh_tokens` and replaying any row as a cookie returns
      `401 Unauthorized`.
- [x] **AC-2 (O-2).** Integration test: deactivate a logged-in user → their
      `/auth/refresh` attempt returns `401` on the very next call.
- [x] **AC-3 (O-2).** Integration test: removing the `admin` role from a logged-in admin
      invalidates all their refresh tokens.
- [x] **AC-4 (O-3).** Timing assertion: `login("nonexistent@…")` and
      `login("valid@…", "wrong")` differ by less than 20 % of the valid-login duration.
- [x] **AC-5 (O-4).** After 5 `401`s within 10 min for the same `(email, ip)`, the 6th
      attempt returns `429` with `Retry-After`.
- [x] **AC-6 (O-4).** A successful login resets the counter.
- [x] **AC-7 (O-5).** `PATCH` that would leave zero active admins returns `409` with code
      `WOULD_LOCK_OUT_ADMINS`.
- [x] **AC-8 (O-5).** Actor cannot deactivate themselves — returns `409` `SELF_LOCKOUT`.
- [x] **AC-9 (O-6).** A user whose hash was created at 100 000 iterations is
      transparently upgraded to 210 000 on their next successful login.
- [x] **AC-10 (O-7).** `grep -R "console.log" apps/web/src` returns 0 matches; ESLint
      warns on new occurrences.
- [x] **AC-11 (O-8).** The deploy script aborts when the target DB contains the known dev
      password hash; running it against a clean DB succeeds.
- [x] **AC-12 (O-8).** `docs/product/api/bootstrap-first-admin.md` exists and walks a new
      operator through initial admin creation in ≤ 5 minutes.
- [x] **AC-13 (O-9).** `jwt-auth-adapter.spec.ts` exists and covers every malformed-input
      category listed in §2.9; all tests pass.
- [x] **AC-14.** All existing suites remain green (`make test`).
- [x] **AC-15.** `make lint` is clean across the monorepo.

---

## 4. Task Breakdown

Each task is sized for **1–2 coding sessions** and lives as its own file in this folder.

| # | Task | Severity → | Files | Status |
|---|------|:---:|-------|:------:|
| 01 | [Hash refresh tokens at rest (SHA-256)](./01-hash-refresh-tokens-at-rest.task.md) | 🔴 High *(S-01)* | `d1-refresh-token-repository.ts`, migration `0004_hash_refresh_tokens.sql` | ✅ Done |
| 02 | [Revoke sessions on deactivation and role change](./02-revoke-sessions-on-admin-mutation.task.md) | 🟠 Medium *(S-02)* | `admin-users.router.ts`, tests | ✅ Done |
| 03 | [Constant-time login (dummy-hash verify)](./03-constant-time-login.task.md) | 🟠 Medium *(S-03)* | `auth-service.ts`, tests | ✅ Done |
| 04 | [`/auth/login` rate-limit + lockout (IRateLimiter port + KV adapter)](./04-login-rate-limit-and-lockout.task.md) | 🟠 Medium *(S-04)* | `packages/shared/ports/i-rate-limiter.ts`, `apps/api/src/adapters/rate-limit/kv-rate-limiter.ts`, `auth.router.ts`, tests | ✅ Done |
| 05 | [Admin lockout guards (last-admin + self-deactivation)](./05-admin-lockout-guards.task.md) | 🟡 Low *(S-05)* | `admin-users.router.ts`, tests | ✅ Done |
| 06 | [PBKDF2 iteration upgrade with transparent rehash on login](./06-pbkdf2-upgrade-on-login.task.md) | 🟡 Low *(S-06)* | `jwt-auth-adapter.ts`, `auth-service.ts`, `d1-user-repository.ts`, tests | ✅ Done |
| 07 | [Remove stray `console.log` + add `no-console` ESLint rule](./07-web-logging-hygiene.task.md) | 🟡 Low *(S-07)* | `auth-api.ts`, `apps/web/eslint.config.mjs` | ✅ Done |
| 08 | [Production seed guard + bootstrap-first-admin doc](./08-production-seed-guard.task.md) | 🟡 Low *(S-08)* | `apps/api/scripts/check-no-dev-seed.ts`, Makefile/CI, docs | ✅ Done |
| 09 | [Adversarial test suite for `JwtAuthAdapter`](./09-jwt-adapter-adversarial-tests.task.md) | ℹ️ Info *(S-10)* | `apps/api/test/adapters/auth/jwt-auth-adapter.spec.ts` | ✅ Done |

Dependency graph (strict prerequisites only):

```
01 ┐
02 ┤── independent, can start in parallel
03 ┤
04 ┤
05 ┤
06 ─ depends on 09 being green (safer to touch the adapter after it has a native suite)
07 ┘
08 ─ depends on 01 (the "known dev hash" becomes the guard's input)
09 ─ no deps
```

**Recommended execution order:** 09 → 01, 03, 07 in parallel → 02, 05, 06 → 04 → 08.

---

## 5. Definition of Done (story level)

- All 9 tasks in §4 are marked `✅ Done` in this file's table.
- All 15 acceptance criteria in §3 are checked.
- `make lint` and `make test` are green.
- An entry is appended to `docs/ReleaseNotes.md` under the **Milestone 2** section noting
  the hardening pass and the closed finding IDs.
- `docs/product/milestones/2/closeout-analysis.md §6` is annotated per-row with the PR or
  commit that closed the finding, so future audits can trace the history.
