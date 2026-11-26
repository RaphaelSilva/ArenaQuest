# Task 12 — Frontend: Admin ledger, pending online payment and refund confirmation (Phase 4)

**Status:** 📝 Open
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Frontend Web
**Depends On:** [Task 08](./08-admin-checkouts-and-gateway-refunds.task.md)

## Summary

Makes online payments legible and operable in the admin billing backoffice (RFC §7): a gateway
row in the ledger reads **Online** with the provider's payment id and a **deep link** to the
provider's dashboard; reversing one shows a **refund confirmation** that says money will be
returned through the provider; the roster and the event-charge panel show **pending online
payment**; an admin can create a checkout **on behalf of a student** and copy its link; and the
payment form accepts the **gateway** method with a provider reference, which is how a payment is
matched by hand. A cash payment on a receivable with an open checkout stays possible, with a warning.

## Dependencies

- [Task 08](./08-admin-checkouts-and-gateway-refunds.task.md) — hard contract dependency: the
  on-behalf routes, the gateway refund answers and the pending flags.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/billing/**` (ledger tab, reverse form, students tab,
    statement panel, payment form, extras tab, error explanations, tests).
  - `apps/web/src/app/(protected)/admin/events/[eventId]/event-charges-panel.tsx` and its test.
  - `apps/web/src/lib/admin-billing-api.ts` and its test.
  - `apps/web/src/lib/api-types.gen.ts` — regenerated, never hand-edited.
  - `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts`.
- **No backend change.** The task consumes Task 08's and Task 04's contracts as published in
  `apps/api/openapi.json`.
- **The deep link is built on the client** from the row's reference (`<provider>:<id>`) and the
  URL template in the shared capability table (milestone §6, decision 25). No template → the id
  is shown as text. The link opens in a new tab with `rel="noopener noreferrer"`.
- **A refund is confirmed in words.** Before reversing a gateway row the dialog says which
  provider will be asked, the amount, and that the reversal is written only when the provider
  accepts. It needs an explicit confirmation distinct from the plain reversal's.
- **Every refund answer has a message:** accepted; already refunded (recorded now); refused by
  the provider (nothing changed); provider not enabled; accepted but not recorded — with a
  *Try again* that repeats the same request safely.
- **Admin only.** The new actions render only for `admin`; a `content_creator` who reaches the
  pages sees no gateway action. The API remains the authority.
- **i18n.** No hardcoded user-facing string; both dictionaries keep identical keys. Money through
  the shared `format-money` helper.

## Scope

**In:**
- Ledger: method *Online*, provider and payment id, deep link, refund rows labelled as refunds
  (including refunds made on the provider's dashboard, which have no original to point at).
- Reverse form: the gateway branch with its confirmation text and the five outcomes above.
- Roster and statement panel: *pending online payment* with the expiry; the same on the
  event-charge panel.
- On behalf: *Create payment link* on an open invoice and an open charge (provider choice when
  several), the hosted URL shown with *Copy* and its expiry; reusing the live one when it exists.
- Payment form: method *Online (gateway)* requires a reference in the `<provider>:<id>` form
  (provider chosen from the bound list, id typed), maps the duplicate-reference answer to a
  message naming the existing payment, and warns — without blocking — when the receivable has an
  open checkout.
- Tests (Vitest + React Testing Library): a gateway row with and without a template; the refund
  dialog's copy and each outcome; pending flags; link creation and copy; the gateway payment
  form's validation and the duplicate message; no gateway action for a non-admin.

**Out:**
- The exceptions tab (Task 13) and the student surfaces (Tasks 10, 11).
- Partial refunds and any provider configuration screen — not in v1.

## Acceptance Criteria

- [ ] A gateway payment in the ledger shows *Online*, its provider id and a working deep link.
- [ ] Reversing a gateway payment shows the refund confirmation; cancelling it sends no request.
- [ ] A refused refund leaves the ledger view unchanged and shows the provider's refusal.
- [ ] A student with an open checkout is marked on the roster and on their statement panel.
- [ ] An admin can create and copy a payment link for a student's open invoice at 390 px.
- [ ] Recording cash on a receivable with an open checkout warns and still succeeds.
- [ ] `check-i18n-coverage.js` green; `dict-en.ts` and `dict-pt.ts` have identical keys.
- [ ] Changed files lint clean; `make test-web` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `cd apps/web && pnpm gen:api-types` — the generated types carry the new routes and fields.
2. `cd apps/web && pnpm test src/app/\(protected\)/admin/billing` — the backoffice suites pass.
3. `make test-web` — green.
4. `make dev` — as the seeded admin: create a link on behalf, see the pending flag, reverse a
   gateway payment against the stub or the sandbox, at 390 px and desktop width.
5. `git diff --stat` confirms only scope-guardrail files changed.
