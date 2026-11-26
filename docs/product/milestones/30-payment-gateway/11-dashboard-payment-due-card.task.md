# Task 11 — Frontend: Payment due card on the dashboard (Phase 4)

**Status:** ✅ Done
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Frontend Web
**Depends On:** [Task 10](./10-student-statement-pay.task.md)

## Summary

A **payment due** card on the student dashboard (RFC §7, R11): when the student has an open
contract invoice and a provider offers a method, the dashboard shows the amount, the due date and
the same *Pay* action as the statement, with a link to `/settings/billing`. It reads the
statement the app shell already fetches — no new endpoint, no extra request — and it is absent
whenever there is nothing to pay online. The card informs and offers; it never blocks, dims or
replaces anything else on the dashboard.

## Dependencies

- [Task 10](./10-student-statement-pay.task.md) — hard code dependency: the shared pay action
  and its states, which this card reuses rather than re-implements.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/dashboard/**` — the card and its test (registered as a widget
    instead if the M29 widget dashboard has merged; see below).
  - `apps/web/src/app/(protected)/dashboard/page.tsx` — only to place the card.
  - `apps/web/src/components/billing/**` — only to share the already-fetched statement with the
    card (the provider that feeds the standing banner).
  - `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts`.
  - `apps/web/src/app/(protected)/__tests__/no-withholding.test.tsx` — extended, never relaxed.
- **No backend change** and **no new request.** The statement the standing banner loads in the
  protected layout is the single source; the card must not trigger a second `GET /v1/me/billing`
  on dashboard load.
- **Contract invoices only.** Event charges stay on the statement page; the card lists open
  invoices, earliest due first, one row each.
- **Renders nothing** when there is no open invoice, when `payOptions` is empty, or while the
  statement is loading or failed — no skeleton, no error state, no layout shift.
- **Sequencing with M29.** If the configurable widget dashboard is on `main` when this task
  opens, the card ships as a widget in that registry with the same behaviour, default-on for
  students, and the guardrail extends to the widget's registration file only. The task's PR says
  which form it took.
- **Never gates.** The card is one more block; every other dashboard element keeps working for a
  `delinquent` student.
- **i18n.** No hardcoded user-facing string; both dictionaries keep identical keys. Money through
  the shared `format-money` helper.

## Scope

**In:**
- The card: amount, due date (overdue shown as such, with no alarm styling beyond the existing
  standing colours), *Pay* (same component, same in-progress state as Task 10), link to the statement.
- Several open invoices: one row per invoice, earliest due first.
- Tests (Vitest + React Testing Library): absent with no invoice; absent with `payOptions: []`;
  one invoice; three invoices in order; an invoice with a pending checkout shows *Open again*;
  the dashboard issues one statement request, not two.

**Out:**
- Event charges on the dashboard, totals across rails, and any reminder banner — not in v1.
- Changes to the widget framework itself (M29's scope).

## Acceptance Criteria

- [x] A student with one open invoice and a bound provider sees the card with the right amount
      and due date; pressing *Pay* behaves exactly as on the statement.
- [x] A student with no open invoice, or under `payOptions: []`, sees the dashboard exactly as today.
- [x] Loading the dashboard issues a single `GET /v1/me/billing`.
- [x] At 390 px the card fits without horizontal scroll.
- [x] `no-withholding.test.tsx` passes: the dashboard's content links stay enabled for a
      `delinquent` student with the card present.
- [x] `check-i18n-coverage.js` green; `dict-en.ts` and `dict-pt.ts` have identical keys.
- [x] Changed files lint clean; `make test-web` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `cd apps/web && pnpm test src/components/dashboard` — the card suite passes.
2. `make test-web` — green.
3. `make dev` — as a seeded student with an open invoice, check the card at 390 px and desktop
   width, then with the provider list set back to `none`.
4. `git diff --stat` confirms only scope-guardrail files changed.
