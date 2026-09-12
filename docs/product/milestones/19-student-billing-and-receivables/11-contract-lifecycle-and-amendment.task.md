# Task 11 — Frontend: Contract lifecycle and amendment (Phase 5)

**Status:** 📝 Open
**Milestone:** [19 — Student billing, contracts and receivables accounting](./milestone.md)
**RFC:** [RFC 0013](../../RFCs/0013-student-billing-contracts-and-receivables-accounting.md)
**Team:** Frontend Web
**Depends On:** [Task 03](./03-billing-service-and-the-admin-lifecycle-api.task.md), [Task 04](./04-accounting-reports-and-per-student-statement.task.md), [Task 10](./10-contract-signing-standard-and-negotiated.task.md)

## Summary

Gives a signed contract the rest of its life. On the student's statement panel, the
contract chain becomes visible and operable: pause it when a student steps away, resume
it, cancel it when they leave, and amend it when the fee is renegotiated. The distinctions
here are the ones a dojo administrator gets wrong by default, so the screen has to carry
them in its copy rather than in a wiki: pausing stops the *next* invoice and nothing else,
so every already-open charge keeps its due date and keeps counting in the reports;
cancelling closes the contract but forgives no debt, which is a waiver adjustment; and
neither of them is a hold, which only stops the chasing. Amendment is the subtle one —
renegotiation supersedes rather than edits, leaving a chain of versions where the old
terms stay readable and the invoices issued under them still explain themselves. The
screen renders that chain, because an administrator who cannot see that history was added
will assume it was overwritten and will be reluctant to use the feature at all.

## Does this need a backend change?

**No.** `apps/web/src/lib/admin-billing-api.ts` already implements
`subscriptions.list`, `subscriptions.update` for the pause, resume and cancel actions,
and `subscriptions.amend`, against `GET /v1/admin/billing/subscriptions`,
`PATCH /v1/admin/billing/subscriptions/{id}` and
`POST /v1/admin/billing/subscriptions/{id}/amend` from RFC 0013 §5 — all delivered by
Task 03 and called by no component today.

The version chain needs no new endpoint either: the per-student statement from Task 04,
which the console's statement panel already fetches, returns each contract group together
with its ordered versions. Rendering the chain is therefore a matter of displaying data
the screen is already receiving and currently discards. `git diff` for this task must
contain no file under `apps/api/` or `packages/`.

## Dependencies

- [Task 03](./03-billing-service-and-the-admin-lifecycle-api.task.md) — owns the
  lifecycle and amendment endpoints. Already `✅ Done`.
- [Task 04](./04-accounting-reports-and-per-student-statement.task.md) — owns the
  per-student statement, which is the source of the contract groups and their versions.
  Already `✅ Done`.
- [Task 10](./10-contract-signing-standard-and-negotiated.task.md) — there is nothing to
  pause or amend before a contract can be signed, and the amendment form reuses the terms
  editor that task introduces, including its mandatory-reason behaviour.
- The existing statement panel at
  `apps/web/src/app/(protected)/admin/billing/student-statement-panel.tsx`, which this
  task extends rather than replaces.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/billing/**` — the statement panel's contract
    section, the lifecycle actions and the amendment form.
  - `apps/web/src/components/**` and `apps/web/src/hooks/**` — only pieces this screen
    introduces.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are typed).
  - `apps/web/**` component tests.
- **Frontend only.** No backend file is touched, and `admin-billing-api.ts` is consumed
  as it stands.
- **Each action states its real effect, in the dictionary copy.** Pausing stops the next
  issue and nothing else — open invoices keep their due dates, keep counting toward the
  outstanding total and the aging report, and still move the student's standing on
  schedule. Cancelling closes the contract with an end date and forgives nothing.
  Neither is a hold. Forgiving a debt is a waiver adjustment, and stopping reminders is a
  hold; where an administrator is likely to reach for the wrong one, the copy points at
  the right one.
- **Amendment supersedes; it never edits.** The screen offers no in-place edit of signed
  terms, and the amendment form requires its written reason. After amending, the chain
  renders with the superseded version still readable.
- **The chain is rendered from the statement's own data.** Version ordering, which version
  is active and which it superseded are read from the API response; the client does not
  reconstruct the chain from separate queries or infer ordering from dates.
- **No standing rule in the client.** Nothing here previews what pausing or cancelling
  will do to a standing, a due date or an aging bucket. The server resolves standing on
  every read, and the screen shows what it resolved.
- **Destructive-looking language is avoided where the action is not destructive**, and
  used where it is: cancelling a contract ends a membership and the confirmation should
  say so, while pausing should not read as though it erases anything.
- **Money renders only through the shared money formatter** at the currency's recorded
  exponent; `Intl.NumberFormat`'s currency style must not appear in this diff. Amended
  amounts are submitted as integer minor units.
- **No paywall affordance.** Pausing or cancelling a contract changes no permission and
  withholds no screen. The copy must not imply that a cancelled or paused student loses
  access, because they do not.
- **App Router conventions.** The statement panel is already a Client Component; this
  task follows it and converts no existing Server Component.
- **i18n.** No hardcoded user-facing string under `src/{app,components,hooks}/**`;
  `dict-en.ts` and `dict-pt.ts` keep identical keys and `check-i18n-coverage.js` passes.
- **Responsive & accessible.** The chain and its actions stay usable at mobile width;
  confirmations are keyboard-reachable and the reason field is labelled and associated
  with its validation message.

## Scope

In:
- The contract section of the statement panel: each contract group, its versions in
  order, which version is active, and the terms each one carried.
- Pause, resume and cancel on the active contract, each behind a confirmation that states
  the action's real effect, and cancel accepting its end date where the API does.
- The amendment form: new amount, cycle, grace days and billing day, with a mandatory
  reason, presented as creating a new version rather than editing the current one.
- A rendering of the resulting chain after an amendment, so the superseded version and
  its terms remain visible with the reason that replaced them.
- Copy that separates pause, cancel, hold and waiver, and points an administrator at the
  right one for forgiving a debt or stopping reminders.
- Success and error feedback for each action, carrying the server's explanation when it
  sends one.
- Dictionary keys in both languages for all of the above.
- Component tests for: the chain rendering three versions with exactly one active; the
  amendment form refusing to submit without a reason; each lifecycle action's request
  payload; and the absence of any in-place terms edit on a signed contract.

Out:
- Any backend change — Tasks 03 and 04 own every endpoint.
- Signing a new contract — Task 10.
- Setting or clearing a hold — already shipped on the Students tab by Task 07.
- Any ledger write, including the waiver adjustment this screen's copy points at —
  Task 12.
- Proration. An amendment takes effect at the next period boundary; mid-period
  arithmetic is a milestone Non-Goal.
- Re-enrolling a former student. Starting a fresh contract group after a gap is an
  ordinary signature and belongs to Task 10.

## Acceptance Criteria

- [ ] A student's statement panel renders each contract group with its versions in order,
      marking the active one, and showing the terms each version carried.
- [ ] Pausing the active contract succeeds, and its confirmation states that open invoices
      keep their due dates and keep counting toward the outstanding total and the aging
      report.
- [ ] A paused contract can be resumed, and the screen reflects the change without a full
      page reload.
- [ ] Cancelling closes the contract with an end date, and its confirmation states that no
      debt is forgiven and points at the waiver adjustment for that.
- [ ] The copy distinguishes pause, cancel, hold and waiver clearly enough that an
      administrator looking to stop reminders is directed to a hold and one looking to
      forgive a charge is directed to a waiver.
- [ ] Amending requires a reason, creates a new active version, and leaves the previous
      version visible as superseded with its original terms intact.
- [ ] After two amendments the panel shows a chain of three versions with exactly one
      active, read from the statement response rather than reconstructed client-side.
- [ ] No screen offers an in-place edit of a signed contract's terms.
- [ ] Amounts render at exponents 2, 0 and 8 through the shared money formatter, amended
      amounts submit as integer minor units, and `Intl.NumberFormat` does not appear in
      the diff.
- [ ] No standing, due-date or aging consequence is computed or previewed anywhere on the
      screen.
- [ ] Nothing on the screen implies that a paused or cancelled student loses access.
- [ ] No hardcoded user-facing string; the new keys exist in both `dict-en.ts` and
      `dict-pt.ts`; `node apps/web/scripts/check-i18n-coverage.js` passes.
- [ ] The section is responsive at mobile width and keyboard-usable throughout, verified
      in a browser.
- [ ] `git diff` contains no file under `apps/api/` or `packages/`, and
      `apps/web/src/lib/admin-billing-api.ts` is unmodified.
- [ ] Changed files lint clean; `make test-web` green for the affected component tests.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`, `make dev-api`, `make dev-web`; sign in as the seeded admin and
   open a contracted student's statement from the Students tab.
2. Note the student's outstanding total and their aging bucket, pause the contract, then
   confirm both are unchanged and the open invoice kept its due date — the claim the
   confirmation makes.
3. Resume the contract and confirm the next cycle run issues for it again, using the
   manual run once Task 13 has landed or the API directly before then.
4. Amend the contract with a new amount and a reason; confirm a chain of two versions with
   one active, the superseded terms still readable, and an invoice issued before the
   amendment still showing its original amount.
5. Amend once more and confirm a chain of three with exactly one active.
6. Cancel a contract and confirm the end date is recorded, the debt is still outstanding,
   and the copy pointed at a waiver rather than implying forgiveness.
7. Submit an amendment with the reason blank and confirm it does not submit.
8. Confirm no control anywhere in the section edits signed terms in place.
9. Point the local replica's active currency at JPY and at BTC and confirm rendering and
   submission at exponents 0 and 8.
10. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`, confirm every label translates,
    and run `node apps/web/scripts/check-i18n-coverage.js`.
11. Resize to mobile width and drive every action with the keyboard.
12. `make test-web` and `make lint`.
13. `git diff --stat` confirms only `apps/web/**` changed.
