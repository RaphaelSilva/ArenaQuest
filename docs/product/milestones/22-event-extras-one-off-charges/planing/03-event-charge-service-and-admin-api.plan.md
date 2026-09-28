# Plan — Task 03: Event-charge service and admin API

**Task:** [03-event-charge-service-and-admin-api.task.md](../03-event-charge-service-and-admin-api.task.md)
**RFC:** [RFC 0015](../../../RFCs/0015-event-extras-one-off-charges-for-events.md) §3, §7, Resolved #6, #7
**Branch:** `feature/m22/03-event-charge-service-and-admin-api.task`
**Depends on:** Task 02 (`D1EventChargeRepository`, wired as `billing.eventChargeRepo` in `container.ts`).

## Goal

Make an extra sellable and collectable over the API: `EventChargeService` owns every write rule
of the extras rail; new routes on the existing billing sub-router (behind its
`requireRole(ROLES.ADMIN)`) expose price, charges, ledger actions, per-event summary and the
read-only audience check.

## Files to touch

| File | Change |
|---|---|
| `apps/api/src/core/billing/event-charge-service.ts` | New `EventChargeService`. |
| `apps/api/src/controllers/admin-billing.controller.ts` | New exported `AdminEventChargeController` (Zod parse → service), in the same file beside `AdminBillingController`. |
| `apps/api/src/routes/admin/billing.ts` | New `createRoute` definitions + registration; existing routes unchanged. |
| `apps/api/src/container.ts` | `BillingContext.eventChargeService`, built per request next to `eventChargeRepo`. |
| `apps/api/test/db/event-charge-service.spec.ts` | Service spec against real D1 (the workers pool only runs `test/db` and `test/routes`). |
| `apps/api/test/routes/admin-billing-extras.router.spec.ts` | Route spec: HTTP flow, statuses, role matrix, no-access-side-effect check. |

### Deviations (forced by the code as it is)

1. **Wiring lives in `container.ts`, not `index.ts`.** `buildApp(env)` delegates to
   `buildContainer(env)`, where Task 02 already wired `eventChargeRepo`. Same deviation as Task 02;
   still per request, never module scope.
2. **Unknown user ids.** `IUserRepository` has no bulk lookup, and a per-id probe would cost up to
   200 queries in one invocation. The service relies on the `event_charges.user_id` foreign key
   (enforced by D1) inside the atomic issue batch, and maps a foreign-key failure to
   `404 NotFound` — nothing is written because the batch rolls back.
3. **One extra read route**, `GET /charges/{id}`, returning the charge with its adjustments and
   payments. Task 07's list must reverse a payment, which needs the payment id, and Task 07 is
   forbidden backend changes. Read-only; same guard.
4. **Summary sign convention.** Adjustments stay signed (movement-report convention: negative
   reduces). The AC identity "charged − adjustments − received = Σ balances" reads adjustments as
   reductions; stated with signed values it is `chargedMinor + adjustmentsMinor − receivedMinor
   = outstandingMinor = Σ balances` over non-void charges. The test asserts exactly this.

## Service contract (`EventChargeService`)

Dependencies (all ports, narrowed with `Pick`, no D1 symbol):

```ts
constructor(
  repo: IEventChargeRepository,
  events: Pick<IEventRepository, 'findById' | 'getAudienceGrants'>,
  groups: Pick<IUserGroupRepository, 'listMembers'>,
  currencies: Pick<IBillingRepository, 'listCurrencies'>,
)
```

Methods (all `Promise<ControllerResult<T>>`):

- `getPrice(eventId)` — 404 unknown event / no price.
- `setPrice(eventId, { amountMinor, currency?, dueInDays?, graceDays? }, actor)` — 404 unknown
  event; 409 no active currency; 400 when `currency` given and ≠ active. Audit
  `billing.charge.set_price`.
- `clearPrice(eventId, actor)` — 404 unknown event / no price. Audit `billing.charge.clear_price`.
- `listCharges(filter)`; `getChargeDetail(id)` → `{ ...charge, adjustments, payments }` (404).
- `issueCharges({ eventId, userIds, amountMinor?, currency?, dueDate?, graceDays?, termsNote? }, actor)`
  → `{ created, absorbed, outsideAudience }`:
  - 400 duplicate ids (schema also enforces 1–200 distinct);
  - 404 unknown event; 409 event not `published` (checked before anything is written);
  - 409 no active currency; 400 `currency` ≠ active; 409 the price's currency is not active;
  - no amount: price required (400 otherwise) → `standard`, price amount;
  - amount given: equal to price → `standard`; else (or no price) `negotiated`, `termsNote`
    required (400);
  - `dueDate` default = today + `price.dueInDays` (0 without a price); `graceDays` default =
    `price.graceDays` (5 without a price, the column default);
  - `outsideAudience` = requested users not in `grants.userIds ∪ members(grants.groupIds)` for a
    `restricted` event, `[]` otherwise; read-only;
  - foreign-key failure → 404. Audit one `billing.charge.issue` per created charge, one
    `billing.charge.issue_batch` summary (created/absorbed counts, outsideAudience).
- `voidCharge(id, reason, actor)` — 400 blank reason; 404; 409 already void; 409 net payments > 0.
  Audit `billing.charge.void`.
- `applyAdjustment(id, { kind, amountMinor, reason }, actor)` — 400 zero / blank reason; 404;
  409 void. Audit `billing.charge.adjust`.
- `recordPayment(id, { amountMinor, method, paidAt?, currency?, externalReference?, note? }, actor)`
  — 400 non-positive; 404; 409 void; 400 currency ≠ charge's. Audit `billing.charge.payment`.
- `reversePayment(paymentId, { reason, paidAt? }, actor)` — 400 blank reason; 404; 409 reversal of
  a reversal; 409 already reversed. Audit `billing.charge.reverse_payment`.
- `getEventSummary(eventId)` — 404 unknown event; 409 if non-void charges span two currencies →
  `{ eventId, currency, chargedMinor, adjustmentsMinor, receivedMinor, outstandingMinor,
  counts: { open, paid, void }, chargeCount }`, sums over non-void charges.
- `checkAudience(eventId, userIds)` — 404 unknown event → `{ eventId, audience, outsideAudience }`.

## Routes (under `/v1/admin/billing`, all behind the router's `requireRole(ROLES.ADMIN)`)

| Method | Path | Success |
|---|---|---|
| GET/PUT/DELETE | `/event-prices/{eventId}` | 200 / 200 / 204 |
| GET | `/charges?eventId&userId&status` | 200 |
| POST | `/charges` | 201 (something created) or 200 (all absorbed) |
| GET | `/charges/{id}` | 200 |
| POST | `/charges/{id}/void` | 200 |
| POST | `/charges/{id}/adjustments` | 201 |
| POST | `/charges/{id}/payments` | 201 |
| POST | `/charge-payments/{id}/reverse` | 201 |
| GET | `/events/{eventId}/summary` | 200 |
| GET | `/events/{eventId}/audience-check?userIds=a,b` | 200 |

`userIds` in the body: `z.array(z.string().min(1)).min(1).max(200)` + distinct refine (400).
Query `userIds`: comma-separated, same bounds.

## Tests → acceptance criteria

Service spec (`test/db/event-charge-service.spec.ts`, real D1, `PRAGMA foreign_keys = ON`):

| AC | Test |
|---|---|
| Idempotent re-issue | Same command twice: created 2 / absorbed 0, then created 0 / absorbed both pairs. |
| draft/archived → 409, writes nothing | Both statuses; `event_charges` count unchanged. |
| Negotiated without note → 400; with note stored `negotiated` | Amount ≠ price; also any amount with no price; equal amount → `standard`. |
| Non-active currency | price `currency: 'USD'` → 400; issue `currency: 'USD'` → 400; price row stored in USD (direct SQL) → issue 409. |
| Pay / reverse / reverse-the-reversal / reverse twice | ok, ok, 409, 409. |
| Void rules | Payment on void → 409; void with net payments → 409; blank reason → 400; void after reversal → ok. |
| outsideAudience | Restricted event with one direct grant and one group grant: the ungranted user listed, both granted not; audience row counts unchanged; public/members → `[]`. |
| Summary identity | Mixed payments/adjustments/void: `charged + adjustments − received = Σ balances (non-void)`, counts by status. |
| Not-found / validation branches | Unknown event, charge, payment, user (FK → 404). Defaults for due date and grace. |

Route spec (`test/routes/admin-billing-extras.router.spec.ts`, full `worker.fetch`):

| AC | Test |
|---|---|
| Idempotent POST | 201 created, then 200 absorbed. |
| Flow statuses | price PUT/GET/DELETE, pay 201, reverse 201, reverse reversal 409, void paid 409, void no reason 400, summary, audience check. |
| content_creator 403 | Loop over every new route. |
| Validation | 0 and 201 userIds → 400, duplicate ids → 400, bad status filter → 400. |
| No access side-effects | Row counts of `enrollments_user`, `enrollments_user_group`, `event_audience_user`, `event_audience_group` identical before and after the whole flow. |

## Verification commands

```bash
make lint
make test-api                   # alone, never `make test`
cd packages/shared && pnpm test
cd apps/api && pnpm exec tsc --noEmit   # no new errors
git diff --stat feature/m22/candidate
```
