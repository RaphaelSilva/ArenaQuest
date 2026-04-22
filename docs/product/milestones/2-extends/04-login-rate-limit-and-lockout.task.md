# Task 04: `/auth/login` Rate Limiting & Lockout

## Metadata
- **Status:** Done — commit `64d7208`
- **Complexity:** Medium
- **Severity closed:** S-04 (Medium)
- **Story:** [`auth-hardening.story.md`](./auth-hardening.story.md)
- **Dependencies:** none (may run in parallel with 01/02/03)

---

## Summary

Introduce a pluggable rate-limiting port and a Cloudflare-KV-backed adapter. Apply it to
`POST /auth/login` so repeated failures from the same `(email, ip)` tuple are locked out
with `429 Too Many Requests` + `Retry-After`.

---

## Technical Constraints

- **Ports/Adapters:** new port `IRateLimiter` in `packages/shared/ports/`. Cloudflare
  specifics (`KVNamespace`) live only in the adapter under
  `apps/api/src/adapters/rate-limit/`.
- **Port shape:** must be simple enough to re-implement with Redis, DurableObject, or an
  in-memory `Map` (used in tests).
- **Cloud-Agnostic:** the router consumes the port; it never imports KV types.
- **Defaults:** `maxAttempts = 5`, `windowMs = 10 * 60_000`, `lockoutMs = 15 * 60_000`
  — injectable for tests.
- **Fail-open:** if the limiter throws, the request is NOT blocked (logged via
  `console.error`). Availability over security for a transient KV outage; revisit if we
  see abuse.

---

## Scope

### 1. Port — `packages/shared/ports/i-rate-limiter.ts`

```ts
export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  remaining: number;
}

export interface IRateLimiter {
  /** Register a failed attempt and return the resulting state. */
  hit(key: string): Promise<RateLimitResult>;
  /** Clear all failed attempts for this key (call on success). */
  reset(key: string): Promise<void>;
  /** Pure read — does not mutate counters. */
  peek(key: string): Promise<RateLimitResult>;
}
```

### 2. Adapter — `apps/api/src/adapters/rate-limit/kv-rate-limiter.ts`

Uses a `KVNamespace` binding (new binding: `RATE_LIMIT_KV` in `wrangler.jsonc`).
Key layout: `rl:login:<email-lower>:<ip>`. Value: `{ count, firstAttemptAt, lockedUntil }`
as JSON with a TTL equal to `lockoutMs`.

### 3. Wire into the auth router

Pre-handler on `POST /auth/login`:
1. `key = \`${email.toLowerCase()}:${ip}\``
2. `peek(key)` → if `!allowed`, return `429` with `Retry-After`.
3. Call the existing controller.
4. On `401` result: `await limiter.hit(key)`.
5. On `200` result: `await limiter.reset(key)`.

IP comes from `c.req.header('cf-connecting-ip')` with a fallback to `'unknown'` for dev.

### 4. Test adapter

`apps/api/test/adapters/rate-limit/in-memory-rate-limiter.ts` — a trivial `Map`-backed
implementation to use in router tests without KV.

### 5. Router test updates

`auth.router.spec.ts` covers:
- 5 failures → 6th call gets `429` with `Retry-After > 0`.
- Successful login resets the counter: after success, 5 more failures are still allowed
  before lockout.
- Different `(email, ip)` tuples are independent.

---

## Acceptance Criteria

- [x] `IRateLimiter` port exported from `@arenaquest/shared/ports`.
- [x] `KvRateLimiter` adapter implemented and compiles.
- [x] `wrangler.jsonc` declares `RATE_LIMIT_KV`.
- [x] `/auth/login` returns `429` with `Retry-After` header after 5 failures in 10 min.
- [x] Successful login within the window resets the counter.
- [x] Integration tests in `auth.router.spec.ts` cover lockout + reset.
- [x] If the limiter errors, a login still proceeds and an error is logged (fail-open).
- [x] `make lint` clean; all tests pass.

---

## Verification Plan

1. `pnpm --filter api test` — green.
2. `wrangler dev` + shell loop:

   ```bash
   for i in {1..6}; do
     curl -s -o /dev/null -w "%{http_code}\n" \
       -X POST http://localhost:8787/auth/login \
       -H 'Content-Type: application/json' \
       -d '{"email":"victim@x.com","password":"wrong"}'
   done
   ```

   Expected: five `401` then a `429`.
