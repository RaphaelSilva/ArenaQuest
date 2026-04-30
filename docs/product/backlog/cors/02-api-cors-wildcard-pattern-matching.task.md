# Task 02: Wildcard / Pattern Support in the CORS Origin Policy

## Metadata
- **Status:** Done
- **Complexity:** Medium
- **Area:** `apps/api`
- **Depends on:** Task 01 (`origin-policy.ts` and `buildOriginMatcher` exist)
- **Blocks:** Task 03 (environment rollout)

---

## Summary

After Task 01, `ALLOWED_ORIGINS` is still an exact-match list. That's painful in two real situations:

- **Cloudflare Pages preview deployments** — every PR gets a unique URL like `https://5f3a2b.arenaquest-web.pages.dev`. Maintaining an exact list is impossible.
- **Multi-tenant or multi-domain rollouts** — if we ever serve `https://app.arenaquest.com`, `https://admin.arenaquest.com`, `https://staff.arenaquest.com`, we want one entry, not three.

This task adds **adaptive matching** so a single `ALLOWED_ORIGINS` entry can be:

| Form | Example | Meaning |
|---|---|---|
| Exact origin | `https://app.arenaquest.com` | only that origin |
| Host wildcard | `https://*.pages.dev` | any subdomain of `pages.dev` over HTTPS, single label deep |
| Full wildcard | `*` | any origin (incompatible with `credentials: true` — see constraints) |

Order of precedence: exact > host-wildcard > full wildcard. The matcher should still return the **echoed origin string** (not the pattern) so browsers see a concrete `Access-Control-Allow-Origin` header.

---

## Technical Constraints

- **`*` with credentials is forbidden.** The browser rejects `Access-Control-Allow-Origin: *` when `Access-Control-Allow-Credentials: true`. Our CORS config has `credentials: true`, so when the operator configures `*`, the matcher must echo the **request's** `Origin` (not the literal `*`) — same trick `hono/cors` already does for function-shaped `origin`. Document this inline.
- **Wildcard scope is one label deep.** `https://*.pages.dev` matches `https://foo.pages.dev` but **not** `https://a.b.pages.dev`. This is intentional: deep wildcards are an injection footgun (e.g. `*.com` matches `evil.com`). If a future use case needs deeper matching, it should be a separate, explicit syntax.
- **Scheme is significant.** `https://*.pages.dev` does **not** match `http://foo.pages.dev`. Mixed-scheme entries are not supported in v1.
- **No regex injection.** Build the matcher by `URL`-parsing the pattern and comparing host parts; do **not** turn the pattern into a `RegExp` constructed from user-provided strings.
- **Validation up front.** Patterns are validated at app construction time, not on every request. Bad patterns throw `OriginPolicyError` with the offending entry quoted.
- **Performance.** A request runs the matcher synchronously inside the CORS middleware. Bucket origins by kind (exact `Set`, host-wildcard array, single `*` flag) so exact-match — the common case — is O(1).

---

## Scope

### Files to add / change

- **Update** `apps/api/src/core/cors/origin-policy.ts`
  - Extend `parseAllowedOrigins` to recognize the three forms above. Output a discriminated union:
    ```ts
    type OriginRule =
      | { kind: 'exact';    origin: string }
      | { kind: 'wildcard-host'; scheme: 'http' | 'https'; suffix: string } // suffix = ".pages.dev"
      | { kind: 'any' };
    ```
  - Reject ambiguous patterns: `*.pages.dev` (no scheme), `https://*` (host is just `*`), `https://*.*.com` (multiple wildcards), `https://foo.*.com` (wildcard not in leading label).
  - **Update** `buildOriginMatcher(rules)`:
    - Build a `Set<string>` of exact origins (lowercased).
    - Keep wildcard rules as a small array.
    - If any rule is `kind: 'any'`, set a flag.
    - Returned function: lowercase the request origin, check exact set first; if no hit, check each wildcard rule (parse the request origin once, compare scheme + host suffix); if still no hit and `any` flag is set, echo the request origin; otherwise return `null`.

- **Update** `apps/api/src/index.ts` / wherever `strictCors` is decided
  - When `*` is configured **and** `credentials: true` is in effect, log a single `console.warn` at boot explaining that the matcher will echo the request origin (because spec). This is a guardrail for future maintainers, not an error — the behavior is correct and intentional.

- **No router changes** beyond what Task 01 already produced. The matcher signature is identical.

### Out of scope
- Per-route CORS overrides.
- Setting different CORS policies per environment in `wrangler.jsonc` (Task 03).
- Pattern syntax beyond `*` and single-label `*.host`.

---

## Acceptance Criteria

- [x] `parseAllowedOrigins("https://*.pages.dev")` returns `[{ kind: 'wildcard-host', scheme: 'https', suffix: '.pages.dev' }]`.
- [x] `parseAllowedOrigins("*")` returns `[{ kind: 'any' }]`.
- [x] `parseAllowedOrigins("https://app.arenaquest.com, https://*.pages.dev, *")` returns rules of all three kinds in order.
- [x] `parseAllowedOrigins("*.pages.dev")` (no scheme) throws `OriginPolicyError`.
- [x] `parseAllowedOrigins("https://*")` throws `OriginPolicyError`.
- [x] `parseAllowedOrigins("https://*.*.com")` throws `OriginPolicyError`.
- [x] Matcher with `https://*.pages.dev` returns `'https://abc.pages.dev'` for that origin and `null` for `'https://abc.pages.dev.evil.com'`, `'https://a.b.pages.dev'`, `'http://abc.pages.dev'`.
- [x] Matcher with `*` returns the **request origin string** (echoed), not `'*'`.
- [x] Boot with `ALLOWED_ORIGINS="*"` emits exactly one `console.warn` mentioning credentials + echo behavior.
- [x] All Task 01 tests still pass unchanged.

---

## Test Plan

### Unit tests — extend `apps/api/test/core/cors/origin-policy.spec.ts`
1. **Wildcard parsing** — happy paths for each form.
2. **Wildcard rejection** — every invalid pattern listed in the constraints throws with the offending input in the message.
3. **Wildcard match** — `https://*.pages.dev` against:
   - `https://abc.pages.dev` → match (echoes origin).
   - `https://a.b.pages.dev` → null (deep subdomain).
   - `http://abc.pages.dev` → null (scheme mismatch).
   - `https://abc.pages.dev.evil.com` → null (suffix attack).
   - `https://pages.dev` → null (bare apex is not a subdomain).
4. **`*` match** — any origin (`https://anything.example`, `http://localhost:9999`) → echoes the request origin.
5. **Precedence** — config `["https://app.arenaquest.com", "https://*.arenaquest.com"]` against `https://app.arenaquest.com` returns `'https://app.arenaquest.com'` exactly once (regression safety; both rules would match).
6. **Performance sanity** — matcher with 1 exact and 1 wildcard rule, called 10k times, completes well under 50ms in the test runner (loose bound, just to catch accidental quadratic behavior).

### Integration tests — extend `apps/api/test/routes/cors.router.spec.ts`
1. **Pages preview** — `ALLOWED_ORIGINS="https://*.pages.dev"`; `OPTIONS /health` with `Origin: https://5f3a2b.arenaquest-web.pages.dev` echoes that exact origin in `Access-Control-Allow-Origin`.
2. **Suffix attack** — same config, `Origin: https://evil.pages.dev.attacker.com` does **not** receive the header.
3. **Wildcard `*` with credentials** — `ALLOWED_ORIGINS="*"`; request from `https://random.example` is echoed back as the ACAO value, and `Access-Control-Allow-Credentials: true` is still present.
4. **Mixed list** — `"https://app.arenaquest.com,https://*.pages.dev"` accepts both an exact and a preview origin, rejects an unrelated one.

### Manual verification
1. Set `ALLOWED_ORIGINS="https://*.pages.dev"` in `.dev.vars`, run `make dev-api`, curl with three different `Origin` headers and inspect the response.
2. Set `ALLOWED_ORIGINS="*"`, confirm the boot warning appears once and that requests are echoed (not literal `*`).

### Definition of Done
- [x] All unit + integration tests green (`make test-api`).
- [x] `OriginPolicyError` messages quote the bad input so an operator misreading wrangler.jsonc gets a clear hint.
- [x] No regex constructed from user-provided strings.
- [x] Public API of `origin-policy.ts` documented with JSDoc, including the `*` + credentials echo behavior.
