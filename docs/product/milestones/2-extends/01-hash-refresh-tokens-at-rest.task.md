# Task 01: Hash Refresh Tokens at Rest

## Metadata
- **Status:** Done — commit `8dde48b`
- **Complexity:** Medium
- **Severity closed:** S-01 (High)
- **Story:** [`auth-hardening.story.md`](./auth-hardening.story.md)
- **Dependencies:** none

---

## Summary

Persist refresh tokens as a **SHA-256 digest** so a dump of the `refresh_tokens` table
cannot be replayed as a valid session cookie. The plain token value stays in the
`HttpOnly` cookie only; the adapter hashes on write and on lookup.

---

## Technical Constraints

- **Ports/Adapters:** the `IRefreshTokenRepository` signature does **not** change. The
  hashing is an internal detail of `D1RefreshTokenRepository`.
- **Cloud-Agnostic:** hashing uses Web Crypto (`crypto.subtle.digest('SHA-256', ...)`),
  already available on Workers and any modern runtime.
- **Reversibility:** there is no migration path from plain to hashed for existing rows
  (cannot derive hash from data we no longer have). The migration TRUNCATES
  `refresh_tokens`, documented as a forced global re-login.
- **Format:** store 64-char lowercase hex (matches the token format) in the existing
  `token` PK column — no schema change.

---

## Scope

### 1. Hashing helper — `apps/api/src/adapters/db/hash.ts`

```ts
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```

### 2. Update `D1RefreshTokenRepository`

- `save`: hash `token` before INSERT.
- `findByToken`: hash the incoming token, then query.
- `delete`: hash before DELETE.
- `deleteAllForUser`: unchanged.

### 3. Migration — `apps/api/migrations/0004_hash_refresh_tokens.sql`

```sql
-- Forces all users to log in again. Intentional: we cannot derive the SHA-256
-- of a token we never stored in plain form anywhere else.
DELETE FROM refresh_tokens;
```

### 4. Operational note

Add a one-liner to `docs/ReleaseNotes.md` under Milestone 2 "Security Notes" documenting
the forced re-login on deploy.

---

## Acceptance Criteria

- [ ] `D1RefreshTokenRepository.save` writes a 64-char hex hash (not the raw token).
- [ ] `D1RefreshTokenRepository.findByToken` finds a row when given the plain token back.
- [ ] Round-trip integration test against real D1: save → findByToken → delete.
- [ ] A test copies a raw token value into `refresh_tokens.token` directly, then calls
      `findByToken` with the same raw value → returns `null` (confirms hashing is in
      effect).
- [ ] Migration `0004_hash_refresh_tokens.sql` exists and is idempotent.
- [ ] All existing tests stay green.
- [ ] `make lint` is clean.

---

## Verification Plan

1. `pnpm --filter api test` — green.
2. `wrangler d1 execute arenaquest-db --local --file ./migrations/0004_hash_refresh_tokens.sql`
   — runs without error; re-running is a no-op.
3. Manual: log in, inspect `refresh_tokens.token` via
   `wrangler d1 execute ... --command "SELECT token FROM refresh_tokens"` — value is a
   hex string different from the cookie value the browser holds.
