# Task 03 — Backend: JWT_SECRET generation and external secret detection (Phase 2)

**Status:** ✅ Done
**Milestone:** [18 — Tenant provisioning: Cloudflare resource bring-up with backend parity](./milestone.md)
**RFC:** [RFC 0012](../../RFCs/0012-tenant-provisioning-backend-parity.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-workers-dev-subdomain-resolution.task.md)

## Summary

Generate and set `JWT_SECRET` per label and per environment during provisioning, and
report — never write — the four secrets whose values originate outside the system.

`JWT_SECRET` is the HMAC-SHA256 key for HS256 access tokens. `JwtAuthAdapter` throws
when it is absent or shorter than 32 characters
(`apps/api/src/adapters/auth/jwt-auth-adapter.ts:141-147`), and it is constructed in
`buildContainer` (`apps/api/src/container.ts:149`) — so a Worker without it returns
500 on *every* authenticated route. Provisioning previously only printed a hint.

## Scope

- `scripts/cloudflare/provision-label.mjs` — `generateSecretValue`, `listSecretNames`, `putSecret`, `ensureWorkerSecrets`, `reportExternalSecrets`, and the `secrets` plan step.
- `scripts/label.mjs` — fix `listSecretNames` to use `--format json`.

## Design notes

**Per label AND per env by construction.** `<label>` and `<label>-staging` are two
different Workers with two different secret lists, each getting its own
`randomBytes(32)`. No two tenants can share a signing key — which matters concretely:
a shared `JWT_SECRET` means an access token minted for tenant A verifies on tenant B,
while the `userId` claims point into different D1 databases.

**Never overwrite.** The step early-returns when the name is already present.
Rotation is deliberately not offered here.

**Unknown ≠ absent.** `listSecretNames` returns `null` (not `[]`) when the list call
fails, and the step then *skips*. Treating a failed list as "absent" would let a
re-run clobber a good key. This matches the house rule at `scripts/label.mjs:21`:
missing credentials → skipped, never a green tick.

**Value never leaves stdin.** `putSecret` is its own `spawnSync` with `{ input }`,
deliberately *not* routed through `runCommand`, which echoes the command line and
interpolates captured output into its error message.

**`--format json`, not `--json`.** Verified against the pinned wrangler 4.82.2:
`wrangler secret list` has no `--json` flag. The previous `--json` in `label.mjs` made
`make label-check` report every `api-secrets` row as "⚠ skipped (no creds)" even when
authenticated, and downgraded a genuinely missing `JWT_SECRET` from exit 1 to exit 2.

## Acceptance Criteria

- [x] `generateSecretValue()` matches `/^[0-9a-f]{64}$/` and differs across calls.
- [x] An existing `JWT_SECRET` is never overwritten.
- [x] A failed `secret list` skips the step with a warning instead of writing.
- [x] `RESEND_API_KEY` is only demanded when `mail.driver === 'resend'` (via `requiredWhenActive`).
- [x] Missing external secrets are warnings with the exact `create-secrets.sh` command, not failures.
- [x] No planned command line can contain a 64-hex-character run (unit-tested).
- [x] `make label-check` reports real ✅/❌ for `api-secrets`.

## Verification

```bash
make test-scripts
node scripts/cloudflare/provision-label.mjs budo --dry-run | grep -A3 "Worker secrets"
```
