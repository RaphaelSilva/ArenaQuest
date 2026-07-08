# Task 01 — Backend: Manifest and validator core (presence checks) (Phase 1)

**Status:** 📝 Open
**Milestone:** [14 — Deployment preflight & configuration validation](./milestone.md)
**RFC:** [RFC 0007](../../RFCs/0007-deployment-preflight-and-config-validation.md)
**Team:** Backend API

## Summary

Establish the committed configuration manifest and the core of the preflight
validator. This task authors `config/deployment.manifest.jsonc` — the single
source of truth listing every required key per scope (`web-build`, `api-vars`,
`api-secrets`, `ci-secrets`) with its attributes (`required`, `requiredWhen`,
`enum`, and placeholders for `coheres`/`contains`/`policy`/`manual` consumed by
Task 02) — derived from the current `apps/api/wrangler.jsonc`,
`apps/api/.dev.vars.example`, and the `deploy-web.yml` build env. It then delivers
`scripts/preflight.mjs` as a Node ESM script that accepts `--env
<local|staging|production>`, resolves the effective config for that target (Worker
`vars` by parsing `wrangler.jsonc` as JSONC with comments stripped — top-level for
production, the `env.staging` block for staging; web build env from the CI `env:`
or local `.env`; secret **names** via `wrangler secret list`), runs **presence**
checks for every `required` and active `requiredWhen` key, prints a checklist
grouped by scope with ✅/❌/⚠️ markers and a final summary, and exits `0`
all-pass / `1` any failure / `2` only manual-or-skipped outstanding. Secret values
are never read, logged, or compared — presence is verified by name only. Task 02
builds coherence, policy, and drift on top of this resolver and checklist core.

## Dependencies

- None — independent. This is the foundation Tasks 02 and 03 extend.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `config/deployment.manifest.jsonc` (**new**) — the manifest; the only place
    the required-key set is declared.
  - `scripts/preflight.mjs` (**new**) — the validator CLI: arg parsing, JSONC
    parse of `wrangler.jsonc`, config resolution per scope, presence checks,
    checklist output, exit-code mapping.
  - `scripts/__tests__/**` or `scripts/preflight.test.mjs` (**new**) — unit tests
    over the pure logic with fixtures.
  - Does not touch `apps/api/src`, the `apps/web` app, migrations, or any deploy
    step.
- **Read-only validator.** The script mutates nothing — it never sets a secret,
  writes config, builds, or deploys. It only reads repo files and the output of
  read-only `wrangler secret list`.
- **No secret exposure.** Secret presence is checked by *name* only; values are
  never read, printed, logged, or compared. This is enforced in code and review.
- **Stdlib only.** Node ESM, no added dependencies — JSONC is parsed by stripping
  comments before `JSON.parse`; no `jq`, no npm install.
- **Pure-logic separation.** Presence evaluation and exit-code mapping are pure
  functions taking resolved config + manifest, so they are unit-testable with
  fixtures and no live Cloudflare calls.
- **Credentials-absent is a skip, never a pass.** When `wrangler` cannot list
  secrets (no CF credentials), those entries are reported ⚠️ skipped, contributing
  to exit `2` — never reported ✅.

## Scope

In:
- `config/deployment.manifest.jsonc` populated from today's `wrangler.jsonc`,
  `.dev.vars.example`, and `deploy-web.yml`, with per-key attributes including
  `requiredWhen` (e.g. `RESEND_API_KEY` when `MAIL_DRIVER=resend`) and `enum`
  constraints.
- `scripts/preflight.mjs`: `--env` parsing; JSONC resolution of `api-vars`;
  resolution of `web-build` and `api-secrets` (names) per scope; presence checks
  for `required`/`requiredWhen`/`enum`; grouped checklist output; `0/1/2`
  exit-code mapping.
- Unit tests on the pure presence + exit-code logic against fixtures.

Out:
- Coherence anchors (`apiHost`/`webOrigin`), the `no-wildcard` policy, and
  `--check-drift` — all in Task 02.
- CI gate job, `make preflight` target, and runbook docs — Task 03.
- Any frontend or `apps/api/src/` change.

## Acceptance Criteria

- [ ] `config/deployment.manifest.jsonc` exists and lists every current
      `web-build`, `api-vars`, `api-secrets`, and `ci-secrets` key with its
      attributes.
- [ ] `node scripts/preflight.mjs --env staging` parses the `env.staging` block of
      `wrangler.jsonc` (comments and all) and prints a scope-grouped checklist.
- [ ] A missing `required` var/secret is reported ❌ by name and the process exits
      `1`; an all-present env exits `0`.
- [ ] An `enum`-constrained var with an out-of-range value is reported ❌.
- [ ] With CF credentials absent, `api-secrets` entries are reported ⚠️ skipped
      (not ✅) and the process exits `2`.
- [ ] No secret value appears anywhere in output or logs — only present/absent by
      name (verified by inspecting checklist output).
- [ ] Unit tests cover presence (present/missing/`requiredWhen`-active) and the
      `0/1/2` exit-code mapping, and pass.
- [ ] Changed files lint clean; `make test-api` and `make test-web` stay green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `node scripts/preflight.mjs --env production` and `--env staging` — confirm the
   correct `wrangler.jsonc` block is parsed and the checklist groups by scope.
2. Temporarily remove a `required` key from a fixture (or `wrangler.jsonc`) and
   confirm ❌ + exit `1`; restore and confirm exit `0` / `2`.
3. Run with no CF credentials and confirm secrets are ⚠️ skipped, never ✅, with
   exit `2`.
4. `make lint`, `make test-api`, `make test-web` — all green; new unit tests pass.
5. `git diff --stat` confirms only `config/deployment.manifest.jsonc`,
   `scripts/preflight.mjs`, and the new test file changed.
