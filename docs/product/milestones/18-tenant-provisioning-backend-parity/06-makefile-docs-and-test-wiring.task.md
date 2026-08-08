# Task 06 — Backend: Makefile, docs and test wiring (Phase 3)

**Status:** ✅ Done
**Milestone:** [18 — Tenant provisioning: Cloudflare resource bring-up with backend parity](./milestone.md)
**RFC:** [RFC 0012](../../RFCs/0012-tenant-provisioning-backend-parity.md)
**Team:** Backend API
**Depends On:** [Task 05](./05-custom-domain-behind-a-flag.task.md)

## Summary

Point the Makefile at the provisioner, retire the targets it supersedes, wire the
operational script tests into `make test`, and document the bring-up flow. Closes the
milestone.

## Scope

- `Makefile` — `r2-cors-*`, `create-db-*`, `create-kv-*`, `set-new-label`, new `test-scripts`, new `superseded` macro, `.PHONY`.
- `CLAUDE.md`, `docs/onboarding.md`.

## Design notes

**`create-kv-*` was actively wrong**, not merely redundant: it created a namespace
literally *titled* `RATE_LIMIT_KV` — the binding name every tenant shares —
contradicting the `<label>-rate-limit-<env>` convention and colliding in the account
namespace list. It and its siblings now print a pointer and exit non-zero via a new
`superseded` macro; they cannot auto-forward like `deprecated` does, because the
replacement is label-scoped and needs a `LABEL`.

**`--only` targets one environment.** A full run is a bring-up (staging, then
production behind the gate); an `--only` run is a targeted repair. So `--production`
with `--only` means production *instead of* staging — otherwise `make r2-cors-prod`
would quietly rewrite staging too, against the Makefile's environment-naming rule.

**`make test-scripts` is new.** The `scripts/**` unit tests existed but were wired into
nothing — not `make test`, not Turborepo, not CI — so they only ran when someone
invoked `node --test` by hand. New tests would have been dead weight without this.

## Acceptance Criteria

- [x] `make r2-cors-staging` / `r2-cors-prod` forward to the provisioner with `--only cors` and no longer reference a committed file.
- [x] `make create-db-*` / `create-kv-*` print the superseded pointer and exit 1.
- [x] `make set-new-label` accepts `PRODUCTION=1`, `CONFIRM=1`, `WITH_DOMAIN=1`, `ONLY=<step>`, `DRY_RUN=1`.
- [x] `make test-scripts` runs all three script test files; `make test` depends on it.
- [x] `.PHONY` covers the new targets and `make help` renders the changed descriptions.
- [x] `CLAUDE.md` documents the bring-up command and the `JWT_SECRET` contract.
- [x] `docs/onboarding.md` has a "Bringing up a new tenant" section and the provisioning secret contract.

## Verification

```bash
make test-scripts
make help | grep -E "set-new-label|r2-cors|test-scripts"
make create-kv-prod   # prints the superseded pointer, exits 1
```
