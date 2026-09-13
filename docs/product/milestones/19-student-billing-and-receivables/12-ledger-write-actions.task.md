# Task 12 — Frontend: Ledger write actions (Phase 5)

**Status:** ✅ Done
**Milestone:** [19 — Student billing, contracts and receivables accounting](./milestone.md)
**RFC:** [RFC 0013](../../RFCs/0013-student-billing-contracts-and-receivables-accounting.md)
**Team:** Frontend Web
**Depends On:** [Task 03](./03-billing-service-and-the-admin-lifecycle-api.task.md), [Task 10](./10-contract-signing-standard-and-negotiated.task.md)

## Summary

Turns the Ledger tab from a report into a place where money is recorded. Four actions
join the Reverse affordance already there: issue an invoice for a contract's period, void
one with its mandatory reason, apply an adjustment — discount, credit, waiver or
surcharge — and record a payment with its method and optional external reference.
Recording a payment is the one the dojo needs most often and cannot do at all today:
money arrives as cash, transfer or Pix in the instructor's own bank, and until an admin
can enter it the ledger disagrees with reality from the first week. Every action is a
signed, attributable row, and the tab keeps making the append-only model visible to a
non-engineer — Reverse and void and a signed adjustment are the corrections, and Delete
exists nowhere. Issuing is deliberately the narrowest of the four: it bills a contract's
period, it is bound by a uniqueness rule to one invoice per contract per period, and the
form has to say which contract and which period it is writing so nobody mistakes it for a
way to sell something.

## Does this need a backend change?

**No.** `apps/web/src/lib/admin-billing-api.ts` already implements `invoices.create`,
`invoices.void`, `invoices.addAdjustment` and `invoices.addPayment`, against
`POST /v1/admin/billing/invoices`, `.../invoices/{id}/void`,
`.../invoices/{id}/adjustments` and `.../invoices/{id}/payments` from RFC 0013 §5 — all
delivered and tested by Task 03, and called by no component today. `payments.reverse` is
already wired to the existing Reverse control and is untouched by this task.

One thing this task must **not** try to work around: issuing an invoice requires an
existing contract, because the invoice table's contract reference is non-nullable and the
API's request schema requires it. The uniqueness rule on contract plus period start is
what makes the daily run idempotent, and it equally means a second invoice for the same
contract and period is refused. That is correct behaviour to surface, not a limitation to
route around — and it is why this screen is not, and must not present itself as, a way to
bill a one-off seminar or any other non-recurring item. `git diff` for this task must
contain no file under `apps/api/` or `packages/`.

## Dependencies

- [Task 03](./03-billing-service-and-the-admin-lifecycle-api.task.md) — owns all four
  endpoints. Already `✅ Done`.
- [Task 10](./10-contract-signing-standard-and-negotiated.task.md) — there is no contract
  to invoice against before signing exists, and the contract picker this screen needs for
  issuing reuses what that task introduces.
- The existing Ledger tab at
  `apps/web/src/app/(protected)/admin/billing/ledger-tab.tsx`, its filters, its CSV
  export and its Reverse flow — all extended, none replaced.
- The per-student statement panel, where adjustments and payments already render beneath
  their invoice.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/billing/**` — the Ledger tab's four new actions
    and their forms, plus the statement panel where a new row must appear.
  - `apps/web/src/components/**` and `apps/web/src/hooks/**` — only pieces these actions
    introduce.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are typed).
  - `apps/web/**` component tests.
- **Frontend only.** No backend file is touched, and `admin-billing-api.ts` is consumed
  as it stands. The manual cycle run is Task 13 and adds the only new client method in
  this area.
- **Delete exists nowhere.** No payment and no adjustment gets a delete control. The
  corrections are Reverse on a payment, void on an invoice and a further signed
  adjustment, and the tab's copy explains that a correction is an entry rather than an
  edit — which is what an administrator who wants to "delete a mistake" needs to be shown.
- **Void requires its reason, and so does a reversal.** Neither form submits without one.
- **An adjustment's kind is named in the administrator's language, with its effect
  stated.** Discount, credit, waiver and surcharge each mean something specific to the
  balance, and the form says which direction each moves it rather than assuming the
  administrator knows.
- **Surcharge is hand-applied only.** Nothing on the screen accrues, schedules, suggests
  or computes a late fee, and no control offers a percentage or a recurring charge. The
  scheduled job never writes an adjustment of any kind, and this screen must not imply
  otherwise.
- **Issuing names its contract and its period.** The form makes explicit which contract
  and which period it bills, and a refusal caused by an invoice already existing for that
  contract and period is reported as exactly that — not as a generic failure, and not
  silently swallowed as success.
- **Issuing is not a sales path.** The screen must not present issuing as a way to charge
  for a seminar, a one-off class or any item outside a contract's periodic billing.
  Non-recurring revenue is not expressible in this data model and is out of scope for the
  milestone.
- **Money is entered and submitted as integer minor units** against the currency's
  recorded exponent, and rendered only through the shared money formatter.
  `Intl.NumberFormat`'s currency style must not appear in this diff.
- **A payment's own currency and method come from the API's accepted values**, and the
  external reference stays optional — it is where a future provider's charge id will
  land, and an administrator recording cash leaves it empty.
- **No standing rule in the client.** No form previews what a payment or an adjustment
  will do to a standing or a balance beyond what the API returns after the write. The
  invoice's status is a cache of "balance reached zero" and is not recomputed locally.
- **No paywall affordance.** None of the four actions gates, suspends, downgrades or
  restricts a student's access, and no copy suggests that recording or not recording a
  payment does.
- **App Router conventions.** The Ledger tab is already a Client Component; this task
  follows it and converts no existing Server Component.
- **i18n.** No hardcoded user-facing string under `src/{app,components,hooks}/**`;
  `dict-en.ts` and `dict-pt.ts` keep identical keys and `check-i18n-coverage.js` passes.
- **Responsive & accessible.** The four forms stay usable at mobile width, every field is
  labelled, and validation messages are associated with their fields.

## Scope

In:
- **Record a payment** on an open invoice: amount, method, paid-at date and an optional
  external reference, with the new row appearing beneath its invoice and the invoice's
  status reflecting what the server returned.
- **Apply an adjustment**: kind, amount and a mandatory reason, with the effect of each
  kind stated in the form.
- **Void an invoice** with its mandatory reason, and the voided invoice rendering as such.
- **Issue an invoice** for a chosen contract and period, with the contract and period
  named in the form, and the already-issued case reported explicitly.
- Copy on the tab explaining that the ledger is append-only, why there is no Delete, and
  what Reverse, void and a signed adjustment each do.
- Success and error feedback per action, carrying the server's explanation when it sends
  one, and leaving the list consistent with what actually persisted.
- Dictionary keys in both languages for all of the above.
- Component tests for: each action's request payload; void and adjustment refusing to
  submit without a reason; the absence of any delete control on a payment or an
  adjustment; a duplicate issue surfacing the server's refusal; amounts submitting as
  integer minor units at exponents 2, 0 and 8; and a recorded payment rendering beneath
  its invoice.

Out:
- Any backend change — Task 03 owns all four endpoints.
- The manual cycle run and its report — Task 13, which owns the only new client method.
- Reversing a payment — already shipped by Task 07 and untouched here.
- Plans, signing, lifecycle and amendment — Tasks 09, 10 and 11.
- Automatic late fees, interest, accrual, percentages or a dunning sequence — milestone
  Non-Goals.
- Selling seminars, one-off classes or any non-recurring item.
- A payment-gateway flow, card entry or webhook. The external reference field exists for
  a future provider; no provider is integrated here.
- Proration or partial-period arithmetic.

## Acceptance Criteria

- [x] Recording a payment on an open invoice issues the expected request, the payment
      renders beneath its invoice with its method and author, and the invoice's status
      reflects the server's response rather than a local recomputation.
- [~] A payment recorded for the full balance settles the invoice, and the student's
      standing on the Students tab updates to what the API resolves — with no threshold
      logic in the client.
- [x] Applying each of the four adjustment kinds issues the expected request, requires a
      reason, and the form states how that kind moves the balance.
- [x] Voiding an invoice requires a reason and the invoice renders as voided afterwards.
- [x] Issuing an invoice names the contract and the period being billed; issuing twice for
      the same contract and period surfaces the server's refusal explicitly and creates
      nothing.
- [x] No delete control exists for a payment or an adjustment anywhere on the tab, and the
      copy explains that a correction is an entry rather than an edit.
- [x] Nothing on the screen accrues, schedules or suggests a late fee; no percentage or
      recurring-charge control exists.
- [x] Nothing on the screen presents issuing as a way to sell a seminar or any item
      outside a contract's periodic billing.
- [x] Amounts render and submit as integer minor units at exponents 2, 0 and 8 through the
      shared money formatter, and `Intl.NumberFormat` does not appear in the diff.
- [~] The reports' totals after a payment and an adjustment reconcile with the ledger rows
      just written.
- [x] No control gates, suspends, restricts or downgrades a student's access, and no copy
      implies it.
- [x] The existing CSV export still reflects the current filtered view after a write,
      without issuing a new request beyond the list refresh.
- [x] No hardcoded user-facing string; the new keys exist in both `dict-en.ts` and
      `dict-pt.ts`; `node apps/web/scripts/check-i18n-coverage.js` passes.
- [~] The four forms are responsive at mobile width and keyboard-usable throughout,
      verified in a browser.
- [x] `git diff` contains no file under `apps/api/` or `packages/`, and
      `apps/web/src/lib/admin-billing-api.ts` is unmodified.
- [x] Changed files lint clean; `make test-web` green for the affected component tests.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`, `make dev-api`, `make dev-web`; sign in as the seeded admin and
   open the Ledger tab with the seeded billing data.
2. Record a partial payment on an open invoice, confirm the row appears beneath it and the
   balance moved; record the remainder and confirm the invoice settles and the student's
   standing changes on the Students tab.
3. Apply a discount, a credit, a waiver and a surcharge in turn, confirming each requires
   a reason and moves the balance in the direction the form stated.
4. Void an invoice with a reason and confirm it renders as voided; attempt a void with the
   reason blank and confirm it does not submit.
5. Issue an invoice for a contract's next period, confirm the form named that contract and
   period, then issue the same one again and confirm the refusal is reported rather than
   silently succeeding.
6. Read the movement and aging reports and confirm they reconcile with the rows just
   written, adjustments included.
7. Confirm no delete control exists on any payment or adjustment, and read the tab's
   append-only copy as a non-engineer would.
8. Export the current view to CSV and confirm it matches what is on screen after the
   writes.
9. Point the local replica's active currency at JPY and at BTC and confirm entry and
   rendering at exponents 0 and 8.
10. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`, confirm every label translates,
    and run `node apps/web/scripts/check-i18n-coverage.js`.
11. Resize to mobile width and drive all four actions with the keyboard.
12. `make test-web` and `make lint`.
13. `git diff --stat` confirms only `apps/web/**` changed.
