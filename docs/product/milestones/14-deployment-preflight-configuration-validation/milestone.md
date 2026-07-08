# Milestone 14 — Deployment preflight & configuration validation

**Status:** 📝 Draft
**Scope:** Repo tooling and CI — `scripts/preflight.mjs`, `config/deployment.manifest.jsonc`, the two deploy workflows, the `Makefile`, and the `*.example` env files. Derived from [RFC 0007](../../RFCs/0007-deployment-preflight-and-config-validation.md).

> **Hard scope guardrail — read before opening any task.** This milestone ships a
> read-only configuration **validator** and the data it reads. It may touch only:
> `scripts/preflight.mjs` (new), `config/deployment.manifest.jsonc` (new), the
> `preflight` / drift wiring in `.github/workflows/deploy-web.yml` and
> `deploy-api.yml`, an additive `preflight` target in `Makefile`, the
> `apps/api/.dev.vars.example` and `apps/web/.env.example` templates (kept in sync
> with the manifest), and the index/runbook entry in `docs/product/RFCs/README.md`.
> It is explicitly **not** an opportunity to: **build or deploy** anything or alter
> the existing `deploy-*` steps beyond adding a `needs:` gate (Non-Goal: "Building
> or deploying"); **own or rename any feature's variables** — the manifest validates
> whatever is listed, it does not define brand/OAuth/endpoint vars (Non-Goal:
> "Owning any feature's variables"); **set, write, or rotate secrets** —
> provisioning stays with `create-secrets.sh` and the Cloudflare dashboard
> (Non-Goals: "Setting secrets / writing config", "Secret rotation / management");
> **validate third-party state** such as Google-console registration beyond emitting
> a manual reminder (Non-Goal: "Validating external third-party state"); or add
> **runtime health checks / smoke tests** against a live deployment (Non-Goal:
> "Runtime health checks"). Secret **values are never read, compared, or printed**
> — presence-by-name only. If a refactor opportunity is spotted outside this scope,
> file a separate task — do not bundle it.

---

## 1. Objectives

- **A single validator `scripts/preflight.mjs`.** Given `--env <local|staging|production>`,
  it prints a pass/fail checklist over presence + coherence + policy and exits
  non-zero on any failure — replacing tribal, scattered config knowledge with one
  command.
- **A committed manifest as the single source of truth.** `config/deployment.manifest.jsonc`
  declares every required key per scope (`web-build`, `api-vars`, `api-secrets`,
  `ci-secrets`) plus which are secret, coherence-linked, or policy-constrained;
  nothing else hardcodes the required set.
- **Presence checks across all three config surfaces.** Worker `vars` (parsed from
  JSONC `wrangler.jsonc`), web build env (`NEXT_PUBLIC_*`), and Worker secrets
  (verified by *name* via `wrangler secret list`, never by value).
- **Coherence checks.** Symbolic anchors (`apiHost`, `webOrigin`) resolve from the
  canonical fields and assert linked fields agree — `NEXT_PUBLIC_API_URL` ↔
  `GOOGLE_REDIRECT_URI` host, `WEB_BASE_URL` ↔ web origin, `ALLOWED_ORIGINS`
  *contains* the web origin.
- **Policy checks.** `no-wildcard-in-prod-staging` rejects the CORS full-wildcard
  `*` (and multi-label wildcards) in `ALLOWED_ORIGINS` for staging/production, per
  the CORS contract — enforced by tooling, not just review.
- **Drift detection (`--check-drift`).** Flags when the manifest, `wrangler.jsonc`,
  and the `*.example` files disagree, so a var added to one but not the others
  fails CI.
- **Two run sites, one implementation.** The same script runs locally
  (`make preflight ENV=…`) and as a **CI gate job** the `deploy-*` jobs `needs:`,
  so a misconfigured environment can't be deployed to.
- **Zero deploy-behaviour change on a healthy environment.** The gate is invisible
  when config is complete; it only ever blocks a broken environment.

Out of scope (explicit, from RFC 0007 Non-Goals):
- **Building or deploying** — CI keeps owning the build/deploy path; the validator
  only reads state and adds a `needs:` gate.
- **Owning any feature's variables** — RFC 0006 defines brand vars, other RFCs
  define theirs; preflight validates whatever the manifest lists.
- **Setting secrets / writing config** — provisioning stays with
  `scripts/create-secrets.sh` and the Cloudflare dashboard; a `--fix` mode is a
  future, separate addition.
- **Validating external third-party state** (e.g. whether `GOOGLE_REDIRECT_URI` is
  registered in the Google Cloud console) — preflight checks our side and emits a
  manual-confirmation reminder only.
- **Runtime health checks / smoke tests** of a live deployment — a separate,
  later concern; preflight runs *before* deploy against static config.
- **Secret rotation / management** — out of scope entirely.

---

## 2. Functional Requirements

- `node scripts/preflight.mjs --env <local|staging|production>` resolves the
  effective config for the target and prints a checklist grouped by scope
  (`web-build`, `api-vars`, `api-secrets`, `ci-secrets`) with ✅ / ❌ / ⚠️ markers
  and a final summary.
- Worker `vars` are read by parsing `apps/api/wrangler.jsonc` as **JSONC** (comments
  stripped): top-level block for production, the `env.staging` block for staging.
- Worker secret **presence** is verified by name via `wrangler secret list` (JSON
  output) for the target environment; values are never read, logged, or compared.
- Web build env (`NEXT_PUBLIC_*`) is resolved from the CI `env:` for the target
  environment and/or the local `.env` when `--env local`.
- Every `required` (and active `requiredWhen`, e.g. `RESEND_API_KEY` when
  `MAIL_DRIVER=resend`) key must resolve to a non-empty value / appear in the
  secret list, or the run reports a failure.
- Coherence checks pass only when the linked fields agree: `NEXT_PUBLIC_API_URL`
  and `GOOGLE_REDIRECT_URI` share the API host; `WEB_BASE_URL` matches the web
  origin; `ALLOWED_ORIGINS` contains the web origin.
- The `no-wildcard-in-prod-staging` policy fails when `*` or a multi-label wildcard
  appears in `ALLOWED_ORIGINS` for staging or production.
- Manual-only checks (Google-console registration) are reported as ⚠️ reminders,
  not silent passes.
- Exit codes: `0` when all required checks pass; `1` on any failure; `2` when only
  manual reminders / skipped secret-listing remain — and in CI the
  "secret-listing skipped" case is treated as a hard failure (never a false green).
- `node scripts/preflight.mjs --check-drift` asserts that every `api-vars` key in
  the manifest exists in `wrangler.jsonc` for each environment (and vice-versa),
  and that every required `api-secrets` / `web-build` key appears in the matching
  `*.example` file; it fails on any divergence.
- `make preflight ENV=<env>` runs the validator (defaulting to `local`) without
  altering any existing deploy target.
- A `preflight` CI job runs between `verify` and `deploy-*` inside the target
  GitHub `environment:`, and the `deploy-*` jobs `needs:` it so a failed preflight
  blocks the deploy; `--check-drift` runs in `verify`.

---

## 3. Acceptance Criteria

- [ ] `make preflight ENV=staging` (and `production`, `local`) prints a grouped
      checklist and exits `0` only when every required var/secret is present,
      coherent, and policy-compliant for that env.
- [ ] Removing a required secret from an environment makes the run report it ❌ by
      name and exit `1`.
- [ ] Pointing `WEB_BASE_URL` (or `GOOGLE_REDIRECT_URI`) at the wrong host makes the
      coherence check fail and exit `1`, naming the mismatched anchor.
- [ ] Leaving `*` (or a multi-label wildcard) in a staging/production
      `ALLOWED_ORIGINS` makes `no-wildcard-in-prod-staging` fail and exit `1`.
- [ ] In CI, a failing preflight blocks the `deploy-*` job (the deploy job does not
      run); a fully-configured environment passes silently and deploys as today.
- [ ] Secret **values never appear** in any output or log — only present/absent by
      name (verified by inspecting checklist output and CI logs).
- [ ] Adding a new variable to `wrangler.jsonc` (or a manifest key) without updating
      the manifest **or** the matching `*.example` fails `--check-drift` in `verify`.
- [ ] When CF credentials are absent, secret presence is reported **skipped (⚠️)** —
      never passed — and exit code is `2` locally / hard-fail in CI.
- [ ] Unit tests on the pure logic (presence, coherence, policy, exit-code mapping)
      pass against fixtures.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] No diff outside the scope declared in the guardrail.

---

## 4. Specific Stack

- **Validator:** Node ESM script (`scripts/preflight.mjs`), stdlib only — Node is
  already the CI runtime and parses JSONC `wrangler.jsonc` robustly (which `jq`
  cannot). URL/origin coherence via the `URL` API.
- **Manifest:** `config/deployment.manifest.jsonc` — JSONC (comments for rationale),
  the single source of truth for required keys per scope and their attributes
  (`required`, `requiredWhen`, `enum`, `coheres`, `contains`, `policy`, `manual`).
- **External commands shelled by the validator (read-only):** `wrangler secret list`
  (secret names, JSON), and optionally `gh api` for the GitHub Environment
  `ci-secrets` scope (best-effort, skipped-with-notice if `gh` is absent/unauthed).
- **CI:** GitHub Actions — a `preflight` gate job inside the target `environment:`
  in `deploy-web.yml` and `deploy-api.yml`, supplying `CF_API_TOKEN` /
  `CF_ACCOUNT_ID`; `--check-drift` wired into `verify`.
- **Local ergonomics:** additive `Makefile` target `preflight` (`ENV` defaulting to
  `local`); `*.example` files kept in sync with the manifest.
- **Tests:** unit tests over the pure validation logic with fixtures (no live
  Cloudflare/GitHub calls).

---

## 5. Task Breakdown

The execution plan. Each row is a `.task.md` file. All three are Backend
(tooling) tasks — there is no frontend surface in this milestone.

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Manifest and validator core (presence checks)](./01-manifest-and-validator-core-presence-checks.task.md) | 1 | Backend | ☐ Open |
| 02 | [Coherence, policy, and drift checks](./02-coherence-policy-and-drift-checks.task.md) | 2 | Backend | ☐ Open |
| 03 | [CI preflight gate, Makefile target, and docs](./03-ci-preflight-gate-makefile-target-and-docs.task.md) | 3 | Backend | ☐ Open |

Dependency graph:

```
01 (manifest + validator core)
      │
      ▼
02 (coherence + policy + drift)
      │
      ▼
03 (CI gate + Makefile + docs)
```

**Recommended execution order:** `01` → `02` → `03`.

Each task is intended to land as an independent PR with `make lint`,
`make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (resolved from RFC 0007 "Open Questions")

1. **`2` exit (manual reminders / skipped secret-listing) warns locally but hard-fails
   in CI.** Credentials should always be present in the deploy environment, so a
   skipped secret-listing in CI is a real gap, not an acceptable warning — never a
   false green. (RFC Open Question 1, proposed answer adopted.)
2. **`ci-secrets` via `gh api` is best-effort, skipped-with-notice.** Include the
   scope now but degrade gracefully when `gh` is absent or lacks a repo-admin-read
   token, rather than blocking on it. (RFC Open Question 2.)
3. **A `--fix` / interactive provisioning mode is out of scope.** Provisioning stays
   strictly separate in `create-secrets.sh`; preflight remains read-only. (RFC Open
   Question 3.)
4. **Post-deploy smoke tests are a separate follow-up.** This milestone stays
   pre-deploy / config-static; runtime health checks are deferred to a sibling RFC.
   (RFC Open Question 4.)
5. **The manifest ships as JSONC.** It mirrors `wrangler.jsonc`, allows rationale
   comments, and avoids a build step; a typed `manifest.ts` is revisited only if the
   validator later wants compile-time guarantees. (RFC Open Question 5.)

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC 0007 status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items remain backlog.
- [ ] No diff outside the scope declared in the guardrail.
