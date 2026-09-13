# Task 08 — Frontend: Student statement and standing banner (Phase 5)

**Status:** ✅ Done
**Milestone:** [19 — Student billing, contracts and receivables accounting](./milestone.md)
**RFC:** [RFC 0013](../../RFCs/0013-student-billing-contracts-and-receivables-accounting.md)
**Team:** Frontend Web
**Depends On:** [Task 05](./05-standing-roster-holds-and-me-billing.task.md)

## Summary

Gives the student their own side of the ledger, so a late payment can be resolved without
the instructor ever having to raise it. `/settings/billing` renders the statement
`GET /v1/me/billing` returns: the current contract and its terms, every invoice with its
due date and balance, the payments and adjustments against them, and the outstanding
total. On `due` and `delinquent` an informational banner appears and links to that page.
The banner is the delicate part of this task and its constraints are the deliverable: it
is a notice, not a paywall. No route is guarded, no screen is withheld, no feature is
dimmed, no action is disabled, and dismissing it costs the student nothing — a student who
is behind on tuition sees exactly the application they saw the day before, plus a line
telling them what they owe and where to look. The standing it displays is the one the API
resolved; the client re-derives no threshold and compares no date, so a hold that reports
`exempt` silently removes the banner with no client-side rule to keep in sync.

## Dependencies

- [Task 05](./05-standing-roster-holds-and-me-billing.task.md) — hard dependency.
  `GET /v1/me/billing` is the only endpoint this task consumes, and it is self-only by
  construction.
- Extends the existing `(protected)/settings` route group and the protected layout that
  will host the banner, plus the shared `format-money.ts` from
  [Task 01](./01-billing-domain-entities-and-repository-port.task.md).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/settings/billing/**` — the statement page.
  - `apps/web/src/lib/me-billing-api.ts` (new) — the client for `GET /v1/me/billing`
    only.
  - `apps/web/src/components/**` and `apps/web/src/hooks/**` — the banner and the
    statement's presentational pieces, plus the single mount point in the protected
    layout.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are typed).
  - `apps/web/**` component tests.
- **Frontend only.** No backend file is touched; this task consumes a contract that
  already exists.
- **The banner withholds nothing.** It must not guard a route, hide a link, disable a
  control, dim a section, block navigation, or change what any other screen renders. A
  reviewer should be able to confirm by inspection that the diff adds a notice and
  nothing conditional around existing UI.
- **No standing rule in the client.** The banner's visibility follows the `standing`
  value the API returned. No grace-day arithmetic, no due-date comparison and no
  threshold constant appears in the diff — which is also what makes a hold's `exempt`
  suppress it for free.
- **Money renders only through the shared `format-money.ts`** with the exponent and
  symbol from the API; `Intl.NumberFormat`'s currency style must not appear.
- **A student with no contract sees nothing unusual** — an empty statement reads as a
  normal state, not an error, and no banner shows.
- **App Router conventions.** Server Component by default; `'use client'` only for the
  banner's dismissal state. No existing Server Component is converted to a Client one.
- **Dismissal is free and local.** Dismissing the banner is a per-viewer convenience with
  no server call and no consequence; it does not mark anything as read or acknowledged.
- **i18n.** No hardcoded user-facing string under `src/{app,components,hooks}/**`; both
  dictionaries keep identical keys and `check-i18n-coverage.js` passes. The copy must
  read as informational — it tells the student what is outstanding and where to see it,
  and does not threaten a consequence the platform will not deliver.
- **Cloud-agnostic.** No provider SDK; the client targets `NEXT_PUBLIC_API_URL`.
- **Responsive & accessible.** Readable at mobile width; the banner is announced to
  assistive technology as a status message and its dismiss control is keyboard-reachable.

## Scope

In:
- `/settings/billing` rendering the caller's contract terms, invoices with due dates and
  balances, payments and adjustments, and the outstanding total.
- The informational banner shown on `due` and `delinquent`, linking to that page, with a
  local dismiss.
- `me-billing-api.ts` for `GET /v1/me/billing`.
- Dictionary keys in both languages for the statement and the banner.
- Component tests covering: the banner rendering for `due` and `delinquent`, its absence
  for `good` and `exempt`, the empty-statement state, and money formatting at exponents 2,
  0 and 8.

Out:
- Any backend change — Task 05 owns the endpoint.
- The admin console — Task 07.
- Any payment flow, checkout or gateway affordance — a milestone Non-Goal; money arrives
  out of band and an admin records it.
- Anything that gates, hides or disables a feature based on standing.

## Acceptance Criteria

- [x] `/settings/billing` renders the caller's own statement from `/v1/me/billing`, and
      its outstanding total matches what the admin console shows for that student.
- [x] The banner renders for `due` and for `delinquent`, and does not render for `good` or
      `exempt` — the `exempt` case proving a hold suppresses it with no client-side rule.
- [x] No route or screen is withheld behind the banner: with a `delinquent` student
      signed in, every page and control available at `good` is still available, asserted
      by a test as well as by inspection.
- [x] No standing threshold, grace-day arithmetic or due-date comparison appears anywhere
      in the diff.
- [x] Dismissing the banner issues no request and changes nothing beyond the current
      view.
- [x] A student with no contract sees an empty statement and no banner, with no error
      state.
- [x] Amounts render through `format-money.ts` at exponents 2, 0 and 8; the string
      `Intl.NumberFormat` does not appear in the diff.
- [x] No hardcoded user-facing string; the new keys exist in both `dict-en.ts` and
      `dict-pt.ts`; `node apps/web/scripts/check-i18n-coverage.js` passes.
- [x] The banner is announced as a status message and its dismiss control is
      keyboard-reachable; the statement is readable at mobile width.
      *Announcement and the keyboard-reachable control are verified in code
      (`role="status"`, `aria-live="polite"`, a real `<button type="button">`) and
      by RTL. Mobile width is built for (card-per-invoice, no fixed-width table)
      but not confirmed in a browser - see the note on Task 07; one walkthrough
      covers both and is owed before the milestone closes.*
- [x] `git diff` contains no file under `apps/api/src/`.
- [x] Changed files lint clean; `make test-web` green for the affected component tests.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`, `make dev-api`, `make dev-web`; drive the seeded student into
   `due` and then `delinquent` through the admin API.
2. Sign in as that student and confirm the banner appears and links to
   `/settings/billing`, and that the statement's figures match the admin console's for
   the same student.
3. Navigate the whole protected app as that student and confirm nothing is withheld,
   disabled or dimmed relative to a student in `good` standing.
4. Set a hold from the admin console and confirm the banner disappears on the student's
   next load with no frontend change involved.
5. Sign in as a student with no contract and confirm an empty statement and no banner.
6. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`; run
   `node apps/web/scripts/check-i18n-coverage.js`.
7. Resize to mobile width; tab to the banner's dismiss control.
8. `make test-web` and `make lint`.
9. `git diff --stat` confirms only `apps/web/**` changed.
