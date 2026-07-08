# New-label bring-up runbook (RFC 0007)

End-to-end path for standing up a **new white-label tenant** — worked
through the concrete example, **SpazioRD**. The profile *is* the spec and
the checklist *is* the runbook: no tribal knowledge required.

This workflow is **local and on-demand**. It creates **no** Cloudflare
resources and pushes **no** secrets — it generates config and **prints the
commands** for you to run by hand. There is **no CI gate**; the existing
ArenaQuest deploy pipeline is untouched.

## Prerequisites

- `wrangler login` (the checklist's resource/secret probes need Cloudflare
  credentials; without them those lines report **⚠️ skipped**, never ✅ —
  no false green).
- Node (the toolchain Node; the script is stdlib-only ESM, zero deps).

## Tooling at a glance

| Command | What it does |
|---|---|
| `make label-new LABEL=<x>` | Write a `config/labels/<x>.jsonc` skeleton. |
| `make label-scaffold LABEL=<x>` | Generate the `env.<x>` wrangler block; print the deploy-workflow stanzas and the provisioning commands. |
| `make label-check LABEL=<x> ENV=staging\|production` | Grouped preflight checklist over config keys, Cloudflare resources, and external steps, with a fix-it line per gap. |
| `node scripts/label.mjs check <x> --schema` | Drift guard: every required schema key is present in the `*.example` templates. |

Two data files back it:
- `config/deployment.schema.jsonc` — the **shared contract** (every key's
  class, coherence anchor, policy). Carries no values.
- `config/labels/<label>.jsonc` — **one label's values**. Two anchors per
  environment (`apiHost`, `webOrigin`) drive every cross-referencing key.

## Step 1 — create the profile

```bash
make label-new LABEL=spaziord
```

Edit `config/labels/spaziord.jsonc`. You only write a handful of facts per
environment; everything cross-referencing is **derived** from them:

- `brand` — the five `NEXT_PUBLIC_BRAND_*` values (RFC 0006).
- `apiHost` — the API Worker host (e.g. `api-spaziord-staging.<acct>.workers.dev`).
- `webOrigin` — the web origin (e.g. `spaziord-web-staging.pages.dev`).
- resource names — `worker`, `pagesProject`, `d1.name`, `kv.binding`,
  `r2.bucket`, `r2.s3Endpoint`; `cookieSameSite`; `mail.driver` / `mail.from`.
- resource ids (`d1.id`, `kv.id`) stay `<fill …>` until step 3.

(See `config/labels/spaziord.jsonc` — committed as a worked sample.)

### Coherence by construction

These keys are **never hand-typed** — they are derived from the two
anchors, so they cannot disagree:

| Generated key | Derived from | Rule |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `apiHost` | `https://<apiHost>` |
| `GOOGLE_REDIRECT_URI` | `apiHost` | `https://<apiHost>/auth/google/callback` |
| `WEB_BASE_URL` | `webOrigin` | `https://<webOrigin>` |
| `ALLOWED_ORIGINS` (staging) | `webOrigin` | `https://<webOrigin>,https://*.<webOrigin>,http://localhost:3000` |
| `ALLOWED_ORIGINS` (production) | `webOrigin` | `https://<webOrigin>` — **exact-origin only** |
| `R2_S3_ENDPOINT` / `R2_BUCKET_NAME` / `R2_PUBLIC_BASE` | `r2` | from the profile's `r2` block |

Staging gets the single-label preview wildcard + localhost; **production is
exact-origin only**. The `no-wildcard-in-prod-staging` policy rejects a `*`
or a multi-label wildcard in either environment.

## Step 2 — scaffold the boilerplate

```bash
make label-scaffold LABEL=spaziord
```

This:

1. **Writes** the `env.spaziord-staging` / `env.spaziord` block into
   `apps/api/wrangler.jsonc`, between clear delimiters
   (`// >>> label:spaziord (generated) >>>` … `// <<< label:spaziord <<<`).
   It is **idempotent** — re-running replaces only that delimited block and
   never touches the existing ArenaQuest `staging` / production blocks.
   (To preview against a copy first: `node scripts/label.mjs scaffold
   spaziord --out /tmp/wrangler.copy.jsonc`.)
2. **Prints** the per-label deploy-workflow build stanzas for
   `.github/workflows/deploy-web.yml` / `deploy-api.yml` — paste them in
   by hand (they are not auto-written, to keep the deploy pipeline change
   reviewable).
3. **Prints** the provisioning command list (next step) — it never runs it.

## Step 3 — provision Cloudflare + external state (by hand)

Run the printed commands, then paste returned ids back into the profile:

```bash
wrangler d1 create spaziord-db-staging          # paste id → profile.environments.staging.d1.id
wrangler kv namespace create RATE_LIMIT_KV --env spaziord-staging   # paste id → kv.id
wrangler r2 bucket create spaziord-media-staging
# create the Pages project spaziord-web-staging (dashboard or `wrangler pages project create`)
# create a NEW Google OAuth (Web) client; register the redirect URI:
#   https://api-spaziord-staging.<acct>.workers.dev/auth/google/callback
```

Set each secret (values entered interactively — **never committed, never
logged**):

```bash
scripts/create-secrets.sh JWT_SECRET            --env spaziord-staging
scripts/create-secrets.sh R2_ACCESS_KEY_ID      --env spaziord-staging
scripts/create-secrets.sh R2_SECRET_ACCESS_KEY  --env spaziord-staging
scripts/create-secrets.sh GOOGLE_CLIENT_SECRET  --env spaziord-staging
scripts/create-secrets.sh RESEND_API_KEY        --env spaziord-staging   # only if MAIL_DRIVER=resend
```

> **Secret hygiene.** Secret *values* are never read, logged, compared, or
> printed by this tooling. Presence is verified by **name** only, via
> `wrangler secret list --env <label>`.

`GOOGLE_CLIENT_ID` is an **api-var** (not sensitive) and lives in the
`env.spaziord-staging.vars` block; `GOOGLE_CLIENT_SECRET` is an
**api-secret** set via `create-secrets.sh`.

## Step 4 — iterate the checklist until green

```bash
make label-check LABEL=spaziord ENV=staging
```

Each item is **present + coherent + policy-compliant**, grouped by surface
(`build`, `api-vars`, `api-secrets`, `cf-resources`, `external`), with the
exact command/value to fix every gap. Re-run after each fix until the only
remaining items are the ⚠️ external manual confirmations.

### Exit-code legend

| Exit | Meaning |
|---|---|
| `0` | All present, coherent and policy-compliant. |
| `1` | Any **hard gap** — a missing key, an incoherent value, or a policy violation. |
| `2` | Only **soft items** outstanding — external manual confirmations, or checks **skipped** because Cloudflare creds were absent. |

### Icons

- ✅ present / coherent / exists.
- ❌ hard gap — see the `→ fix` line under it.
- ⚠️ skipped (no creds — never counted as a pass) **or** an external
  manual-confirm item carrying the exact value to register.

## Step 5 — production cutover

Repeat steps 3–4 with `ENV=production` (its own resources, its own secrets,
its own Google OAuth client and redirect). Production `ALLOWED_ORIGINS` is
exact-origin only — the policy is applied at generation time, so a wildcard
cannot leak in. Once the production checklist is green (manual items
acknowledged), deploy via the **existing, unchanged** pipeline.

## Keeping the contract honest

After adding a key to `config/deployment.schema.jsonc`, run the drift guard
so the `*.example` templates can't silently fall behind:

```bash
node scripts/label.mjs check spaziord --schema
```

It fails (exit 1) if a required `build` key is missing from
`apps/web/.env.example`, or a required `api-secret` / `api-var`
(`.dev.vars` surface) key is missing from `apps/api/.dev.vars.example`.
