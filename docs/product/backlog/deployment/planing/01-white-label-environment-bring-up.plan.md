# Plan — White-label environment bring-up (RFC 0007)

**Task:** `docs/product/backlog/deployment/01-white-label-environment-bring-up.task.md`
**Source RFC:** `docs/product/RFCs/0007-deployment-preflight-and-config-validation.md`
**Branch:** `feature/backlog/deployment/01-white-label-environment-bring-up.task` (cut from `develop`)
**Persona:** DevOps/tooling — repo-root scripts/config, **not** `apps/*/src`. Delegated to a `general-purpose` subagent (the backend/frontend personas don't own root tooling).

---

## 0. Nature & guardrails

Tooling only: Node ESM scripts, two JSONC config files, additive `Makefile` targets, a runbook, and a `*.example` drift reconciliation. **No** CI gate, **no** change to deploy behaviour, **no** Cloudflare resource creation, **no** secret push. The tool *prints* commands; humans run them.

**Scope guardrail — may ONLY touch:**
- `config/deployment.schema.jsonc` (new)
- `config/labels/spaziord.jsonc` (new sample profile)
- `scripts/label.mjs` (new) + `scripts/label.test.mjs` (+ fixtures under `scripts/fixtures/`)
- `Makefile` (additive `label-new` / `label-scaffold` / `label-check` targets — **do not edit existing targets**)
- `docs/product/backlog/deployment/` (new-label runbook)
- `apps/api/.dev.vars.example`, `apps/web/.env.example` (drift-guard reconciliation **only if** a required schema key is missing — currently they look complete; prefer no change)

**Must NOT touch:** `apps/api/src/**`, `apps/web/src/**`, the existing ArenaQuest `env.staging`/top-level blocks in `wrangler.jsonc`, the deploy-gate jobs in the workflows, or `pnpm-lock.yaml` (stdlib only — **zero new dependencies**).

**Key decision — keep `wrangler.jsonc` & the workflows byte-for-byte unchanged in the committed diff.** The `scaffold` subcommand *can* append an `env.<label>` block / workflow stanza, but we do **not** commit a scaffolded SpazioRD block into the real `wrangler.jsonc` or `deploy-*.yml` (placeholder resource ids would pollute the live config). Scaffolding is exercised against **fixtures/temp copies** in tests and demonstrated in verification by writing to a temp path, never the real files. This keeps "existing deploy pipeline unchanged" + "no diff outside guardrail" true. The scaffolder still *targets* the real files when a maintainer runs it on purpose later.

---

## 1. Technical facts harvested from the repo (use these exact values)

**Current `apps/api/wrangler.jsonc`:** top-level block = production (ArenaQuest), `env.staging` = `api-staging`. Vars present: `ALLOWED_ORIGINS`, `COOKIE_SAMESITE`, `R2_S3_ENDPOINT`, `R2_PUBLIC_BASE`, `R2_BUCKET_NAME`, `MAIL_DRIVER`, `MAIL_FROM`, `WEB_BASE_URL`, `GOOGLE_REDIRECT_URI`. `GOOGLE_CLIENT_ID` is **commented out** in `env.staging` (the ambiguity to resolve → **api-var**). Secrets are out-of-band. Bindings: D1 `DB`, KV `RATE_LIMIT_KV`, R2 `R2`.

**`apps/api/.dev.vars.example` keys (api-secrets + api-vars surface):** `JWT_SECRET`, `ALLOWED_ORIGINS`, `COOKIE_SAMESITE`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `MAIL_DRIVER`, `MAIL_FROM`, `RESEND_API_KEY`, `WEB_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. (`R2_S3_ENDPOINT`/`R2_BUCKET_NAME`/`R2_PUBLIC_BASE` are wrangler vars, not in `.dev.vars.example`.)

**`apps/web/.env.example` keys (build surface):** `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_BRAND_SIGLA`, `NEXT_PUBLIC_BRAND_NAME_PREFIX`, `NEXT_PUBLIC_BRAND_NAME_ACCENT`, `NEXT_PUBLIC_BRAND_POWERED_BY`, `NEXT_PUBLIC_BRAND_ACCENT`. (`NEXT_PUBLIC_LANGUAGE` is referenced in CLAUDE.md but not in the example — schema marks it `required:false`, so absence is fine.)

**`scripts/create-secrets.sh`** — `./scripts/create-secrets.sh <SECRET_NAME> [--env <environment>]`. This is the fix-it command the checklist points at for missing api-secrets.

**Deploy workflows** — `deploy-web.yml`: per-env `Build for Cloudflare Pages` step carries `NEXT_PUBLIC_API_URL` + 5 `NEXT_PUBLIC_BRAND_*` (lines ~79-89 staging, ~128-138 prod) and a `pages deploy --project-name=arenaquest-web[-staging]`. `deploy-api.yml`: `deploy --env staging` / `deploy`. The scaffold stanza model mirrors these.

**Node:** v24, ESM. **`JSON.parse` does NOT accept JSONC** (comments / trailing commas) — implement a tiny stdlib-only JSONC pre-strip (remove `//` and `/* */` comments while respecting string literals, drop trailing commas) in `label.mjs`. Tests via the built-in runner: `node --test scripts/`.

**CORS policy (CLAUDE.md / `apps/api/src/core/cors/`):** staging may carry the single-label preview wildcard `https://*.<host>` + `http://localhost:3000`; production is exact-origin only. `*` (full wildcard) and multi-label wildcards are forbidden in staging/prod → this is the `no-wildcard-in-prod-staging` policy.

---

## 2. Files to author

### 2.1 `config/deployment.schema.jsonc` (the contract — no values)
Mirror the RFC §1 schema block verbatim in intent. Sections: `build`, `api-vars`, `api-secrets`, `cf-resources`, `external`. Each key carries `required` + optionally `derivedFrom` (`apiHost`|`webOrigin`), `from` (`brand`|`r2`), `enum`, `policy:"no-wildcard-in-prod-staging"`, `manual`, `requiredWhen` (e.g. `"MAIL_DRIVER=resend"`), `confirm`. `GOOGLE_CLIENT_ID` → **api-vars, required**; `GOOGLE_CLIENT_SECRET` → **api-secrets, required**. Header comment: "shared contract, carries no values; one schema for all labels."

### 2.2 `config/labels/spaziord.jsonc` (sample profile)
Mirror RFC §1 profile block: `label`, `displayName`, `brand` (5 `NEXT_PUBLIC_BRAND_*`), `environments.{staging,production}` each with `apiHost`, `webOrigin`, `worker`, `pagesProject`, `d1{name,id}`, `kv{binding,id}`, `r2{bucket,s3Endpoint}`, `cookieSameSite`, `mail{driver,from}`. Use `<fill after …>` placeholders for resource ids. This is a **sample/worked example**, committed as data only.

### 2.3 `scripts/label.mjs` (the CLI — ESM, stdlib only)
Structure as importable **pure functions** + a thin CLI dispatch at the bottom (`if (import.meta.url === pathToFileURL(process.argv[1]).href)`), so the test file imports the pure logic without shelling out.

Pure/derivation layer (unit-tested):
- `stripJsonc(text)` / `parseJsonc(text)` — comment + trailing-comma tolerant.
- `deriveExpected(profile, env)` → `{ NEXT_PUBLIC_API_URL, GOOGLE_REDIRECT_URI, WEB_BASE_URL, ALLOWED_ORIGINS, R2_S3_ENDPOINT, R2_BUCKET_NAME, R2_PUBLIC_BASE }` from anchors. Rules:
  - `NEXT_PUBLIC_API_URL` = `https://<apiHost>`
  - `GOOGLE_REDIRECT_URI` = `https://<apiHost>/auth/google/callback`
  - `WEB_BASE_URL` = `https://<webOrigin>`
  - `ALLOWED_ORIGINS` staging = `https://<webOrigin>,https://*.<webOrigin>,http://localhost:3000`; production = `https://<webOrigin>` (exact only — policy applied at derivation time).
  - `R2_*` from the profile `r2` block.
- `checkPresence(schema, resolved)` — every `required` / active `requiredWhen` key resolves non-empty.
- `checkCoherence(expected, actual)` — derive-and-diff; report named mismatches (e.g. `WEB_BASE_URL` ≠ derived, `NEXT_PUBLIC_API_URL` host ≠ `apiHost`).
- `checkPolicy(allowedOrigins, env)` — reject `*` and multi-label wildcards in staging/prod.
- `requiredWhen` evaluator (`MAIL_DRIVER=resend` gates `RESEND_API_KEY` + `external.resend`).
- `mapExitCode(results)` → `0` all good / `1` any hard gap (missing|incoherent|policy) / `2` only manual confirmations outstanding.
- `formatChecklist(results)` — grouped `✅/❌/⚠️` lines + a fix-it line per gap. **Never emit a secret value** — only name + present/absent.

Side-effecting layer (CLI only, not in unit tests):
- `check <label> --env <staging|production>`: parse profile + the matching `env.<label>[-staging]` block from `wrangler.jsonc` if present (else evaluate from profile-derived expectations); `api-secrets` presence by NAME via `wrangler secret list --env <label>[-staging] --json` (spawn read-only; parse names only). **Credential/cmd failure → ⚠️ skipped, never ✅.** `cf-resources` presence via `wrangler d1 list` / `kv namespace list` / `r2 bucket list` / `pages project list` (names matched; absent creds → ⚠️ skipped). `external` → ⚠️ manual-confirm lines carrying the exact value (redirect URI, sender domain). Exit per `mapExitCode`.
- `check --schema`: assert every required `build` key ∈ `apps/web/.env.example` and every required `api-secrets`/`api-vars` (.dev.vars surface) key ∈ `apps/api/.dev.vars.example`; fail (exit 1) on a missing key. **If this surfaces a genuinely missing key, that is the only sanctioned reason to edit a `*.example`** — reconcile minimally.
- `new <label>`: write `config/labels/<label>.jsonc` skeleton (all anchors `<fill …>`, brand block ready). Refuse to clobber an existing profile.
- `scaffold <label>`: read profile+schema; build the `env.<label>` / `env.<label>-staging` block (bindings + derived `vars`) and the per-label workflow stanza, **append between clear delimiters** (e.g. `// >>> label:<label> (generated) >>>` … `// <<< label:<label> <<<`); idempotent — re-running replaces only that delimited block, never the ArenaQuest blocks. Print (never run) the `wrangler d1/kv/r2 create`, Pages-create, and `scripts/create-secrets.sh <NAME> --env <label>` command list. **Hygiene: in tests/verification, target a temp copy, not the real `wrangler.jsonc`.**

**Secret hygiene (hard rule):** never read, log, compare, or print a secret value anywhere. Only `wrangler secret list` (names) is allowed. Enforce in code; verification greps for violations.

### 2.4 `scripts/label.test.mjs` (+ `scripts/fixtures/`)
`node --test`-compatible. Cover: JSONC parse; `deriveExpected` for staging vs production (wildcard present in staging, absent in prod); presence (missing `GOOGLE_CLIENT_ID` → fail); coherence (wrong `WEB_BASE_URL` / wrong `NEXT_PUBLIC_API_URL` host → named failure); policy (`*` in staging `ALLOWED_ORIGINS` → fail); `requiredWhen` (resend gates `RESEND_API_KEY`); exit-code mapping `0/1/2`. Fixtures: a good profile, a profile/wrangler block with an injected coherence break, one with a wildcard policy break. **No network / no real `wrangler`** in tests — keep them pure.

### 2.5 `Makefile` (append a new section, do not touch existing targets)
```make
label-new:       ## Create a label profile skeleton (LABEL=spaziord)
	node scripts/label.mjs new $(LABEL)
label-scaffold:  ## Generate wrangler/workflow/env boilerplate from the profile (LABEL=spaziord)
	node scripts/label.mjs scaffold $(LABEL)
label-check:     ## Checklist of what's missing for a label (LABEL=spaziord ENV=staging|production)
	node scripts/label.mjs check $(LABEL) --env $(or $(ENV),staging)
```
Add the three target names to the `.PHONY` line.

### 2.6 `docs/product/backlog/deployment/02-new-label-runbook.md` (runbook)
End-to-end SpazioRD path mirroring RFC "Worked example" §: `label-new` → edit two anchors/env + brand → `label-scaffold` → run printed provisioning commands (`wrangler … create`, paste ids, create Pages project, new Google OAuth client + redirect, `create-secrets.sh … --env spaziord-staging`) → `label-check … ENV=staging` until green → repeat `ENV=production`. Include the exit-code legend and the secret-hygiene note.

---

## 3. Acceptance-criteria → implementation map
- **P1** schema/profile/`check` presence + exit codes + unit tests → §2.1, §2.2, §2.3 (presence+CLI), §2.4.
- **P2** coherence derive-and-diff, `no-wildcard-in-prod-staging`, `cf-resources`, `external`, exit `2` → §2.3 (coherence/policy/cf/external).
- **P3** `new`, `scaffold` (idempotent, ArenaQuest blocks untouched), `check --schema` drift, runbook → §2.3 (`new`/`scaffold`/`--schema`), §2.5, §2.6.
- **Global** no secret values in output; pipeline unchanged; `make lint` + `make build` + `node --test scripts/` green; `git diff --stat` only guardrail files → enforced in §1 decision + §4 verification.

## 4. Verification (parent runs)
1. `node scripts/label.mjs check spaziord --env staging` with no creds → every secret/resource line ⚠️ skipped (never ✅); config coherence/policy evaluated; exit reflects gaps.
2. Coherence catch: fixture with wrong `WEB_BASE_URL` → named failure, exit 1.
3. Policy catch: fixture `*` in staging `ALLOWED_ORIGINS` → `no-wildcard-in-prod-staging` failure.
4. `node scripts/label.mjs scaffold spaziord` targeting a **temp copy** → derived hosts agree (`ALLOWED_ORIGINS` ⊇ `webOrigin`; `GOOGLE_REDIRECT_URI` host == `apiHost` == `NEXT_PUBLIC_API_URL` host); printed (not executed) command list present.
5. Idempotency: re-run scaffold on the temp copy → only the label's delimited block changes; ArenaQuest blocks identical.
6. Secret hygiene: grep `scripts/label.mjs` + its output for any read/print of a secret value → none.
7. Gates: `make lint`, `make build`, `node --test scripts/` green; `git diff --stat` shows only guardrail files; real `apps/api/wrangler.jsonc` + `.github/workflows/*` unchanged.

## 5. Out of scope (do not build)
CI gate; auto-provisioning / `--fix`; asserting third-party state green; runtime smoke tests; `ENV=local`; any change to `apps/*/src` or existing deploy logic.
