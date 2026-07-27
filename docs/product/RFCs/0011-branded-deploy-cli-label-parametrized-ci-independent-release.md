# RFC 0011: Branded deploy CLI - label-parametrized CI-independent release script

**Date:** 2026-07-23
**Revised:** 2026-07-27
**Status:** Approved
**Author:** raphaelsilva
**Affected:**
- `scripts/deploy/core.mjs` (new) — the **cloud-agnostic** core (Node, stdlib only): arg parsing, label resolution, preflight, secret prompting, prod confirmation. Knows brands and environments; knows nothing about any cloud.
- `scripts/cloudflare/deploy.mjs` (new) — the **Cloudflare entrypoint + adapter** (`#!/usr/bin/env node`): imports `core.mjs` and executes the resolved plan by spawning `wrangler` (`d1 migrations apply`, `deploy`, `pages deploy`) via `child_process`. A future provider is a sibling `scripts/<cloud>/deploy.mjs`, not a fork.
- `scripts/lib/log.mjs` (new) — small JS logging module mirroring the `ok`/`warn`/`fail`/`die` vocabulary of `scripts/lib/log.sh`, so the Node scripts read like the shell ones without shelling out to them.
- `scripts/label.mjs` — reused (not forked) for config resolution: `deriveExpected`, `buildResolved`, `checkPresence`, `checkCoherence`, `checkPolicy`, `mapExitCode`.
- `config/labels/<label>.jsonc`, `config/deployment.schema.jsonc` — the single source of truth the CLI reads; no new per-brand config format is introduced.
- `Makefile` — `deploy-*-staging` / `deploy-*-prod` targets become thin wrappers over the CLI.
- `.github/workflows/deploy-api.yml`, `deploy-web.yml` — the copy-pasted per-brand prod jobs collapse into a matrix that calls the same CLI.

---

## Summary

Introduce a label-aware deploy CLI split along the two axes the codebase already treats as
orthogonal — **brand is data** (a label profile) and **cloud is an adapter** (a directory).
A cloud-agnostic core (`scripts/deploy/core.mjs`) resolves *what* to deploy, and a per-cloud
entrypoint (`scripts/cloudflare/deploy.mjs`, a fully Node `.mjs` script) executes *how*. It
takes the target environment and brand as parameters
(`node scripts/cloudflare/deploy.mjs --label spaziord -e staging`) and drives the full release for
that tenant: resolve config from the existing label profile, run the preflight
checklist, apply D1 migrations, and deploy the Worker and Pages project. The single
most important consequence is that **a maintainer can cut a production release for any
brand from their own machine, with the exact same code path CI uses** — the pipeline
stops being a single point of failure, and the three-way duplication we have today
(Makefile targets, per-brand GitHub Actions jobs, and ad-hoc knowledge) collapses to
one tested script. Crucially, it does **not** introduce a parallel `./scripts/<brand>/.env`
config store: brand values already live in `config/labels/<label>.jsonc`, and the CLI
resolves from there, prompting the operator **only** for genuinely missing secrets.

## Motivation

We deploy multiple white-label tenants (ArenaQuest stock, SpazioRD, Budo, and more to
come). Today, releasing any of them means trusting the GitHub pipeline end-to-end. Two
problems make that untenable:

1. **We are hostage to CI.** If the pipeline is degraded, the Cloudflare action is rate-limited,
   or a token rotates, there is no first-class, supported way to push a release by hand.
   The Makefile has `deploy-*-prod` targets, but they hardcode a single database name
   (`wrangler d1 migrations apply arenaquest-db --remote`, `Makefile:224`) and do not
   understand labels at all — they can only ship the stock brand.

2. **Multi-brand deploy is copy-paste that has already rotted.** `.github/workflows/deploy-api.yml`
   duplicates the entire production job per brand (`deploy-production`, `deploy-prod-spaziord`,
   `deploy-prod-budo`), each with a hardcoded database name. The SpazioRD and Budo jobs even
   reference a non-existent action, `cloudflare/wrangler-action@v3raphael` (a typo that would
   fail at runtime), and every new brand means another ~40-line copy of the same stanza. This
   is exactly the class of drift the label system (RFC 0006/0007) was built to eliminate — but
   the *deploy* path never adopted it.

| Case | Covered today? | Covered by this RFC? |
|---|---|---|
| Ship stock ArenaQuest to staging by hand | Yes (`make deploy-staging`) | Yes (CLI, plus preflight) |
| Ship **SpazioRD** to production by hand | No (Makefile is stock-only) | Yes (`--label spaziord -e production`) |
| Add a new brand's prod deploy | Copy ~40 lines of YAML | Add one matrix entry / one CLI flag |
| Verify config is complete before deploying | No (deploy assumes it) | Yes (preflight gate reused from `label.mjs`) |
| CI is down, prod hotfix needed | No supported path | Yes (same script CI runs, run locally) |

## Goals & Non-Goals

**Goals**
- One deploy entrypoint parametrized by **environment** (`-e staging|production`) and
  **brand** (`--label <label>`), runnable locally and from CI, sharing a single code path.
- Establish **Node (`.mjs`, stdlib only) as the standard engine for operational scripts.**
  The CLI is fully Node — arg parsing, config resolution, preflight, and the `wrangler`
  invocations (via `child_process`) — with no bash step layer, so the whole flow is debuggable
  with the Node inspector, unit-testable with `node:test`, and consistent with `label.mjs`.
- Make the deploy path **cloud-agnostic in structure**: a provider-neutral core plus a
  per-cloud entrypoint under `scripts/<cloud>/deploy.mjs`, so adding a second provider later is
  a sibling directory reusing the core — matching the Ports & Adapters split in
  `packages/shared/ports` and `apps/api/src/adapters/*`.
- Reuse the existing single source of truth (`config/labels/<label>.jsonc` +
  `config/deployment.schema.jsonc`) via `scripts/label.mjs`. No new per-brand config format.
- A preflight gate before any mutation: refuse to deploy a label whose required config is
  missing or incoherent (reusing `checkPresence`/`checkCoherence`/`checkPolicy`).
- Prompt interactively **only** for values that legitimately cannot live in the repo (secrets),
  and only when the run is a TTY; fail closed (non-interactive) in CI.
- Honor the repo's naming and safety rules: production is never implicit and always confirms
  (`CONFIRM=1`/`--yes` bypass), matching the `confirm-prod` convention in `Makefile:214`.
- Collapse the duplicated per-brand CI jobs into a matrix over the same CLI.

**Non-Goals**
- Provisioning cloud resources (D1/KV/R2 creation, OAuth client setup). That is `label-scaffold`
  and the RFC 0007 bring-up checklist; deploy assumes the tenant already exists.
- Managing/rotating secrets. The CLI reads secrets from the environment or prompts; setting
  them in Cloudflare stays with `scripts/create-secrets.sh` / `make secret-*`.
- A rollback system. The script only performs a complete, forward deploy of the application
  per brand; re-releasing a prior version is a separate concern, not part of this CLI.
- **Implementing a second cloud provider.** Cloudflare is the only target, and that is fine —
  it is our single, primary cloud. This RFC only makes the *structure* accommodate a future
  provider (a sibling `scripts/<cloud>/deploy.mjs`); building an actual AWS/other adapter is
  out of scope until there is a real second-cloud requirement.
- Replacing the `.env`-per-brand shape the original proposal suggested — see
  Alternatives Considered §1 for why that is intentionally rejected in favor of the label profile.

## Current State (for reference)

- **Makefile deploy targets** are stock-only and environment-named. `deploy-api-staging`
  runs `wrangler deploy --env staging` (`Makefile:181`); `deploy-api-prod` gates on
  `confirm-prod guard-no-dev-seed-prod` then `wrangler deploy` (`Makefile:216`). Every
  database name is hardcoded to the stock brand (`arenaquest-db`, `Makefile:224`). There is
  no `--label` dimension anywhere in the Makefile.
- **GitHub Actions** (`.github/workflows/deploy-api.yml`) has four near-identical prod jobs:
  `deploy-production` (stock), `deploy-prod-spaziord`, `deploy-prod-budo`, each hardcoding a
  database name (`arenaquest-db` / `spaziord-db` / `budo-db`). Two of them reference a
  non-existent action `cloudflare/wrangler-action@v3raphael`. `deploy-web.yml` is the Pages
  counterpart.
- **The label system already exists and is the intended source of truth.** `config/labels/spaziord.jsonc`
  holds every per-tenant value keyed by environment (`worker`, `pagesProject`, `d1.name`,
  `r2.bucket`, `cookieSameSite`, `mail`, brand tokens). `config/deployment.schema.jsonc`
  defines the *shape* and *rules* (which keys exist, their class, their derivation anchor,
  policy constraints) and states explicitly that values live only in the profile — "this file
  and the profile never duplicate each other."
- **`scripts/label.mjs` exposes pure, tested resolvers** the deploy path can call directly:
  `deriveExpected(profile, env)`, `buildResolved(profile, env, expected)`,
  `checkPresence(section, resolved)`, `checkCoherence(expected, actual)`,
  `checkPolicy(allowedOrigins, env)`, and `mapExitCode(results)` (0 clean / 1 hard gap /
  2 soft gap). `make label-check LABEL=spaziord ENV=staging` already renders this checklist.
- **Shared shell vocabulary** lives in `scripts/lib/log.sh` (`ok`/`warn`/`fail`/`die`/`heading`),
  whose icon set matches `label.mjs` so all scripts read alike.

The gap is narrow and specific: the config, the resolver, and the checklist all exist, but
**the deploy step never consumes them** — it lives in a separate, brand-blind Makefile/CI world.

## Proposed Design

### 1. Layout — cloud-agnostic core, per-cloud entrypoint

The original proposal asked for `./script/<brand>/deploy.sh` with shared functions in
`./script/commum`. We keep that *spirit* (one command per operator, shared reusable core)
but restructure along **two axes the codebase already treats as orthogonal**: **brand is
data** (a label profile), and **cloud is an adapter** (a directory). This mirrors the
Ports & Adapters split the repo enforces everywhere else — `packages/shared/ports` defines
cloud-agnostic contracts, and `apps/api/src/adapters/*` implements them per provider. The
deploy path gets the same shape:

```
scripts/
  deploy/
    core.mjs             # (new) CLOUD-AGNOSTIC: arg parse, label resolve, preflight, secret
                         #        prompt, prod confirm. Knows brands + environments, not clouds.
  cloudflare/
    deploy.mjs           # (new) Cloudflare ENTRYPOINT + adapter: imports core.mjs, executes the
                         #        plan by spawning `wrangler` (d1 migrate, worker deploy, pages deploy).
  lib/log.mjs            # (new) JS logging module, mirrors lib/log.sh vocabulary
  lib/log.sh             # (existing) shared shell logging vocabulary — kept for the .sh scripts
  label.mjs              # (existing) pure config resolvers, imported by core.mjs
config/labels/<label>.jsonc   # (existing) the ONLY per-brand values
config/deployment.schema.jsonc# (existing) the shape + rules
```

Two invariants fall out of this:

- **`scripts/<cloud>/deploy.mjs` is the entrypoint you run.** Today the only cloud is
  `cloudflare` — and that is fine; it is our single, primary target. A future provider
  (e.g. `scripts/aws/deploy.mjs`) is a **sibling directory** that reuses the exact same
  `deploy/core.mjs`, not a fork of the whole flow. The cloud-specific surface is narrow:
  the executor that turns the resolved plan into provider commands.
- **`deploy/core.mjs` never imports a cloud SDK or `wrangler`.** It resolves *what* to
  deploy (which brand, which environment, is the config complete, which secrets are
  missing) and hands a plan to the cloud entrypoint, which decides *how*. If `core.mjs`
  ever needed to know it was Cloudflare, the boundary would be wrong.

There is still exactly one `core.mjs` and one `deploy.mjs` per cloud; brands never get
their own copy. `scripts/commum` is unnecessary because that shared core is precisely
`deploy/core.mjs` plus `label.mjs` and the logging module.

The CLI is **fully Node** (`.mjs`, stdlib only — consistent with `label.mjs`): it parses
args, resolves and validates config, and executes the Cloudflare steps by spawning
`wrangler` through `node:child_process`. There is no bash step layer — dropping the "JS
decides / shell executes" split makes the flow debuggable end-to-end under the Node
inspector and testable with `node:test`, and it advances the wider goal of Node being the
app's primary script engine. It is invoked directly (`node scripts/cloudflare/deploy.mjs …`,
or `./scripts/cloudflare/deploy.mjs` via its shebang).

### 2. Interface

```
node scripts/cloudflare/deploy.mjs --label <label> -e <staging|production> [--scope api|web|all] [--yes] [--dry-run]

# examples
node scripts/cloudflare/deploy.mjs --label spaziord -e staging             # SpazioRD → staging, both apps
node scripts/cloudflare/deploy.mjs --label arenaquest -e production --yes   # stock → prod, no prompt (CI)
node scripts/cloudflare/deploy.mjs --label budo -e staging --scope api --dry-run   # print the plan, mutate nothing
```

- `-e` / `--env` accepts only `staging` | `production` (the profile's environment keys). We
  standardize on `staging`, not the proposal's `stage`, to match the profile and Makefile.
- `--label` selects `config/labels/<label>.jsonc`. Required (no implicit brand).
- `--scope` defaults to `all` (api + web); `api` or `web` narrow it.
- Production requires confirmation. `--yes` or `CONFIRM=1` bypasses (matches `confirm-prod`).
- `--dry-run` resolves, runs preflight, and prints the exact `wrangler` commands **without executing**.

### 3. Resolve → Preflight → Deploy (the pipeline)

```
1. parse args                → { label, env, scope, yes, dryRun }
2. load profile              → parseJsonc(config/labels/<label>.jsonc)   [label.mjs]
3. expected = deriveExpected(profile, env)
   resolved = buildResolved(profile, env, expected)
4. PREFLIGHT (fail closed):
     presence  = checkPresence(schema.*, resolved)     // required keys present?
     coherence = checkCoherence(expected, actual)       // derived keys consistent?
     policy    = checkPolicy(resolved.ALLOWED_ORIGINS, env)  // no wildcard in prod/staging
     exit      = mapExitCode([...])   // 1 => hard gap => ABORT before any mutation
5. CLOUD CREDENTIAL (the only secret a deploy needs — see §6):
       - CF_API_TOKEN present in process.env (CI)?  use it.
       - else, a `wrangler login` session exists (~/.wrangler, local)?  use it.
       - else  ABORT: "run `wrangler login`, or set CF_API_TOKEN".  Never prompt for it.
   NOTE: app runtime secrets (JWT_SECRET, R2_*, GOOGLE_CLIENT_SECRET, RESEND_API_KEY) are
   NOT read here — they already live on the Worker and persist across deploys (§6).
6. CONFIRM if env==production and not --yes:  require typing the label name.
7. EXECUTE (or print, if --dry-run), per scope, using resolved.<worker|pagesProject|d1.name|bucket>:
       build_shared
       migrate     → wrangler d1 migrations apply <resolved.d1.name> --remote [--env staging]
       deploy_worker → wrangler deploy [--env staging]   (from apps/api)
       build_web   → NEXT_PUBLIC_BRAND_* + NEXT_PUBLIC_* from resolved; next build (this label's
                     bundle — brand tokens & favicon are baked in at build time, §7)
       deploy_pages  → wrangler pages deploy .vercel/output/static --project-name=<resolved.pagesProject>
```

The pipeline answers the original ask ("if the env is not complete, ask in the terminal") by
resolving everything from the profile and failing preflight (step 4) on any missing config —
prompting for a non-secret would mean the profile was incomplete, which is a preflight failure,
not a prompt. This keeps the "never duplicate values" invariant intact. The only sensitive input
a routine deploy needs is the Cloudflare credential (step 5); how that is sourced — and why app
secrets are *not* a deploy-time concern — is §6.

### 4. Naming & safety compliance

- Every environment is named in the invocation (`-e staging|production`); there is no implicit prod.
- Production always confirms unless explicitly bypassed — same contract as `Makefile` `confirm-prod`.
- The existing `guard-no-dev-seed-*` check (`apps/api/scripts/check-no-dev-seed.ts`) is invoked as
  a preflight step before a prod/staging deploy, preserving today's guarantee.

### 5. Makefile & CI become thin wrappers

- `make deploy-api-staging` → `node scripts/cloudflare/deploy.mjs --label arenaquest -e staging --scope api`
  (stock brand as the default label), keeping the familiar targets working.
- `deploy-api.yml` collapses the three duplicated prod jobs into one job with a
  `strategy.matrix.label: [arenaquest, spaziord, budo]` step running
  `node scripts/cloudflare/deploy.mjs --label ${{ matrix.label }} -e production --yes`, with only the
  Cloudflare credential (`CF_API_TOKEN`/`CF_ACCOUNT_ID`) injected from the GitHub environment (§6).
  Adding a brand becomes a one-line matrix edit and a
  new `config/labels/<label>.jsonc`, not a 40-line copy — and the `@v3raphael` typo disappears
  because there is one canonical invocation.

### 6. Secrets — two kinds, only one is a deploy-time concern

"Sensitive value" splits into two categories that the deploy path treats very differently:

**A. App runtime secrets** — `JWT_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY` (the `api-secrets` in `deployment.schema.jsonc`).
These are set on the Worker once via `wrangler secret put` (or `make secret-*`) and **persist
across deploys** — `wrangler deploy` does not re-upload them. Therefore a *routine deploy never
carries them*. They are read by the running Worker, not by the deploy script. Setting and
rotating them is bring-up / rotation work, which is already a **Non-Goal** of this RFC.

**B. The deploy credential** — the Cloudflare API token (`CF_API_TOKEN`, with `CF_ACCOUNT_ID`)
that authenticates `wrangler`. This is the **only** sensitive input a deploy needs, and it is
resolved by context, never prompted:

| Context | Source of the Cloudflare credential |
|---|---|
| **Local** (operator) | `wrangler login` OAuth session in `~/.wrangler` — no token in any file |
| **CI** (Actions) | `CF_API_TOKEN` from the GitHub environment (unchanged from today) |
| **Bring-up / rotation** (out of scope) | app secrets via `wrangler secret put` / `make secret-*` |

**Why not a secrets manager (HashiCorp Vault et al.) now?** A vault mainly solves category A —
which the deploy does not carry — so it adds standing operational cost (server, auth, unseal,
maintenance) for no deploy-time benefit today. **Why not read GitHub secrets from a local
script?** GitHub Actions secrets are write-only and unreadable outside a workflow run, so relying
on them locally would reintroduce the exact CI dependency this RFC removes; they remain the right
source for the *CI* path only. See Resolved Decisions for the trigger to revisit this.

### 7. Web build is per-label, built inline

The web brand (`NEXT_PUBLIC_BRAND_*` — sigla, wordmark, accent colour, and the per-brand favicon)
is **baked into the bundle at build time**, exactly like `NEXT_PUBLIC_LANGUAGE`/`NEXT_PUBLIC_API_URL`
(RFC 0006); there is no runtime brand switcher. Each brand is therefore a *distinct* bundle, and
`next build` emits to a single fixed path (`.vercel/output/static`). So the `--scope web`/`all`
path **builds this label's bundle inline**, right before `pages deploy` (step 7 `build_web`), with
the brand vars sourced from the resolved profile.

This is safe precisely because of the CLI's shape: it deploys **one label per invocation**, and CI
runs labels in a **matrix** where each leg has its own isolated workspace — so the shared
`.vercel/output/static` path is never written by two brands at once. A pre-built,
folder-per-brand artifact scheme (`out/<label>/…`) would decouple build from deploy and speed up
multi-brand runs, but it solves a path-collision that one-label-per-run + matrix does not have;
it is deferred as an optimisation, not adopted now (see Resolved Decisions).

## Alternatives Considered

1. **`./scripts/<brand>/.env` + `./scripts/commum` (the original proposal).**
   *Rejected as the config store; adopted in spirit.* A per-brand `.env` would duplicate the
   values already in `config/labels/<label>.jsonc`, directly violating the schema's stated
   invariant that "this file and the profile never duplicate each other." Two sources of truth
   drift — that is precisely the failure the label system exists to prevent, and the rotted
   per-brand CI jobs prove it happens. We keep the proposal's *goals* (one script, env
   parameter, brand-scoped, prompt when incomplete, shared core) but source config from the
   profile and reserve prompting for secrets.

2. **Keep it in the Makefile, add a `LABEL=` variable to the deploy targets.**
   *Rejected.* Make is a poor host for JSONC parsing, coherence derivation, hidden secret
   prompts, and TTY detection. We would reimplement `label.mjs` logic in `make`/`sh`. The
   Makefile stays as a discoverable façade that shells into the CLI.

3. **Pure Bash CLI (no Node).** *Rejected for the orchestration layer.* Resolving JSONC and
   re-deriving `expected` in bash means reimplementing `label.mjs`'s pure functions in another
   language — a second, untested copy of the exact logic RFC 0007 centralized. Node reuses them
   directly, and the leaf `wrangler` invocations are spawned from Node via `child_process` — so
   the whole flow stays in one language rather than straddling JS and bash.

4. **Lean entirely on GitHub Actions `workflow_dispatch` for manual deploys.**
   *Rejected as the sole mechanism.* It still routes every release through the pipeline and its
   availability — the exact dependency this RFC removes. `workflow_dispatch` remains valuable and
   is retained; it will call the *same* CLI, so local and CI deploys never diverge.

5. **A separate deploy config file distinct from the label profile.** *Rejected.* Same
   duplication problem as §1, one layer up. Deploy needs `worker`/`pagesProject`/`d1.name`/`bucket`,
   all already in the profile.

6. **A single flat `scripts/deploy.mjs` with a `--cloud` flag (no per-cloud directory).**
   *Rejected.* It collapses the agnostic core and the Cloudflare executor into one file, so
   the provider boundary lives in `if (cloud === 'cloudflare')` branches instead of the module
   graph. A `scripts/<cloud>/deploy.mjs` directory makes the boundary structural and matches how
   `apps/api/src/adapters/*` already separates providers — a new cloud is a new folder, and
   `deploy/core.mjs` physically cannot import `wrangler`.

7. **Defer the cloud dimension until a second provider actually exists.** *Rejected as the
   default, but low-cost.* Since Cloudflare is the only target, one could ship a flat script now
   and split later. But the split costs almost nothing today (one directory, one clean import
   boundary) and retrofitting a provider boundary onto a script whose logic has grown entangled
   with `wrangler` is the expensive path. We pay the small structural cost now.

## Implementation Plan

Total: **~3–4 dev days.**

### Phase 0 — Fix the bleeding CI bug (~0.5d)
Replace `cloudflare/wrangler-action@v3raphael` with `@v3` in `deploy-api.yml` so multi-brand prod
is not silently broken while the CLI lands. Independent, shippable immediately.

### Phase 1 — The agnostic core + Cloudflare adapter (~1.5d)
`scripts/deploy/core.mjs` (cloud-agnostic) + `scripts/cloudflare/deploy.mjs` (adapter) +
`scripts/lib/log.mjs`: arg parsing, profile load, resolve via `label.mjs`, preflight gate
(reusing `checkPresence`/`checkCoherence`/`checkPolicy`/`mapExitCode`), and a `--dry-run` that
prints the plan. `core.mjs` emits a provider-neutral deploy plan; `cloudflare/deploy.mjs` turns
it into `wrangler` calls. No secret prompting yet; read secrets from env only. Unit-test the arg
parser and the plan builder, and assert `core.mjs` has **no** `wrangler`/cloud import (stdlib
`node:test`, mirroring `label.test.mjs`).

### Phase 2 — Cloud credential resolution + confirmation (~0.5d)
Resolve the Cloudflare credential by context (CF_API_TOKEN in env → else an existing `wrangler
login` session → else abort with a clear message; never prompt), production
confirm-by-typing-label, `--yes`/`CONFIRM=1` bypass, `guard-no-dev-seed` preflight wiring. No app
secrets are handled here — they persist on the Worker (§6).

### Phase 3 — Wire Makefile & CI (~1d)
Point `deploy-*-staging` / `deploy-*-prod` targets at the CLI (stock label default). Collapse the
per-brand prod jobs in `deploy-api.yml`/`deploy-web.yml` into a `matrix.label` job over the CLI.
Verify a staging deploy of SpazioRD end-to-end. Update `docs/onboarding.md` and CLAUDE.md commands.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| A local operator deploys the wrong brand/env to production | Mandatory `--label` + `-e`, no implicit prod, confirm-by-typing-the-label, `--dry-run` to preview. Same guard as `confirm-prod`. |
| A leaked Cloudflare API token grants deploy access | The token is never prompted, written to a file by the CLI, or logged; local uses the `wrangler login` OAuth session, CI uses a scoped GitHub environment secret. App secrets are never carried by deploy at all (§6). |
| Local `wrangler`/Node drift from CI's pinned versions | CLI runs `pnpm --filter api exec wrangler` (repo-pinned wrangler); document the required Node in onboarding; CI uses the same script so drift surfaces identically. |
| Preflight false-negative blocks a legitimate deploy | Preflight reuses the *same* `label.mjs` checks as `make label-check`; a hard gap is a real config gap. `--dry-run` and the grouped checklist make the missing key explicit. |
| Two paths (Makefile + CLI) during migration | Makefile targets become wrappers in Phase 3, so there is one real code path; the façade only forwards. |

## Success Criteria

- `node scripts/cloudflare/deploy.mjs --label spaziord -e staging` deploys SpazioRD's Worker and Pages using values
  resolved solely from `config/labels/spaziord.jsonc` — no brand value is written anywhere else. (Phase 1/3)
- A deploy against a label with a missing required key or a wildcard `ALLOWED_ORIGINS` in
  prod/staging **aborts before any mutation**, printing the offending key. (Phase 1)
- Running the CLI with `--dry-run` prints the exact `wrangler` commands and mutates nothing. (Phase 1)
- With no `CF_API_TOKEN` in the environment and no `wrangler login` session, the CLI exits
  non-zero telling the operator to log in or set the token — it never prompts for a secret and
  never hangs. A deploy never reads `JWT_SECRET` or the other app secrets. (Phase 2)
- `deploy-api.yml` contains **one** production job (matrixed over labels) and zero references to
  `@v3raphael`; adding a brand is a one-line matrix change plus a new profile. (Phase 0/3)
- `make deploy-api-staging` still works, now by forwarding to the CLI. (Phase 3)
- `scripts/deploy/core.mjs` imports no `wrangler` and no cloud SDK — enforced by a unit test — so
  a future `scripts/<cloud>/deploy.mjs` can reuse it unchanged. (Phase 1)

## Open Questions

_None outstanding._

## Resolved Decisions

- **Web build is per-label, built inline — not pre-built per-brand artifacts** (2026-07-23,
  raphaelsilva). `NEXT_PUBLIC_BRAND_*` (and the favicon) are baked at build time, so each brand is
  a distinct bundle. The CLI builds the `--label` bundle inline before `pages deploy` (§7). This is
  safe because deploys are one-label-per-invocation and CI runs labels in an isolated matrix, so the
  shared `.vercel/output/static` output path never collides. **Revisit — adopting a
  folder-per-brand pre-built artifact scheme (`out/<label>/…`) — when** multi-brand build time
  becomes the deploy bottleneck and decoupling build from deploy is worth the added artifact
  management.

- **No secrets manager for deploy; do not read GitHub secrets locally** (2026-07-23, raphaelsilva).
  App runtime secrets persist on the Worker and are not carried by deploy, so a vault (HashiCorp
  et al.) would add standing operational cost for no deploy-time benefit. GitHub Actions secrets
  are write-only/unreadable outside a workflow, so they serve the CI path only. Deploy resolves
  the Cloudflare credential from `wrangler login` (local) or `CF_API_TOKEN` (CI); app-secret
  provisioning/rotation stays out of scope (§6). **Revisit when** rotating app secrets across many
  brands becomes painful or audit/dynamic secrets are required — and evaluate lighter options
  first (1Password CLI, sops+age, Cloudflare Secrets Store) before a full vault.

## References

- Relevant code: `Makefile:181` (`deploy-api-staging`), `Makefile:216` (`deploy-api-prod`),
  `Makefile:224` (hardcoded `arenaquest-db`), `.github/workflows/deploy-api.yml` (duplicated
  per-brand prod jobs; `@v3raphael` typo), `scripts/label.mjs` (`deriveExpected`, `buildResolved`,
  `checkPresence`, `checkCoherence`, `checkPolicy`, `mapExitCode`), `scripts/lib/log.sh`,
  `config/labels/spaziord.jsonc`, `config/deployment.schema.jsonc`,
  `apps/api/scripts/check-no-dev-seed.ts`.
- Cloud-agnostic precedent: `packages/shared/ports/*` (provider-neutral contracts) and
  `apps/api/src/adapters/*` (per-provider implementations) — the structural model this RFC
  applies to the deploy path.
- Related RFCs: RFC 0006 (white-label branding — the label concept), RFC 0007 (label profiles,
  scaffolding & preflight — owns `label.mjs`, the profile schema, and the checklist this RFC consumes).
