# Task 15 — Backend: Provider configuration schema and provisioning (Phase 5)

**Status:** 📝 Open
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-provider-list-and-gateway-registry.task.md)

## Summary

Teaches the deployment tooling about the payment configuration (RFC §2, R13): the schema declares
**`PAYMENTS_PROVIDERS`** and **`PAYMENTS_KEY_MODE`** as optional Worker vars and, for each known
provider, the two secrets **`PAYMENTS_<PROVIDER>_SECRET_KEY`** and
**`PAYMENTS_<PROVIDER>_WEBHOOK_SECRET`**, required only when that provider appears in the list.
`requiredWhenActive` gains a **contains** operator (`~=`) to express that, and `infra-check`
reports the secrets **by name** with their fix command. Provisioning still never writes an
externally-valued secret. After this task `make infra-check-staging LABEL=budo` tells the
operator exactly which two secrets a bound provider is missing.

## Dependencies

- [Task 02](./02-provider-list-and-gateway-registry.task.md) — hard code dependency: the list
  grammar and the provider names this tooling must agree with, and the vars pinned in the
  Worker configuration that the checks read.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `config/deployment.schema.jsonc` — two `api-vars` entries and the `api-secrets` pairs.
  - `scripts/label.mjs`, `scripts/label.test.mjs` — the `~=` operator and its callers.
  - `scripts/cloudflare/provision-label.mjs`, `scripts/cloudflare/provision-label.test.mjs` —
    `externalSecretNames` and the `--check` report.
- **`~=` means "the list names this provider".** The condition `PAYMENTS_PROVIDERS~=mercadopago`
  is active when the comma-separated value has an entry whose provider part equals
  `mercadopago` — including a retired entry with no method — and inactive for `none`, for an
  absent or empty value, and for a provider whose name merely contains the text. The existing
  `KEY=value` form keeps its exact behaviour.
- **Conditions are evaluated against the environment's resolved vars** — the profile plus the
  committed Worker block — everywhere a `requiredWhen` is read; today one caller passes only the
  mail driver, which would make every payment secret look unneeded.
- **Secret contract (RFC 0012).** These secrets are *detected by name and reported with their
  fix command*; no code path writes them, generates them or reads their value, and no value
  reaches argv, disk or a log line. `JWT_SECRET` stays the only generated secret.
- **One list of providers.** The schema names the same four providers the shared capability
  table knows; a test fails when the two drift.
- **No runtime change.** The Worker's own validation of the list is Task 02's; this task is
  build-time tooling only and its suites run with `node --test`.
- **Defaults stay dark.** No label profile and no Worker block changes value here; every
  environment remains `none`.

## Scope

**In:**
- Schema: `PAYMENTS_PROVIDERS` (optional), `PAYMENTS_KEY_MODE` (optional, enum `test` / `live`),
  and eight conditional secrets (two for each of `stripe`, `mercadopago`, `asaas`, `pagarme`),
  with a comment pointing at the runtime guard, in the style of the submissions block.
- `requiredWhenActive` with `~=`; `externalSecretNames`, the secrets scaffold and the external
  confirmations all evaluating against the resolved vars.
- `--check` / `make infra-check-<env> LABEL=x` (`JSON=1` included): each active payment secret
  listed as present or missing by name, a missing one with its `create-secrets.sh` command for
  that label and environment; nothing listed for a label on `none`.
- A webhook reminder in the `external` confirmations, active when any provider is bound: the
  URL to register at the provider, built from the environment's API host.
- Tests: `~=` truth table (bound, retired, `none`, absent, substring trap, two providers); the
  `=` form unchanged; `externalSecretNames` for `none`, one provider, two providers;
  the check report naming a missing secret without printing any value; the provider-list drift test.

**Out:**
- Setting any secret, flipping any environment's list, registering a webhook — operator acts
  described in the runbook (Task 16).
- A configuration screen — not in v1.

## Acceptance Criteria

- [ ] `requiredWhenActive('PAYMENTS_PROVIDERS~=mercadopago', …)` is true for
      `mercadopago:pix+card`, for `stripe:card,mercadopago:pix` and for `mercadopago:`, and false
      for `none`, for an absent value and for `stripe:card`.
- [ ] `make infra-check-staging LABEL=arenaquest` names no payment secret.
- [ ] With a Worker block set to `mercadopago:pix+card`, the check lists exactly
      `PAYMENTS_MERCADOPAGO_SECRET_KEY` and `PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET`, each with its
      fix command when missing, and prints no value.
- [ ] `make set-new-label LABEL=x DRY_RUN=1` plans no write for any payment secret.
- [ ] `node --test scripts/label.test.mjs scripts/cloudflare/provision-label.test.mjs` passes;
      `make lint` clean; `make test-api` green (no runtime file changed).
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/label.test.mjs scripts/cloudflare/provision-label.test.mjs` — passes.
2. `make infra-check-staging LABEL=budo JSON=1` — no payment secret listed while the list is `none`.
3. In a scratch copy of the Worker block set the list to `mercadopago:pix`, re-run the check,
   confirm the two names and their fix commands, then discard the change.
4. `make lint` and `make test-api` — green.
5. `git diff --stat` confirms only scope-guardrail files changed.
