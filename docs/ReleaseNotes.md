# Release Notes

## Unreleased

---

## Milestone 2 — Auth Hardening (Security Epic S-01 → S-10)

> All findings from the Milestone 2 close-out security audit are now closed.
> See [`docs/product/milestones/2-extends/auth-hardening.story.md`](product/milestones/2-extends/auth-hardening.story.md) for the full story.

### Security fixes

- **S-01 (High) — Refresh tokens hashed at rest** *(commit `8dde48b`)*  
  Refresh tokens are now persisted as a SHA-256 digest (hex). A table-truncating migration
  (`0004_hash_refresh_tokens.sql`) is required on deploy — all active sessions will be forced
  to re-authenticate once after the migration runs.

- **S-02 (Medium) — Session revocation on admin mutations** *(commit `5697266`)*  
  `PATCH /admin/users/:id` and `DELETE /admin/users/:id` now call `deleteAllForUser` whenever
  a user is deactivated or their roles change. Deactivated accounts can no longer use stale
  refresh tokens. Admin mutations emit an audit log line `{event, userId, actor, at}` at
  `console.info`.

- **S-03 (Medium) — Constant-time login** *(commit `fe3cf09`)*  
  `POST /auth/login` now runs a full PBKDF2 verification against a pre-computed dummy hash
  when the requested email does not exist in the database. Login response time no longer
  reveals whether an email is registered.

- **S-04 (Medium) — Login rate limiting & lockout** *(commit `64d7208`)*  
  Failed attempts are counted per `(email, ip)` tuple via a new `IRateLimiter` port backed
  by Cloudflare KV. After 5 failures in 10 minutes the tuple is locked for 15 minutes and
  the endpoint returns `429 Too Many Requests` with a `Retry-After` header. Successful login
  clears the counter. The limiter fails open on KV errors.  
  **Operator action required:** provision a `RATE_LIMIT_KV` KV namespace with
  `wrangler kv:namespace create RATE_LIMIT_KV` and update the placeholder `id` in
  `wrangler.jsonc` before deploying.

- **S-05 (Low) — Admin lockout prevention** *(commit `9ba9c44`)*  
  `PATCH` and `DELETE /admin/users/:id` now reject changes that would leave zero active
  admins (`409 WOULD_LOCK_OUT_ADMINS`) or that target the acting admin's own account
  (`409 SELF_LOCKOUT`).

- **S-06 (Low) — PBKDF2 iteration upgrade** *(commit `feda632`)*  
  Default iteration count raised from 100 000 to 210 000 (OWASP 2023 recommendation).
  Existing hashes are transparently rehashed to 210 000 iterations on the user's next
  successful login — no forced password-reset required.

- **S-07 (Low) — Web logging hygiene** *(commit `1acf836`)*  
  Removed `console.log('API_URL', …)` from `apps/web/src/lib/auth-api.ts`. Added an
  ESLint `no-console` rule (warn level, `console.warn`/`console.error` allowed) to
  `apps/web` to prevent regressions.

- **S-08 (Low) — Production seed guard** *(commit `012d7b7`)*  
  Dev seed SQL moved to `apps/api/scripts/dev/`. A new pre-deploy script
  (`scripts/check-no-dev-seed.ts`) fails loudly if the known dev password hash is
  present in the target D1. `make deploy-api` and `make deploy-api-staging` run it
  automatically as a prerequisite. See
  [`docs/product/api/bootstrap-first-admin.md`](api/bootstrap-first-admin.md) for the
  operator procedure to create the first production admin account.

- **S-09 (Info) — Accepted as designed.**  
  Edge middleware checks cookie presence only; the API rejects invalid tokens on every
  authenticated request. No code change.

- **S-10 (Info) — JWT adversarial test suite** *(commit `feda632`)*  
  `apps/api/test/adapters/auth/jwt-auth-adapter.spec.ts` added with 32 tests covering
  malformed headers, wrong algorithms (`alg:none`, RS256), wrong segment counts, signature
  tampering, expired tokens, and claim-shape mutations.
