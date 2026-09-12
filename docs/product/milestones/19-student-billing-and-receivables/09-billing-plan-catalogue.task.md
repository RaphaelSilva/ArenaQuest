# Task 09 — Frontend: Billing plan catalogue (Phase 5)

**Status:** 📝 Open
**Milestone:** [19 — Student billing, contracts and receivables accounting](./milestone.md)
**RFC:** [RFC 0013](../../RFCs/0013-student-billing-contracts-and-receivables-accounting.md)
**Team:** Frontend Web
**Depends On:** [Task 03](./03-billing-service-and-the-admin-lifecycle-api.task.md)

## Summary

Gives the administrator the price list, which is the first thing missing between a
deployed tenant and a signed contract: RFC 0013's rollout deploys with no plans and no
contracts, and until a plan exists nothing else in billing can be operated. A fourth tab
on `/admin/billing` lists the catalogue — name, description, amount, cycle, grace days,
archived state — and offers create, edit and archive. Editing is safe by construction and
the screen has to say so, because the whole point of snapshotting terms at signature is
lost on an administrator who believes a price change will restate signed contracts and
therefore never touches the form. The catalogue is also explicitly the **recurring**
shelf: the cycle field accepts only monthly, quarterly and yearly, so there is no way to
express a one-off item here, and the copy says what a plan actually is — something
re-invoiced every period by the daily run — rather than leaving an administrator to
discover it after a seminar has been billed for three months. Every write call this tab
makes already exists on the client and on the API; this task adds none.

## Does this need a backend change?

**No.** `apps/web/src/lib/admin-billing-api.ts` already implements `plans.list`,
`plans.create` and `plans.update`, against `GET/POST /v1/admin/billing/plans` and
`PATCH /v1/admin/billing/plans/{id}` from RFC 0013 §5, all delivered and tested by
Task 03. Archiving is `plans.update` with the archived flag — there is no separate
endpoint and none is needed. No component calls any of the three today, which is the
entire gap. `git diff` for this task must contain no file under `apps/api/` or
`packages/`.

## Dependencies

- [Task 03](./03-billing-service-and-the-admin-lifecycle-api.task.md) — owns the three
  plan endpoints this tab consumes. Already `✅ Done`; this task ships no contract of
  its own.
- The existing `/admin/billing` tab shell, its `role="tablist"` keyboard handling and
  the resolved display currency in `apps/web/src/app/(protected)/admin/billing/page.tsx`
  — the new tab joins that set rather than introducing a second pattern.
- The shared money renderer from
  [Task 01](./01-billing-domain-entities-and-repository-port.task.md), reached through the
  console's existing local money component.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/billing/**` — the new tab, its form and its row
    components, plus the tab registration in the existing page shell.
  - `apps/web/src/components/**` and `apps/web/src/hooks/**` — only pieces this tab
    introduces.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are typed).
  - `apps/web/**` component tests.
- **Frontend only.** No backend file is touched. The plan contract is fixed by Task 03,
  and a gap found here is a follow-up task, not a bundled edit.
- **No new client method.** `plans.list`, `plans.create` and `plans.update` are consumed
  as they stand; extending `admin-billing-api.ts` is not part of this task.
- **Money renders only through the shared money formatter** with the currency's exponent
  and symbol. `Intl.NumberFormat`'s currency style must not appear in this diff — it
  accepts a code like BTC and silently rounds it to two decimals.
- **Amounts are entered and submitted as integer minor units.** The form may present a
  familiar decimal field, but no floating-point value is sent, and the conversion is
  driven by the active currency's recorded exponent rather than an assumed two decimals.
- **The catalogue is the recurring shelf.** The cycle control offers only the three
  periodic values the API accepts. It must not offer, imply or leave room for a one-off
  or single-purchase item: a plan is re-invoiced every period by the daily run, so a plan
  created to sell one seminar would be billed every month indefinitely. Selling
  non-recurring extras is outside this milestone entirely.
- **State that editing a plan does not restate signed contracts.** Copy on the edit form
  must say that a signed contract and an issued invoice keep the terms they snapshotted,
  so an administrator can reprice the shelf without fear. Individualising one student is
  a negotiated contract (Task 10), and changing one charge is an adjustment (Task 12) —
  the form should point at those rather than inviting a plan edit to do their job.
- **Archive is not delete.** The catalogue offers archiving, which hides a plan from
  future signature; no destructive control exists, because the API has none and existing
  contracts reference the plan.
- **No paywall affordance.** Nothing on this tab gates, suspends, downgrades or restricts
  a student's access, because no such API exists and none is to be implied.
- **App Router conventions.** The console is already a Client Component; the new tab
  follows it and converts no existing Server Component.
- **i18n.** No hardcoded user-facing string under `src/{app,components,hooks}/**`;
  `dict-en.ts` and `dict-pt.ts` keep identical keys and `check-i18n-coverage.js` passes.
- **Responsive & accessible.** The table stays usable at mobile width; the tab, the form
  and the row actions are keyboard-navigable with semantic markup and labelled fields.

## Scope

In:
- A **Plans** tab registered in the existing `/admin/billing` tab set, with its keyboard
  behaviour matching the three tabs already there.
- The catalogue list: name, description, amount, cycle, grace days and archived state,
  with archived plans filterable rather than hidden outright.
- Create a plan: name, description, amount, currency, cycle, grace days.
- Edit a plan, with the copy explaining that signed contracts and issued invoices are
  unaffected.
- Archive and un-archive a plan.
- Success and error feedback for each write, surfacing the server's own explanation when
  it sends one rather than a generic failure message.
- An empty state that tells a fresh tenant that a plan is the prerequisite for signing a
  contract, and points at the signing screen once one exists.
- Dictionary keys in both languages, including the copy about editing being safe and
  about a plan being a recurring charge.
- Component tests for: the list rendering an amount at exponents 2, 0 and 8; the create
  form's submitted payload; the cycle control offering only the three periodic values;
  and the edit form refusing to submit an amount that is not a whole number of minor
  units.

Out:
- Any backend change — Task 03 owns all three endpoints.
- Signing, amending or listing contracts — Tasks 10 and 11.
- Any ledger write — Tasks 12 and 13.
- A currency management screen — a milestone Non-Goal; currencies are seeded reference
  data.
- Non-recurring items, seminars, one-off classes or any other extra-revenue product —
  not expressible in this data model and out of scope for this milestone.
- Per-topic pricing. The scope topic field the migration reserves is read by no code and
  must stay that way; the form does not expose it.

## Acceptance Criteria

- [ ] The Plans tab appears in the `/admin/billing` tab set, is reachable by keyboard
      alongside the existing three, and lists every plan the API returns.
- [ ] Creating a plan issues the expected request and the new plan appears in the list
      without a full page reload.
- [ ] Editing a plan persists, and the form states that signed contracts and issued
      invoices keep their snapshotted terms.
- [ ] Archiving a plan removes it from the default list, it is recoverable through the
      archived filter, and no delete control exists anywhere on the tab.
- [ ] The cycle control offers exactly monthly, quarterly and yearly, and the tab's copy
      states that a plan is re-invoiced every period.
- [ ] Amounts render at exponents 2, 0 and 8 through the shared money formatter, and the
      string `Intl.NumberFormat` does not appear in the diff.
- [ ] Submitted amounts are integer minor units derived from the active currency's
      exponent; no floating-point amount reaches the API.
- [ ] A server-rejected write shows the server's explanation, and the list is not left
      showing a plan that was not created.
- [ ] On a tenant with no plans, the empty state explains that a plan is required before
      a contract can be signed.
- [ ] No control on the tab suspends, restricts, downgrades or paywalls access.
- [ ] No hardcoded user-facing string; the new keys exist in both `dict-en.ts` and
      `dict-pt.ts`; `node apps/web/scripts/check-i18n-coverage.js` passes.
- [ ] The tab is responsive at mobile width and keyboard-usable throughout, verified in a
      browser and not only under RTL.
- [ ] `git diff` contains no file under `apps/api/` or `packages/`, and
      `apps/web/src/lib/admin-billing-api.ts` is unmodified.
- [ ] Changed files lint clean; `make test-web` green for the affected component tests.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`, `make dev-api`, `make dev-web`; sign in as the seeded admin and
   open `/admin/billing`.
2. On the Plans tab, confirm the empty-state copy on a tenant whose plans have been
   removed, then create a paid plan and a zero-amount plan and confirm both appear.
3. Edit the paid plan's amount and grace days, then confirm through an existing
   contract's statement that its snapshotted terms did not move — the claim the form
   makes to the administrator.
4. Archive a plan, confirm it leaves the default list and returns under the archived
   filter, and confirm no delete control is present.
5. Point the local replica's active currency at JPY (exponent 0) and at BTC (exponent 8)
   and confirm amounts render and submit correctly at each.
6. Submit an invalid plan (blank name, negative amount) and confirm the server's
   explanation is shown and nothing is added to the list.
7. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`, confirm every label translates,
   and run `node apps/web/scripts/check-i18n-coverage.js`.
8. Resize to mobile width and tab through the tab strip, the form and the row actions
   with the keyboard.
9. `make test-web` and `make lint`.
10. `git diff --stat` confirms only `apps/web/**` changed and that
    `apps/web/src/lib/admin-billing-api.ts` is untouched.
