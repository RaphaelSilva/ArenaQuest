# Task 07 — Frontend: Admin billing console (Phase 5)

**Status:** 📝 Open
**Milestone:** [19 — Student billing, contracts and receivables accounting](./milestone.md)
**RFC:** [RFC 0013](../../RFCs/0013-student-billing-contracts-and-receivables-accounting.md)
**Team:** Frontend Web
**Depends On:** [Task 04](./04-accounting-reports-and-per-student-statement.task.md), [Task 05](./05-standing-roster-holds-and-me-billing.task.md)

## Summary

Gives the administrator the screen the spreadsheet was standing in for: `/admin/billing`
with three tabs. **Students** is the everyday one and answers "who is behind?" in a
single page — every student with a contract, their standing badge, outstanding balance,
next due date and a flag on negotiated terms, filterable by standing, with setting and
clearing a hold available inline. **Ledger** lists invoices, adjustments and payments
with filters and a client-side CSV export, and it is where the append-only model becomes
visible to a non-engineer: the action is **Reverse**, never Delete, and a reversal renders
inline underneath its original with its reason and its author, so an admin who wants to
"delete a mistake" is shown what actually happens instead. **Reports** renders monthly
movement and receivables aging. A delinquency count badge sits on the admin nav's billing
entry so the number is visible without opening the screen. Every amount on every tab
renders through the shared `format-money.ts` against the currency's recorded exponent —
never `Intl.NumberFormat`'s currency style — and no standing rule is re-derived in the
client: the badge shows what the API resolved.

## Dependencies

- [Task 05](./05-standing-roster-holds-and-me-billing.task.md) — the roster and holds
  endpoints this tab consumes, and the source of the nav badge count.
- [Task 04](./04-accounting-reports-and-per-student-statement.task.md) — the movement,
  aging and per-student statement endpoints the Reports tab and the student drill-down
  render.
- The lifecycle endpoints from
  [Task 03](./03-billing-service-and-the-admin-lifecycle-api.task.md) back the Ledger
  tab's actions.
- Extends the existing admin backoffice layout and nav under
  `apps/web/src/app/(protected)/admin/`, and the shared `format-money.ts` from
  [Task 01](./01-billing-domain-entities-and-repository-port.task.md).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/billing/**` — the page, its three tabs and their
    components.
  - `apps/web/src/lib/admin-billing-api.ts` (new) — the client for the
    `/v1/admin/billing/*` endpoints. It calls only endpoints that already exist; this
    task defines no new server contract.
  - `apps/web/src/components/**` and `apps/web/src/hooks/**` — only the pieces this
    console introduces, plus the billing entry and its badge in the existing admin nav.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are typed).
  - `apps/web/**` component tests.
- **Frontend only.** No backend file is touched: the API contract is fixed by Tasks
  03–05, and a gap found here is a follow-up task, not a bundled edit.
- **Money renders only through the shared `format-money.ts`** with the currency's
  exponent and symbol from the API. `Intl.NumberFormat`'s currency style must not appear
  in this diff — it accepts `BTC` and silently rounds it to two decimals.
- **No standing rule in the client.** The badge and the filter render what the API
  returned; `resolveStanding`'s logic is not reimplemented, approximated or partially
  duplicated in a component.
- **The ledger is append-only in the UI too.** No Delete control exists for a payment or
  an adjustment; Reverse is the affordance, it asks for a reason, and the resulting entry
  renders under its original.
- **A hold's meaning is visible.** The UI states that a hold stops the chasing and not
  the debt — held students appear in their own filter with the reason and who set it, and
  their balance stays in every total on screen.
- **No paywall affordance anywhere.** This console reports and alerts; it offers no
  control that suspends, locks, downgrades or restricts a student's access, because no
  such API exists and none is to be implied.
- **App Router conventions.** Server Component by default; `'use client'` only where the
  filters, tabs and actions require it. No existing Server Component is converted.
- **i18n.** No hardcoded user-facing string under `src/{app,components,hooks}/**`;
  `dict-en.ts` and `dict-pt.ts` keep identical keys and `check-i18n-coverage.js` passes.
- **CSV export is client-side** over the rows already fetched — no new endpoint.
- **Cloud-agnostic.** No provider SDK; the client targets `NEXT_PUBLIC_API_URL`.
- **Responsive & accessible.** The tables stay usable at mobile width, and the tabs,
  filters and actions are keyboard-navigable with semantic markup.

## Scope

In:
- `/admin/billing` with the Students, Ledger and Reports tabs and their shared layout.
- Students tab: standing badge, outstanding, next due, oldest overdue, negotiated-terms
  flag, standing filter including held, and inline set/clear hold with a reason.
- Ledger tab: invoices, adjustments and payments with status, date-range and student
  filters; the Reverse affordance with its reason prompt; reversals rendered inline under
  their originals; client-side CSV export of the current view.
- Reports tab: monthly movement and the four aging buckets.
- The per-student statement drill-down from the Students tab.
- The delinquency count badge on the admin nav's billing entry.
- `admin-billing-api.ts` covering the endpoints above.
- Dictionary keys in both languages, including the copy that explains what a hold does
  and what Reverse does.
- Component tests for the standing badge rendering, the money formatting at exponents 2,
  0 and 8, the hold action's request payload, and the Reverse flow refusing to submit
  without a reason.

Out:
- Any backend change — Tasks 03–06 own every endpoint.
- The student's own statement page and banner — Task 08.
- A currency management screen — a milestone Non-Goal; currencies are seeded data.
- Any control that gates or restricts access.

## Acceptance Criteria

- [ ] `/admin/billing` renders all three tabs, and the Students tab lists a seeded
      `delinquent` student with the same standing, balance and oldest overdue date the API
      returns for them.
- [ ] The standing filter round-trips to the API's `standing=` parameter rather than
      filtering client-side.
- [ ] Setting a hold from the Students tab issues the expected request with its reason,
      moves the student to the held filter, and leaves the outstanding total shown in
      Reports unchanged.
- [ ] Amounts render at exponent 2, 0 and 8 through `format-money.ts`; the string
      `Intl.NumberFormat` does not appear in the diff.
- [ ] The Ledger tab offers no Delete control for a payment or an adjustment; Reverse
      requires a reason and the resulting entry renders inline under its original with its
      author.
- [ ] CSV export produces the current filtered view without issuing a new request.
- [ ] The nav badge shows the delinquency count and updates after a hold is set.
- [ ] No standing threshold, grace-day arithmetic or due-date comparison appears in any
      component — the client renders what the API resolved.
- [ ] No hardcoded user-facing string; the new keys exist in both `dict-en.ts` and
      `dict-pt.ts`; `node apps/web/scripts/check-i18n-coverage.js` passes.
- [ ] The console is responsive at mobile width and keyboard-usable throughout.
- [ ] `git diff` contains no file under `apps/api/src/`.
- [ ] Changed files lint clean; `make test-web` green for the affected component tests.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`, `make dev-api` and `make dev-web`; seed a month of activity
   through the admin API so all three tabs have data.
2. Open `/admin/billing` as an admin and walk each tab: filter by standing, set and clear
   a hold, reverse a payment, export the ledger to CSV, read both reports.
3. Confirm the held student leaves the delinquency filter while the Reports totals do not
   move.
4. Point a plan at JPY and at BTC in the local replica and confirm the amounts render at
   exponent 0 and 8 correctly.
5. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en` and confirm every label
   translates; run `node apps/web/scripts/check-i18n-coverage.js`.
6. Resize to mobile width and confirm the tables and actions stay usable; tab through the
   filters and actions with the keyboard.
7. `make test-web` and `make lint`.
8. `git diff --stat` confirms only `apps/web/**` changed.
