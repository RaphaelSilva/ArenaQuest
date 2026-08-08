# Task 04 — Backend: Ensure the Worker exists via the deploy CLI (Phase 2)

**Status:** ✅ Done
**Milestone:** [18 — Tenant provisioning: Cloudflare resource bring-up with backend parity](./milestone.md)
**RFC:** [RFC 0012](../../RFCs/0012-tenant-provisioning-backend-parity.md)
**Team:** Backend API
**Depends On:** [Task 03](./03-jwt-secret-generation-and-secret-detection.task.md)

## Summary

Bring the label's Worker into existence during provisioning, so `make set-new-label`
leaves the backend as alive as the frontend. Cloudflare has no "create Worker" API —
a Worker exists once it is deployed — so this step performs a real initial deploy.

## Scope

- `scripts/cloudflare/provision-label.mjs` — `ensureWorker(label, env)` and the `worker` plan step.

## Design notes

**Spawn the deploy CLI, do not call wrangler.** RFC 0011's premise is that every
release goes through one script. A second `wrangler deploy` call site would
reintroduce the divergence it removed, and would skip three things the CLI gets right:
the fail-closed `preflight`, the `guard-no-dev-seed` step, and — crucially — the
`migrate` step that `buildPlan` orders *before* `deploy-worker`. That last one is how
the freshly created D1 gets its schema.

**Spawn, not import.** `deploy.mjs` calls `process.exit()` on its failure paths and is
written as an entrypoint, not a library.

**`--scope api`**, not `all`, so provisioning never silently ships a frontend build.

**`--yes` is safe here only because** `provisionEnvironment` for production is already
downstream of `confirmProduction`. This is called out inline, since it otherwise reads
like a confirmation bypass.

**Ordering.** Secrets run *before* this step. `wrangler secret put` creates a draft
Worker when none exists and deploys never delete secrets, so the first real deploy
boots with a valid signing key. The reverse order would leave a window where the
Worker is live and 500s on every authenticated route.

A fresh D1 is safe for the guard: `isFreshDatabaseError` in
`apps/api/scripts/check-no-dev-seed.ts` turns `no such table: users` into exit 0.

## Acceptance Criteria

- [x] The `worker` plan step invokes `scripts/cloudflare/deploy.mjs`, not `wrangler deploy`.
- [x] It passes `--scope api`.
- [x] `secrets` precedes `worker` in the plan (unit-tested).
- [x] `profile` precedes `worker` in the plan (unit-tested).
- [x] A non-zero exit from the deploy CLI aborts provisioning with a named error.

## Verification

```bash
make test-scripts
node scripts/cloudflare/provision-label.mjs budo --dry-run | grep -A2 "Deploy the Worker"
```
