# Task 06: PBKDF2 Iteration Upgrade with Transparent Rehash

## Metadata
- **Status:** Done — commit `feda632`
- **Complexity:** Low
- **Severity closed:** S-06 (Low)
- **Story:** [`auth-hardening.story.md`](./auth-hardening.story.md)
- **Dependencies:** Task 09 (adversarial JWT tests should land first to keep the adapter
  guarded before we touch its cost parameters).

---

## Summary

Raise the default PBKDF2 iteration count to **210 000** (OWASP 2023 SHA-256 baseline) for
*new* hashes, and transparently rehash a user's password on their next successful login
if their stored hash used a lower count. The existing
`pbkdf2:<iter>:<salt>:<hash>` format already encodes the count per row, so old rows keep
working forever while the fleet gradually migrates.

---

## Technical Constraints

- **Format stability:** no change to the stored-hash format.
- **Opportunistic upgrade only:** never rehash on failed login; never rehash during a
  non-login flow (refresh, logout).
- **New repository method:** `IUserRepository.updatePasswordHash(id: string, hash: string): Promise<void>` —
  isolates this one-field update from the more general `update`.
- **Adapter introspection:** `JwtAuthAdapter` exposes a read-only getter
  `readonly iterations: number` so callers can compare without parsing the hash string.
- **Adapter helper:** expose a pure helper
  `readIterationsFromHash(hash: string): number | null` to keep the service free of
  format knowledge.

---

## Scope

### 1. Adapter changes

```ts
export class JwtAuthAdapter implements IAuthAdapter {
  // ...
  get currentPbkdf2Iterations(): number { return this.iterations; }

  static readIterationsFromHash(storedHash: string): number | null {
    const parts = storedHash.split(':');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return null;
    const n = parseInt(parts[1], 10);
    return Number.isFinite(n) ? n : null;
  }
}
```

Default iterations constant flips to `210_000`.

### 2. Repository

Add `updatePasswordHash(id, hash)` to `IUserRepository` and implement in
`D1UserRepository`:

```sql
UPDATE users SET password_hash = ? WHERE id = ?
```

### 3. Service change

Inside `AuthService.login`, after a successful verify:

```ts
const current = this.auth.currentPbkdf2Iterations;
const stored  = JwtAuthAdapter.readIterationsFromHash(record.passwordHash);
if (stored !== null && stored < current) {
  const newHash = await this.auth.hashPassword(password);
  await this.users.updatePasswordHash(record.id, newHash).catch(() => { /* log */ });
}
```

> The `.catch` swallows rehash failures so a DB blip does not break the login. Log via
> `console.warn`.

> Alternative: inject an `IPasswordUpgrader` port to keep the service free of adapter
> references. OK to skip for this task — `JwtAuthAdapter.readIterationsFromHash` is a
> pure static helper and the coupling is trivial. Revisit if we ever add a second hash
> algorithm.

### 4. Tests

Unit tests in `auth-service.spec.ts`:
- Login with a hash at 100 000 iterations triggers a rehash to the new count.
- Login with a hash at 210 000 iterations does NOT rehash.
- Failed login never rehashes.
- Rehash failure does not break the login result.

---

## Acceptance Criteria

- [x] `JwtAuthAdapter` default iterations = 210 000.
- [x] `readIterationsFromHash` static helper exists and is covered.
- [x] `IUserRepository.updatePasswordHash` implemented in D1 and tested.
- [x] Successful login upgrades stale hashes; failed login does not.
- [x] Rehash failure is swallowed with a `console.warn`; login still succeeds.
- [x] Existing dev seed users still log in (old 100 000-iteration hashes).
- [x] `make lint` clean; all tests pass.

---

## Verification Plan

1. `pnpm --filter api test` — green.
2. Manual: apply the dev seed (100 000 iterations), log in as `admin@arenaquest.com`,
   then inspect `SELECT password_hash FROM users WHERE email = ...` — the iteration
   count in the hash string is now `210000`.
