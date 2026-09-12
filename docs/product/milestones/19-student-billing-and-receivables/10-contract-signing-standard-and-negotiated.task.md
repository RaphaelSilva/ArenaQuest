# Task 10 — Frontend: Contract signing, standard and negotiated (Phase 5)

**Status:** ✅ Done
**Milestone:** [19 — Student billing, contracts and receivables accounting](./milestone.md)
**RFC:** [RFC 0013](../../RFCs/0013-student-billing-contracts-and-receivables-accounting.md)
**Team:** Frontend Web
**Depends On:** [Task 03](./03-billing-service-and-the-admin-lifecycle-api.task.md), [Task 09](./09-billing-plan-catalogue.task.md)

## Summary

Lets the administrator put a student under contract from the product, which is the single
step that makes everything else in billing reachable: no contract means no invoice, no
standing and — because a roster line is defined as a student with a contract — no row on
the Students tab at all. The screen picks a student, picks a plan, sets the billing day
and the start date, and signs. Its second mode is the one RFC 0013's Motivation named
directly: **negotiated terms**, where the amount, cycle and grace days are overridden
against a mandatory written reason, so "this student negotiated a different fee in March"
becomes answerable from the product instead of from someone's memory. The negotiated flag
already renders on the Students tab; until now there was no way to set it outside a
hand-written request. Because a student without a contract is invisible to the roster,
the picker cannot be built from roster data — it reads the admin user list, which the
console already fetches for name resolution.

## Does this need a backend change?

**No** — and this was the one worth checking, because the form needs students who have no
contract and therefore no roster line.

`apps/web/src/app/(protected)/admin/billing/page.tsx` **already** calls the admin user
list for the console's name lookup, and `apps/web/src/app/(protected)/admin/access/page.tsx`
is the established precedent for exactly this UI: fetch the user list once, filter it
client-side by name and email in a search box. Both go through
`apps/web/src/lib/admin-users-api.ts`, which is admin-guarded and already wired into the
API client. Signing itself is `subscriptions.create` in `admin-billing-api.ts`, against
`POST /v1/admin/billing/subscriptions` from RFC 0013 §5, delivered by Task 03, called by
no component today.

Two constraints inherited rather than introduced, both to be stated on screen rather than
worked around:

- The user-list endpoint caps its page size at 100 server-side, so the picker sees at most
  the first page. This is the existing behaviour of the access screen and the billing
  console, not something this task creates. If a tenant outgrows it, a searchable user
  endpoint is its own backend task — do not add one here, and do not paginate around it
  silently in a way that hides students from the administrator.
- Whether a student already holds an active contract is **not** something the client is
  trusted to decide. A unique partial index enforces one active contract per user, so a
  duplicate is refused by the database and the screen reports that refusal. Marking
  already-contracted students in the picker is a courtesy that prevents a pointless
  round-trip; it is not the guarantee.

`git diff` for this task must contain no file under `apps/api/` or `packages/`, and
`admin-users-api.ts` must be consumed unmodified.

## Dependencies

- [Task 03](./03-billing-service-and-the-admin-lifecycle-api.task.md) — owns
  `POST /v1/admin/billing/subscriptions`, including the negotiated path and its reason
  field. Already `✅ Done`.
- [Task 09](./09-billing-plan-catalogue.task.md) — a contract cannot be signed against an
  empty catalogue, and this screen reuses the plan list that task introduces.
- The console's existing student name map and resolved display currency in
  `apps/web/src/app/(protected)/admin/billing/page.tsx`.
- `apps/web/src/lib/admin-users-api.ts` and the picker pattern in
  `apps/web/src/app/(protected)/admin/access/page.tsx` — both consumed, neither modified.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/billing/**` — the signing form, the student
    picker and their entry points from the Students tab and the statement panel.
  - `apps/web/src/components/**` and `apps/web/src/hooks/**` — only pieces this screen
    introduces.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are typed).
  - `apps/web/**` component tests.
- **Frontend only.** No backend file is touched, and `admin-users-api.ts` and
  `admin-billing-api.ts` are both consumed as they stand.
- **The student picker reads the user list, not the roster.** Building it from roster data
  would make it structurally impossible to sign the first contract for anyone, which is
  the defect this task exists to fix.
- **Negotiated terms require their reason.** The form must refuse to submit a negotiated
  contract without a written note, and must make clear that the note is the record of
  what was agreed — it is what a future administrator reads to answer why this student
  pays a different amount.
- **The negotiated path is a deliberate mode, not a default.** Standard signature
  pre-fills from the plan and shows the terms being adopted; the administrator has to
  choose to depart from them, and the screen shows what changed against the plan.
- **Money is entered and submitted as integer minor units** against the active currency's
  recorded exponent, and rendered only through the shared money formatter.
  `Intl.NumberFormat`'s currency style must not appear in this diff.
- **No standing rule in the client.** Nothing on this screen computes, predicts or
  previews a standing, a due date's consequence or a grace outcome; the server owns that.
  Showing the plan's recorded grace days as data is fine; deriving anything from them is
  not.
- **A duplicate active contract is the server's refusal to report.** The screen surfaces
  it as an explained error, never as a client-side assertion presented as authority.
- **No paywall affordance.** Signing a contract grants nothing and restricts nothing:
  it records what was agreed. The screen must not suggest that signing, or failing to
  sign, changes what a student can see.
- **App Router conventions.** The console is already a Client Component; this screen
  follows it and converts no existing Server Component.
- **i18n.** No hardcoded user-facing string under `src/{app,components,hooks}/**`;
  `dict-en.ts` and `dict-pt.ts` keep identical keys and `check-i18n-coverage.js` passes.
- **Responsive & accessible.** The form is usable at mobile width; every field is
  labelled, the picker is keyboard-navigable, and validation messages are associated with
  their fields.

## Scope

In:
- A signing screen reachable from the Students tab and from a student's statement panel.
- The student picker: the admin user list with a name and email search, marking students
  who already hold an active contract, and stating plainly that it shows the first page
  of users so nobody assumes a missing student does not exist.
- Plan selection, showing the terms that will be snapshotted — amount, cycle, grace days.
- Billing day and start date, within the range the API accepts.
- The negotiated mode: overrides for amount, cycle and grace days, a mandatory reason,
  and a visible comparison against the plan's own terms.
- Submission, with success feedback that lands the administrator where the new contract
  is visible, and error feedback carrying the server's explanation — the duplicate active
  contract case included.
- Dictionary keys in both languages, including the copy explaining what a negotiated
  contract records and that signing changes no access.
- Component tests for: the picker filtering by name and email; the form refusing a
  negotiated submission with no reason; the standard payload matching the selected plan's
  terms; the negotiated payload carrying the overrides and the note; and the duplicate
  refusal surfacing as a readable error.

Out:
- Any backend change — Task 03 owns the endpoint, and no new user-search endpoint is
  added here.
- Pausing, resuming, cancelling or amending a contract — Task 11.
- Any ledger write — Tasks 12 and 13.
- Creating or editing a plan — Task 09.
- Creating a user. The picker selects among existing accounts; user administration is its
  own screen.
- Proration. A contract starts when it starts; mid-period arithmetic is a milestone
  Non-Goal.

## Acceptance Criteria

- [x] A student who holds **no contract**, and therefore appears on no roster line, is
      selectable in the picker and can be put under contract end to end.
- [x] The picker filters by name and email, marks students who already hold an active
      contract, and states that it lists the first page of users.
- [x] A standard signature submits the selected plan's amount, cycle and grace days
      unchanged, and the resulting contract appears with terms matching the plan.
- [x] A negotiated signature refuses to submit without a reason, and on success the
      contract records the overridden terms, the negotiated source and the note.
- [x] After signing a negotiated contract, its amount and reason are readable back from
      the product — the Motivation's March renegotiation is answerable without a database
      query.
- [x] A newly signed student appears on the Students tab, where they had no row before.
- [x] Attempting a second active contract for one student surfaces the server's refusal
      as an explained error; no client-side check is presented as the authority.
- [x] Amounts render at exponents 2, 0 and 8 through the shared money formatter, are
      submitted as integer minor units, and `Intl.NumberFormat` does not appear in the
      diff.
- [x] No standing, due-date consequence or grace outcome is computed anywhere on the
      screen.
- [x] Nothing on the screen suggests that signing or not signing changes a student's
      access.
- [x] No hardcoded user-facing string; the new keys exist in both `dict-en.ts` and
      `dict-pt.ts`; `node apps/web/scripts/check-i18n-coverage.js` passes.
- [~] The form is responsive at mobile width and keyboard-usable throughout, with
      labelled fields and field-associated validation, verified in a browser.
- [x] `git diff` contains no file under `apps/api/` or `packages/`, and
      `apps/web/src/lib/admin-users-api.ts` and `admin-billing-api.ts` are both
      unmodified.
- [x] Changed files lint clean; `make test-web` green for the affected component tests.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`, `make dev-api`, `make dev-web`; sign in as the seeded admin.
2. Create a plan on the Plans tab if none exists, then confirm the seeded student who has
   **no** contract is absent from the Students tab and still selectable in the picker.
3. Sign a standard contract for that student and confirm they now appear on the Students
   tab with the plan's terms.
4. Sign a negotiated contract for a second uncontracted student with a different amount
   and a reason; confirm the negotiated flag shows on the Students tab and the reason is
   readable from the contract.
5. Attempt a second active contract for an already-contracted student and confirm the
   server's refusal is shown clearly and nothing is created.
6. Submit a negotiated form with the reason blank and confirm it does not submit.
7. Point the local replica's active currency at JPY and at BTC and confirm the amount
   field and the displayed terms behave at exponents 0 and 8.
8. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`, confirm every label translates,
   and run `node apps/web/scripts/check-i18n-coverage.js`.
9. Resize to mobile width and complete a signature using only the keyboard.
10. `make test-web` and `make lint`.
11. `git diff --stat` confirms only `apps/web/**` changed, and `git diff` confirms both
    API client files are untouched.
