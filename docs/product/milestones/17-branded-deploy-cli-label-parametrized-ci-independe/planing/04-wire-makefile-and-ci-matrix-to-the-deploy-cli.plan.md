# Plan — Task 04: Wire Makefile & CI matrix to the deploy CLI (Phase 3)

**Task:** [04-...task.md](../04-wire-makefile-and-ci-matrix-to-the-deploy-cli.task.md)
**Persona:** Backend/infra. Depends on Task 01 + Task 03 (both in candidate).
**Branch:** `feature/m17/04-wire-makefile-and-ci-matrix-to-the-deploy-cli.task`

## Scope-guardrail deviation (recorded, user-approved 2026-07-27)

The task file's guardrail lists Makefile, the two workflows, onboarding.md and
CLAUDE.md. The CLI requires `config/labels/<label>.jsonc`, but only `spaziord`
exists. Per the user's decision (matrix = arenaquest + spaziord + budo), this task
ALSO creates two profile files — an **approved expansion** of the guardrail:
- `config/labels/arenaquest.jsonc` — stock profile, built from values already
  committed in `apps/api/wrangler.jsonc` + Makefile (no invented data).
- `config/labels/budo.jsonc` — placeholder profile following the same
  `<acct>`-placeholder convention `spaziord.jsonc` already uses.

## Integration boundary (document; do NOT try to fix here)

The CLI's wrangler-env convention (Task 02) is `staging → <label>-staging`,
`production → <label>`. Real execution therefore needs each label's wrangler env
block (`env.arenaquest-staging`, `env.spaziord`, …) in `apps/api/wrangler.jsonc`,
which is **bring-up / label-scaffold — a milestone Non-Goal**. Task 04 is verified
at the **forwarding + `--dry-run`** level (targets invoke the CLI; the CLI resolves
and prints correct commands). Live end-to-end deploys are gated on scaffolded env
blocks, exactly as the RFC's "deploy assumes the tenant already exists" states.
Note this in the closeout.

## Stock apiHost normalization

`apps/api/wrangler.jsonc` prod vars (the deployed worker) use `api.arenaquest.app`
(GOOGLE_REDIRECT_URI, WEB_BASE_URL, ALLOWED_ORIGINS→arenaquest-web.pages.dev). The
Makefile `deploy-web-prod` hardcoded `api.raphael-1d2.workers.dev` — a drift/bug.
The stock profile uses `api.arenaquest.app` (the coherent, deployed value); the
CLI-driven web build will now use it. Record this as an intentional correction.

## Profile contents (exact — provided to the implementer; no fabrication)

**arenaquest.jsonc** — brand AQ/Arena/Quest/#ff8101 (from apps/web/src/lib/brand.ts
defaults), POWERED_BY false. staging: apiHost api-staging.raphael-1d2.workers.dev,
webOrigin arenaquest-web-staging.pages.dev, worker api-staging, pagesProject
arenaquest-web-staging, d1 arenaquest-db-staging (id 6a2f5784-c57e-46ae-a858-27ca876f1dfe),
kv id c697147935024190ada81e743c3479d9, r2 arenaquest-media-staging + s3Endpoint
https://1d2505ce8bda0a19b128ae074c38ee1a.r2.cloudflarestorage.com, cookieSameSite None,
mail resend "ArenaQuest Staging <noreply@arenaquest.app>". production: apiHost
api.arenaquest.app, webOrigin arenaquest-web.pages.dev, worker api, pagesProject
arenaquest-web, d1 arenaquest-db (id placeholder), r2 arenaquest-media, cookieSameSite
Strict, mail resend "ArenaQuest <noreply@arenaquest.app>".

**budo.jsonc** — placeholder profile (header comment noting values are placeholders
until bring-up). brand BUD/Budo/… . staging/production with `<acct>`/`<fill …>`
placeholders, worker api-budo(-staging), pagesProject budo-web(-staging), d1
budo-db(-staging), r2 budo-media(-staging), hosts as `<...>` placeholders,
cookieSameSite None/Strict, mail resend budo placeholders.

## Makefile

Repoint the deploy targets to forward to the CLI, stock `arenaquest` default;
remove hardcoded `arenaquest-db` from the deploy targets (migration inside CLI):
- `deploy-api-staging` → `node scripts/cloudflare/deploy.mjs --label arenaquest -e staging --scope api`
- `deploy-web-staging` → `... --scope web`
- `deploy-staging` → `... --scope all` (or keep composing api+web)
- `deploy-api-prod` → `... -e production --scope api` (CLI owns confirm; keep `confirm-prod`? The CLI already confirms — drop the make-level confirm to avoid a double prompt, but KEEP `guard-no-dev-seed` semantics which the CLI now runs). Prefer: target calls the CLI only; the CLI does guard + confirm.
- `deploy-web-prod`, `deploy-prod` similarly.
Keep other targets (db-migrate-*, create-*, secret-*) untouched.

## CI — collapse prod jobs into a matrix

`deploy-api.yml`: replace the three prod jobs (`deploy-production`,
`deploy-prod-spaziord`, `deploy-prod-budo`) with ONE job matrixed via
`strategy.matrix.include` mapping label→GitHub environment:
- {label: arenaquest, environment: production}
- {label: spaziord, environment: prod-spaziord}
- {label: budo, environment: prod-budo}
Job: `environment.name: ${{ matrix.environment }}`, `needs: deploy-staging`,
`if: github.ref_name == 'main'`, standard checkout/pnpm/node/install/build-shared,
then a single run step:
```
env:
  CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
  CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
run: node scripts/cloudflare/deploy.mjs --label ${{ matrix.label }} -e production --yes --scope api
```
`deploy-web.yml`: same collapse, `--scope web`; drop the per-job
`NEXT_PUBLIC_BRAND_*` env (the CLI bakes brand vars from the resolved profile).
Keep each file's `verify` and `deploy-staging` jobs. Zero `@v3raphael` remain
(Task 01 already fixed them; the collapse deletes those stanzas entirely).

## Docs

- `docs/onboarding.md` — document the CLI: `node scripts/cloudflare/deploy.mjs
  --label <label> -e <staging|production> [--scope] [--yes] [--dry-run]`, the
  CI-independent manual-release path, and the credential contract (wrangler login
  local / CF_API_TOKEN in CI).
- `CLAUDE.md` — update the Deploy command block to point at the CLI (targets are
  now thin wrappers).

## Verification (parent)

1. `node scripts/cloudflare/deploy.mjs --label arenaquest -e staging --scope api --dry-run` → prints
   `wrangler deploy --env arenaquest-staging` + migrate for arenaquest-db-staging; exit 0.
2. Same for `--label spaziord` and `--label budo` (all three profiles resolve, no preflight hard gap
   on required keys). budo/spaziord placeholders are OK (hosts aren't placeholder-checked).
3. `grep -rn "v3raphael" .github/workflows/` → zero. Both workflows parse as valid YAML with exactly
   ONE prod job each (matrixed).
4. Makefile deploy targets contain no `arenaquest-db` literal; `make -n deploy-api-staging` shows the CLI call.
5. `make lint`, `make test-api`, `make test-web` green. `git diff --stat` = Makefile + 2 workflows +
   onboarding.md + CLAUDE.md + 2 new config/labels/*.jsonc.
