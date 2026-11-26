# Task 16 — Backend: Operations runbook, staging rollout and closeout (Phase 5)

**Status:** 📝 Open
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Backend API
**Depends On:** [Task 09](./09-reconcile-run-and-exceptions-routes.task.md), [Task 11](./11-dashboard-payment-due-card.task.md), [Task 12](./12-admin-ledger-online-payments.task.md), [Task 13](./13-payment-exceptions-panel.task.md), [Task 14](./14-reminder-email-pay-link.task.md), [Task 15](./15-provider-configuration-and-provisioning.task.md)

## Summary

Closes the milestone: the **operations runbook** `docs/operations/payments.md`, the onboarding
and `CLAUDE.md` sections, the **budo staging rollout** on Mercado Pago sandbox keys with a
recorded end-to-end walk, the evidence for acceptance signals **S1–S9**, and the closeout that
moves the milestone and the RFC to done. It is the only task that changes an environment's
provider list, and it changes exactly one — **budo staging**. Production stays `none`: flipping
it is the owner's act, after a real R$ 1,00 charge and its refund, and this task leaves the
exact steps for it.

## Dependencies

- [Task 09](./09-reconcile-run-and-exceptions-routes.task.md), [Task 11](./11-dashboard-payment-due-card.task.md),
  [Task 12](./12-admin-ledger-online-payments.task.md), [Task 13](./13-payment-exceptions-panel.task.md),
  [Task 14](./14-reminder-email-pay-link.task.md), [Task 15](./15-provider-configuration-and-provisioning.task.md)
  — everything the walk exercises must be on `main` and deployed to staging first.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `docs/operations/payments.md` (new).
  - `docs/onboarding.md`, `CLAUDE.md`, `docs/ReleaseNotes.md`.
  - `apps/api/wrangler.jsonc` — the provider list of the **budo staging** block only.
  - `apps/api/.dev.vars.example` — comments only, if the runbook's local recipe needs them.
  - `docs/product/milestones/30-payment-gateway/**` (statuses, the closeout notes) and the
    RFC's status line and index row.
- **Order of the staging flip.** The operator sets the two sandbox secrets and registers the
  webhook URL first; `infra-check` shows both secrets present; only then does the list change
  merge. A list naming a provider whose secrets are absent makes every payment route `500`.
- **Secrets never pass through this task.** The runbook gives the command that prompts for a
  value; no secret, token or signed URL appears in a document, a commit, a PR description or a
  recorded walk. Screenshots are checked for them.
- **Production writes are the operator's.** Nothing in this task deploys to, configures or
  queries a production environment.
- **Tier-3 commands are documented, not wrapped.** No Makefile target or script is added for
  refunds, list flips or secret rotation.
- **Evidence is recorded where the milestone's Definition of Done asks for it,** with dates and
  ids — never an amount tied to a real person.
- **No runtime source change.** A defect found during the walk becomes its own fix PR against
  the task that owns the file, and the walk is repeated.

## Scope

**In:**
- The runbook: what the gateway does and does not do (collector; never gates access); enabling a
  provider on a label (the list grammar, key mode, the two secrets, the webhook URL to register
  and which events to subscribe); disabling and **retiring** a provider (keep it bound with no
  method until its checkouts and refunds have drained); rotating a webhook secret and a secret
  key; reading the exceptions tab — each kind, its likely cause and the action, including that a
  refund made at the provider for an unlanded payment arrives as another orphan to dismiss; the
  refund outcomes and what to do after *accepted but not recorded*; disputes and the hold; the
  reconcile run (schedule, caps, summary fields, how to run it by hand, what `failed` means);
  the Cron Trigger allowance recorded from Task 09; previews (they run with an empty registry);
  a local recipe with the sandbox; the **production go-live checklist** (live secrets, key mode
  `live`, webhook, the R$ 1,00 charge and refund, what to verify in the ledger, how to roll back
  to `none`).
- Onboarding: a "Payments" section pointing at the runbook; `CLAUDE.md`: the bindings, the
  webhook as the second anonymous surface, the hourly job, the secret contract.
- The staging walk on budo, recorded: a demo student pays a demo invoice by simulated Pix and an
  event charge by test card at 390 px; the ledger rows carry the system actor; an admin refunds
  one; a payment whose webhook is withheld lands on the next hourly run; a tampered delivery is
  refused; a live-mode key is rejected (S7, on a preview or a throwaway setting, then restored).
- S1–S9: each signal ticked in the milestone with a pointer to its evidence (test name, run id
  or walk step).
- Closeout: milestone status and task statuses, RFC status and index row, release notes, and a
  list of follow-ups filed in the backlog (partial refunds from the admin, a second adapter, an
  out-of-app alert for new exceptions, a narrowing-only configuration page).

**Out:**
- Enabling payments on budo production or on any other label.
- A second provider adapter.

## Acceptance Criteria

- [ ] `docs/operations/payments.md` exists and an operator can enable, retire and roll back a
      provider from it alone.
- [ ] `make infra-check-staging LABEL=budo` reports both Mercado Pago secrets present, and budo
      staging runs the bound list on sandbox keys with the webhook registered.
- [ ] The recorded walk shows a Pix payment and a card payment landing with no human step, one
      refund, and one payment recovered by the reconcile run.
- [ ] Every other label and environment, budo production included, still deploys with `none`
      (`grep` of the Worker configuration shows one non-`none` list).
- [ ] S1–S9 are ticked in the milestone, each with its evidence.
- [ ] No secret value appears anywhere in the diff or the PR.
- [ ] `make lint`, `make test-api` and `make test-web` green on the closing commit.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Follow the runbook's "enable a provider" section on budo staging exactly as written; fix the
   document wherever a step was unclear.
2. Run the walk; attach the evidence to the milestone's closeout notes.
3. `node .claude/skills/write-feature/check-feature.mjs` and
   `node .claude/skills/write-tasks/check-task.mjs --milestone 30` — clean.
4. `make lint`, `make test-api`, `make test-web` — green.
5. `git diff --stat` confirms only scope-guardrail files changed.
