# Task 09: Adversarial Test Suite for `JwtAuthAdapter`

## Metadata
- **Status:** Done — commit `feda632`
- **Complexity:** Low
- **Severity closed:** S-10 (Info) + coverage gap
- **Story:** [`auth-hardening.story.md`](./auth-hardening.story.md)
- **Dependencies:** none. Recommended to land **first** among the hardening tasks — every
  subsequent change to the adapter lands on top of a protective net.

---

## Summary

Create a focused unit test file for `JwtAuthAdapter` that enumerates malformed tokens,
wrong algorithms, tampered signatures, and malformed password-hash inputs. Today the
adapter is only exercised through service / route tests, which means many edge cases
are implicit.

---

## Technical Constraints

- **Pure unit test:** no Workers pool needed — the adapter has no binding dependencies
  beyond Web Crypto (available in Vitest's Node 18+ runtime). A plain Vitest environment
  is fine, keeping the suite fast.
- **No randomness leakage:** each token is constructed deterministically from a known
  secret so failures are reproducible.
- **Boundary cases only:** happy-path tokens are already covered by the service/router
  suites; this file focuses on adversarial inputs.

---

## Scope

### File — `apps/api/test/adapters/auth/jwt-auth-adapter.spec.ts`

Suites:

1. **`verifyAccessToken` — malformed input**
   - Empty string → `null`.
   - One, two, and four dot-separated segments → `null`.
   - Non-base64url payload segment → `null`.
   - Payload JSON that is not an object (`"hello"`, `[]`) → `null`.

2. **`verifyAccessToken` — wrong algorithm / header**
   - Header with `alg: 'none'` and empty signature → `null`.
   - Header with `alg: 'RS256'` → `null`.
   - Header with `typ: 'JWS'` → `null`.
   - Header missing `alg` → `null`.

3. **`verifyAccessToken` — signature tampering**
   - Valid token with the last byte of the signature flipped → `null`.
   - Valid token signed with a different secret → `null`.

4. **`verifyAccessToken` — claim shape**
   - `sub` not a string → `null`.
   - `roles` not an array → `null`.
   - Missing `iat` or `exp` → `null`.
   - `exp` one second in the past → `null`.

5. **`verifyPassword` — malformed stored hash**
   - Prefix other than `pbkdf2:` → `false`.
   - Three colon-separated parts instead of four → `false`.
   - Non-numeric iterations → `false`.
   - Salt with wrong length → `false`.
   - Non-hex characters in hash → `false`.
   - Correct format but wrong derived bytes → `false`.

6. **`generateRefreshToken`**
   - Returns a 64-char lowercase hex string.
   - Two consecutive calls return distinct values.

7. **`hashPassword`**
   - Returns `pbkdf2:<n>:<32-hex>:<64-hex>` with `<n>` equal to the configured iteration
     count.
   - Hashing the same plaintext twice yields different hashes (salt is random).

### Config — use short PBKDF2 iterations in this test

Instantiate with `pbkdf2Iterations: 1_000` so the password-focused tests run in
milliseconds. Production defaults are covered elsewhere.

---

## Acceptance Criteria

- [ ] `apps/api/test/adapters/auth/jwt-auth-adapter.spec.ts` exists and runs under
      `pnpm --filter api test`.
- [ ] Every suite listed in §Scope has at least one passing test.
- [ ] Test suite runs in under 1 second.
- [ ] No flaky tests on three consecutive runs (`for i in 1 2 3; do pnpm --filter api test …; done`).
- [ ] Coverage on `jwt-auth-adapter.ts` reaches ≥ 90 % (line).
- [ ] `make lint` clean; all tests pass.

---

## Verification Plan

1. `pnpm --filter api test test/adapters/auth/jwt-auth-adapter.spec.ts` — green.
2. `pnpm --filter api test -- --coverage` (if enabled) — inspect coverage for the file.
3. Mutate a byte inside `jwt-auth-adapter.ts` (e.g. flip a `!==` to `==`) and confirm at
   least one test fails. Revert.
