# Milestone 22 — Event extras: one-off charges on a separate billing rail

**Status:** 📝 Draft
**Scope:** `apps/api` (billing bounded context: new event-charge ledger, per-rail standing, roster, reports, daily run), `packages/shared` (billing types, new port, `receivable.ts`), `apps/web` (admin billing console, admin events panel, student `/settings/billing`). Derived from [RFC 0015](../../RFCs/0015-event-extras-one-off-charges-for-events.md).

> **Hard scope guardrail — read before opening any task.** This milestone may touch **only**: the new migration `apps/api/migrations/0028_create_event_charges.sql` (renumbered to `0029` if RFC 0016's `0028_create_topic_notes.sql` lands first); the new files `packages/shared/{ports/i-event-charge-repository.ts,domain/billing/receivable.ts}` and their re-exports in `ports/index.ts` / `domain/billing/index.ts`; `packages/shared/types/entities.ts` **only** to add `Entities.Billing.EventPrice`/`EventCharge` and `Config.ChargeStatus`; the new `apps/api/src/adapters/db/d1-event-charge-repository.ts` and `apps/api/src/core/billing/event-charge-service.ts`; the existing `apps/api/src/core/billing/{billing-service.ts,accounting-service.ts}`, `apps/api/src/controllers/{admin-billing.controller.ts,me-billing.controller.ts}`, `apps/api/src/routes/admin/billing.ts`, `apps/api/src/routes/me/billing.ts` and the container wiring in `apps/api/src/index.ts`; `apps/web/src/app/(protected)/admin/billing/**`, a read-only panel under `apps/web/src/app/(protected)/admin/events/**`, `apps/web/src/app/(protected)/settings/billing/**`, the billing API clients under `apps/web/src/lib/`, both i18n dictionaries; and, for the closeout only, a local seed file under `apps/api/migrations/seed/`, `docs/product/FEATURES.md`, RFC 0015's `Status:` header and its README row. It is explicitly **not** an opportunity to: **merge the two rails** — no field, filter, report or standing may combine contract invoices and event charges, except the explicitly named `cashReceivedMinor`; grant or revoke anything — no write to `enrollments_*` or `event_audience_*`, no read of `getEffectiveAccessTopicIds`, no gate, no `402` (RFC 0013 #2, RFC 0015 Resolved #1); alter any RFC 0013 table (`invoices`, `payments`, `invoice_adjustments`, `subscriptions`, `billing_plans`, `billing_standing_holds`) or the invoice run's idempotency key; add a money column or any money route to `events` / `routes/admin/events.ts`; build self-service checkout, a payment gateway, guest charges, quantities/tickets/seat limits, installments or automatic charging on RSVP/audience; add a hold for the extras rail; or charge a `draft`/`archived` event. If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **An event can carry a list price without `events` carrying money.** `event_prices` is its own optional table; an event with no row is not for sale (RFC §1, Alternative 4).
- **An administrator charges one or many users for a published event in one idempotent request.** At most one live charge per `(event, user)`; a re-submit creates nothing and reports the duplicates as *absorbed* (RFC §1, §3, §7).
- **A charge has an invoice's accounting guarantees on its own ledger.** Snapshot amount, minor units, single active currency, append-only adjustments and payments, reversal by mirror row, voiding as a recorded decision (RFC §1, §3).
- **Two rails, never merged.** Contract standing stays exactly RFC 0013's (invoices only) and remains the input to the manual access decision; extras standing is resolved separately from charges by the same pure resolver, and a mixed input throws (RFC §2, Resolved #5).
- **The roster answers both questions side by side.** "Is the monthly fee late?" and "did an extra slip through?" — two badges, two independent filters, buyers with no contract included (RFC §4, Resolved #4).
- **Reports keep the rails apart.** Movement gets an `extras` block beside the unchanged contract fields; aging gets `?rail=` defaulting to `contract` (RFC §7).
- **The student sees and is reminded of their extras.** `/v1/me/billing` gains a separate `extras` object; the daily run e-mails the same two reminders as for a monthly fee, worded for the event, not suppressed by a contract hold (RFC §5, Resolved #8, #9).
- **The administrator is warned — never blocked, never auto-granted — when a buyer cannot see a restricted event** (RFC §7, Resolved #7).
- **The "Seminário plan" footgun gets a door.** The plans tab links to the Extras tab (RFC §8).

Out of scope (explicit, from RFC 0015 Non-Goals):
- **Access of any kind** — a charge never enrolls, unlocks or adds to an audience; widening that is a reversal of RFC 0013 Alternative 10 in a new RFC.
- **Self-service purchase, checkout, payment gateway** — manual recording as in RFC 0013; a gateway reuses `external_reference` + `method = 'gateway'` later (RFC 0013 #9).
- **Charging someone with no account** — the lead is created through the existing admin user flow first.
- **Quantities, tickets, seat limits, waitlists** — one charge is one user's participation.
- **Automatic charging** on RSVP or audience membership — the run issues no charge.
- **Installments of one extra** — one due date per charge; partial payments already work.
- **A charge with no event** — deferred (RFC Alternative 6).
- **A hold on the extras rail** — rejected for v1 (Resolved #9); would be a new `event_charge_holds` table.
- **Any change to RFC 0013's tables, its run or its idempotency key.**

---

## 2. Functional Requirements

**Pricing**
- `PUT /v1/admin/billing/event-prices/{eventId}` sets or replaces an event's price (`amountMinor`, `dueInDays`, `graceDays`) in the tenant's active currency; `GET` returns it or `404`; `DELETE` stops offering it without touching existing charges.
- A price in a currency other than the active one is rejected.

**Issuing charges**
- `POST /v1/admin/billing/charges` issues one charge per `userIds[]` entry (1–200) for one `eventId`, returning `{ created, absorbed, outsideAudience }`.
- Only a `published` event can be charged; `draft` and `archived` return `409`. Archiving an event later leaves its charges intact.
- Without an explicit amount the event price is snapshot (`terms_source='standard'`); an explicit amount differing from the price — or any amount when no price exists — is `negotiated` and requires a `termsNote`.
- The due date defaults to issue date + `dueInDays`; grace defaults to the price's `graceDays`. Both are snapshot on the charge.
- A second live charge for the same `(event, user)` is not created; it is reported under `absorbed`. A voided charge does not block a re-issue.
- For a `restricted` event, users not in its audience (neither directly nor through a group) are listed in `outsideAudience`; the charge is still issued and no audience row is written. `GET /v1/admin/billing/events/{eventId}/audience-check?userIds=…` answers the same question without writing.

**Ledger on a charge**
- Payments must be positive; a reversal appends the negated mirror row with a mandatory reason; a reversal cannot be reversed, and a payment can be reversed only once.
- No payment on a void charge; the payment currency must equal the charge's.
- Adjustments (`discount`/`credit`/`waiver`/`surcharge`) are signed, non-zero, with a mandatory reason.
- A charge whose net payments are positive cannot be voided (`409`); voiding requires a reason.
- The cached `status` flips `open`↔`paid` in the same batch as the ledger write that crossed zero.
- Every write emits a `billing.charge.*` audit line with the acting admin.

**Standing and roster**
- Contract standing is computed from contract invoices only and is unchanged for every existing input.
- Extras standing is computed from event charges only, with the same four labels.
- `GET /v1/admin/billing/students` lists every user with a contract **or** any charge; each entry carries a `contract` block (or `null`) and an `extras` block (or `null`), each with its own standing, oldest overdue date and outstanding amount; no top-level standing or total exists.
- `contractStanding` and `extrasStanding` filter independently; the legacy `standing` filter means `contractStanding`.
- A hold makes the contract standing `exempt` and has no effect on the extras rail.

**Reports and statements**
- Movement keeps every existing field's meaning (contracts only) and adds `extras: { chargedMinor, adjustmentsMinor, receivedMinor, chargesIssued, receivableAtCloseMinor }` plus `cashReceivedMinor` (both rails).
- Aging accepts `?rail=contract|extras` (default `contract`); the two are never bucketed together.
- The admin statement and `GET /v1/me/billing` keep `standing`/`outstandingMinor` as contract-only and add `extras: { standing, outstandingMinor, charges[] }`.
- `GET /v1/admin/billing/events/{eventId}/summary` returns charged, received, outstanding and counts by status for one event.

**Daily run**
- The run writes no row in any `event_charge*` table.
- An open charge produces an `extras_due_date` e-mail on its due date and an `extras_grace_lapsed` e-mail when grace lapses, naming the event; a contract hold does not suppress them.
- The admin digest reports standing crossings in two separate sections, one per rail.

**Web**
- Admin billing has an **Extras** tab: choose a published event, edit its price, see its summary, charge participants (user multi-select with group expansion and "create user" shortcut), and run payment / adjustment / reversal / void on each charge.
- The charge dialog flags, inline, each selected user outside a restricted event's audience, linking to the event's audience; submitting stays allowed.
- The roster shows a *Monthly fee* badge and an *Extras* badge per row, each with its amount and overdue count, and two independent filters.
- The reports tab has a rail switch on aging and shows the contract block, the extras block and the till total apart on movement.
- The statement panel and `/settings/billing` show an "Extras" section with its own standing badge, separate from the contract section.
- The plans tab links to the Extras tab from its "a plan is recurring" copy.
- The admin event page shows a read-only "Charges" summary linking to the Extras tab; no money is written from the events backoffice.
- No hardcoded user-facing strings; `dict-en`/`dict-pt` keep identical keys.

---

## 3. Acceptance Criteria

- [ ] Migration `0028` (or `0029`) creates exactly `event_prices`, `event_charges`, `event_charge_adjustments`, `event_charge_payments` and their indexes, and contains no `ALTER`, `DROP` or `UPDATE` of any pre-existing table.
- [ ] Issuing the same `(eventId, userIds)` twice returns every pair in `created` the first time and in `absorbed` the second; `SELECT COUNT(*)` is unchanged by the second call.
- [ ] Issuing on a `draft` or `archived` event returns `409` and writes nothing.
- [ ] A negotiated amount without `termsNote` returns `400`.
- [ ] A payment equal to the balance leaves the charge `paid`; its reversal leaves it `open`; reversing the reversal returns `409`.
- [ ] Voiding a charge with positive net payments returns `409`.
- [ ] **Rail isolation (API test):** contract paid-up + one overdue charge ⇒ roster `contract.standing = good`, `extras.standing = delinquent`; late invoice + all charges paid ⇒ `contract.standing = delinquent`, `extras.standing = good`.
- [ ] Calling `resolveRailStanding('contract', …)` with an `event_charge` item throws.
- [ ] With charges present, `GET /v1/admin/billing/students?contractStanding=delinquent` returns exactly the users it returns with the charge tables empty.
- [ ] A user with no contract and one overdue charge appears with `contract: null` and `extras.standing = delinquent`, in `?rail=extras` aging, and in their own `/v1/me/billing`.
- [ ] A hold turns `contract.standing` to `exempt` and leaves `extras.standing` and the extras reminders unchanged.
- [ ] The roster query-count test asserts **4** queries, independent of the number of students.
- [ ] Movement for a month with 30000 fees and 15000 extras received returns `receivedMinor = 30000`, `extras.receivedMinor = 15000`, `cashReceivedMinor = 45000`.
- [ ] The scheduled run leaves every `event_charge*` table's row count unchanged; an overdue charge yields exactly one `extras_due_date` and one `extras_grace_lapsed` reminder over the relevant days, each naming the event.
- [ ] Charging a user outside a `restricted` event's audience returns them in `outsideAudience`, and `event_audience_user`/`event_audience_group` row counts are unchanged.
- [ ] A test asserts no charge path writes `enrollments_*` or `event_audience_*`.
- [ ] Web tests: roster renders both badges and both filters; charge dialog shows the audience warning and still submits; `/settings/billing` renders the extras section apart from the contract one.
- [ ] `check-i18n-coverage.js` passes; `dict-en`/`dict-pt` keys are identical.
- [ ] `make lint`, `make test-api` and `make test-web` pass green.
- [ ] No diff outside the files listed in the guardrail.

---

## 4. Specific Stack

- **Backend:** Cloudflare Workers + Hono; per-request adapters in `buildApp(env)` (the new `D1EventChargeRepository` sits next to `D1BillingRepository`, never in module scope); routes are `@hono/zod-openapi` `createRoute` definitions on the existing billing sub-router under its `requireRole(ROLES.ADMIN)`; services return `ControllerResult<T>`. D1 writes that must be atomic (ledger row + status refresh, bulk issue with `ON CONFLICT DO NOTHING`) use `db.batch([...])`.
- **Shared:** `Entities.Billing.EventPrice`/`EventCharge`, `Config.ChargeStatus`; new port `IEventChargeRepository`; new pure module `domain/billing/receivable.ts` (`BillingRail`, `Receivable`, `fromInvoice`, `fromCharge`, `resolveRailStanding`); `resolveStanding` itself is **not** modified.
- **Frontend:** Next.js 15 App Router, React 19, Tailwind CSS v4; reuse the existing billing forms (`payment-form.tsx`, `adjustment-form.tsx`, `void-invoice-form.tsx`, `money.tsx`, `standing-badge.tsx`) by parametrising the target kind; both i18n dictionaries; `check-i18n-coverage.js`.
- **Tests:** Vitest + `@cloudflare/vitest-pool-workers` (API, including the roster query-count test and the run tests); Vitest for `packages/shared` pure modules; Vitest + RTL (web).

---

## 5. Task Breakdown

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Event-charge domain, port and the rail-tagged receivable](./01-event-charge-domain-port-and-receivable.task.md) | 0 | Backend | ✅ Done |
| 02 | [Event-charge schema, D1 repository and local seed](./02-event-charge-schema-d1-repository-and-seed.task.md) | 1 | Backend | ✅ Done |
| 03 | [Event-charge service and admin API](./03-event-charge-service-and-admin-api.task.md) | 2 | Backend | ✅ Done |
| 04 | [Two-rail standing and roster](./04-two-rail-standing-and-roster.task.md) | 3 | Backend | ✅ Done |
| 05 | [Per-rail reports, statement and `/v1/me/billing`](./05-per-rail-reports-statement-and-me-billing.task.md) | 3 | Backend | ✅ Done |
| 06 | [Daily run: extras reminders and per-rail crossings](./06-daily-run-extras-reminders-and-crossings.task.md) | 3 | Backend | ✅ Done |
| 07 | [Admin Extras tab](./07-admin-extras-tab.task.md) | 4 | Frontend | ✅ Done |
| 08 | [Two-rail roster, reports and statement panel](./08-two-rail-roster-reports-and-statement.task.md) | 4 | Frontend | ☐ Open |
| 09 | [Student extras, plans-tab link and event charges panel](./09-student-extras-plans-link-and-event-panel.task.md) | 4 | Frontend | ☐ Open |
| 10 | [Seed, docs and rollout closeout](./10-seed-docs-and-rollout.task.md) | 5 | Backend | ☐ Open |

Dependency graph:

```
01 ──► 02 ──┬──► 03 ─────────────────► 07 ──┐
            │     │                         │
            │     └───────────────┐         │
            │                     ▼         │
            └──► 04 ──┬──► 05 ──► 09 ◄──────┤  (09 also links to 07's tab)
                      │     │               │
                      │     └──► 08 ◄── 04  │  (04 + 08 ship in one merge)
                      │                     │
                      └──► 06               │
                                            ▼
                               07, 08, 09 ──► 10
```

**Recommended execution order:** `01` → `02` → `03` → `04` → `05` → `06` → `07` → `08` → `09` → `10`.

`04` reshapes `RosterEntry` (an API contract change whose only consumer is the admin billing console), so `04` and `08` must reach `main` in the same candidate merge — never deploy `04` alone.

Each task is intended to land as an independent PR into the `feature/m22/candidate` branch with `make lint`, `make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC 0015 "Resolved Decisions")

1. **An extra is a charge for an event and grants no content access** — RFC 0013's "billing never touches access" and its Alternative 10 (per-topic pricing) stand; any widening is a new RFC. *(owner, 2026-09-12)*
2. **Extras are RFC 0015, after RFC 0014** — the charge points at `events.id`; `events` stays money-free. *(owner, 2026-09-16)*
3. **Additive model** — new tables beside RFC 0013's, with their own ledger, because `payments.invoice_id`/`invoice_adjustments.invoice_id` are `NOT NULL`; no rebuild of `invoices`. *(owner, 2026-09-27)*
4. **Buyers without a contract are students** — charged like any student, listed on the roster and reports; they need a `users` row, created through the existing admin flow. *(owner, 2026-09-27)*
5. **Two rails, never merged** — contract standing (invoices only) is what the manual access policy reads; extras standing is a payment-control view; no field sums both except `cashReceivedMinor`. *(owner, 2026-09-27)*
6. **Charges only on `published` events** — no pre-sale on `draft`, none on `archived`; existing charges survive a later archive. *(owner, 2026-09-27)*
7. **Restricted audience: warn only** — `outsideAudience` + inline warning; never blocks, never writes an audience row. *(owner, 2026-09-27)*
8. **Extras reminders** — same two e-mails as a monthly fee (due date, grace lapsed), worded for the event. *(owner, 2026-09-27)*
9. **Holds apply to monthly fees only** — a contract hold neither exempts the extras standing nor suppresses extras reminders; no extras hold in v1. *(owner, 2026-09-27)*
10. **Milestone numbered 22, migration `0028` shared with RFC 0016** — RFC 0016 reserved M21 and `0028`; whichever lands second renumbers its migration. *(recorded at scaffolding, 2026-09-28)*

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC 0015 status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items remain backlog.
- [ ] No diff outside the scope declared in the guardrail.
