# Task 05 — Backend: Custom domain detection behind `--with-domain` (Phase 3)

**Status:** ✅ Done
**Milestone:** [18 — Tenant provisioning: Cloudflare resource bring-up with backend parity](./milestone.md)
**RFC:** [RFC 0012](../../RFCs/0012-tenant-provisioning-backend-parity.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-ensure-worker-via-deploy-cli.task.md)

## Summary

Optionally attach the `apiHost` custom domain to the label's Worker when its zone is
already active in the Cloudflare account, and record the fact in the profile so the
generated wrangler env block emits `routes`. No env in `apps/api/wrangler.jsonc` had a
`routes` key before this, so custom hosts like `api.budo.app` were aspirational.

## Scope

- `scripts/cloudflare/provision-label.mjs` — `findZoneForHost`, `ensureCustomDomain`, `setProfileCustomDomain`, the `--with-domain` flag and the `domain` plan step.
- `scripts/label.mjs` — conditional `routes` emission in `buildEnvBlockObject`.
- `config/labels/<label>.jsonc` — optional `customDomain` boolean per environment.

## Design notes

**Opt-in and fail-soft, deliberately.** The Cloudflare dashboard side of custom domains
still needs operator study, so the default path — keep the workers.dev host and print a
follow-up — is the one every `make set-new-label` exercises, and therefore the
well-tested one. Every failure mode (no zone, zone not active, attach error,
placeholder host, already a workers.dev host) degrades to a warning with a hint.

**The flag lives in the profile, not the script.** `scaffoldWranglerText` regenerates
the entire env block on every provision run, so a `routes` key not derivable from the
profile would be silently stripped on the next run. `setProfileCustomDomain` inserts
the key under `apiHost` on first use and updates it in place afterwards.

**Zone matching** picks the longest zone name that is a suffix of `apiHost`, so
`api.budo.app` resolves to zone `budo.app` rather than a shorter accidental match.

## Open items for the operator (dashboard)

1. Whether attaching requires the zone to be **active** (nameservers delegated) or a
   pending zone suffices — the code assumes active and skips otherwise.
2. Worker **custom domains** and **routes** are different objects; confirm which appears
   under Workers → the Worker → Settings → Domains & Routes after a `--domain` deploy.
3. Whether the token needs `Zone:Read` in addition to `Workers Scripts:Edit`.
4. Pages custom domains for `webOrigin` are a separate API and remain manual.

## Acceptance Criteria

- [x] No `domain` step in the plan unless `--with-domain` is passed (unit-tested).
- [x] `scaffoldWranglerText` emits `routes` iff the profile records `customDomain: true`, per environment.
- [x] Scaffolding stays byte-idempotent once `routes` are emitted.
- [x] `setProfileCustomDomain` inserts once and updates in place thereafter.
- [x] A missing or inactive zone warns and continues; it never fails the run.
- [x] Attaching prints the Google redirect re-registration warning.

## Verification

```bash
make test-scripts
node scripts/cloudflare/provision-label.mjs budo --dry-run --with-domain | grep -A2 "Custom domain"
```
