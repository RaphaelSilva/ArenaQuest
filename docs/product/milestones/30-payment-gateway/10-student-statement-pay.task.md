# Task 10 — Frontend: Pay on the student statement (Phase 4)

**Status:** 📝 Open
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Frontend Web
**Depends On:** [Task 07](./07-student-checkout-routes.task.md)

## Summary

The student's **Pay** on `/settings/billing` (RFC §7). Every open invoice and every open event
charge on the statement gains a *Pay* action whenever `payOptions` offers at least one method;
pressing it creates (or reuses) the hosted checkout through `POST /v1/me/billing/checkouts` and
opens the provider's page in a **new tab**. A receivable with a live attempt shows *payment in
progress · expires at …* with *Open again*; a gateway payment in the history reads *Paid online*
with its date. Coming back from the provider, the page polls the checkout's status for about a
minute and refreshes the statement when it settles. Nothing here withholds anything: the page
only adds a way to pay.

## Dependencies

- [Task 07](./07-student-checkout-routes.task.md) — hard contract dependency: the two checkout
  routes, `payOptions` and `pendingCheckout` on the statement.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/settings/billing/**` (page, new co-located components, tests).
  - `apps/web/src/components/billing/**` — a shared pay action the dashboard card (Task 11)
    reuses, and the statement test fixture.
  - `apps/web/src/lib/me-billing-api.ts` and its test.
  - `apps/web/src/lib/api-types.gen.ts` — regenerated from the committed OpenAPI document, never hand-edited.
  - `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts` (`types.ts` only if the shape requires it).
  - `apps/web/src/app/(protected)/__tests__/no-withholding.test.tsx` — extended, never relaxed.
- **No backend change.** The task consumes Task 07's contract as published in `apps/api/openapi.json`.
- **The provider's page opens in a new tab, never in an iframe**, and the tab is opened from the
  click itself so a popup blocker does not swallow it; when it is blocked anyway, the page shows
  the link to follow.
- **The return URL is a hint, not a fact.** `?checkout=…&outcome=…` only starts the polling; what
  the page shows always comes from the status route and the statement. *Paid* is never rendered
  from the query string.
- **Polling is bounded:** at most five status reads (after 2, 4, 8, 15 and 30 seconds), paused
  while the tab is hidden, stopped at the first settled answer; then one statement refresh. After
  the last read with no answer the page says the payment is still being confirmed and that
  leaving is safe.
- **Labels are methods, not brands.** With several providers the choice is labelled by what each
  offers (*Pix*, *Cartão*), in the order the statement gives; a provider name never stands alone.
- **Money** renders through the shared `format-money` helper from integer minor units.
- **i18n.** No hardcoded user-facing string; both dictionaries keep identical keys.
- **Client data.** Calls go through `apiFetch` and the existing auth context; no new HTTP client.

## Scope

**In:**
- *Pay* on open invoices and open event charges; hidden when `payOptions` is empty; one button
  with one provider, a small choice with several.
- The in-progress state from `pendingCheckout` (expiry in the viewer's locale, *Open again*
  reusing the same checkout, and *Pay* again once it expired).
- *Paid online* on gateway payments in the history, with the date; a refunded one reads as refunded.
- The return flow: polling, the confirmed / cancelled / still-confirming / failed messages, the
  query hints removed from the URL once read.
- Error mapping for every refusal Task 07 documents (not payable any more, provider unavailable,
  too many attempts, configuration error) to a translated message, with the statement refreshed
  when the receivable changed underneath.
- Layout at 390 px: actions reachable without horizontal scroll, touch targets at least 44 px.
- Tests (Vitest + React Testing Library): no *Pay* without options; one provider; two providers;
  in-progress and expired states; the poll sequence with fake timers and a hidden tab; each error
  message; *Paid* never shown from the query string alone.

**Out:**
- The dashboard card (Task 11) and every admin surface (Tasks 12, 13).
- Saved cards, instalments, automatic charging — RFC non-goals.

## Acceptance Criteria

- [ ] With `payOptions: []` the page renders exactly as it does today (no *Pay*, no new copy).
- [ ] *Pay* on an open invoice opens the hosted URL in a new tab and the row turns into *payment
      in progress* without a full reload.
- [ ] Returning with `outcome=success` while the checkout is still `open` does not show *Paid*.
- [ ] No more than five status requests follow one return, and none while the tab is hidden.
- [ ] At 390 px the statement has no horizontal scroll with the new actions.
- [ ] `no-withholding.test.tsx` passes with a `delinquent` fixture: content links stay enabled.
- [ ] `check-i18n-coverage.js` green; `dict-en.ts` and `dict-pt.ts` have identical keys.
- [ ] Changed files lint clean; `make test-web` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `cd apps/web && pnpm gen:api-types` — the generated types carry `payOptions` and `pendingCheckout`.
2. `cd apps/web && pnpm test src/app/\(protected\)/settings/billing` — the page suite passes.
3. `make test-web` — green (includes the i18n coverage check).
4. `make dev`, with the local API bound to the stub or the sandbox: pay an invoice end to end at
   390 px and at desktop width; if the Playwright scaffold (backlog `test-debt/11`) has landed,
   add the walk there, otherwise record it with the `qa` skill.
5. `git diff --stat` confirms only scope-guardrail files changed.
