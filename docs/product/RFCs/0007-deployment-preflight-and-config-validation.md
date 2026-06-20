# RFC 0007: Deployment preflight & configuration validation

**Date:** 2026-06-19
**Status:** Draft
**Author:** raphaelsilva
**Affected:**
- `scripts/preflight.mjs` (**new** — the validator/CLI)
- `config/deployment.manifest.jsonc` (**new** — single source of truth for required config per scope/environment)
- `.github/workflows/deploy-web.yml` + `deploy-api.yml` (new `preflight` gate job before deploy)
- `Makefile` (additive `preflight` target — does not touch existing deploy targets)
- `apps/api/.dev.vars.example`, `apps/web/.env.example` (kept in sync with the manifest)
- `docs/product/RFCs/README.md` (index entry)

> **Relationship to RFC 0006.** RFC 0006 (white-label branding) *adds*
> the `NEXT_PUBLIC_BRAND_*` build variables. This RFC does not own any
> single feature's variables; it owns the **cross-cutting guarantee that
> a target environment is configured coherently before we deploy to it**
> — brand variables included, but also the generic control config
> (API endpoints, Google OAuth, CORS, mail) and the presence of the
> Cloudflare **secrets** that never live in the repo. 0006 can ship
> without this; this makes 0006 (and every future env var) safe to
> operate.

---

## Summary

Add a **deployment preflight**: a single validator that, for a given
target (`local` / `staging` / `production`), checks that **all required
configuration is present and mutually coherent** *before* a deploy runs
— and fails loudly if not. It validates three classes of config that are
today spread across `wrangler.jsonc` (Worker `vars`), Cloudflare
**secrets** (set out-of-band via `wrangler secret put`, never in the
repo), and the web build env (`NEXT_PUBLIC_*` in CI):

1. **Presence** — every required var and secret exists for that
   environment (secrets checked by *name* via `wrangler secret list`; we
   never read or print values).
2. **Coherence** — the values that must agree actually agree: the web's
   `NEXT_PUBLIC_API_URL` points at the Worker host that owns the
   environment's `GOOGLE_REDIRECT_URI`; the Worker's `WEB_BASE_URL`
   matches the deployed web origin; `ALLOWED_ORIGINS` contains that
   origin.
3. **Policy** — environment-specific rules: the CORS full-wildcard `*`
   (and, in production, the subdomain wildcard) must **never** appear in
   staging/production (per the CORS contract in CLAUDE.md /
   `docs/product/backlog/cors/`).

A committed **manifest** (`config/deployment.manifest.jsonc`) is the
single source of truth for "what a complete environment needs". The
preflight reads it; the `*.example` env files and the CI workflows are
checked against it. The validator runs **both locally**
(`make preflight ENV=staging`) **and as a CI gate** that the existing
`deploy-*` jobs depend on. It is a **validator, not a deployer** — it
mutates nothing and never replaces the GitHub Actions pipeline.

## Motivation

Deploys are already automated (GitHub Actions: `deploy-web.yml`,
`deploy-api.yml`). What is *not* automated is the answer to "is this
environment actually configured?" Today that knowledge is tribal and
scattered:

- **Worker `vars`** live in `wrangler.jsonc` (per environment), e.g.
  `ALLOWED_ORIGINS`, `WEB_BASE_URL`, `GOOGLE_REDIRECT_URI`, `R2_*`,
  `MAIL_*` ([wrangler.jsonc:17](../../../apps/api/wrangler.jsonc#L17),
  [:100](../../../apps/api/wrangler.jsonc#L100)).
- **Worker secrets** are *not* in the repo by design — `JWT_SECRET`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `GOOGLE_CLIENT_SECRET`,
  `RESEND_API_KEY` — set via `scripts/create-secrets.sh` /
  `wrangler secret put` ([.dev.vars.example](../../../apps/api/.dev.vars.example),
  [create-secrets.sh](../../../scripts/create-secrets.sh)). Nothing
  verifies they were actually set on the target.
- **Web build env** is injected in CI per environment
  (`NEXT_PUBLIC_API_URL`,
  [deploy-web.yml:82](../../../.github/workflows/deploy-web.yml#L82)),
  and — once RFC 0006 lands — the `NEXT_PUBLIC_BRAND_*` set.

The failure modes are exactly the ones that are silent until a user hits
them:

- A new environment (or a white-label deploy) is missing
  `GOOGLE_CLIENT_SECRET` → OAuth 500s on first login, not at deploy time.
- `WEB_BASE_URL` or `GOOGLE_REDIRECT_URI` points at the wrong host after
  copy-paste → activation emails and OAuth callbacks land on the wrong
  origin.
- `ALLOWED_ORIGINS` doesn't include the web origin → every API call is
  CORS-blocked in the browser.
- A `*` wildcard left in `ALLOWED_ORIGINS` on staging/production → a
  security regression the CORS contract explicitly forbids.

A 10-second check that turns all of these into a **red CI step before
the deploy** is high-leverage and cheap. This is the generic control
gap the user flagged: not branding-specific, but the same shape for
brand, endpoints, and OAuth.

## Goals & Non-Goals

**Goals**
- A **single validator** (`scripts/preflight.mjs`) that, given
  `--env <local|staging|production>`, reports a pass/fail checklist over
  presence + coherence + policy, exiting non-zero on any failure.
- A **committed manifest** as the single source of truth for required
  config per scope (`web-build`, `api-vars`, `api-secrets`) and which
  entries are secret, coherence-linked, or policy-constrained.
- **Secret presence without secret exposure** — verify names via
  `wrangler secret list`; never read, log, or compare values.
- **Run in two places with one implementation** — locally
  (`make preflight ENV=…`) and as a **CI gate job** the `deploy-*` jobs
  `needs:`, so a misconfigured environment can't be deployed to.
- **Drift detection** — flag when `wrangler.jsonc` vars, the `*.example`
  files, and the manifest disagree (a var added to one but not the
  others).
- **Zero deploy behaviour change when everything is configured** — the
  gate is invisible on a healthy environment; it only ever *blocks* a
  broken one.

**Non-Goals**
- **Building or deploying.** This RFC adds no build/deploy path; CI keeps
  owning that. The validator only reads state.
- **Owning any feature's variables.** RFC 0006 defines the brand vars;
  other RFCs define theirs. This RFC validates *whatever the manifest
  lists*.
- **Setting secrets / writing config.** Provisioning stays with
  `create-secrets.sh` and the Cloudflare dashboard. (A future
  `--fix`/`--prompt` mode is noted in Open Questions, not built here.)
- **Validating external third-party state** that has no API we trust —
  e.g. whether `GOOGLE_REDIRECT_URI` is registered in the Google Cloud
  console. The preflight checks our side (host coherence) and emits a
  **manual-confirmation reminder** for the Google-console side.
- **Runtime health checks / smoke tests** of a live deployment (hitting
  `/health`, etc.). Useful, but a separate concern — preflight runs
  *before* deploy, against config, not a running service.
- **Secret rotation / management.** Out of scope.

## Current State (for reference)

Three config surfaces, no validator across them:

| Scope | Where it lives | Examples | Checked today? |
|---|---|---|---|
| Web build (`NEXT_PUBLIC_*`) | CI `env:` in `deploy-web.yml`; `next.config.ts` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_BRAND_*` (RFC 0006), `NEXT_PUBLIC_LANGUAGE` | ❌ |
| Worker `vars` (plaintext) | `wrangler.jsonc` per env | `ALLOWED_ORIGINS`, `WEB_BASE_URL`, `GOOGLE_REDIRECT_URI`, `R2_*`, `MAIL_*`, `COOKIE_SAMESITE` | ❌ (committed, but no coherence/policy check) |
| Worker secrets | `wrangler secret put` (out-of-band) | `JWT_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY` | ❌ (no presence check on target) |
| CI/CD secrets | GitHub Environments | `CF_API_TOKEN`, `CF_ACCOUNT_ID` | ❌ |

The CORS policy is documented as a hard rule (no wildcards in
staging/prod — CLAUDE.md, `docs/product/backlog/cors/`) but enforced
only by review, not by tooling.

## Proposed Design

### 1. The manifest — single source of truth

`config/deployment.manifest.jsonc` declares, per scope, every required
key and its attributes. Sketch:

```jsonc
{
  "web-build": {
    "NEXT_PUBLIC_API_URL":   { "required": true, "coheres": "apiHost" },
    "NEXT_PUBLIC_LANGUAGE":  { "required": false, "enum": ["pt", "en"] },
    "NEXT_PUBLIC_BRAND_SIGLA":       { "required": false }, // RFC 0006
    "NEXT_PUBLIC_BRAND_NAME_PREFIX": { "required": false },
    "NEXT_PUBLIC_BRAND_NAME_ACCENT": { "required": false },
    "NEXT_PUBLIC_BRAND_POWERED_BY":  { "required": false, "enum": ["", "true", "false"] }
  },
  "api-vars": {
    "ALLOWED_ORIGINS":     { "required": true,  "policy": "no-wildcard-in-prod-staging", "contains": "webOrigin" },
    "WEB_BASE_URL":        { "required": true,  "coheres": "webOrigin" },
    "GOOGLE_REDIRECT_URI": { "required": true,  "coheres": "apiHost", "manual": "register in Google Cloud console" },
    "COOKIE_SAMESITE":     { "required": true,  "enum": ["Strict", "Lax", "None"] },
    "R2_S3_ENDPOINT":      { "required": true },
    "R2_BUCKET_NAME":      { "required": true },
    "R2_PUBLIC_BASE":      { "required": false },
    "MAIL_DRIVER":         { "required": true,  "enum": ["resend", "console", ""] },
    "MAIL_FROM":           { "required": true }
  },
  "api-secrets": {
    "JWT_SECRET":            { "required": true },
    "R2_ACCESS_KEY_ID":      { "required": true },
    "R2_SECRET_ACCESS_KEY":  { "required": true },
    "GOOGLE_CLIENT_ID":      { "required": true },
    "GOOGLE_CLIENT_SECRET":  { "required": true },
    "RESEND_API_KEY":        { "required": true, "requiredWhen": "MAIL_DRIVER=resend" }
  },
  "ci-secrets": {
    "CF_API_TOKEN":  { "required": true },
    "CF_ACCOUNT_ID": { "required": true }
  }
}
```

The manifest is the **only** place the required set is written; the
`*.example` files and `wrangler.jsonc` are validated *against* it
(§4 drift check), so they can't silently diverge.

### 2. The validator — `scripts/preflight.mjs`

A small Node ESM script (Node is already the CI runtime; a Node script
parses **JSONC** `wrangler.jsonc` robustly, which `jq` cannot). Run as
`node scripts/preflight.mjs --env staging` (or via `make preflight`).
For each scope it:

- **Resolves the effective config** for the target:
  - `api-vars` ← parse `wrangler.jsonc` (top-level for production, the
    `env.staging` block for staging), comments stripped.
  - `web-build` ← the CI `env:` for that environment (and/or the local
    `.env` when `--env local`).
  - `api-secrets` ← **names** from `wrangler secret list --env <env>`
    (JSON output); presence only.
  - `ci-secrets` ← optional, via `gh api` against the GitHub Environment
    (skipped if `gh` is absent / unauthenticated, with a notice).
- **Checks presence** — every `required` (and `requiredWhen`-active) key
  resolves to a non-empty value / appears in the secret list.
- **Checks coherence** — resolves the symbolic anchors (`apiHost`,
  `webOrigin`) from the canonical fields and asserts the linked fields
  agree (host/origin equality, `ALLOWED_ORIGINS` `contains` the web
  origin).
- **Checks policy** — e.g. `no-wildcard-in-prod-staging` rejects `*`
  (and multi-label wildcards) in `ALLOWED_ORIGINS` for those envs.
- **Prints a checklist** grouped by scope (✅ / ❌ / ⚠️ manual), and a
  final summary. **Exit code:** `0` all-pass; `1` any failure; `2` only
  manual reminders / skips outstanding (configurable whether `2` blocks).

It **never prints secret values** — only the key name and present/absent.

### 3. CI gate — a job the deploys depend on

Add a `preflight` job to each deploy workflow, between `verify` and the
`deploy-*` jobs, running inside the same GitHub `environment:` (so
`CF_API_TOKEN` / `CF_ACCOUNT_ID` and the environment `vars` are in
scope):

```yaml
preflight:
  name: Preflight (config validation)
  needs: verify
  runs-on: ubuntu-latest
  environment: { name: staging }   # production job mirrors this
  steps:
    - uses: actions/checkout@v4
    - run: node scripts/preflight.mjs --env staging
      env:
        CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
        CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
# deploy-staging / deploy-production then add:  needs: [verify, preflight]
```

A failed preflight blocks the deploy with an explicit checklist, instead
of a green deploy that 500s at runtime.

### 4. Drift check (manifest ↔ repo)

A manifest-only mode (`--check-drift`, also run in CI `verify`) asserts:

- every `api-vars` key in the manifest exists in `wrangler.jsonc` for
  each environment (and vice-versa — no undocumented var);
- every required `api-secrets` / `web-build` key appears in the
  corresponding `*.example` file.

This keeps the manifest, `wrangler.jsonc`, and the `*.example` templates
from drifting as new variables are added (including future
feature-specific ones).

### 5. Local ergonomics

Additive `Makefile` target (does **not** alter existing deploy targets):

```make
preflight: ## Validate config for a target env (ENV=local|staging|production)
	node scripts/preflight.mjs --env $(or $(ENV),local)
```

So a maintainer setting up a new white-label environment runs
`make preflight ENV=staging`, gets the exact list of what's missing, and
fixes it before pushing.

## Alternatives Considered

1. **A bash + `jq` script.** *Rejected:* `wrangler.jsonc` is JSONC
   (comments) and `jq` can't parse it without a pre-strip; coherence
   logic (URL parsing, origin matching) is awkward in bash. Node is
   already the toolchain and parses everything cleanly.
2. **Fold validation into the deploy step itself** (inline checks in the
   YAML). *Rejected:* not runnable locally, duplicated across both
   workflows, and hard to unit-test. A separate script is testable and
   shared.
3. **No manifest — hardcode the required set in the script.** *Rejected:*
   the required set must be the single source of truth that the
   `*.example` files and `wrangler.jsonc` are checked against; a data
   manifest makes drift-checking and future additions trivial.
4. **A live smoke test after deploy instead of preflight.** *Complementary,
   not a replacement:* a post-deploy health check catches runtime breaks
   but only *after* shipping a bad config; preflight catches them before.
   A smoke test can be a later, separate addition.
5. **Validate secret *values*, not just presence.** *Rejected:* we will
   not pull secret values into CI logs/memory; presence-by-name is the
   safe, sufficient check (a wrong value is caught by the smoke test, not
   by leaking it into preflight).
6. **Extend `create-secrets.sh` to also validate.** *Rejected:* that
   script *sets* one secret interactively; validation is a read-only,
   all-scopes concern with a different shape. They stay separate (and
   `create-secrets.sh` remains the "fix it" companion).

## Implementation Plan

Estimated total: **~1.5–2 dev days.**

### Phase 1 — Manifest + validator core (~0.75 d)
- Author `config/deployment.manifest.jsonc` from the current
  `wrangler.jsonc` + `.dev.vars.example` + `deploy-web.yml` env.
- Implement `scripts/preflight.mjs`: JSONC parse of `wrangler.jsonc`,
  presence checks for vars + secrets (`wrangler secret list --json`),
  checklist output, exit codes. No coherence yet.
- Unit tests on the pure logic (presence, exit-code mapping) with
  fixtures.

### Phase 2 — Coherence + policy + drift (~0.5 d)
- Coherence anchors (`apiHost`, `webOrigin`) and the `coheres` /
  `contains` checks.
- `no-wildcard-in-prod-staging` policy check.
- `--check-drift` (manifest ↔ `wrangler.jsonc` ↔ `*.example`).
- Manual-reminder output (Google console) with the `2` exit semantics.

### Phase 3 — CI wiring + docs (~0.5 d)
- Add the `preflight` gate job to `deploy-web.yml` and `deploy-api.yml`;
  make `deploy-*` `needs:` it; add `--check-drift` to `verify`.
- Add the `make preflight` target.
- Document the workflow in the RFC's wake (README / runbook): "adding a
  new env var → add it to the manifest + the relevant `*.example`".

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| **`wrangler secret list` needs CF credentials** — preflight can't fully run without them | In CI the GitHub Environment supplies `CF_API_TOKEN`/`CF_ACCOUNT_ID`; locally it uses the dev's `wrangler login`. If creds are absent, secret presence is reported as **skipped (⚠️)**, not passed — never a false green. |
| Manifest becomes another thing to keep in sync | The `--check-drift` mode makes drift a **failing CI check**, so the manifest, `wrangler.jsonc`, and `*.example` are forced to agree rather than relying on discipline. |
| False sense of safety (presence ≠ correctness) | Scope is explicit: preflight proves *present + coherent + policy-compliant*, not *functionally correct*. The Google-console reminder and the (future, separate) post-deploy smoke test cover what config-static checks can't. |
| Coherence rules could be over-strict and block legitimate setups | Anchors/links are declared in the manifest, not hardcoded; an env with a deliberately different topology can relax a link there. Rules ship conservative and are reviewed against the three current environments. |
| Extra CI job adds latency to deploys | The job is seconds (parse + a couple of `wrangler`/`gh` list calls) and runs in parallel after `verify`; it gates only the deploy jobs. |
| Leaking secrets into logs | Hard rule, enforced in code + review: presence-by-name only; values are never read, compared, or printed. |

## Success Criteria

- `make preflight ENV=staging` (and `production`, `local`) prints a
  grouped checklist and exits `0` only when every required var/secret is
  present, coherent, and policy-compliant for that env.
- Removing a required secret from an environment (or pointing
  `WEB_BASE_URL` at the wrong host, or leaving `*` in a staging
  `ALLOWED_ORIGINS`) makes the **CI `preflight` job fail and blocks the
  deploy**, with a message naming the exact key/rule.
- Secret **values never appear** in any output or log — only
  present/absent by name.
- Adding a new variable without updating the manifest **or** the
  matching `*.example` fails `--check-drift` in `verify`.
- The happy-path pipeline (fully-configured environment) deploys exactly
  as today, with the gate passing silently.
- A maintainer can stand up a **new white-label environment** by running
  `make preflight` and resolving the checklist, with no tribal knowledge.

## Open Questions

1. **Does `2` (manual reminders / skipped secret-listing) block a
   deploy, or only warn?** Proposed: warn locally, but in CI treat
   "secret-listing skipped" as a hard fail (creds should always be
   present in the deploy environment).
2. **GitHub Environment `vars`/secrets check via `gh api`** — include the
   `ci-secrets` scope now, or defer (it needs a token with repo-admin
   read)? Proposed: best-effort, skipped-with-notice if unavailable.
3. **A future `--fix` / interactive mode** that shells into
   `create-secrets.sh` for each missing secret — in scope later, or keep
   provisioning strictly separate? Proposed: separate for now.
4. **Post-deploy smoke test** (`/health`, an OAuth round-trip) — a
   sibling follow-up RFC, or a Phase 4 here? Proposed: separate; this RFC
   stays pre-deploy/config-static.
5. **Manifest format** — `jsonc` (matches `wrangler.jsonc`, comments for
   rationale) vs a typed `manifest.ts` (type-checked, importable by the
   validator). Proposed: start `jsonc`; revisit if the validator wants
   compile-time guarantees.

## References

- Worker vars (per env): `apps/api/wrangler.jsonc:17`, `:100`
- Worker secrets (out-of-band): `apps/api/.dev.vars.example`,
  `scripts/create-secrets.sh`
- Web build env in CI: `.github/workflows/deploy-web.yml:79-83`, `:121-124`
- API deploy pipeline: `.github/workflows/deploy-api.yml`
- CORS policy contract (no wildcards in staging/prod): CLAUDE.md,
  `docs/product/backlog/cors/`, `apps/api/src/core/cors/`
- Brand variables this validates (sibling): **RFC 0006**
- Existing helper scripts: `scripts/create-secrets.sh`,
  `scripts/bootstrap-first-admin.sh`, `scripts/info.sh`
