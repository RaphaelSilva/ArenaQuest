# RFC 0007: White-label environment bring-up — label profiles, scaffolding & preflight checklist

**Date:** 2026-06-19
**Revised:** 2026-06-25
**Status:** Draft
**Author:** raphaelsilva
**Affected:**
- `config/labels/<label>.jsonc` (**new** — per-label deployment profile; single source of truth for *one* label's anchors)
- `config/deployment.schema.jsonc` (**new** — shared contract: which keys exist, which are secret vs. var, coherence anchors, policy rules, derivations)
- `scripts/label.mjs` (**new** — the CLI: `new` | `scaffold` | `check` subcommands)
- `apps/api/wrangler.jsonc` (scaffolder appends an `env.<label>` / `env.<label>-staging` block — existing `staging`/`production` blocks untouched)
- `.github/workflows/deploy-web.yml` + `deploy-api.yml` (scaffolder appends a per-label build/target stanza — **no gate job; deploy behaviour unchanged**)
- `apps/api/.dev.vars.example`, `apps/web/.env.example` (the schema is checked against them so they can't drift)
- `scripts/create-secrets.sh` (referenced as the "fix-it" companion the checklist points at for missing secrets)
- `Makefile` (additive `label-new`, `label-scaffold`, `label-check` targets — existing deploy targets untouched)
- `docs/product/RFCs/README.md` (index/title entry)

> **Relationship to RFC 0006.** RFC 0006 (white-label branding) defines
> the *mechanism* — the build-time `NEXT_PUBLIC_BRAND_*` variables that
> bake one brand into one bundle. This RFC owns the *operations* of
> actually **standing a whole new branded deployment up**: a second
> tenant of the same codebase, with its own backend host, web origin,
> Cloudflare resources, OAuth client and secrets. 0006 makes a brand
> *possible*; this makes bringing a brand *online* repeatable and
> checkable instead of tribal.

---

## Summary

Today ArenaQuest is deployed (staging + production). The next step is a
**second white-label tenant — "SpazioRD" — with a brand-new backend and
frontend, different URLs, and its own secrets.** Doing that today means
hand-editing `wrangler.jsonc`, copy-pasting hosts into four places,
creating Cloudflare resources by memory, running `wrangler secret put`
for each secret, registering a Google OAuth client, and *hoping* nothing
was missed — failures surface only when a user hits a 500.

This RFC adds a **local, on-demand white-label bring-up workflow** built
around three pieces:

1. **A per-label profile** (`config/labels/spaziord.jsonc`) — the single
   source of truth for *that label's* anchors: brand values, the API host
   and web origin per environment, the names of its Cloudflare resources,
   and its mail/OAuth identity. Two anchors (`apiHost`, `webOrigin`) drive
   everything else.
2. **A scaffolder** (`make label-scaffold LABEL=spaziord`) — generates
   the coherent boilerplate *from* the profile: the `env.spaziord` block
   in `wrangler.jsonc` (all the cross-referencing vars **derived** from
   the anchors, so they agree by construction), the per-label stanza in
   the deploy workflows, and the env templates. It does **not** create
   Cloudflare resources or push secrets — those stay manual.
3. **A checklist/validator** (`make label-check LABEL=spaziord ENV=staging`)
   — runs locally against the target and prints a grouped pass/fail
   checklist over three surfaces: **config keys** (present + coherent +
   policy-compliant), **Cloudflare resources** (Worker, Pages, D1, KV, R2
   actually exist for this label), and **external manual steps** (Google
   OAuth client + redirect, DNS/custom domain, Resend sender). For a
   not-yet-complete label it prints *exactly the commands and values* to
   fix each gap.

It is **local-first and on-demand** — you run it on your machine with
`wrangler login`. There is **no CI gate**; this never blocks or replaces
the existing deploy pipeline. It is a *bring-up assistant*, not a
deployer.

## Motivation

The concrete trigger: **stand up SpazioRD.** Same code as ArenaQuest, but
a fully separate deployment — its own Worker (`api-spaziord*`), its own
Pages project (`spaziord-web*`), its own D1/KV/R2, its own domain, its own
Google OAuth client, its own secrets. "Configure a new tenant" is today an
undocumented, multi-surface, error-prone ritual, and every failure mode is
silent until first use:

- A host typed into `wrangler.jsonc` but not the matching place in
  `deploy-web.yml` → the web build points at the wrong API.
- `GOOGLE_REDIRECT_URI` for the new host not registered in a *new* Google
  OAuth client → login 500s the first time someone tries it.
- `ALLOWED_ORIGINS` left as ArenaQuest's origin → every SpazioRD API call
  CORS-blocked in the browser.
- A secret (`JWT_SECRET`, `R2_*`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`)
  never `wrangler secret put` for `--env spaziord` → 500 on the feature
  that needs it.
- A Cloudflare resource (the `spaziord-media` bucket, the `spaziord-db`
  D1) never created → the Worker boots but the first DB/R2 call fails.
- A `*` wildcard copy-pasted into a staging/prod `ALLOWED_ORIGINS` → the
  security regression the CORS contract explicitly forbids.

None of these is caught by anything today. The knowledge of "what a
complete tenant needs" lives in one person's head. The cost of getting it
wrong is a broken launch and a debugging session against production.

The leverage: make the *shape* of a complete label **data** (the schema),
make *one label's values* **data** (the profile), **generate** the
fiddly coherent boilerplate from those, and give a **single command that
lists what's still missing** — with the fix for each item. Bring-up goes
from tribal to a checklist anyone can run.

## Goals & Non-Goals

**Goals**
- **A per-label profile** (`config/labels/<label>.jsonc`) as the single
  source of truth for one tenant's anchors, so a new label is *described*
  in one file, not scattered across five.
- **Coherence by construction** — derive the cross-referencing config
  (`ALLOWED_ORIGINS`, `WEB_BASE_URL`, `GOOGLE_REDIRECT_URI`,
  `NEXT_PUBLIC_API_URL`, `R2_*`) from two anchors per environment
  (`apiHost`, `webOrigin`) so they *cannot* disagree when generated.
- **A scaffolder** that writes the `wrangler.jsonc` env block, the deploy
  workflow stanza, and the env templates for a new label from its profile.
- **A local checklist** (`make label-check LABEL=… ENV=…`) covering three
  surfaces — **config keys**, **Cloudflare resources**, **external manual
  steps** — that reports pass/fail/⚠️ per item and, for every gap, the
  exact command or value to resolve it.
- **Secret presence without secret exposure** — verify secret *names* per
  label via `wrangler secret list --env <label>`; never read, log, or
  compare values.
- **A shared contract/schema** that classifies every key (secret vs. var
  vs. build), its coherence anchor, and its policy constraint — checked
  against the `*.example` files so they can't silently drift.

**Non-Goals**
- **A CI gate.** This RFC adds **no** gate job and changes **no** deploy
  behaviour. The existing GitHub Actions pipeline keeps owning build &
  deploy untouched. (Discussed and explicitly dropped — see Alternatives.)
- **Creating Cloudflare resources or pushing secrets automatically.** The
  scaffolder emits config and *prints the commands*; provisioning stays a
  human action (`wrangler d1 create …`, `create-secrets.sh … --env …`).
- **Validating third-party state we can't trust an API for** — e.g.
  whether the redirect URI is actually registered in the Google console,
  whether DNS has propagated, whether the Resend domain is verified. These
  are emitted as **manual-confirmation items** with the exact value to
  register, not asserted green.
- **Runtime health checks / smoke tests** of a live deployment. Separate
  concern; this is pre-deploy/config-static.
- **Owning a feature's variables.** RFC 0006 owns the brand vars; others
  own theirs. The schema validates *whatever it lists*.
- **Secret rotation / management.** Out of scope.

## Current State (for reference)

`apps/api/wrangler.jsonc` has exactly two environments today, both
ArenaQuest: the top-level block (**production**) and `env.staging`. There
is no notion of a *second tenant*. The config surfaces a new label must
satisfy:

| Surface | Where it lives | Per-label examples for SpazioRD | Stood up by? |
|---|---|---|---|
| Web build (`NEXT_PUBLIC_*`) | CI `env:` in `deploy-web.yml`; `.env.example` | `NEXT_PUBLIC_API_URL` → new API host, `NEXT_PUBLIC_BRAND_*` → SpazioRD brand | hand-edit |
| Worker `vars` | `wrangler.jsonc` per env | `ALLOWED_ORIGINS`, `WEB_BASE_URL`, `GOOGLE_REDIRECT_URI`, `R2_*`, `MAIL_*`, `COOKIE_SAMESITE` | hand-edit |
| Worker secrets | `wrangler secret put --env <label>` | `JWT_SECRET`, `R2_ACCESS_KEY_ID/SECRET`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY` | manual, by memory |
| Cloudflare resources | `wrangler d1/kv/r2 create` | `spaziord-db*`, `RATE_LIMIT_KV`, `spaziord-media*`, Worker, Pages project | manual, by memory |
| External | third-party consoles | Google OAuth client + redirect, DNS/custom domain, Resend sender domain | manual, by memory |

Note a real ambiguity the current repo carries: in `env.staging`,
`GOOGLE_CLIENT_ID` is *commented out* (treated as a var) while
`GOOGLE_CLIENT_SECRET` is a secret. Nobody has decided which it is. The
schema (below) resolves this explicitly: `GOOGLE_CLIENT_ID` → **api-var**
(not sensitive), `GOOGLE_CLIENT_SECRET` → **api-secret**.

The CORS policy (no wildcards in staging/prod — CLAUDE.md,
`docs/product/backlog/cors/`) is enforced only by review today.

## Proposed Design

### 1. Two data files: the shared schema and the per-label profile

**`config/deployment.schema.jsonc` — the contract (one, shared by all
labels).** Declares every key, its class (`secret` | `var` | `build`),
which environment anchor it derives from, and any policy. It carries *no
values* — it is the shape and the rules:

```jsonc
{
  "build": {
    "NEXT_PUBLIC_API_URL":   { "required": true,  "derivedFrom": "apiHost" },
    "NEXT_PUBLIC_LANGUAGE":  { "required": false, "enum": ["pt", "en"] },
    "NEXT_PUBLIC_BRAND_SIGLA":       { "required": true,  "from": "brand" },
    "NEXT_PUBLIC_BRAND_NAME_PREFIX": { "required": true,  "from": "brand" },
    "NEXT_PUBLIC_BRAND_NAME_ACCENT": { "required": false, "from": "brand" },
    "NEXT_PUBLIC_BRAND_POWERED_BY":  { "required": false, "from": "brand", "enum": ["", "true", "false"] },
    "NEXT_PUBLIC_BRAND_ACCENT":      { "required": false, "from": "brand" }
  },
  "api-vars": {
    "ALLOWED_ORIGINS":     { "required": true,  "derivedFrom": "webOrigin", "policy": "no-wildcard-in-prod-staging" },
    "WEB_BASE_URL":        { "required": true,  "derivedFrom": "webOrigin" },
    "GOOGLE_REDIRECT_URI": { "required": true,  "derivedFrom": "apiHost", "manual": "register in the label's Google OAuth client" },
    "GOOGLE_CLIENT_ID":    { "required": true },
    "COOKIE_SAMESITE":     { "required": true,  "enum": ["Strict", "Lax", "None"] },
    "R2_S3_ENDPOINT":      { "required": true,  "from": "r2" },
    "R2_BUCKET_NAME":      { "required": true,  "from": "r2" },
    "R2_PUBLIC_BASE":      { "required": false, "from": "r2" },
    "MAIL_DRIVER":         { "required": true,  "enum": ["resend", "console", ""] },
    "MAIL_FROM":           { "required": true }
  },
  "api-secrets": {
    "JWT_SECRET":            { "required": true },
    "R2_ACCESS_KEY_ID":      { "required": true },
    "R2_SECRET_ACCESS_KEY":  { "required": true },
    "GOOGLE_CLIENT_SECRET":  { "required": true },
    "RESEND_API_KEY":        { "required": true, "requiredWhen": "MAIL_DRIVER=resend" }
  },
  "cf-resources": {
    "worker":       { "check": "wrangler deployments / name" },
    "pagesProject": { "check": "wrangler pages project list" },
    "d1":           { "check": "wrangler d1 list" },
    "kv":           { "check": "wrangler kv namespace list" },
    "r2":           { "check": "wrangler r2 bucket list" }
  },
  "external": {
    "google-oauth": { "confirm": "Web OAuth client created; <GOOGLE_REDIRECT_URI> is an Authorised redirect URI" },
    "dns":          { "confirm": "Custom domains for <apiHost> and <webOrigin> resolve / are attached" },
    "resend":       { "confirm": "Sender domain of <MAIL_FROM> verified in Resend", "requiredWhen": "MAIL_DRIVER=resend" }
  }
}
```

**`config/labels/spaziord.jsonc` — the profile (one per label).** Fills in
the anchors. The author writes a handful of facts; everything else is
derived:

```jsonc
{
  "label": "spaziord",
  "displayName": "SpazioRD",
  "brand": {
    "NEXT_PUBLIC_BRAND_SIGLA": "SRD",
    "NEXT_PUBLIC_BRAND_NAME_PREFIX": "Spazio",
    "NEXT_PUBLIC_BRAND_NAME_ACCENT": "RD",
    "NEXT_PUBLIC_BRAND_POWERED_BY": "true",
    "NEXT_PUBLIC_BRAND_ACCENT": "#1e6fff"
  },
  "environments": {
    "staging": {
      "apiHost":      "api-spaziord-staging.<acct>.workers.dev",
      "webOrigin":    "spaziord-web-staging.pages.dev",
      "worker":       "api-spaziord-staging",
      "pagesProject": "spaziord-web-staging",
      "d1":   { "name": "spaziord-db-staging", "id": "<fill after `wrangler d1 create`>" },
      "kv":   { "binding": "RATE_LIMIT_KV", "id": "<fill after `wrangler kv namespace create`>" },
      "r2":   { "bucket": "spaziord-media-staging", "s3Endpoint": "https://<acct>.r2.cloudflarestorage.com" },
      "cookieSameSite": "None",
      "mail": { "driver": "resend", "from": "SpazioRD Staging <noreply@spaziord.app>" }
    },
    "production": {
      "apiHost":      "api.spaziord.app",
      "webOrigin":    "app.spaziord.app",
      "worker":       "api-spaziord",
      "pagesProject": "spaziord-web",
      "d1":   { "name": "spaziord-db", "id": "<fill after create>" },
      "kv":   { "binding": "RATE_LIMIT_KV", "id": "<fill after create>" },
      "r2":   { "bucket": "spaziord-media", "s3Endpoint": "https://<acct>.r2.cloudflarestorage.com" },
      "cookieSameSite": "Strict",
      "mail": { "driver": "resend", "from": "SpazioRD <noreply@spaziord.app>" }
    }
  }
}
```

The profile is the **only** place per-label values are written. The schema
is the **only** place the contract/rules live. Neither duplicates the
other.

### 2. Coherence by construction — derive, don't copy

The class of bugs in the Motivation (wrong host in one of four places)
exists because those values are *independently hand-typed*. Here, each
environment declares **two anchors** and the rest is computed:

| Generated key | Derived from | Example (SpazioRD staging) |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `apiHost` | `https://api-spaziord-staging.<acct>.workers.dev` |
| `GOOGLE_REDIRECT_URI` | `apiHost` | `https://api-spaziord-staging.<acct>.workers.dev/auth/google/callback` |
| `WEB_BASE_URL` | `webOrigin` | `https://spaziord-web-staging.pages.dev` |
| `ALLOWED_ORIGINS` | `webOrigin` (+ staging preview wildcard + localhost) | `https://spaziord-web-staging.pages.dev,https://*.spaziord-web-staging.pages.dev,http://localhost:3000` |
| `R2_S3_ENDPOINT` / `R2_BUCKET_NAME` / `R2_PUBLIC_BASE` | `r2` | from the profile's `r2` block |

Because the scaffolder *emits* these and the checker *re-derives and
diffs* them, they are coherent when written and proven still-coherent on
every check. Staging gets the `*.pages.dev` preview wildcard + localhost;
**production is exact-origin only** — the policy rule is applied at
generation time, so a wildcard can't leak into prod.

### 3. The CLI — `scripts/label.mjs` (Node ESM)

Node is already the toolchain and parses JSONC (`wrangler.jsonc`, the
schema, the profile) cleanly. Three subcommands:

- **`new <label>`** → writes a `config/labels/<label>.jsonc` skeleton with
  every anchor stubbed (`<fill …>`) and the brand block ready to edit.
  (`make label-new LABEL=spaziord`.)
- **`scaffold <label>`** → reads the profile + schema and **generates**:
  - the `env.<label>` / `env.<label>-staging` block appended to
    `apps/api/wrangler.jsonc` (D1/KV/R2 bindings + the derived `vars`);
  - the per-label build/target stanza in `deploy-web.yml` / `deploy-api.yml`
    (the `NEXT_PUBLIC_*` build env + Pages project / Worker `--env`);
  - optional `apps/api/.dev.vars.<label>.example` for local runs against
    the label.
  It writes config only — it prints, but never runs, the `wrangler …
  create` and `create-secrets.sh … --env <label>` commands.
  (`make label-scaffold LABEL=spaziord`.)
- **`check <label> --env <staging|production>`** → the checklist (next
  section). (`make label-check LABEL=spaziord ENV=staging`.)

### 4. The checklist — three surfaces, fix-it for every gap

`make label-check LABEL=spaziord ENV=staging` resolves the target and
prints a grouped checklist. **Config keys:** `api-vars` parsed from the
`env.spaziord-staging` block of `wrangler.jsonc`; `build` from the deploy
workflow stanza (and/or profile); `api-secrets` by **name** from
`wrangler secret list --env spaziord-staging` (presence only, values never
read). **Cloudflare resources:** the names in the profile are matched
against `wrangler d1 list`, `wrangler kv namespace list`,
`wrangler r2 bucket list`, Pages/Worker listings. **External:** emitted as
⚠️ manual-confirm items carrying the exact value to register.

Each check is **present + coherent + policy-compliant**: presence (every
`required` / active `requiredWhen` key resolves non-empty), coherence
(re-derive from anchors and assert the committed/live value matches),
policy (`no-wildcard-in-prod-staging` rejects `*`/multi-label wildcards in
those envs). For a brand-new label, output looks like:

```
SpazioRD — staging
  api-vars
    ✅ ALLOWED_ORIGINS        coherent with webOrigin, policy ok
    ✅ WEB_BASE_URL           coherent with webOrigin
    ❌ GOOGLE_CLIENT_ID       missing in env.spaziord-staging.vars
  api-secrets   (wrangler secret list --env spaziord-staging)
    ❌ JWT_SECRET             not set   → scripts/create-secrets.sh JWT_SECRET --env spaziord-staging
    ❌ GOOGLE_CLIENT_SECRET   not set   → scripts/create-secrets.sh GOOGLE_CLIENT_SECRET --env spaziord-staging
    ❌ RESEND_API_KEY         not set   → scripts/create-secrets.sh RESEND_API_KEY --env spaziord-staging
  cf-resources
    ❌ d1   spaziord-db-staging   not found → wrangler d1 create spaziord-db-staging  (then paste id into the profile)
    ❌ r2   spaziord-media-staging not found → wrangler r2 bucket create spaziord-media-staging
  external (manual — confirm)
    ⚠️  google-oauth  register https://api-spaziord-staging.<acct>.workers.dev/auth/google/callback as an Authorised redirect URI
    ⚠️  resend        verify sender domain spaziord.app in Resend

Summary: 6 missing, 2 manual confirmations.  Exit 1.
```

**Exit codes:** `0` all present/coherent; `1` any hard gap (missing /
incoherent / policy violation); `2` only manual confirmations outstanding.
Secret **values never appear** — only the name and present/absent.

### 5. Drift guard for the shared `*.example`

A light `check --schema` mode asserts every required `build` /
`api-secrets` key in the schema appears in the corresponding `*.example`
template, so adding a variable to the contract without updating the
template fails the check. (Run on demand; **not** wired into CI.)

### 6. Local ergonomics

Additive `Makefile` targets — existing deploy targets untouched:

```make
label-new:       ## Create a label profile skeleton (LABEL=spaziord)
	node scripts/label.mjs new $(LABEL)
label-scaffold:  ## Generate wrangler/workflow/env boilerplate from the profile (LABEL=spaziord)
	node scripts/label.mjs scaffold $(LABEL)
label-check:     ## Checklist of what's missing for a label (LABEL=spaziord ENV=staging|production)
	node scripts/label.mjs check $(LABEL) --env $(or $(ENV),staging)
```

## Worked example — standing up SpazioRD

The end-to-end path the RFC optimises for:

1. `make label-new LABEL=spaziord` → edit `config/labels/spaziord.jsonc`:
   brand values + the two anchors (`apiHost`, `webOrigin`) and resource
   names per environment.
2. `make label-scaffold LABEL=spaziord` → the `env.spaziord` /
   `env.spaziord-staging` block lands in `wrangler.jsonc` (all derived
   vars coherent), the deploy workflows get the SpazioRD build stanza, and
   the command list to run is printed.
3. Run the printed provisioning commands by hand:
   `wrangler d1 create spaziord-db-staging`,
   `wrangler kv namespace create RATE_LIMIT_KV`,
   `wrangler r2 bucket create spaziord-media-staging` → paste the returned
   ids into the profile; create the Pages project; create a **new** Google
   OAuth client and register the redirect URI;
   `scripts/create-secrets.sh <NAME> --env spaziord-staging` for each
   secret.
4. `make label-check LABEL=spaziord ENV=staging` → iterate until the
   checklist is all ✅ (with ⚠️ manual items acknowledged). Now deploy via
   the existing pipeline — unchanged.
5. Repeat step 4 with `ENV=production` before the production cutover.

No tribal knowledge: the profile *is* the spec, and the checklist *is* the
runbook.

## Alternatives Considered

1. **A CI gate that blocks deploys on bad config** (the original framing
   of this RFC). *Dropped on the maintainer's call:* the value wanted is a
   **local, on-demand** answer to "what's left to configure for this new
   label", not a pipeline change. A gate is a possible *future* follow-up,
   but it is explicitly out of scope here and the deploy workflows are not
   given a gate job.
2. **Hand-edit `wrangler.jsonc` + workflows per label (status quo).**
   *Rejected:* exactly the multi-surface, silent-failure ritual this RFC
   removes; doesn't scale past one tenant.
3. **A branch/fork per label.** *Rejected:* duplicates the codebase and
   makes shipping a fix to all tenants N PRs; brand is build-time data
   (RFC 0006), so labels are *deployment profiles*, not code forks. One
   repo, per-label profiles, one `wrangler.jsonc` with per-label `env`
   blocks.
4. **Generate everything at deploy time from the profile (no committed
   `wrangler.jsonc` blocks).** *Rejected for now:* committed env blocks
   keep `wrangler` working normally and stay reviewable in PRs; the
   scaffolder writing them (vs. a build-time transform) is simpler and
   auditable. Revisit if the number of labels makes the file unwieldy.
5. **One global manifest of required keys (no per-label profile).**
   *Rejected:* the required *shape* is shared (→ schema), but the *values*
   are per-tenant; conflating them is what makes a second label hard. The
   split (schema = contract, profile = one label's values) is the core of
   the design.
6. **Bash + `jq`.** *Rejected:* `wrangler.jsonc`/profile are JSONC; host
   derivation and origin matching are awkward in bash. Node parses
   everything and is already the toolchain.
7. **Validate secret *values*, not just presence.** *Rejected:* never pull
   secret values into logs/memory; presence-by-name per `--env <label>` is
   the safe, sufficient check.

## Implementation Plan

Estimated total: **~2–2.5 dev days.**

### Phase 1 — Schema + profile + `check` core (~0.75 d)
- Author `config/deployment.schema.jsonc` from the current
  `wrangler.jsonc` + `.dev.vars.example` + `deploy-web.yml`; resolve the
  `GOOGLE_CLIENT_ID` var-vs-secret ambiguity (→ var).
- Implement `scripts/label.mjs check`: JSONC parse, presence checks for
  `api-vars` + `build` + `api-secrets` (via `wrangler secret list --env`),
  grouped checklist + fix-it lines + exit codes. No coherence yet.
- Unit tests on the pure logic (presence, derivation, exit-code mapping)
  with fixtures.

### Phase 2 — Coherence + policy + CF resources + external (~0.75 d)
- Derivation anchors (`apiHost`, `webOrigin`, `r2`, `brand`) and the
  derive-and-diff coherence checks.
- `no-wildcard-in-prod-staging` policy.
- `cf-resources` presence via `wrangler d1/kv/r2/pages` list calls.
- `external` manual-confirm items with the exact value to register; `2`
  exit semantics.

### Phase 3 — Scaffolder + `new` + docs (~0.75 d)
- `label.mjs new` (profile skeleton) and `label.mjs scaffold` (append
  `env.<label>` to `wrangler.jsonc`, the workflow stanza, the env
  template; print provisioning commands).
- `check --schema` drift guard for the `*.example` files.
- `Makefile` targets; a **new-label runbook** in `docs/` mirroring the
  SpazioRD worked example.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| **`wrangler` calls need CF credentials** — `check` can't fully run without them. | It runs locally with the maintainer's `wrangler login`. If creds are absent, secret/resource presence is reported **skipped (⚠️)**, never passed — no false green. |
| Profile + schema are two more files to keep in sync with `wrangler.jsonc`. | The scaffolder *generates* the `wrangler.jsonc` block from the profile, and `check` re-derives & diffs — drift surfaces as a failing item rather than relying on discipline. |
| Presence ≠ correctness (a secret can be present but wrong). | Scope is explicit: this proves *present + coherent + policy-compliant*, not *functionally correct*. The external manual items and a future, separate smoke test cover the rest. |
| Derivation could be over-strict for a label with deliberately different topology. | Anchors live in the profile, not hardcoded; an unusual label overrides them there. Rules ship conservative, validated against ArenaQuest's two existing environments. |
| Scaffolder editing `wrangler.jsonc` / workflows could clobber hand edits. | It **appends** a clearly-delimited `env.<label>` block and a per-label stanza; it never rewrites the existing ArenaQuest blocks. Re-running is idempotent (regenerates only the label's block). |
| Leaking secrets into output. | Hard rule, enforced in code + review: presence-by-name only; values are never read, compared, or printed. |

## Success Criteria

- `make label-new LABEL=spaziord` + editing two anchors per env +
  `make label-scaffold LABEL=spaziord` produces a coherent
  `env.spaziord*` block in `wrangler.jsonc` and a SpazioRD stanza in the
  deploy workflows, with the cross-referencing hosts agreeing **by
  construction**.
- `make label-check LABEL=spaziord ENV=staging` prints a grouped
  checklist over config keys, Cloudflare resources, and external steps,
  and for every gap prints the exact command/value to fix it; it exits `0`
  only when the label is fully present, coherent, and policy-compliant.
- A `*` wildcard in a staging/production `ALLOWED_ORIGINS`, a missing
  per-label secret, or a `WEB_BASE_URL` that doesn't match the profile's
  `webOrigin` is reported as a **named failure**.
- Secret **values never appear** in any output — only present/absent by
  name.
- A maintainer can stand up **SpazioRD** (and any future label) from the
  profile + the checklist alone, with no tribal knowledge — and the
  **existing ArenaQuest deploy pipeline is byte-for-byte unchanged**.

## Open Questions

1. **Does the scaffolder write resource ids back into the profile, or does
   the maintainer paste them?** Proposed: paste for now (the `wrangler …
   create` output has the id); a `label.mjs adopt` that reads back the ids
   is a later nicety.
2. **`production` anchors as `*.workers.dev`/`*.pages.dev` vs. custom
   domains.** SpazioRD will likely use `api.spaziord.app` / `app.spaziord.app`;
   the profile supports either, but custom domains add the DNS manual item.
   Proposed: profile carries whatever the label uses; DNS stays a manual
   confirm.
3. **A future `--fix` mode** that runs the printed `create-secrets.sh` /
   `wrangler create` commands for you. Proposed: keep provisioning a human
   action for now; revisit once there are ≥3 labels.
4. **Per-label local dev** (`make label-check LABEL=spaziord ENV=local`
   against a `.dev.vars.spaziord`). Proposed: out of scope here; the local
   path is a small later add if needed.
5. **A CI gate as a follow-up RFC** once the local workflow is proven.
   Proposed: separate RFC if/when wanted — deliberately not here.

## References

- Existing two-tenant config: `apps/api/wrangler.jsonc` (top-level =
  production, `env.staging`)
- Worker secrets (out-of-band): `apps/api/.dev.vars.example`,
  `scripts/create-secrets.sh`
- Web build env in CI: `.github/workflows/deploy-web.yml:79-89`, `:130-138`
- API deploy pipeline: `.github/workflows/deploy-api.yml`
- CORS policy contract (no wildcards in staging/prod): CLAUDE.md,
  `docs/product/backlog/cors/`, `apps/api/src/core/cors/`
- Brand mechanism this operationalises: **RFC 0006**
- Existing helper scripts: `scripts/create-secrets.sh`,
  `scripts/bootstrap-first-admin.sh`, `scripts/info.sh`
