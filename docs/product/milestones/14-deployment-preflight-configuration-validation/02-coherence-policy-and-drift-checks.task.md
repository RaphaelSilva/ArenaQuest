# Task 02 — Backend: Coherence, policy, and drift checks (Phase 2)

**Status:** 📝 Open
**Milestone:** [14 — Deployment preflight & configuration validation](./milestone.md)
**RFC:** [RFC 0007](../../RFCs/0007-deployment-preflight-and-config-validation.md)
**Team:** Backend API

## Summary

Extend the validator core from Task 01 with the three remaining check classes:
**coherence**, **policy**, and **drift**. Coherence resolves the symbolic anchors
declared in the manifest — `apiHost` (from `NEXT_PUBLIC_API_URL` /
`GOOGLE_REDIRECT_URI`) and `webOrigin` (from `WEB_BASE_URL` / the deployed web
origin) — and asserts the linked fields agree: `NEXT_PUBLIC_API_URL` and
`GOOGLE_REDIRECT_URI` share the API host, `WEB_BASE_URL` matches the web origin,
and `ALLOWED_ORIGINS` *contains* the web origin. Policy adds
`no-wildcard-in-prod-staging`, which fails when `*` or a multi-label wildcard
appears in `ALLOWED_ORIGINS` for staging or production, enforcing the CORS
contract in tooling rather than review. Manual-only entries (e.g.
`GOOGLE_REDIRECT_URI` registration in the Google Cloud console) are emitted as ⚠️
reminders that contribute to exit `2`, never silent passes. Finally, a
`--check-drift` mode asserts the manifest, `wrangler.jsonc`, and the `*.example`
templates agree — every `api-vars` key in the manifest exists in `wrangler.jsonc`
for each environment and vice-versa, and every required `api-secrets`/`web-build`
key appears in the matching `*.example` file — failing on any divergence. Task 03
wires the env-mode run and `--check-drift` into CI and the Makefile.

## Dependencies

- [Task 01 — Manifest and validator core](./01-manifest-and-validator-core-presence-checks.task.md)
  — hard dependency: this task consumes Task 01's config resolver, manifest schema,
  checklist output, and exit-code mapping.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/preflight.mjs` — add coherence anchors + `coheres`/`contains`
    checks, the `no-wildcard-in-prod-staging` policy, manual-reminder output, and
    the `--check-drift` mode.
  - `config/deployment.manifest.jsonc` — populate the `coheres`, `contains`,
    `policy`, and `manual` attributes left as placeholders in Task 01.
  - `apps/api/.dev.vars.example`, `apps/web/.env.example` — bring into sync with
    the manifest so `--check-drift` passes (add any missing required keys).
  - `scripts/__tests__/**` or `scripts/preflight.test.mjs` — coherence, policy,
    and drift unit tests.
  - Does not touch `apps/api/src`, the `apps/web` runtime code, migrations, or any
    deploy step.
- **Read-only validator.** Still mutates nothing; coherence/policy/drift read repo
  files and resolved config only.
- **No secret exposure.** Coherence operates on non-secret URL/origin vars; secret
  entries remain name-only.
- **Conservative rules.** Coherence links and the policy are declared in the
  manifest, not hardcoded, and are validated against the three current
  environments so a legitimate topology is not falsely blocked.
- **URL/origin matching via the `URL` API.** Host/origin equality and "contains"
  use parsed URL components, not string includes, to avoid false matches.
- **Stdlib only**, pure-logic separation preserved — coherence, policy, and drift
  evaluation are pure functions over resolved config + manifest, unit-tested with
  fixtures.

## Scope

In:
- Anchor resolution (`apiHost`, `webOrigin`) and the `coheres` / `contains`
  checks wired from manifest attributes.
- `no-wildcard-in-prod-staging` policy rejecting `*` and multi-label wildcards in
  staging/production `ALLOWED_ORIGINS`.
- Manual-reminder (⚠️) output for `manual`-flagged keys, feeding exit `2`.
- `--check-drift` mode: manifest ↔ `wrangler.jsonc` (per env, both directions) and
  manifest ↔ `*.example` for required secrets/build vars.
- Syncing `.dev.vars.example` and `.env.example` to the manifest.
- Unit tests for each new check (pass + each failure shape).

Out:
- The CI `preflight` gate job, the `make preflight` target, and runbook docs —
  Task 03.
- Any frontend or `apps/api/src/` runtime change.

## Acceptance Criteria

- [ ] Pointing `WEB_BASE_URL` (or `GOOGLE_REDIRECT_URI`) at the wrong host makes
      the coherence check fail with exit `1`, naming the mismatched anchor.
- [ ] An `ALLOWED_ORIGINS` that omits the web origin fails the `contains` check.
- [ ] `*` or a multi-label wildcard in a staging/production `ALLOWED_ORIGINS` fails
      `no-wildcard-in-prod-staging` with exit `1`; a `local` env with `*` does not.
- [ ] A `manual`-flagged key is reported ⚠️ and contributes to exit `2` when no
      hard failure exists.
- [ ] `node scripts/preflight.mjs --check-drift` fails when a key exists in
      `wrangler.jsonc` but not the manifest (or vice-versa), or when a required
      secret/build key is missing from its `*.example`.
- [ ] `.dev.vars.example` and `.env.example` are in sync with the manifest such
      that `--check-drift` passes on the committed tree.
- [ ] Coherence/policy/drift logic is covered by unit tests (pass + each failure
      shape) that pass.
- [ ] Changed files lint clean; `make test-api` and `make test-web` stay green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Flip `WEB_BASE_URL` to a wrong host in a fixture and confirm a named coherence
   failure + exit `1`; restore and confirm pass.
2. Inject `*` into a staging `ALLOWED_ORIGINS` fixture and confirm the policy fails;
   confirm `--env local` with `*` is allowed.
3. `node scripts/preflight.mjs --check-drift` on the committed tree exits `0`; add a
   throwaway key to `wrangler.jsonc` only and confirm drift fails.
4. `make lint`, `make test-api`, `make test-web` — all green; new unit tests pass.
5. `git diff --stat` confirms only `scripts/preflight.mjs`, the manifest, the two
   `*.example` files, and the test file changed.
