# Plan — Task 07: Admin Extras tab

**Task:** [07-admin-extras-tab.task.md](../07-admin-extras-tab.task.md)
**RFC:** [RFC 0015](../../../RFCs/0015-event-extras-one-off-charges-for-events.md) §7, §8, Resolved #7
**Branch:** `feature/m22/07-admin-extras-tab.task`
**Depends on:** Task 03 (price, charge, ledger, summary and audience-check routes under `/v1/admin/billing`).

## Goal

A fifth tab, **Extras**, in `/admin/billing`: pick a published event, edit its price, read its
summary, work its charge list with the same payment / adjustment / reversal / void actions the
invoice ledger offers, and charge participants through a dialog (multi-select with group
expansion, amount override with mandatory note when negotiated, create-user shortcut, inline
audience warning that never blocks submit, result summary). Frontend only.

## Files to touch

| File | Change |
|---|---|
| `apps/web/src/lib/admin-billing-api.ts` | Extras wire types + `extras` module (12 calls). |
| `apps/web/src/app/(protected)/admin/billing/page.tsx` | `extras` tab (after `ledger`), renders `<ExtrasTab>`. |
| `.../billing/payment-form.tsx`, `adjustment-form.tsx`, `void-invoice-form.tsx` | New optional prop `kind: LedgerTargetKind = 'invoice'`; `'charge'` routes the write to the charge endpoint and swaps the invoice-worded copy. `invoice` prop narrowed to `{ id, currency, balanceMinor }` so a charge fits. |
| `.../billing/reverse-payment-form.tsx` (new) | The reversal dialog extracted from `ledger-tab.tsx`, parametrised by kind; the ledger tab uses it too (same DOM, same copy). |
| `.../billing/extras-tab.tsx` (new) | Event selector, price editor, summary, charge list + ledger actions. |
| `.../billing/charge-dialog.tsx` (new) | Charge participants dialog. |
| `.../billing/__tests__/{extras-tab,charge-dialog}.test.tsx` (new) | Component tests. |
| `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` | `admin.billing.tabs.extras` + `admin.billing.extras.*`. |

No change under `apps/api` or `packages/shared`. The roster response reshape from Task 04 stays for
Task 08.

## API client contract (`client.adminBilling.extras`)

| Method | HTTP | Returns |
|---|---|---|
| `getPrice(eventId)` | `GET /event-prices/{eventId}` | `BillingEventPrice \| null` (404 → `null`) |
| `setPrice(eventId, { amountMinor, dueInDays?, graceDays? })` | `PUT /event-prices/{eventId}` | `BillingEventPrice` |
| `clearPrice(eventId)` | `DELETE /event-prices/{eventId}` | `void` (204) |
| `listCharges({ eventId?, userId?, status? })` | `GET /charges` | `BillingEventChargeWithBalance[]` |
| `getCharge(id)` | `GET /charges/{id}` | `BillingEventChargeDetail` (charge + `adjustments` + `payments`) |
| `issueCharges({ eventId, userIds, amountMinor?, termsNote?, dueDate?, graceDays? })` | `POST /charges` | `{ created, absorbed, outsideAudience }` (201 or 200) |
| `voidCharge(id, reason)` | `POST /charges/{id}/void` | charge |
| `addAdjustment(id, input)` | `POST /charges/{id}/adjustments` | adjustment |
| `addPayment(id, input)` | `POST /charges/{id}/payments` | payment |
| `reversePayment(paymentId, { reason })` | `POST /charge-payments/{id}/reverse` | payment |
| `summary(eventId)` | `GET /events/{eventId}/summary` | `{ eventId, currency, chargedMinor, adjustmentsMinor, receivedMinor, outstandingMinor, chargeCount, counts }` |
| `audienceCheck(eventId, userIds)` | `GET /events/{eventId}/audience-check?userIds=a,b` | `{ eventId, audience, outsideAudience }` |

The currency is never sent: the server uses the active one.

## Behaviour

- **Event selector** — `client.adminEvents.list({ status: 'published', limit: 100 })`; the list is
  additionally filtered client-side to `status === 'published'` so the selector can never offer a
  draft/archived event even if the server ignored the filter.
- **Price editor** — amount through `toMinorUnits` / `fromMinorUnits` at the console currency's
  exponent; due-in and grace days as non-negative integers; Save → `setPrice`, Remove → `clearPrice`.
  "Not for sale" when `getPrice` is `null`.
- **Summary** — `Money` for charged / adjustments / received / outstanding, counts by status.
- **Charge list** — `listCharges({ eventId })`; each row expands to `getCharge(id)` with the
  adjustments and payments (reversal nested under its original); actions open `PaymentForm`,
  `AdjustmentForm`, `VoidInvoiceForm` with `kind="charge"`, and `ReversePaymentForm` with
  `kind="charge"`. Every write bumps a refresh token → list + summary re-read, and the open
  detail is reloaded.
- **Charge dialog**
  - Candidates = the console's users (`students` from `page.tsx`), filtered by name/email;
    checkboxes in a `fieldset` (keyboard-native).
  - Group expansion: `adminGroups.list()` → select → "Add members" → `listMembers(groupId)`; members
    are added to the selection client-side (the request still carries user ids only).
  - Create-user shortcut: inline name / email / temporary password → `adminUsers.create`; the new
    user is appended to the candidates and selected.
  - Amount override (optional). Negotiated = override given and (no price, or ≠ price). Negotiated
    without a note → translated error, no request. No price and no override → translated error.
  - Audience check: for a `restricted` event, every change of the selection calls
    `audienceCheck`; each selected user in `outsideAudience` gets an inline warning text (not colour
    only) with a link to `/admin/events/{eventId}`, plus a polite live-region count. Submit stays
    enabled.
  - Submit: one `issueCharges` request with every selected id; the dialog then shows the result in
    three groups: created / absorbed (already charged) / outside audience, by name.

## Tests → acceptance criteria

| AC | Test |
|---|---|
| Selector lists only published | `extras-tab.test`: list request carries `status=published`; a draft returned anyway is not offered. |
| Three users → one request, result grouped | `charge-dialog.test`: select 3, submit → exactly one `POST /admin/billing/charges` with `{eventId, userIds:[3]}`; result shows created / absorbed / outside audience in their groups. |
| Restricted → flagged, submit enabled | `charge-dialog.test`: audience-check response flags one user → warning text visible next to that user, link to the event, submit button enabled. |
| Negotiated needs a note | `charge-dialog.test`: amount ≠ price, no note → translated error, no POST; with a note → POST with `amountMinor` + `termsNote`. |
| Pay / reverse / void call Task 03 endpoints and refresh the summary | `extras-tab.test`: record payment → `POST /charges/{id}/payments` and summary re-fetched; reverse → `POST /charge-payments/{id}/reverse`; void → `POST /charges/{id}/void`. |
| i18n | Keys in both dictionaries (type-enforced), `check-i18n-coverage.js` passes. |
| Existing behaviour kept | Existing payment/adjustment/void/ledger/page tests still pass unchanged. |

## Verification commands

```bash
make lint
make test-web                            # alone; runs check-i18n-coverage.js first
cd apps/web && pnpm exec tsc --noEmit
git diff --stat feature/m22/candidate    # only scope-guardrail files
```

Manual: `make dev`, log in as `admin@arenaquest.dev`, Admin → Billing → Extras.
