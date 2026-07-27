# Milestone 17 — Branded deploy CLI - label-parametrized CI-independent release script

**Status:** 📝 Draft
**Scope:** `scripts/deploy/`, `scripts/cloudflare/`, `scripts/lib/`, `Makefile`, and `.github/workflows/deploy-*.yml` — a label-aware, cloud-agnostic deploy CLI plus the Makefile/CI wrappers that call it. Derived from [RFC 0011](../../RFCs/0011-branded-deploy-cli-label-parametrized-ci-independent-release.md).

> **Hard scope guardrail — read before opening any task.** This milestone may only touch the **deploy orchestration layer**: `scripts/deploy/core.mjs` (new, cloud-agnostic), `scripts/cloudflare/deploy.mjs` (new, Cloudflare entrypoint/adapter), `scripts/lib/log.mjs` (new, JS logging module), the `deploy-*-staging` / `deploy-*-prod` targets in `Makefile`, the production jobs in `.github/workflows/deploy-api.yml` and `deploy-web.yml`, and their unit tests under `scripts/**`. It **reuses** `scripts/label.mjs`, `config/labels/<label>.jsonc`, `config/deployment.schema.jsonc`, and `apps/api/scripts/check-no-dev-seed.ts` — it must **not** modify their logic or shape. It is explicitly **not** an opportunity to: provision cloud resources (D1/KV/R2 creation, OAuth setup — that is `label-scaffold`/RFC 0007); set or rotate app runtime secrets (`JWT_SECRET`, `R2_*`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY` — those persist on the Worker and stay with `make secret-*`); build a rollback/re-release system; implement a second cloud provider (only the *structure* accommodates one); introduce a `scripts/<brand>/.env` or any per-brand config store separate from the label profile; or add a secrets manager/vault. If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **One deploy entrypoint parametrized by environment and brand.** `node scripts/cloudflare/deploy.mjs --label <label> -e <staging|production>` drives the full release for any tenant — resolve config, preflight, migrate D1, deploy Worker + Pages — so a maintainer can cut a production release for any brand from their own machine using the exact code path CI uses. This removes CI as a single point of failure for releases.
- **A cloud-agnostic core plus a per-cloud entrypoint.** `scripts/deploy/core.mjs` resolves *what* to deploy and emits a provider-neutral plan; `scripts/cloudflare/deploy.mjs` executes *how* by spawning `wrangler`. `core.mjs` imports no `wrangler` and no cloud SDK, so a future `scripts/<cloud>/deploy.mjs` is a sibling that reuses the core unchanged — mirroring the Ports & Adapters split in `packages/shared/ports` vs `apps/api/src/adapters/*`.
- **A fail-closed preflight gate before any mutation.** The CLI refuses to deploy a label whose required config is missing, incoherent, or policy-violating, by reusing `checkPresence`/`checkCoherence`/`checkPolicy`/`mapExitCode` from `scripts/label.mjs`. A hard gap (exit 1) aborts before D1 or Worker/Pages are touched, printing the offending key.
- **Node (`.mjs`, stdlib only) as the standard engine for operational scripts.** The whole flow — arg parsing, config resolution, preflight, and the `wrangler` invocations via `node:child_process` — is Node with no bash step layer, so it is debuggable under the Node inspector, unit-testable with `node:test`, and consistent with `label.mjs`.
- **Context-resolved Cloudflare credential, never a prompt.** The only sensitive input a routine deploy needs is the Cloudflare API token: use `CF_API_TOKEN` from the environment (CI), else an existing `wrangler login` session (local), else abort with a clear message. App runtime secrets are never read at deploy time.
- **Naming & safety compliance.** Every environment is named in the invocation; there is no implicit prod; production always confirms (confirm-by-typing-the-label) unless `--yes`/`CONFIRM=1` bypasses — matching the `confirm-prod` convention. `--dry-run` resolves, runs preflight, and prints the exact `wrangler` commands without executing. The `guard-no-dev-seed` check runs as a preflight step.
- **Makefile & CI collapse to thin wrappers over the CLI.** `deploy-*-staging` / `deploy-*-prod` targets forward to the CLI (stock `arenaquest` label as default); the duplicated per-brand prod jobs in `deploy-api.yml` / `deploy-web.yml` collapse into one `strategy.matrix.label` job, and the `cloudflare/wrangler-action@v3raphael` typo disappears. Adding a brand becomes a one-line matrix edit plus a new `config/labels/<label>.jsonc`.

Out of scope (explicit, from RFC 0011 Non-Goals):
- **Provisioning cloud resources** (D1/KV/R2 creation, OAuth client setup) — lives in `label-scaffold` and the RFC 0007 bring-up checklist; deploy assumes the tenant already exists.
- **Managing/rotating secrets** — app runtime secrets are set on the Worker via `wrangler secret put` / `make secret-*` and persist across deploys; the CLI never carries them.
- **A rollback system** — the CLI only performs a complete forward deploy; re-releasing a prior version is a separate concern.
- **Implementing a second cloud provider** — Cloudflare is the only target; this milestone only makes the *structure* accommodate a future provider, not build an actual AWS/other adapter.
- **A `scripts/<brand>/.env` config store or a secrets manager (Vault et al.)** — rejected in the RFC's Alternatives Considered; brand values live only in `config/labels/<label>.jsonc`, and no vault is introduced.

---

## 2. Functional Requirements

- The CLI accepts `--label <label>` (required, no implicit brand), `-e|--env <staging|production>` (required; only these two keys accepted), `--scope <api|web|all>` (default `all`), `--yes`, and `--dry-run`.
- Given a valid `--label`, the CLI loads and parses `config/labels/<label>.jsonc` and resolves every deploy value (`worker`, `pagesProject`, `d1.name`, `r2.bucket`, brand tokens) solely from that profile via `label.mjs` — no brand value is read from or written to any other location.
- Before any mutation, the CLI runs preflight: presence (required keys present), coherence (derived keys consistent), and policy (no wildcard `ALLOWED_ORIGINS` in staging/production). A hard gap aborts with a non-zero exit, printing the offending key; nothing is deployed.
- The `guard-no-dev-seed` check (`apps/api/scripts/check-no-dev-seed.ts`) runs as a preflight step before a staging/production deploy.
- The CLI resolves the Cloudflare credential by context: `CF_API_TOKEN` in the environment, else an existing `wrangler login` session, else it aborts telling the operator to log in or set the token — it never prompts for a secret and never hangs. It never reads `JWT_SECRET` or any other app runtime secret.
- For `-e production` without `--yes`/`CONFIRM=1`, the CLI requires the operator to type the label name to confirm before proceeding.
- With `--dry-run`, the CLI resolves, runs preflight, and prints the exact `wrangler` commands per scope without executing any of them.
- Executing (non-dry-run) deploys, per scope, using resolved values: apply D1 migrations to `<resolved.d1.name>`, deploy the Worker (`--scope api`/`all`), and build this label's web bundle inline (brand tokens/favicon baked at build time) then `wrangler pages deploy` to `<resolved.pagesProject>` (`--scope web`/`all`).
- `make deploy-api-staging` (and the other `deploy-*` targets) still works, now by forwarding to the CLI with the stock `arenaquest` label as default.
- `deploy-api.yml` and `deploy-web.yml` each contain a single production job matrixed over `[arenaquest, spaziord, budo]` calling the CLI with `--yes`, with only the Cloudflare credential injected from the GitHub environment; there are zero references to `@v3raphael`.
- The CLI runs the repo-pinned wrangler (`pnpm --filter api exec wrangler`) so local and CI use the same version.

---

## 3. Acceptance Criteria

- [ ] `node scripts/cloudflare/deploy.mjs --label spaziord -e staging` deploys SpazioRD's Worker and Pages using values resolved solely from `config/labels/spaziord.jsonc` — no brand value is written anywhere else.
- [ ] A deploy against a label with a missing required key **or** a wildcard `ALLOWED_ORIGINS` in staging/production aborts before any mutation, printing the offending key (non-zero exit).
- [ ] `node scripts/cloudflare/deploy.mjs --label <label> -e <env> --dry-run` prints the exact `wrangler` commands and mutates nothing.
- [ ] With no `CF_API_TOKEN` in the environment and no `wrangler login` session, the CLI exits non-zero telling the operator to log in or set the token — it never prompts and never hangs; a deploy never reads `JWT_SECRET` or the other app secrets.
- [ ] `-e production` without `--yes`/`CONFIRM=1` requires typing the label name before any mutation; `--yes` or `CONFIRM=1` bypasses the prompt.
- [ ] A unit test asserts `scripts/deploy/core.mjs` imports no `wrangler` and no cloud SDK, so a future `scripts/<cloud>/deploy.mjs` can reuse it unchanged.
- [ ] Unit tests (`node:test`, mirroring `label.test.mjs`) cover the arg parser and the plan builder.
- [ ] `deploy-api.yml` contains **one** production job (matrixed over labels) and zero references to `@v3raphael`; `deploy-web.yml` is likewise a single matrixed job.
- [ ] `make deploy-api-staging` still works, now by forwarding to the CLI.
- [ ] `docs/onboarding.md` and `CLAUDE.md` commands are updated to describe the CLI.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] No diff outside the scope declared in the guardrail.

---

## 4. Specific Stack

- **Deploy CLI (orchestration):** Node `.mjs`, stdlib only — `node:util` (arg parsing), `node:fs`/`node:path` (profile load), `node:child_process` (spawn `wrangler`), `node:readline` (prod confirm / TTY detection). Consistent with `scripts/label.mjs`.
- **Reused resolvers:** `scripts/label.mjs` — `deriveExpected`, `buildResolved`, `checkPresence`, `checkCoherence`, `checkPolicy`, `mapExitCode` — imported by `core.mjs`; not modified.
- **Config source of truth:** `config/labels/<label>.jsonc` (per-brand values) + `config/deployment.schema.jsonc` (shape + rules); no new config format.
- **Logging:** `scripts/lib/log.mjs` (new) mirroring the `ok`/`warn`/`fail`/`die`/`heading` vocabulary of `scripts/lib/log.sh`.
- **Cloud executor:** `wrangler` via `pnpm --filter api exec wrangler` — `d1 migrations apply`, `deploy`, `pages deploy`.
- **Web build:** `next build` (`@cloudflare/next-on-pages`) emitting `.vercel/output/static`, one label per invocation, brand vars (`NEXT_PUBLIC_BRAND_*`) sourced from the resolved profile.
- **Wrappers:** `Makefile` deploy targets; `.github/workflows/deploy-api.yml` / `deploy-web.yml` with `strategy.matrix.label`.
- **Tests:** `node:test` (stdlib), mirroring `scripts/label.test.mjs`.

---

## 5. Task Breakdown

The execution plan. Each row is a `.task.md` file. All tasks are Backend
(infrastructure / operational scripts) — this milestone has no web UI surface.

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Fix wrangler-action typo in prod CI jobs](./01-fix-wrangler-action-typo-in-prod-ci-jobs.task.md) | 0 | Backend | ✅ Done |
| 02 | [Cloud-agnostic core and Cloudflare adapter with preflight and dry-run](./02-cloud-agnostic-core-and-cloudflare-adapter-with-pr.task.md) | 1 | Backend | ✅ Done |
| 03 | [Cloud credential resolution and production confirmation](./03-cloud-credential-resolution-and-production-confirm.task.md) | 2 | Backend | 📝 Open |
| 04 | [Wire Makefile and CI matrix to the deploy CLI](./04-wire-makefile-and-ci-matrix-to-the-deploy-cli.task.md) | 3 | Backend | 📝 Open |

Dependency graph:

```
01 (independent, Phase 0 hotfix) ─┐
                                  ▼
02 (independent) ──► 03 ──► 04
```

`04` depends on both `03` (needs the complete CLI) and `01` (edits the same
workflows, then subsumes the per-brand jobs). `01` and `02` are independent of
each other and may proceed in parallel.

**Recommended execution order:** `01` → `02` → `03` → `04`.

Each task is intended to land as an independent PR with `make lint`,
`make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC 0011 "Resolved Decisions")

1. **Web build is per-label, built inline — not pre-built per-brand artifacts** (2026-07-23, raphaelsilva). `NEXT_PUBLIC_BRAND_*` and the favicon are baked at build time, so each brand is a distinct bundle; the CLI builds the `--label` bundle inline before `pages deploy`. Safe because deploys are one-label-per-invocation and CI runs labels in an isolated matrix, so the shared `.vercel/output/static` output path never collides. *Revisit* a folder-per-brand pre-built scheme (`out/<label>/…`) only when multi-brand build time becomes the deploy bottleneck.
2. **No secrets manager for deploy; do not read GitHub secrets locally** (2026-07-23, raphaelsilva). App runtime secrets persist on the Worker and are not carried by deploy, so a vault would add standing operational cost for no deploy-time benefit. GitHub Actions secrets are write-only/unreadable outside a workflow, so they serve the CI path only. Deploy resolves the Cloudflare credential from `wrangler login` (local) or `CF_API_TOKEN` (CI). *Revisit* when rotating app secrets across many brands becomes painful — evaluating lighter options (1Password CLI, sops+age, Cloudflare Secrets Store) before a full vault.
3. **Brand is data, cloud is an adapter — a per-cloud directory, not a `--cloud` flag or a flat script** (RFC §1, Alternatives §6/§7). The provider boundary is structural (`scripts/<cloud>/deploy.mjs` reusing `scripts/deploy/core.mjs`), not an `if (cloud === …)` branch, so `core.mjs` physically cannot import `wrangler`. The small structural cost is paid now rather than retrofitting a boundary later.
4. **Config comes from the label profile, never a per-brand `.env`** (RFC Alternatives §1/§5). A per-brand `.env` or a separate deploy config file would duplicate values already in `config/labels/<label>.jsonc`, violating the schema's "never duplicate each other" invariant. The CLI sources from the profile and prompts only for genuinely missing secrets.
5. **Node, not Bash, for the orchestration layer** (RFC Alternatives §2/§3). Make and Bash are poor hosts for JSONC parsing and coherence derivation; reimplementing `label.mjs` in another language would create a second untested copy. Node reuses the pure functions directly and spawns the leaf `wrangler` calls via `child_process`.

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC 0011 status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items remain backlog.
- [ ] No diff outside the scope declared in the guardrail.
