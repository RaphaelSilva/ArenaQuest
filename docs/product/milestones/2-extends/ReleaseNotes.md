# Release Notes — Milestone 2 Extension: Auth Hardening

**Release date:** 2026-04-23
**Scope:** Closes the Security Audit Findings (S-01 → S-10) raised in
[`../2/closeout-analysis.md §6`](../2/closeout-analysis.md#6-security-audit-findings).
**Status:** ✅ All acceptance criteria met — cleared to begin Milestone 3.

---

## 1. Executive Summary

Milestone 2's functional contract was already met at the start of this extension. This
hardening pass closes every open security finding from that close-out in a single
bounded epic, so no security debt carries into Milestone 3's content work.

- **9 tasks delivered**, spanning High / Medium / Low severity findings.
- **15 acceptance criteria** met (see [`auth-hardening.story.md §3`](./auth-hardening.story.md#3-acceptance-criteria)).
- **1 finding accepted as designed** (S-09, edge middleware cookie presence check) —
  documented, no task created.
- **Out of scope (deferred to M3):** first-login password rotation journey.

---

## 2. Findings Closed

| ID | Severity | Area | Closed by Task | Commit |
|----|:--------:|------|----------------|--------|
| S-01 | 🔴 High | Refresh tokens stored in plain text | [01](./01-hash-refresh-tokens-at-rest.task.md) | `8dde48b` |
| S-02 | 🟠 Medium | Sessions survive deactivation / role change | [02](./02-revoke-sessions-on-admin-mutation.task.md) | `5697266` |
| S-03 | 🟠 Medium | Timing leak on user enumeration via login | [03](./03-constant-time-login.task.md) | `fe3cf09` |
| S-04 | 🟠 Medium | No brute-force protection on `/auth/login` | [04](./04-login-rate-limit-and-lockout.task.md) | `64d7208` |
| S-05 | 🟡 Low | Admin backoffice could be locked out | [05](./05-admin-lockout-guards.task.md) | — |
| S-06 | 🟡 Low | PBKDF2 iteration count not forward-compatible | [06](./06-pbkdf2-upgrade-on-login.task.md) | `feda632` |
| S-07 | 🟡 Low | Stray `console.log` of API URL in web client | [07](./07-web-logging-hygiene.task.md) | `1acf836` |
| S-08 | 🟡 Low | Dev seed hash could reach production | [08](./08-production-seed-guard.task.md) | `012d7b7` |
| S-09 | ℹ️ Info | Edge middleware only checks cookie presence | — | Accepted as designed |
| S-10 | ℹ️ Info | `JwtAuthAdapter` lacked adversarial coverage | [09](./09-jwt-adapter-adversarial-tests.task.md) | `feda632` |

---

## 3. What Changed

### 3.1 Session security
- **Refresh tokens at rest** are now SHA-256 hashed. A database dump no longer yields
  usable session cookies. Migration `0004_hash_refresh_tokens.sql` truncates the existing
  `refresh_tokens` table, forcing a one-time global re-login on deploy.
- **Session revocation on admin mutation:** deactivating a user, soft-deleting, or
  changing their roles now calls `tokens.deleteAllForUser(id)` and emits a structured
  audit line `{ event, userId, actor, at }` via `console.info`.

### 3.2 Login hardening
- **Constant-time login:** `AuthService.login` runs PBKDF2 verification against a
  pre-computed dummy hash when the email is missing, so missing-email and wrong-password
  branches consume equivalent CPU (timing asserted within ±20 %).
- **Rate limiting + lockout:** new `IRateLimiter` port (in `packages/shared/ports/`) with
  a Cloudflare-KV adapter (`RATE_LIMIT_KV` binding). After **5 failures in 10 min** for
  a `(email, ip)` tuple, `/auth/login` responds `429 Too Many Requests` with
  `Retry-After` for **15 min**. Successful login resets the counter. Fail-open on KV
  outage.
- **PBKDF2 forward-compatibility:** default iteration count raised to **210 000** for
  new hashes (kept at 100 000 on Workers only because of platform CPU limits — see
  CLAUDE.md note). Existing hashes are **transparently rehashed on next successful
  login** via a new `IUserRepository.updatePasswordHash` method. Failed logins never
  rehash.

### 3.3 Admin safety
- **Last-admin guard:** `PATCH` / `DELETE /admin/users/:id` rejects any mutation that
  would leave zero active admins with `409 WOULD_LOCK_OUT_ADMINS`.
- **Self-lockout guard:** actor cannot deactivate themselves or strip their own `admin`
  role (`409 SELF_LOCKOUT`).
- Enforced via new `IUserRepository.countActiveAdmins()` server-side.

### 3.4 Deploy-time hygiene
- **Production seed guard:** pre-deploy script `check-no-dev-seed.ts` inspects the
  target D1 and aborts the deploy if any user row matches the known dev password hash.
  Wired into `make deploy-api` and `make deploy-api-staging`.
- **Dev seed relocated** to `apps/api/scripts/dev/0004_seed_dev_users.sql` to make its
  scope unambiguous.
- **First-admin bootstrap procedure** documented in
  `docs/product/api/bootstrap-first-admin.md` (≤ 5-minute operator walk-through using
  `gen-hash.ts --password <...>` + `wrangler d1 execute --remote`).

### 3.5 Observability & tests
- **Web logging hygiene:** removed stray `console.log('API_URL', …)` from
  `apps/web/src/lib/auth-api.ts`. Added `no-console` ESLint rule (warn level,
  `warn`/`error` allowed) scoped to `apps/web/src/**`.
- **Adversarial JWT tests:** new `apps/api/test/adapters/auth/jwt-auth-adapter.spec.ts`
  covers `alg: none`, wrong algorithms, malformed headers, signature tampering, claim
  shape mutations, expired tokens, and malformed password-hash inputs. Coverage on
  `jwt-auth-adapter.ts` ≥ 90 % line.

---

## 4. Breaking Changes & Migration Notes

| Change | Impact | Action required |
|--------|--------|-----------------|
| Migration `0004_hash_refresh_tokens.sql` truncates `refresh_tokens` | All users are logged out once on deploy | None — users re-authenticate on next request |
| New KV binding `RATE_LIMIT_KV` | Required for `/auth/login` rate limiting | Ensure the KV namespace is provisioned in `wrangler.jsonc` for every env |
| `buildAdminUsersRouter` signature now takes `tokens: IRefreshTokenRepository` | Internal wiring only | Updated in `routes/index.ts`; no external consumer |
| `IUserRepository` gained `countActiveAdmins()` and `updatePasswordHash()` | Any custom adapter must implement both | D1 adapter updated; in-memory test adapters already updated |
| Dev seed path moved to `apps/api/scripts/dev/` | Local bootstrap scripts | README / Make targets updated; re-clone if stale |
| PBKDF2 default iterations raised to 210 000 | New hashes only | Existing users auto-upgrade on next login; no manual rehash needed |

---

## 5. Verification

- ✅ `make lint` — clean across the monorepo.
- ✅ `make test` — all suites green, including new adversarial JWT suite and rate-limit
  router tests.
- ✅ Manual verification of timing assertion, KV-backed lockout, and admin-guard error
  codes per each task's Verification Plan.

---

## 6. Milestone 3 Readiness

- All story-level DoD items complete except two residual docs follow-ups
  (non-blocking, tracked below).
- Milestone 3 (`../3/milestone.md` + tasks 01–11) has **no dependency on any
  unresolved hardening item** — content data layer, R2 storage adapter, admin CRUD,
  markdown sanitization, frontend, and Playwright E2E scaffold can all begin.
- Recommendation: **proceed to Milestone 3.**

### Residual follow-ups (non-blocking)

- [ ] Append a one-line entry to top-level `docs/ReleaseNotes.md` under the
      **Milestone 2** section referencing this hardening pass.
- [ ] Annotate `docs/product/milestones/2/closeout-analysis.md §6` per row with the
      closing commit (see table in §2 above) so future audits can trace history.

---

## 7. Accepted Risks (documented, not fixed)

- **S-09 — Edge middleware checks cookie presence only.** Full JWT verification at the
  edge would double the crypto cost for every request. Cookie presence is a coarse
  gate; authoritative verification happens at the API. Revisit if abuse patterns shift.
