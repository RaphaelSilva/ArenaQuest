# Task 14 — Backend: Pay link in the reminder e-mails (Phase 4)

**Status:** ✅ Done
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Backend API
**Depends On:** [Task 07](./07-student-checkout-routes.task.md)

## Summary

Adds a **pay link** to the reminder e-mails the daily billing run already sends (RFC §7): the
two contract reminders (due date, grace lapsed) and their two event-charge twins gain one line
and one link to the student's statement page, **only when the tenant offers online payment**.
The link goes to `/settings/billing` on the label's own web origin — never to a provider, never
to a checkout: a checkout is created when the logged-in student presses *Pay*, so no e-mail ever
carries a URL that pays someone's invoice. With `PAYMENTS_PROVIDERS = none` every reminder is
byte-for-byte what it is today.

## Dependencies

- [Task 07](./07-student-checkout-routes.task.md) — hard code dependency: the pay options
  resolved from the registry for the active currency, which decide whether the line is added.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/core/billing/billing-service.ts` — the reminder builders' copy only.
  - `apps/api/src/container.ts` — only if the billing service needs the pay-options resolver handed in.
  - `apps/api/test/core/billing/billing-service.spec.ts`, `apps/api/test/core/billing/invoice-run.spec.ts`,
    `apps/api/test/core/billing/invoice-run-extras.spec.ts`.
- **Copy only.** No new reminder kind, no new trigger, no change to when or to whom a reminder
  goes, no change to the idempotency key that keeps a reminder from being sent twice.
- **The link is the statement page**, built from the same web base URL the existing reminder
  links use. It carries no checkout id, no token, no amount and no invoice id in the query.
- **Conditional on pay options, not on configuration validity.** An invalid provider list means
  no line (the run keeps sending reminders as today); it never fails the billing run. The
  failure stays loud where RFC §2 puts it — the payment routes and the reconcile run.
- **No provider call** is made while building a reminder, and no checkout is created.
- **Language** follows whatever the existing reminders do for the label; the new line is added
  in each language the reminder already exists in.
- **Never gates.** The wording invites; it does not threaten loss of access, because none happens.

## Scope

**In:**
- The extra line and link in the four reminder builders, in the text and (where one exists) the
  HTML part.
- Tests: each of the four reminders with one provider offering a method (line present, link
  equals the statement URL); with `none` (output identical to a stored snapshot of today's
  message); with an invalid list (no line, run succeeds); with a provider bound but offering no
  method for the active currency (no line).

**Out:**
- A *Pay* button that opens a checkout straight from the e-mail — rejected by the RFC.
- New reminder moments (for example "your Pix expires soon") and any receipt e-mail after an
  online payment — not in v1.
- Any change to the web statement page (Task 10).

## Acceptance Criteria

- [x] With a bound provider, all four reminders contain exactly one link to `/settings/billing`
      on the label's web origin, and no provider hostname.
- [x] With `PAYMENTS_PROVIDERS = none`, each reminder equals today's output character for character.
- [x] A billing run with an invalid provider list completes and sends reminders without the line.
- [x] No reminder test observes a provider call or a new `gateway_checkouts` row.
- [x] Changed files lint clean; `make test-api` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `cd apps/api && pnpm test test/core/billing` — the reminder and run suites pass.
2. `make test-api` — green.
3. `make dev-api` with the console mail driver and a stub-bound list: trigger the billing run
   locally and read the printed reminder.
4. `git diff --stat` confirms only scope-guardrail files changed.
