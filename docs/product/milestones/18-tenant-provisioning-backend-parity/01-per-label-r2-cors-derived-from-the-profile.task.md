# Task 01 — Backend: Per-label R2 CORS derived from the profile (Phase 1)

**Status:** ✅ Done
**Milestone:** [18 — Tenant provisioning: Cloudflare resource bring-up with backend parity](./milestone.md)
**RFC:** [RFC 0012](../../RFCs/0012-tenant-provisioning-backend-parity.md)
**Team:** Backend API
**Depends On:** —

## Summary

Replace the single committed `apps/api/cors.json` with a per-label derivation, and
apply it during provisioning. The committed file carried arenaquest *staging*
origins while `make r2-cors-*` parametrised only the bucket name via
`DEPLOY_LABEL`, so running the target for any other tenant wrote arenaquest's
origins onto that tenant's bucket.

## Scope

- `scripts/label.mjs` — new pure `deriveCorsRules(profile, env)` and `renderCorsFile(rules)`.
- `scripts/cloudflare/provision-label.mjs` — new `ensureR2Cors(profile, env)` and the `cors` plan step.
- `apps/api/cors.json` — deleted.

## Design notes

`deriveCorsRules` does **not** re-implement the origin rule. It splits
`deriveExpected(profile, env).ALLOWED_ORIGINS`, making the bucket policy and the
Worker policy two consumers of one derivation. Production therefore inherits
exact-origins-only and staging inherits the single preview-wildcard carve-out for
free, and `checkPolicy` governs the one string both consume.

`wrangler r2 bucket cors set` takes `--file`, so the document is written to a
**deterministic absolute** temp path (`aq-cors-<label>-<env>.json`) and removed in a
`finally`. Deterministic, so the command the dry run prints is byte-identical to the
one that executes; absolute, because wrangler runs with `cwd=apps/api` under
`pnpm --filter api exec`.

A committed per-label file (`config/labels/cors/<label>-<env>.json`) was rejected: it
is derived data with a second source of truth, which drifts from `webOrigin`.

## Acceptance Criteria

- [x] `deriveCorsRules(p,'production').allowed.origins` is exact-origin only, no `*`.
- [x] `deriveCorsRules(p,'staging')` carries the named host, the single wildcard, and `http://localhost:3000`.
- [x] `deriveCorsRules(p,e)[0].allowed.origins.join(',') === deriveExpected(p,e).ALLOWED_ORIGINS` for both envs (anti-drift test).
- [x] `checkPolicy` returns `[]` for the derived origins in both envs.
- [x] `renderCorsFile` round-trips through `JSON.parse` with the `{ rules: [...] }` shape.
- [x] `ensureR2Cors` skips the write when `cors list` already matches.
- [x] `apps/api/cors.json` is deleted and nothing references it.

## Verification

```bash
make test-scripts
node scripts/cloudflare/provision-label.mjs budo --dry-run --only cors
grep -rn "cors.json" . --exclude-dir=node_modules   # no hits
```
