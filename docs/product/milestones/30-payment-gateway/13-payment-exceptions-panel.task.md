# Task 13 — Frontend: Payment exceptions panel (Phase 4)

**Status:** ✅ Done
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Frontend Web
**Depends On:** [Task 09](./09-reconcile-run-and-exceptions-routes.task.md), [Task 12](./12-admin-ledger-online-payments.task.md)

## Summary

The **payment exceptions** tab of `/admin/billing` (RFC §7, R14): one list of everything the
gateway could not settle by itself — orphan payments, currency mismatches, events that keep
failing or never finished, and disputes — oldest first, each with what is known about it and
three ways out: **match by hand**, **refund**, or **dismiss with a note**. A **Run reconcile
now** button runs the hourly job on demand and shows its summary. An empty list is the normal
state and says so; the tab is how an admin learns that money arrived that the ledger does not
yet explain.

## Dependencies

- [Task 09](./09-reconcile-run-and-exceptions-routes.task.md) — hard contract dependency: the
  exceptions list, the dismiss route and the manual reconcile route.
- [Task 12](./12-admin-ledger-online-payments.task.md) — hard code dependency: *match by hand*
  reuses the payment form's gateway method and its duplicate-reference message.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/billing/**` — the new exceptions tab, its dialogs, the
    tab registration in the page, tests.
  - `apps/web/src/lib/admin-billing-api.ts` and its test.
  - `apps/web/src/lib/api-types.gen.ts` — regenerated, never hand-edited.
  - `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts`.
- **No backend change.** The task consumes Task 09's contract as published in `apps/api/openapi.json`.
- **Admin only.** The tab is not offered to a `content_creator`; a `403` from the API renders
  the existing no-access state, not an error.
- **The three actions (milestone §6, decision 23):**
  - *Match by hand* — pick the student (the roster search), pick one of their open receivables,
    then the existing payment form with method *Online* and the reference prefilled from the
    exception; on success the exception is dismissed with an automatic note naming the payment.
    A duplicate reference means the payment already landed: the dialog says so and offers to dismiss.
  - *Refund* — for an exception with no ledger row, a link to the payment on the provider's
    dashboard (the refund happens there; nothing landed, so nothing is owed to the ledger) and a
    hint to dismiss afterwards; for one with a ledger row (a dispute), a link to that row's
    reversal in the ledger tab. The tab itself never calls a refund endpoint.
  - *Dismiss* — a required note of 1 to 500 characters; the row leaves the list.
- **Orphans show no amount** — the API does not know one. The row shows provider, ids, kind, age
  and attempts, and never invents a figure.
- **Reconcile is one request at a time:** the button is disabled while a run is in flight and
  the list reloads when it returns.
- **i18n.** No hardcoded user-facing string; both dictionaries keep identical keys. Money through
  the shared `format-money` helper.

## Scope

**In:**
- The tab with a count badge when the list is not empty, the list (kind, provider, provider ids
  with deep link, age, attempts, student and receivable when known), an explanation line per kind
  in plain language, and the empty state.
- The three action dialogs and their success and failure messages.
- *Run reconcile now* with its summary (confirmed, landed, expired, deferred, retried, stale,
  unreachable) and the run's failure reason when it fails — including an invalid configuration.
- Layout at 390 px: rows stack, actions stay reachable.
- Tests (Vitest + React Testing Library): empty state; one row of each kind; dismiss validation
  and removal; match by hand end to end with the transport stub, including the duplicate case;
  both refund variants; reconcile in flight, succeeded and failed; the tab hidden for a non-admin.

**Out:**
- Notifications outside the app (e-mail, push) for a new exception — not in v1.
- Editing an event or a checkout; the tab only reads, dismisses and links.

## Acceptance Criteria

- [x] With no exception the tab shows the empty state and no badge.
- [x] An orphan row shows its provider ids and a deep link, and no amount.
- [x] Dismissing without a note is refused on the client; with one, the row disappears and stays
      gone after a reload.
- [x] Matching an orphan to an open invoice records a gateway payment with the exception's
      reference and removes the exception.
- [x] *Run reconcile now* shows the returned summary and cannot be pressed twice in parallel.
- [x] A `content_creator` is not offered the tab.
- [x] `check-i18n-coverage.js` green; `dict-en.ts` and `dict-pt.ts` have identical keys.
- [x] Changed files lint clean; `make test-web` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `cd apps/web && pnpm gen:api-types` — the generated types carry the three routes.
2. `cd apps/web && pnpm test src/app/\(protected\)/admin/billing` — the tab's suite passes.
3. `make test-web` — green.
4. `make dev` — as the seeded admin: open the tab under `none` (empty), then with a stubbed
   orphan; dismiss it; run reconcile; check 390 px.
5. `git diff --stat` confirms only scope-guardrail files changed.
