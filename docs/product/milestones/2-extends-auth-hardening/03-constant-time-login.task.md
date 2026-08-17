# Task 03: Constant-Time Login (Close User-Enumeration Timing Leak)

## Metadata
- **Status:** Done — commit `fe3cf09`
- **Complexity:** Low
- **Severity closed:** S-03 (Medium)
- **Story:** [`auth-hardening.story.md`](./auth-hardening.story.md)
- **Dependencies:** none

---

## Summary

`AuthService.login()` currently short-circuits when `findByEmail` returns `null`, so a
missing email answers in a handful of milliseconds while a wrong password takes ~100 k
PBKDF2 iterations (~30–80 ms on Workers). Run a dummy verify on the missing-email branch
so both paths consume equivalent CPU.

---

## Technical Constraints

- **No new dependency.** Use the existing `IAuthAdapter.verifyPassword`.
- **Dummy hash is a compile-time constant** — generated once via `scripts/gen-hash.ts`
  against a throwaway password and frozen in a `const` inside the service.
- **Error code remains `INVALID_CREDENTIALS`** regardless of branch; no information leak
  via response shape.

---

## Scope

### 1. Frozen dummy hash

Add at the top of `auth-service.ts`:

```ts
// A pre-computed pbkdf2 hash of the string "arenaquest-dummy-password".
// Purpose: keep login timing constant when the email does not exist.
// Regenerate with `pnpm --filter api run gen-hash` if iteration target changes.
const DUMMY_PASSWORD_HASH =
  'pbkdf2:210000:<salt-hex>:<derived-hex>';
```

### 2. Rewrite the failing branches

```ts
async login(email: string, password: string): Promise<LoginResult> {
  const record = await this.users.findByEmail(email);

  // Run the verify regardless, so both paths pay the same CPU.
  const hash = record ? record.passwordHash : DUMMY_PASSWORD_HASH;
  const valid = await this.auth.verifyPassword(password, hash);

  if (!record || !valid) {
    throw new AuthError('INVALID_CREDENTIALS', 'Invalid credentials');
  }
  if (record.status !== Entities.Config.UserStatus.ACTIVE) {
    throw new AuthError('ACCOUNT_INACTIVE', 'Account is not active');
  }

  const { passwordHash: _, ...user } = record;
  return this.issueTokens(user);
}
```

### 3. Test the timing invariant

In `auth-service.spec.ts`, add a timing assertion that averages N=5 calls for each
branch and asserts `abs(missing - wrongPassword) / wrongPassword < 0.2`.

---

## Acceptance Criteria

- [ ] `login("unknown@x", "y")` and `login("valid@x", "wrong")` both throw
      `AuthError(INVALID_CREDENTIALS)`.
- [ ] Dummy hash constant is clearly labelled and documented.
- [ ] Timing test: average runtime of both failure branches is within ±20 %.
- [ ] `ACCOUNT_INACTIVE` is still reported when credentials are correct but status is
      not `active`.
- [ ] All existing service tests pass unchanged.
- [ ] `make lint` clean.

---

## Verification Plan

1. `pnpm --filter api test` — green.
2. Inspect the Vitest output — the new timing test reports the measured delta.
