# Task 09 — Frontend: Student extras, plans-tab link and event charges panel (Phase 4)

**Status:** 📝 Open
**Milestone:** [22 — Event extras: one-off charges on a separate billing rail](./milestone.md)
**RFC:** [RFC 0015](../../RFCs/0015-event-extras-one-off-charges-for-events.md)
**Team:** Frontend Web
**Depends On:** [Task 05](./05-per-rail-reports-statement-and-me-billing.task.md), [Task 03](./03-event-charge-service-and-admin-api.task.md)

## Summary

Closes the three remaining surfaces of RFC 0015 §8. On **`/settings/billing`**, the student
keeps their contract section unchanged and sees a separate **Extras** section listing each of
their charges with event title, event date, due date, balance and its own standing badge —
read from the `extras` object Task 05 added to `/v1/me/billing`. On the admin **plans tab**,
the copy that already warns that a plan is recurring (M19 Task 09) gains a link to the Extras
tab, so an administrator who wanted to "create a Seminário plan" is given the right door
instead of only a warning. On the admin **event page**, a read-only **Charges** panel shows the
event's summary (charged, received, outstanding, counts by status) from the Task 03 summary
endpoint, with a link into the Extras tab pre-selected on that event; no money is written from
the events backoffice.

## Dependencies

- [Task 05](./05-per-rail-reports-statement-and-me-billing.task.md) — the `extras` object on
  `/v1/me/billing`.
- [Task 03](./03-event-charge-service-and-admin-api.task.md) — the per-event summary endpoint.
- [Task 07](./07-admin-extras-tab.task.md) — ordering preference: the links target the Extras
  tab it creates.
- Existing pieces extended: `apps/web/src/app/(protected)/settings/billing/page.tsx`,
  `apps/web/src/app/(protected)/admin/billing/plans-tab.tsx`, the admin event detail/edit page
  under `apps/web/src/app/(protected)/admin/events/`, and the billing / me-billing API clients
  under `apps/web/src/lib/`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/settings/billing/**` — the Extras section and its test.
  - `apps/web/src/app/(protected)/admin/billing/plans-tab.tsx` — the link only.
  - `apps/web/src/app/(protected)/admin/events/**` — a new read-only Charges panel component
    and its mount point on the event page; no form field, no write call.
  - `apps/web/src/lib/` — the me-billing client's types and one summary call in the billing client.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are typed).
- **Read-only on events.** The Charges panel issues only `GET` requests; it does not call any
  `apps/web/src/lib/admin-events-api.ts` write.
- **No withholding.** The existing `no-withholding` test for `(protected)` must still pass —
  nothing here hides content based on a balance.
- **i18n.** No hardcoded user-facing strings; identical keys; `check-i18n-coverage.js` passes.

## Scope

In:
- `/settings/billing` Extras section with its own badge, and an empty state when the student
  has no charge.
- Plans-tab link to the Extras tab.
- Event page Charges panel (summary + link), hidden when the event has no price and no charge.
- Component tests for the three surfaces.

Out:
- Extras tab — Task 07. Roster, reports and statement panel — Task 08.
- Any backend change.

## Acceptance Criteria

- [ ] A student with a paid-up contract and one overdue charge sees the contract section
      unchanged and an Extras section showing that charge as overdue, with the event title.
- [ ] A student with no charge sees no Extras section content beyond its empty state.
- [ ] The plans tab shows a link that opens the Extras tab.
- [ ] The admin event page shows the Charges summary for a charged event, and the link opens
      the Extras tab on that event; the panel issues no non-GET request.
- [ ] The existing `no-withholding` test passes unchanged.
- [ ] No hardcoded user-facing string; keys exist in both dictionaries;
      `check-i18n-coverage.js` passes.
- [ ] Changed files lint clean; `make test-web` green for the affected component tests.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-api` + `make dev-web` on the seeded local D1.
2. Sign in as the seeded extras buyer; open `/settings/billing`.
3. Sign in as admin; open the plans tab link; open the seeded event's page and follow the
   Charges link.
4. Toggle `NEXT_PUBLIC_LANGUAGE`; resize to mobile.
5. `make test-web`; run `check-i18n-coverage.js`.
6. `git diff --stat` confirms only scope-guardrail files changed.
