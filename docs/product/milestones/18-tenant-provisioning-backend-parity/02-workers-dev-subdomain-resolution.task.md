# Task 02 — Backend: workers.dev subdomain resolution and the `<acct>` placeholder (Phase 1)

**Status:** ✅ Done
**Milestone:** [18 — Tenant provisioning: Cloudflare resource bring-up with backend parity](./milestone.md)
**RFC:** [RFC 0012](../../RFCs/0012-tenant-provisioning-backend-parity.md)
**Team:** Backend API
**Depends On:** —

## Summary

Resolve the Cloudflare account's workers.dev subdomain during provisioning and
substitute it into a placeholder `apiHost`, so staging hosts stop being the literal
string `api-<label>-staging.<acct>.workers.dev`.

This matters beyond cosmetics: `apiHost` is the anchor `deriveExpected` uses for
`GOOGLE_REDIRECT_URI` and `NEXT_PUBLIC_API_URL`, so the placeholder was being baked
into deployed Workers (`apps/api/wrangler.jsonc:110,194`) as an unusable redirect URI.

## Scope

- `scripts/label.mjs` — new pure `workersDevHost(worker, subdomain)`.
- `scripts/cloudflare/provision-label.mjs` — `resolveWorkersSubdomain()`, `resolveApiHost()`, the `subdomain` plan step, and an `apiHost` key on `updateProfileResourceIds`.

## Design notes

There is **no `wrangler subdomain` command**, so the value comes from the Cloudflare
REST API: `GET /accounts/<id>/workers/subdomain`. That needs a bearer token, and an
OAuth `wrangler login` session exposes none — so `cfApi()` returns `null` without
`CF_API_TOKEN` and the step degrades to a printed follow-up rather than failing.

`apiHost` is a *scalar* on the environment object, not nested like `d1.id`, so
`updateProfileResourceIds` gained an `objectName === null` branch that regexes the env
body directly instead of first locating a child object. The write is guarded by
`isPlaceholder` so an operator-chosen host (`api.budo.app`) is never clobbered.

Changing `apiHost` invalidates any previously registered Google redirect URI, which
fails *silently* at login. Every mutation path prints a loud re-register warning.

## Acceptance Criteria

- [x] `workersDevHost('api-budo-staging','raphael-1d2')` → `api-budo-staging.raphael-1d2.workers.dev`.
- [x] `updateProfileResourceIds(text,'staging',{apiHost})` rewrites staging only; production's host and the leading JSONC comment survive.
- [x] Without a token, the step warns and leaves the placeholder rather than failing the run.
- [x] A non-placeholder `apiHost` is never overwritten.
- [x] The resolution path prints the Google redirect re-registration warning.

## Verification

```bash
make test-scripts
node scripts/cloudflare/provision-label.mjs budo --dry-run | grep -A1 "workers.dev subdomain"
```
