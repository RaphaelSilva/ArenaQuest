# RFC 0012: Tenant provisioning — Cloudflare resource bring-up with backend parity

**Date:** 2026-08-08
**Status:** Implemented
**Author:** raphaelsilva
**Affected:**
- `scripts/cloudflare/provision-label.mjs` (new here) — the **Cloudflare provisioning entrypoint + adapter**. Creates every resource a label needs from its profile, writes the resolved identifiers back, and regenerates the label's wrangler env block. Existed untracked before this RFC; it is formalised and completed here.
- `scripts/label.mjs` — reused (not forked) for derivation: `deriveExpected`, plus new pure helpers `deriveCorsRules`, `renderCorsFile`, `workersDevHost`, `kvNamespaceName`. Also gains conditional `routes` emission in the generated env block.
- `scripts/cloudflare/deploy.mjs` — reused unchanged. Provisioning brings a Worker into existence by *spawning the deploy CLI*, so there remains exactly one release code path.
- `scripts/deploy/core.mjs` — reused unchanged (`confirmProduction`). Deliberately untouched: it must stay cloud-free.
- `config/labels/<label>.jsonc` — gains an optional `customDomain` flag per environment.
- `apps/api/cors.json` — **deleted**. R2 CORS is now derived per label from `webOrigin`.
- `Makefile` — `r2-cors-*` forward to the provisioner; `create-db-*` / `create-kv-*` are superseded; `set-new-label` gains `WITH_DOMAIN` / `ONLY`; new `test-scripts` target.

---

## Summary

RFC 0011 delivered a label-aware **deploy** CLI and explicitly deferred **provisioning**.
The gap that deferral left is asymmetric: the untracked bring-up script provisions the
data plane (D1, KV, R2) and the *frontend* project (Cloudflare Pages), but nothing on
the backend. A new label therefore ends up with correct bindings in `wrangler.jsonc`
and a live Pages project, while its Worker does not exist, has no signing key, its
bucket has no CORS policy, and its `apiHost` is a literal `<acct>` placeholder.

This RFC makes provisioning symmetric. `make set-new-label LABEL=x` now brings up the
backend to the same standard as the frontend: it resolves the account's workers.dev
subdomain, applies profile-derived CORS to the bucket, generates a per-tenant
`JWT_SECRET`, deploys the Worker through the existing deploy CLI, and optionally
attaches the `apiHost` custom domain. Secrets whose values originate outside the system
are *detected and reported*, never written.

## Motivation

Three concrete defects motivated this, all reachable from the current `main`:

1. **A provisioned label cannot serve authenticated traffic.** `JWT_SECRET` is the
   HMAC-SHA256 key for HS256 access tokens. `JwtAuthAdapter` throws when it is absent or
   shorter than 32 characters (`apps/api/src/adapters/auth/jwt-auth-adapter.ts:141-147`),
   and it is constructed inside `buildContainer` (`apps/api/src/container.ts:149`) — so a
   Worker deployed without it returns 500 on *every* authenticated route, not a graceful
   degradation. Provisioning only printed a hint.

2. **`make r2-cors-prod DEPLOY_LABEL=budo` wrote the wrong origins.** `apps/api/cors.json`
   was a single committed file carrying arenaquest *staging* origins
   (`http://localhost:3000`, `https://arenaquest-web-staging.pages.dev`). `DEPLOY_LABEL`
   parametrised only the bucket name, so running the target for any other tenant applied
   arenaquest's origins to that tenant's bucket — a cross-tenant misconfiguration.

3. **Staging `apiHost` values were unresolvable.** Profiles carry
   `api-budo-staging.<acct>.workers.dev`, and nothing ever substituted `<acct>`. That
   placeholder is derived into `GOOGLE_REDIRECT_URI` and baked into the deployed Worker
   (`apps/api/wrangler.jsonc:110,194`), so OAuth could never work for those tenants.

A fourth, latent issue: `make create-kv-*` created a namespace literally *titled*
`RATE_LIMIT_KV` — the binding name, which every tenant shares — contradicting the
`<label>-rate-limit-<env>` convention the provisioner uses and colliding in the account
namespace list.

## Goals & Non-Goals

**Goals**
- Bring the backend of a new label up to the same standard as its frontend, in one command.
- Generate `JWT_SECRET` per label **and** per environment, idempotently, without ever
  writing, logging or prompting for a secret value.
- Derive R2 CORS from the profile so it cannot drift from the Worker's `ALLOWED_ORIGINS`.
- Resolve the `<acct>` placeholder so `apiHost` and every value derived from it are real.
- Keep a single release code path: provisioning deploys by invoking the RFC 0011 CLI.
- Keep production behind the existing confirmation gate, and `--dry-run` exhaustive.

**Non-Goals**
- **Creating the Google OAuth client**, or registering its redirect URI. The provisioner
  reports the URI to register; creating the client stays manual.
- **Verifying the Resend sender domain.** Reported, not automated.
- **Registering or delegating DNS zones.** `--with-domain` attaches a Worker custom
  domain only when the zone is *already* active in the account; it never buys, adds or
  delegates one.
- **Pages custom domains.** A separate Cloudflare API surface from Worker routes; the
  provisioner reports the manual path.
- **Writing externally-valued secrets** (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`). Detected by name and reported; setting them
  stays with `scripts/create-secrets.sh` / `make secret-*`.
- **Rotating `JWT_SECRET`.** The provisioner never overwrites an existing one. Rotation
  is a separate, explicitly-flagged operation.
- **A second cloud provider.** As in RFC 0011, only the *structure* accommodates one:
  `scripts/label.mjs` stays pure and cloud-free, and everything that touches Cloudflare
  lives under `scripts/cloudflare/`.

## Proposed Design

### The pipeline

`provisionEnvironment` walks one ordered plan per label/environment:

```
d1 → kv → r2 → subdomain → write profile+wrangler → cors → pages
   → secrets → worker → [domain] → report external secrets
```

Two orderings carry the design and are asserted by unit tests:

- **The profile/wrangler write precedes every `--env <wranglerEnv>` command.** Wrangler
  resolves the target script name from the generated env block; without it,
  `secret put --env budo-staging` either fails or silently targets the top-level `api`
  Worker.
- **Secrets precede the first deploy.** `wrangler secret put` creates a draft Worker when
  none exists, and deploys never delete secrets. Setting `JWT_SECRET` first means the
  first real deploy boots with a valid signing key; the reverse order leaves a live
  Worker returning 500 on every authenticated route.

### One plan, printed and executed

`buildProvisionPlan(profile, env, options)` is a pure function returning ordered steps
`{ id, title, commands, note }`. `--dry-run` prints it; the executor walks it. A step
cannot be executed without appearing in the dry run, so dry-run coverage is structural
rather than a matter of discipline. The CORS temp-file path is deterministic so the
printed command is byte-identical to the executed one.

### CORS as derived data

`deriveCorsRules(profile, env)` splits `deriveExpected(profile, env).ALLOWED_ORIGINS`
rather than re-deriving origins. That single reuse means the bucket policy and the
Worker policy are two consumers of one derivation: production inherits exact-origins-only,
staging inherits the single preview-wildcard carve-out, and `checkPolicy` governs the one
string both consume. A unit test asserts the two can never diverge.

The committed `apps/api/cors.json` is deleted; the document is generated to a temp file
per run and removed afterwards.

### Secret hygiene

`JWT_SECRET` is 32 random bytes, hex-encoded, handed to wrangler over **stdin**. It is
never placed in argv, never written to disk, never logged. `putSecret` deliberately does
not route through `runCommand`, which echoes the command line and interpolates captured
output into its error message.

Presence is read with `wrangler secret list --format json`. A *failed* list returns
`null`, distinct from `[]`, and the step skips — treating "unknown" as "absent" would let
a re-run overwrite a good key. Because `<label>` and `<label>-staging` are two different
Workers with two different secret lists, no two tenants and no two environments can share
a signing key. That matters concretely: a shared `JWT_SECRET` means an access token
minted for tenant A verifies on tenant B.

### Custom domain: opt-in, fail-soft

`--with-domain` looks for a zone in the account whose name is the longest matching suffix
of `apiHost`. Found and active → `wrangler deploy --env <w> --domain <host>`, then record
`customDomain: true` in the profile so `buildEnvBlockObject` emits
`routes: [{ pattern, custom_domain: true }]`. Not found, not active, or the attach fails →
a warning and a follow-up; never a hard failure.

The flag lives in the **profile**, not the script, because every provision run regenerates
the whole env block — anything not derivable from the profile would be silently stripped.

Without the flag, the fallback path (workers.dev host plus a printed follow-up) is what
every default run exercises, which makes it the well-tested one.

## Alternatives Considered

- **A committed per-label CORS file** (`config/labels/cors/<label>-<env>.json`). Rejected:
  derived data with a second source of truth, which drifts from `webOrigin` — exactly the
  failure mode RFC 0007's derive-and-diff design exists to prevent.
- **Calling `wrangler deploy` directly from the provisioner.** Rejected: a second release
  call site reintroduces the divergence RFC 0011 removed, and would skip the fail-closed
  preflight, the no-dev-seed guard, and the `migrate`-before-`deploy` ordering that
  `buildPlan` already gets right.
- **Importing `deploy.mjs` in-process.** Rejected: it calls `process.exit()` on its failure
  paths and is written as an entrypoint, not a library.
- **Prompting for the external secrets during provisioning.** Rejected: it would make the
  whole bring-up non-automatable, and secret entry already has a home in
  `scripts/create-secrets.sh`.
- **Deploying the Worker before setting secrets.** Rejected once it was confirmed that
  `secret put` creates a draft Worker; the reverse order has a window where the Worker is
  live and broken.

## Implementation Plan

Delivered as milestone 18. Ordered so the pure layers land first:

1. Per-label R2 CORS derivation (`deriveCorsRules`, `renderCorsFile`) and `ensureR2Cors`.
2. workers.dev subdomain resolution and the `<acct>` placeholder write-back.
3. `JWT_SECRET` generation and external-secret detection.
4. `ensureWorker` via the deploy CLI.
5. Custom-domain detection behind `--with-domain`.
6. Makefile, docs and the `test-scripts` wiring.

## Tradeoffs & Risks

- **`make set-new-label` now deploys code.** Bring-up is no longer purely
  infrastructural. This is the point — parity with the frontend, which already got a real
  Pages project — but it means the command takes longer and can fail on an application
  build error rather than only on a Cloudflare error.
- **Changing `apiHost` silently breaks OAuth.** The redirect URI is derived and baked into
  the deployed Worker, so every path that mutates `apiHost` (subdomain resolution, custom
  domain) prints a loud re-register warning.
- **`scaffoldWranglerText` destroys hand edits** inside the `// >>> label:x >>>` markers on
  every run. Pre-existing, but the new `routes` key makes it more consequential — hence
  keeping `customDomain` in the profile.
- **The CF REST probes need `CF_API_TOKEN`.** An OAuth `wrangler login` session exposes no
  bearer token, and there is no `wrangler subdomain` command, so subdomain and zone
  resolution degrade to a printed follow-up in that path.

## Success Criteria

- `make set-new-label LABEL=x` on a fresh profile yields a Worker that answers a health
  check and returns a 4xx (not a 500) on a malformed authenticated request.
- Re-running it is a no-op: every step logs "already exists"/"already set", `git diff` is
  empty, and `JWT_SECRET` is unchanged.
- `wrangler r2 bucket cors list <label>-media-staging` returns origins matching the
  profile's `webOrigin` and containing no other tenant's host.
- `make label-check LABEL=x ENV=staging` reports real ✅/❌ for `api-secrets` instead of
  "⚠ skipped".
- No rendered command line in any code path can contain a secret value (unit-tested).

## Resolved Decisions

- **`wrangler secret list` takes `--format {json,pretty}`, not `--json`.** The previous
  `--json` in `scripts/label.mjs` made every `api-secrets` row report "skipped (no creds)"
  even when authenticated. Fixed here.
- **`wrangler secret put` does not require the Worker to exist** — it creates a draft, and
  deploys never delete secrets. This is what allows secrets-before-deploy.
- **`--only <step>` targets one environment.** A full run is a bring-up (staging, then
  production behind the gate); an `--only` run is a targeted repair, so `--production`
  there means production *instead of* staging. Otherwise `make r2-cors-prod` would quietly
  rewrite staging too, against the Makefile's environment-naming rule.

## References

- RFC 0007 — white-label environment bring-up, label profiles and preflight.
- RFC 0011 — branded deploy CLI; its Non-Goals scope provisioning and secret-setting out,
  which is what this RFC takes up.
- Milestone 18 — `docs/product/milestones/18-tenant-provisioning-backend-parity/`.
