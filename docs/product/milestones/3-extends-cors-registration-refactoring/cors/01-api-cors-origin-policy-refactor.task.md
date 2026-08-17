# Task 01: Extract CORS Setup into a Config-Driven Origin Policy

## Metadata
- **Status:** Done
- **Complexity:** Small
- **Area:** `apps/api`
- **Depends on:** existing `apps/api/src/routes/index.ts`, `ALLOWED_ORIGINS` env var
- **Blocks:** Task 02 (wildcard patterns), Task 03 (environment rollout)

---

## Summary

CORS is currently configured inline in `AppRouter.register` with a one-liner:

```ts
origin: allowedOrigins?.split(',') ?? 'http://localhost:3000',
```

This works for an exact comma-separated list, but it has three problems we need to solve before we can support `*` and wildcard hosts:

1. The parsing/normalization logic is glued to the router. There is no place to add validation, trimming, or pattern matching without making the router messy.
2. There is a stray `console.log(\`allowedOrigins: ${allowedOrigins}\`)` at `routes/index.ts:51` that leaks env config into production logs.
3. The fallback `'http://localhost:3000'` silently kicks in if `ALLOWED_ORIGINS` is missing — that's fine for dev but dangerous in prod, where a missing var should fail loudly.

This task is a **pure refactor**: same observable behavior, but the CORS setup moves into a small, testable origin-policy module that Task 02 can extend with wildcard matching.

---

## Technical Constraints

- **No behavior change for existing envs.** `ALLOWED_ORIGINS="https://arenaquest-web.pages.dev"` and `ALLOWED_ORIGINS="https://arenaquest-web-staging.pages.dev,http://localhost:3000"` must produce identical CORS responses before and after this task.
- **No new runtime deps.** Use `hono/cors` as today; only the `origin` argument shape changes.
- **Cloud-agnostic core.** The policy module lives in `apps/api/src/core/cors/` and has zero `hono` imports. The router thinly adapts it to `hono/cors`.
- **Strict mode in production.** When the parsed origin list is empty (`undefined`, empty string, or only whitespace/commas), throw at app construction time in production. In dev/test fall back to `http://localhost:3000` and emit a single warning via `console.warn` (not `console.log`) so it's visible but doesn't pollute structured logs.
- **Drop the stray `console.log`.** Replace it with structured info (env name + count of allowed origins, never the full list) or remove it entirely — we should not be printing the raw config on every cold start.

---

## Scope

### Files to add / change

- **New** `apps/api/src/core/cors/origin-policy.ts`
  - Exports `parseAllowedOrigins(raw: string | undefined, opts: { strict: boolean }): string[]` — splits on comma, trims, filters empties, lowercases scheme+host, validates each entry parses as a URL (`new URL(o)`), throws `OriginPolicyError` on invalid entries when `strict: true`.
  - Exports `buildOriginMatcher(origins: string[]): (origin: string) => string | null` — returns a function compatible with `hono/cors`'s `origin` option (`(origin) => string | null | undefined`). For now this is just a `Set` lookup; Task 02 swaps in pattern matching behind the same signature.
  - Exports `OriginPolicyError extends Error` for misconfiguration.

- **Update** `apps/api/src/routes/index.ts`
  - Replace the inline `origin: allowedOrigins?.split(',') ?? 'http://localhost:3000'` with `origin: buildOriginMatcher(parseAllowedOrigins(allowedOrigins, { strict: ... }))`.
  - Decide `strict` from a new `deps.environment: 'production' | 'staging' | 'development' | 'test'` field, OR from a simple `deps.strictCors: boolean`. Pick whichever fits the existing dep-injection style — do not introduce a global env detector.
  - Remove `console.log(\`allowedOrigins: ${allowedOrigins}\`)`.

- **Update** `apps/api/src/index.ts`
  - Pass `strictCors: true` for the deployed Worker. For local dev (`make dev-api`), pass `false` so a missing `ALLOWED_ORIGINS` doesn't crash the boot.
  - The simplest signal: `strictCors: env.ALLOWED_ORIGINS !== undefined && env.ALLOWED_ORIGINS.trim() !== ''` — i.e. "if you configured it, we'll enforce it strictly; if you didn't, you're in dev". Document this choice inline.

### Out of scope (handled by later tasks)
- Wildcard / glob origin matching (Task 02).
- Updating `wrangler.jsonc` env vars to use a new format (Task 03).
- Per-route CORS overrides.

---

## Acceptance Criteria

- [x] `parseAllowedOrigins("https://a.com, https://b.com ,", { strict: true })` returns `['https://a.com', 'https://b.com']` (trimmed, empties dropped).
- [x] `parseAllowedOrigins("not a url", { strict: true })` throws `OriginPolicyError`.
- [x] `parseAllowedOrigins(undefined, { strict: true })` throws `OriginPolicyError`.
- [x] `parseAllowedOrigins(undefined, { strict: false })` returns `['http://localhost:3000']` and emits one `console.warn`.
- [x] `buildOriginMatcher(['https://a.com'])` returns a function that yields `'https://a.com'` for that origin and `null` for `'https://evil.com'`.
- [x] `routes/index.ts` no longer contains `.split(',')` or `console.log` for origins; the CORS middleware uses the matcher.
- [x] Existing integration tests that exercise `Origin: https://arenaquest-web.pages.dev` against the production-style env still pass with the same `Access-Control-Allow-Origin` header.

---

## Test Plan

### Unit tests — `apps/api/test/core/cors/origin-policy.spec.ts`
1. **Parsing** — comma-separated list with whitespace, trailing commas, empty entries → cleaned array.
2. **Validation** — non-URL entry → throws `OriginPolicyError` in strict, warns in non-strict.
3. **Empty input strict** — `undefined`, `""`, `"  ,  "` → throws.
4. **Empty input non-strict** — same inputs → returns `['http://localhost:3000']` and `console.warn` was called exactly once (spy).
5. **Matcher exact match** — every configured origin returns itself; any other origin returns `null`.
6. **Matcher case** — `https://A.com` configured matches a request `Origin: https://a.com` (host normalized).

### Integration tests — `apps/api/test/routes/cors.router.spec.ts` (new, or extend existing)
1. **Allowed origin** — `OPTIONS /health` with `Origin: https://arenaquest-web.pages.dev` returns `Access-Control-Allow-Origin: https://arenaquest-web.pages.dev` and `Access-Control-Allow-Credentials: true`.
2. **Disallowed origin** — same request with `Origin: https://evil.com` does **not** echo the origin header.
3. **No `console.log` regression** — spy on `console.log` during app construction; assert it was not called with the raw `ALLOWED_ORIGINS` value.

### Manual verification
1. `make dev-api` with `ALLOWED_ORIGINS` unset → boots, prints exactly one `console.warn`, accepts `http://localhost:3000`.
2. `make dev-api` with `ALLOWED_ORIGINS="garbage"` → boot fails with `OriginPolicyError` (because we set `strictCors: true` once the var is present).
3. Diff `Access-Control-Allow-Origin` headers against `main` for the staging origin list — must match exactly.

### Definition of Done
- [x] All unit + integration tests green (`make test-api`).
- [x] No `hono` imports in `apps/api/src/core/cors/`.
- [x] `console.log` for origins removed from `routes/index.ts`.
- [x] No new dependencies in `apps/api/package.json`.
