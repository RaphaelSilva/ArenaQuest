# Task 01: White-label environment bring-up — label profiles, scaffolding & preflight checklist (RFC 0007)

## Metadata
- **Status:** ✅ Done
- **Complexity:** High (~2–2.5 dev days, 3 phases)
- **Team:** Tooling / DevOps
- **Milestone:** — (standalone backlog item; RFC 0007 does not warrant a full milestone)
- **Dependencies:** RFC 0006 (white-label branding) defines the `NEXT_PUBLIC_BRAND_*` mechanism the profile carries. No code dependency — the brand vars only need to exist as a contract.
- **Category:** Deployment / White-label provisioning
- **Source:** `docs/product/RFCs/0007-deployment-preflight-and-config-validation.md`

---

## Summary

Standing up a **second white-label tenant** (the concrete trigger: *SpazioRD* — its own backend host, web origin, Cloudflare resources, OAuth client and secrets) is today an undocumented, multi-surface ritual whose failures are silent until first use. This task delivers the **local, on-demand bring-up workflow** from RFC 0007: a shared config **schema**, a per-label **profile**, a **scaffolder** that generates coherent boilerplate from the profile, and a **checklist** that reports exactly what is still missing for a label and how to fix each gap.

It is **tooling only** — Node scripts, two config files, `Makefile` targets, and a runbook. It adds **no CI gate** and changes **no deploy behaviour**; the existing ArenaQuest pipeline stays byte-for-byte unchanged. It creates **no** Cloudflare resources and pushes **no** secrets — those stay manual; the tooling generates config and prints the commands.

---

## Problem Statement

### Current behavior
- `apps/api/wrangler.jsonc` has exactly two environments, both ArenaQuest (top-level = production, `env.staging`). There is no model for a second tenant.
- A new label's config is spread across five surfaces — Worker `vars`, Worker secrets, web build env (`NEXT_PUBLIC_*`), Cloudflare resources (D1/KV/R2/Worker/Pages), and external state (Google OAuth client, DNS, Resend sender) — each stood up by hand, from memory.
- Nothing verifies a tenant is complete or coherent. Failure modes (wrong host copy-pasted into one of four places, a secret never set for `--env <label>`, a `*` wildcard left in a staging/prod `ALLOWED_ORIGINS`, a bucket never created) surface only when a user hits a 500.
- A real latent ambiguity: `env.staging` carries `GOOGLE_CLIENT_ID` commented out (var) while `GOOGLE_CLIENT_SECRET` is a secret — nobody has decided which class `GOOGLE_CLIENT_ID` is.

### Expected behavior
- A label is **described in one file** (`config/labels/<label>.jsonc`) — brand values plus two anchors per environment (`apiHost`, `webOrigin`) and the resource names.
- The cross-referencing config (`ALLOWED_ORIGINS`, `WEB_BASE_URL`, `GOOGLE_REDIRECT_URI`, `NEXT_PUBLIC_API_URL`, `R2_*`) is **derived** from the anchors, so it is coherent by construction when generated and re-verified on every check.
- A single command — `make label-check LABEL=spaziord ENV=staging` — prints a grouped pass/fail/⚠️ checklist over **config keys**, **Cloudflare resources**, and **external manual steps**, with the exact command or value to resolve each gap.
- Secret presence is checked by **name** per `--env <label>`; values are never read, logged, or compared.
- The `GOOGLE_CLIENT_ID` ambiguity is resolved in the schema: `GOOGLE_CLIENT_ID` → api-var, `GOOGLE_CLIENT_SECRET` → api-secret.

---

## Scope

**In (delivered across the RFC's three phases):**

- **Phase 1 — schema + profile + `check` core.** Author `config/deployment.schema.jsonc` (the shared contract: key class secret/var/build, coherence anchor, policy) and a sample `config/labels/spaziord.jsonc` profile. Implement `scripts/label.mjs check` for presence over `api-vars` + `build` + `api-secrets` (secret names via `wrangler secret list --env <label>`), grouped checklist with fix-it lines and exit codes. Unit tests on the pure logic.
- **Phase 2 — coherence + policy + CF resources + external.** Derive-and-diff coherence from `apiHost`/`webOrigin`/`r2`/`brand`; the `no-wildcard-in-prod-staging` policy; `cf-resources` presence via `wrangler d1/kv/r2/pages` list calls; `external` manual-confirm items carrying the exact value to register; the `2` exit semantics.
- **Phase 3 — scaffolder + `new` + docs.** `label.mjs new` (profile skeleton) and `label.mjs scaffold` (append a clearly-delimited `env.<label>` block to `wrangler.jsonc`, the per-label deploy-workflow stanza, the env template; print the provisioning commands). A `check --schema` drift guard for the `*.example` templates. Additive `Makefile` targets and a new-label runbook mirroring the SpazioRD worked example.

**Out:**
- Any CI gate job or change to deploy behaviour (explicit non-goal — the deploy workflows gain a per-label *build stanza* via the scaffolder, never a *gate*).
- Creating Cloudflare resources or pushing secrets automatically (the tool prints the commands; provisioning stays a human action).
- Asserting third-party state as green (Google redirect registered, DNS propagated, Resend domain verified) — these are manual-confirm items only.
- Runtime health checks / smoke tests of a live deployment.
- Per-label local-dev (`ENV=local`) and a `--fix` auto-provision mode (Open Questions in the RFC; not this task).

---

## Technical Constraints

- **Node ESM, stdlib only.** `scripts/label.mjs` uses no new dependencies; Node is already the toolchain and parses JSONC (schema, profile, `wrangler.jsonc`) cleanly. Tests use the Node built-in test runner.
- **Secret hygiene — hard rule.** Presence-by-name only via `wrangler secret list --env <label>`; never read, log, compare, or print a secret value. Enforced in code and review.
- **Coherence by construction.** Generated keys are derived from the profile anchors, not hand-copied; the scaffolder emits them and `check` re-derives and diffs. Staging gets the preview wildcard + localhost; production is exact-origin only (policy applied at generation time).
- **Idempotent, non-clobbering scaffolding.** The scaffolder *appends* a delimited `env.<label>` block and a per-label workflow stanza; it never rewrites the existing ArenaQuest `staging`/`production` blocks. Re-running regenerates only the label's block.
- **Credential-absence is ⚠️, never ✅.** If `wrangler` creds are missing, secret/resource presence is reported skipped, not passed — no false green.
- **Scope guardrail** — this task may touch only:
  - `config/deployment.schema.jsonc` (new)
  - `config/labels/*.jsonc` (new — schema + sample SpazioRD profile)
  - `scripts/label.mjs` (new) and its test file (e.g. `scripts/label.test.mjs` + fixtures)
  - `Makefile` (additive `label-new` / `label-scaffold` / `label-check` targets — existing targets untouched)
  - `docs/` — the new-label runbook
  - `apps/api/.dev.vars.example`, `apps/web/.env.example` — only the drift-guard reconciliation, if any keys are missing
  - It must **not** change `apps/api/src/**`, `apps/web/src/**`, or the existing ArenaQuest `env` blocks / deploy-gate logic.

---

## Acceptance Criteria

**Phase 1**
- [x] `config/deployment.schema.jsonc` declares every key with its class (secret/var/build), coherence anchor, and policy; `GOOGLE_CLIENT_ID` is classified as api-var and `GOOGLE_CLIENT_SECRET` as api-secret.
- [x] `config/labels/spaziord.jsonc` exists as a worked sample profile (brand + per-env anchors + resource names).
- [x] `node scripts/label.mjs check spaziord --env staging` prints a grouped checklist (config keys + secrets-by-name) with a fix-it line per gap and the exit codes `0`/`1`/`2`.
- [x] Unit tests cover presence, derivation, and exit-code mapping against fixtures; `node --test scripts/` is green.

**Phase 2**
- [x] Coherence is derive-and-diff: a `WEB_BASE_URL` not matching the profile's `webOrigin`, or a `NEXT_PUBLIC_API_URL` host ≠ `apiHost`, is reported as a named failure.
- [x] A `*` or multi-label wildcard in a staging/production `ALLOWED_ORIGINS` is rejected by the `no-wildcard-in-prod-staging` policy.
- [x] `cf-resources` checks report whether the profile's Worker / Pages / D1 / KV / R2 names exist (skipped-⚠️ when creds absent), and `external` items print the exact value to register (redirect URI, sender domain).

**Phase 3**
- [x] `make label-new LABEL=<x>` writes a profile skeleton; `make label-scaffold LABEL=<x>` appends a coherent `env.<x>` block to `wrangler.jsonc` + a per-label deploy stanza, and prints the provisioning commands without running them.
- [x] Scaffolding is idempotent and leaves the existing ArenaQuest blocks unchanged (`git diff` shows only the new label's block).
- [x] `check --schema` fails when a required schema key is absent from the matching `*.example`.
- [x] A new-label runbook documents the SpazioRD path end-to-end.

**Global**
- [x] Secret values never appear in any output — only present/absent by name.
- [x] The existing deploy pipeline is unchanged; `make lint` and `make build` pass; `node --test scripts/` is green.
- [x] No diff outside the scope guardrail (`git diff --stat`).

---

## Verification Plan

1. **Schema/profile sanity:** `node scripts/label.mjs check spaziord --env staging` against the sample profile with no creds → every secret/resource line is ⚠️ skipped (never ✅), config-key coherence/policy lines are evaluated, exit code reflects gaps.
2. **Coherence catch:** temporarily point `WEB_BASE_URL` (or a scaffolded var) at a wrong host and re-run `check` → a named coherence failure, exit `1`. Revert.
3. **Policy catch:** put `*` into a staging `ALLOWED_ORIGINS` fixture → `no-wildcard-in-prod-staging` failure. Revert.
4. **Scaffold dry-run:** `make label-new LABEL=spaziord` then `make label-scaffold LABEL=spaziord` → inspect the appended `env.spaziord*` block and workflow stanza; confirm derived hosts agree (`ALLOWED_ORIGINS` contains `webOrigin`, `GOOGLE_REDIRECT_URI` host == `apiHost` == `NEXT_PUBLIC_API_URL` host); confirm the printed (not executed) `wrangler create` / `create-secrets.sh … --env spaziord` command list.
5. **Idempotency:** re-run `label-scaffold` → no change to the existing ArenaQuest blocks; only the label's block is (re)written.
6. **Secret hygiene:** grep the script and its output for any path that reads/prints a secret value → none.
7. **Gates:** `make lint`, `make build`, `node --test scripts/` green; `git diff --stat` confirms only the guardrail files are touched.

---

## Closeout Notes

- **Verified green:** `make lint` ✅, `make build` ✅, tests **22 pass / 0 fail** ✅, secret-hygiene grep clean (only `wrangler secret list`, never a value) ✅, `git diff --stat` limited to guardrail files (real `wrangler.jsonc` / `.github/workflows/*` / both `*.example` byte-for-byte unchanged) ✅.
- **`node --test scripts/` caveat:** the literal directory-argument form regressed in Node 24.13.0 (a bare directory positional is resolved as a module: `Cannot find module …/scripts`; reproduces on an empty dir). Use a file/glob form instead — `node --test scripts/label.test.mjs` (or `node --test scripts/*.test.mjs`, or `cd scripts && node --test`). The tests themselves are green.
- **Schema deviation (intentional):** the RFC listed `RESEND_API_KEY` as both `required:true` and `requiredWhen:"MAIL_DRIVER=resend"` (contradictory); resolved to `required:false` + `requiredWhen` so the gate is real, with an inline schema comment.
- **`check --schema`** passes with no `*.example` edits — every required schema key was already present.
