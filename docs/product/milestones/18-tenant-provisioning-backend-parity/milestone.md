# Milestone 18 — Tenant provisioning: Cloudflare resource bring-up with backend parity

**Status:** ✅ Completed
**Scope:** `scripts/cloudflare/provision-label.mjs`, the pure derivation helpers in `scripts/label.mjs`, the `r2-cors-*` / `create-*` / `set-new-label` targets in `Makefile`, and their unit tests under `scripts/**`. Derived from [RFC 0012](../../RFCs/0012-tenant-provisioning-backend-parity.md).

> **Hard scope guardrail — read before opening any task.** This milestone may only touch the **provisioning layer**: `scripts/cloudflare/provision-label.mjs` (formalised here), the new *pure* helpers in `scripts/label.mjs` (`deriveCorsRules`, `renderCorsFile`, `workersDevHost`, `kvNamespaceName`) plus its conditional `routes` emission, the `r2-cors-*` / `create-db-*` / `create-kv-*` / `set-new-label` / `test-scripts` targets in `Makefile`, the deletion of `apps/api/cors.json`, and the unit tests under `scripts/**`. It **reuses unchanged**: `scripts/deploy/core.mjs` (`confirmProduction` only — the module must stay cloud-free and must not gain a provisioning concept), `scripts/cloudflare/deploy.mjs` (spawned, never modified, never imported), `config/deployment.schema.jsonc`, and `apps/api/scripts/check-no-dev-seed.ts`. It is explicitly **not** an opportunity to: create Google OAuth clients or register redirect URIs; verify Resend sender domains; register, buy or delegate DNS zones; provision Pages custom domains; write externally-valued secrets (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`); build a `JWT_SECRET` rotation flow; touch `apps/api/src/**` or `apps/web/**`; or implement a second cloud provider. If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **Backend/frontend parity in bring-up.** `make set-new-label LABEL=x` must leave the backend as alive as the frontend already is. Today the frontend gets a real provisioned Cloudflare Pages project while the backend gets only bindings: no Worker, no signing key, no bucket CORS, and an unresolvable `apiHost`.
- **A label's Worker serves authenticated traffic immediately after provisioning.** `JWT_SECRET` is generated per label *and* per environment and set before the first deploy, so `buildContainer` never throws. A shared key across tenants would let an access token minted for tenant A verify on tenant B; per-Worker generation makes that structurally impossible.
- **R2 CORS is derived, never committed.** The bucket policy is `ALLOWED_ORIGINS` split apart, so it cannot drift from the Worker policy. This removes the `apps/api/cors.json` defect where `make r2-cors-prod DEPLOY_LABEL=budo` applied arenaquest staging origins to budo's production bucket.
- **`apiHost` is real.** The account workers.dev subdomain is resolved and substituted, so the `<acct>` placeholder stops leaking into the deployed `GOOGLE_REDIRECT_URI`.
- **One release code path preserved.** Provisioning brings a Worker into existence by spawning the RFC 0011 deploy CLI, inheriting its preflight, no-dev-seed guard and `migrate`-before-`deploy` ordering — never by calling `wrangler deploy` itself.
- **Secret hygiene is structural.** Secret values never reach argv, disk or a log line, and a unit test asserts no planned command can carry one.
- **Naming & safety compliance.** Production stays behind the existing confirmation gate; `--dry-run` requires no credential, changes nothing, and covers every command because the plan it prints is the plan that executes.

Out of scope (explicit, from RFC 0012 Non-Goals):
- **Google OAuth client creation / redirect registration** — reported, not automated.
- **Resend sender domain verification** — reported, not automated.
- **DNS zone registration or delegation** — `--with-domain` attaches only to a zone already active in the account.
- **Pages custom domains** — a separate Cloudflare API surface from Worker routes.
- **Writing externally-valued secrets** — detected by name and reported; setting stays with `scripts/create-secrets.sh` / `make secret-*`.
- **`JWT_SECRET` rotation** — the provisioner never overwrites an existing key.
- **A second cloud provider** — only the structure accommodates one.

---

## 2. Functional Requirements

- `provision-label.mjs` accepts `<label>` (required), `--production`, `--yes`, `--with-domain`, `--only <all|cors|secrets|worker|domain>` (default `all`), and `--dry-run`.
- `buildProvisionPlan(profile, env, options)` is pure and returns ordered steps; `--dry-run` prints it and the executor walks it, so no step can execute without appearing in the dry run.
- The plan order is `d1 → kv → r2 → subdomain → profile → cors → pages → secrets → worker → [domain]`. The `profile` write precedes every `--env` command; `secrets` precedes `worker`.
- `--dry-run` requires no Cloudflare credential, prints the planned commands and leaves the working tree byte-identical.
- `deriveCorsRules(profile, env)` derives origins by splitting `deriveExpected(profile, env).ALLOWED_ORIGINS`; the two can never diverge.
- `ensureR2Cors` compares the bucket's current CORS before writing and reports "already correct" when it matches.
- `JWT_SECRET` is 32 random bytes hex-encoded, delivered over stdin, set only when `wrangler secret list --format json` reports it absent. A *failed* list skips the step rather than risking an overwrite.
- The four externally-valued secrets are reported ✅/⚠ with their exact fix command, gated by `requiredWhenActive` so `RESEND_API_KEY` is only demanded when `mail.driver === 'resend'`.
- `ensureWorker` spawns `node scripts/cloudflare/deploy.mjs --label <l> -e <env> --scope api --yes`; `--yes` is reachable only after `confirmProduction` has already passed.
- With `--with-domain`, a zone matching `apiHost` that is active gets the domain attached and `customDomain: true` written to the profile, which makes `buildEnvBlockObject` emit `routes`. Any failure degrades to a warning plus a follow-up.
- Every path that mutates `apiHost` prints a re-register-the-Google-redirect-URI warning.
- `make r2-cors-staging` / `r2-cors-prod` forward to the provisioner with `--only cors`; an `--only` run targets exactly one environment.
- `make create-db-*` / `create-kv-*` print a superseded pointer to `set-new-label` and exit non-zero.
- `make test-scripts` runs `label.test.mjs`, `deploy/core.test.mjs` and `cloudflare/provision-label.test.mjs`; `make test` depends on it.

---

## 3. Acceptance Criteria

- On a fresh profile, `make set-new-label LABEL=x` produces a Worker that answers a health check and returns a 4xx — not a 500 — on a malformed authenticated request.
- Re-running it is a no-op: every step logs "already exists"/"already set", `git diff` is empty, and `JWT_SECRET` is unchanged.
- `wrangler r2 bucket cors list <label>-media-staging` returns the profile's origins and contains no other tenant's host.
- `git diff` after `--dry-run` is empty and the run needs no credential.
- `make label-check LABEL=x ENV=staging` reports real ✅/❌ for `api-secrets` instead of "⚠ skipped".
- No rendered command line in any code path can contain a 64-hex-character run (unit-tested).
- `scripts/deploy/core.mjs` is unchanged and still imports no cloud SDK.

---

## 4. Specific Stack

Node `.mjs`, stdlib only (`node:crypto`, `node:child_process`, `node:fs`, `node:os`, global `fetch`), consistent with `label.mjs` and the RFC 0011 CLI. Tests are `node:test` with zero network and zero wrangler invocations. Cloudflare is reached through the repo-pinned wrangler (`pnpm --filter <api|web> exec wrangler`) and, for the two probes wrangler does not expose (workers.dev subdomain, zone lookup), the Cloudflare REST API with `CF_API_TOKEN`.

---

## 5. Task Breakdown

The execution plan. Each row is a `.task.md` file. All tasks are Backend
(infrastructure / operational scripts) — this milestone has no web UI surface.

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Per-label R2 CORS derived from the profile](./01-per-label-r2-cors-derived-from-the-profile.task.md) | 1 | Backend | ✅ Done |
| 02 | [workers.dev subdomain resolution and the acct placeholder](./02-workers-dev-subdomain-resolution.task.md) | 1 | Backend | ✅ Done |
| 03 | [JWT_SECRET generation and external secret detection](./03-jwt-secret-generation-and-secret-detection.task.md) | 2 | Backend | ✅ Done |
| 04 | [Ensure the Worker exists via the deploy CLI](./04-ensure-worker-via-deploy-cli.task.md) | 2 | Backend | ✅ Done |
| 05 | [Custom domain detection behind --with-domain](./05-custom-domain-behind-a-flag.task.md) | 3 | Backend | ✅ Done |
| 06 | [Makefile, docs and test wiring](./06-makefile-docs-and-test-wiring.task.md) | 3 | Backend | ✅ Done |

Dependency graph:

```
01 ─┐
02 ─┼─► 03 ─► 04 ─► 05 ─► 06
    │
    └─► (both are pure-layer, independent of each other)
```

---

## 6. Decisions recorded (from RFC 0012 "Resolved Decisions")

- **`wrangler secret list` takes `--format {json,pretty}`, not `--json`.** The previous `--json` in `scripts/label.mjs` made every `api-secrets` row report "skipped (no creds)" even when authenticated.
- **`wrangler secret put` does not require the Worker to exist** — it creates a draft, and deploys never delete secrets. This is what allows secrets-before-deploy and removes the ordering dilemma.
- **`--only <step>` targets one environment.** A full run is a bring-up; an `--only` run is a targeted repair, so `--production` there means production *instead of* staging — otherwise `make r2-cors-prod` would quietly rewrite staging, against the Makefile's environment-naming rule.
- **`customDomain` lives in the profile, not the script.** `scaffoldWranglerText` regenerates the whole env block on every run, so a `routes` key not derivable from the profile would be silently stripped.
- **The provisioner spawns the deploy CLI rather than importing it.** `deploy.mjs` calls `process.exit()` on its failure paths and is an entrypoint, not a library.

---

## 7. Definition of Done (milestone level)

- Every task above is ✅ Done.
- `make test-scripts` is green.
- `apps/api/cors.json` is deleted and nothing references it.
- `scripts/cloudflare/provision-label.mjs` is committed (it was untracked before this milestone).
- RFC 0012 is Implemented and indexed in `docs/product/RFCs/README.md`.
- `CLAUDE.md` and `docs/onboarding.md` document the bring-up flow and the secret contract.
