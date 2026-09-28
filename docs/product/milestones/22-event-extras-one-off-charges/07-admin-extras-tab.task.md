# Task 07 — Frontend: Admin Extras tab (Phase 4)

**Status:** 📝 Open
**Milestone:** [22 — Event extras: one-off charges on a separate billing rail](./milestone.md)
**RFC:** [RFC 0015](../../RFCs/0015-event-extras-one-off-charges-for-events.md)
**Team:** Frontend Web
**Depends On:** [Task 03](./03-event-charge-service-and-admin-api.task.md)

## Summary

Gives the administrator one screen to sell and collect an extra (RFC 0015 §8). A new **Extras**
tab in the admin billing console lets them pick a **published** event, see and edit its price
(amount, due-in days, grace), read its summary (charged, received, outstanding, counts by
status), and work its charge list with the same payment, adjustment, reversal and void actions
the invoice list already offers — reusing the existing billing forms, parametrised by target
kind rather than duplicated. **Charge participants** opens a dialog with a user multi-select
(a group filter expands to its members client-side), an optional amount override that demands
a note when it differs from the price, and a shortcut to create a user for a lead with no
account. For a `restricted` event, every selected user outside the audience is flagged inline —
"this person does not see this event on the board" — with a link to the event's audience in
the events backoffice; **submitting stays allowed** (Resolved #7). After submitting, the dialog
reports created, absorbed (already charged) and outside-audience users. The tab consumes only
the endpoints Task 03 delivered.

## Dependencies

- [Task 03](./03-event-charge-service-and-admin-api.task.md) — the price, charge, ledger,
  summary and audience-check endpoints this tab calls.
- Existing pieces extended: `apps/web/src/app/(protected)/admin/billing/{page.tsx,payment-form.tsx,adjustment-form.tsx,void-invoice-form.tsx,money.tsx,minor-units.ts,explain-error.ts}`
  and the billing API client under `apps/web/src/lib/`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/billing/**` — the new tab, the charge dialog, the
    parametrised forms, and their tests.
  - `apps/web/src/lib/` — the existing billing API client file, extended with the extras calls.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are typed).
- **Only published events** are selectable; the selector never offers `draft` or `archived`.
- **No money from the events backoffice** — this tab lives in billing; the events pages are
  Task 09's read-only panel.
- **i18n.** No hardcoded user-facing strings; identical keys in both dictionaries;
  `check-i18n-coverage.js` passes.
- **Money display.** Amounts go through the existing minor-unit helpers; no floating point.
- **Accessible.** The multi-select and dialog are keyboard-usable; the audience warning is
  announced, not colour-only.

## Scope

In:
- Extras tab: event selector (published only), price editor, summary, charge list with ledger
  actions.
- Charge dialog: multi-select with group expansion, amount override with mandatory note when
  negotiated, create-user shortcut, inline audience warning (via the audience check before
  submit), result summary (created / absorbed / outside audience).
- API client additions for the Task 03 endpoints.
- Component tests: dialog payload, warning rendered and submit still enabled, negotiated-note
  validation, result summary.

Out:
- Roster, reports and statement changes — Task 08.
- Student view, plans-tab link and events panel — Task 09.
- Any backend change.

## Acceptance Criteria

- [ ] The event selector lists only published events.
- [ ] Charging three users sends one request with the three ids and the chosen event; the
      result shows each in the right group (created / absorbed / outside audience).
- [ ] For a restricted event, a selected user outside the audience is flagged before submit,
      and the submit button stays enabled.
- [ ] Entering an amount different from the price without a note blocks submit with a
      translated message.
- [ ] Recording a payment, reversing it and voiding a charge from the list call the Task 03
      endpoints and refresh the summary.
- [ ] No hardcoded user-facing string; new keys exist in both `dict-en.ts` and `dict-pt.ts`;
      `check-i18n-coverage.js` passes.
- [ ] The tab and dialog are responsive and keyboard-usable.
- [ ] Changed files lint clean; `make test-web` green for the affected component tests.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-api` + `make dev-web` on the seeded local D1; open Admin → Billing → Extras.
2. Price the seeded event, charge a user inside and one outside a restricted audience,
   confirm the warning and the result summary; submit the same selection again and confirm
   everything is reported as already charged.
3. Record, reverse and void from the list; try to void a paid charge and confirm the error
   message.
4. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`; resize to mobile.
5. `make test-web`; run `check-i18n-coverage.js`.
6. `git diff --stat` confirms only scope-guardrail files changed.
