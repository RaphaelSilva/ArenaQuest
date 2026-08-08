# Plan — Task 02: Cloud-agnostic core + Cloudflare adapter, preflight & dry-run (Phase 1)

**Task:** [02-...task.md](../02-cloud-agnostic-core-and-cloudflare-adapter-with-pr.task.md)
**Persona:** Backend/infra (Node operational scripts). No app code.
**Branch:** `feature/m17/02-cloud-agnostic-core-and-cloudflare-adapter-with-pr.task`

## Reused contracts (from `scripts/label.mjs`, already exported)

- `PATHS` — `{ schema, labelsDir, wrangler, ... }`. Profile path is
  `join(PATHS.labelsDir, "<label>.jsonc")`; schema is `PATHS.schema`.
- `parseJsonc(text)` — parse a JSONC string (profiles + schema are JSONC).
- `deriveExpected(profile, env)` → derived anchor map (NEXT_PUBLIC_API_URL,
  ALLOWED_ORIGINS, R2_*, …).
- `buildResolved(profile, env, expected)` → resolved value map (brand + derived +
  cookieSameSite/mail). Call WITHOUT wranglerVars (deploy resolves from the
  profile only — no wrangler read at resolve time).
- `checkPresence(schemaSection, resolved)` → array of missing key names.
- `checkCoherence(expected, resolved)` → array of `{key, expected, actual}`.
- `checkPolicy(allowedOrigins, env)` → array of `{origin, reason}`.
- `mapExitCode(results)` → 0 clean / 1 hard gap / 2 soft.

`loadSchema`/`loadProfile`/`wranglerEnvName` are module-private in `label.mjs` and
must NOT be imported — read files with `readFileSync` + `parseJsonc` instead, and
re-derive the wrangler env name from the documented convention below.

## Profile shape (see `config/labels/spaziord.jsonc`)

- `profile.brand` — brand tokens (build vars).
- `profile.environments[env]` — `{ apiHost, webOrigin, worker, pagesProject,
  d1: { name }, r2: { bucket, s3Endpoint, publicBase }, kv, cookieSameSite, mail }`.

Wrangler env-name convention (mirrors `env.<label>-staging` / `env.<label>` blocks
that `label scaffold` writes): `staging` → `"<label>-staging"`, `production` →
`"<label>"`. The Cloudflare adapter passes this as `--env <name>`.

## New files (scope guardrail — only these)

1. **`scripts/lib/log.mjs`** — JS logging module mirroring `scripts/lib/log.sh`
   vocabulary: `info`, `ok`, `warn`, `fail`, `die` (writes stderr + throws/exits),
   `hint`, `heading`. Same icons/colours (✔ ⚠ ✖ →). stdlib only.

2. **`scripts/deploy/core.mjs`** — CLOUD-AGNOSTIC. Must import **no** `wrangler`
   and **no** cloud SDK. Exports:
   - `parseArgs(argv)` → `{ label, env, scope, yes, dryRun }`. Rules: `--label`
     required; `-e|--env` ∈ {staging, production} (reject others); `--scope` ∈
     {api, web, all} default `all`; `--yes` bool; `--dry-run` bool. Throw a clear
     Error on invalid/missing input.
   - `loadProfile(label)` → parse `config/labels/<label>.jsonc` via `parseArgs`'s
     resolved path (readFileSync + parseJsonc). Error if the file is absent.
   - `resolve(profile, env)` → `{ expected, resolved, envConfig }` using
     `deriveExpected` + `buildResolved(profile, env, expected)`.
   - `preflight(schema, resolved, expected, env)` → runs presence (over
     schema.build + schema['api-vars']), coherence, policy; returns a results
     array + `mapExitCode`. A hard gap (exit 1) must name the offending key(s).
   - `buildPlan({ label, env, scope, resolved, envConfig })` → a PROVIDER-NEUTRAL
     plan: an ordered array of steps, each `{ id, title, kind }` plus the neutral
     parameters (e.g. `{ kind: "migrate", d1Name }`, `{ kind: "deploy-worker",
     wranglerEnv }`, `{ kind: "build-web", brandVars }`, `{ kind: "deploy-pages",
     pagesProject, wranglerEnv }`). `build-shared` first; scope filters api/web
     steps. NO wrangler strings here — the adapter turns kinds into commands.
   The module-level orchestration (`run`) resolves → preflight (abort on exit 1
   before returning any executable plan) → returns the plan for the adapter.

3. **`scripts/cloudflare/deploy.mjs`** — Cloudflare ENTRYPOINT + adapter,
   `#!/usr/bin/env node`. Imports core, calls its pipeline, then maps each plan
   step `kind` → a `wrangler` argv:
   - `migrate` → `wrangler d1 migrations apply <d1Name> --remote --env <wranglerEnv>`
   - `deploy-worker` → `wrangler deploy --env <wranglerEnv>` (cwd apps/api)
   - `build-web` → `next build` with `NEXT_PUBLIC_BRAND_*`/`NEXT_PUBLIC_*` from resolved
   - `deploy-pages` → `wrangler pages deploy .vercel/output/static --project-name=<pagesProject>`
   Wrangler is invoked through the repo pin: `pnpm --filter api exec wrangler ...`
   via `node:child_process` `spawnSync`. **`--dry-run`**: print each command
   (exact argv, human-readable) and execute nothing. This task reads the CF
   credential from `process.env` only (no prompting, no session detection — that
   is Task 03); if execution is requested (not dry-run) with no credential, print
   a clear message and exit non-zero. Do NOT wire prod confirmation here.

4. **`scripts/deploy/core.test.mjs`** — `node:test` (stdlib), mirroring
   `scripts/label.test.mjs`:
   - `parseArgs`: valid combos; rejects missing `--label`, bad `--env`, bad `--scope`.
   - `buildPlan`: correct ordered steps per scope (api/web/all); neutral params
     carry the resolved d1Name/pagesProject/wranglerEnv.
   - preflight: a profile with a missing required key → exit 1 naming the key; a
     wildcard `ALLOWED_ORIGINS` in staging/production → exit 1.
   - **No-cloud-import assertion**: read `scripts/deploy/core.mjs` source and
     assert it contains no `wrangler` and no cloud-SDK import token.

## Out of scope (later tasks)

- CF credential context resolution (`wrangler login` session), prod
  confirm-by-typing-label, `guard-no-dev-seed` wiring → Task 03.
- Makefile / CI wiring → Task 04.
- No change to `label.mjs`, profiles, or the deployment schema.

## Verification (parent)

1. `node --test scripts/deploy/` and `node --test scripts/label.test.mjs` (no regression) — green.
2. `node scripts/cloudflare/deploy.mjs --label spaziord -e staging --dry-run` — prints wrangler
   commands (migrate/worker/build/pages), executes nothing.
3. A crafted missing-key / wildcard profile aborts non-zero naming the key before any command.
4. `make lint` green.
5. `git diff --stat` — only the four new files under `scripts/`.
