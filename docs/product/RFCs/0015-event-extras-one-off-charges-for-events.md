# RFC 0015: Event extras: one-off charges for events

**Date:** 2026-09-27
**Status:** Implemented
**Author:** raphaelsilva
**Affected:**
- `apps/api/migrations/0028_create_event_charges.sql` (new — `event_prices`, `event_charges`, `event_charge_adjustments`, `event_charge_payments`; purely additive, no `ALTER` of any existing table. RFC 0016 also reserves `0028`: whichever lands second renumbers)
- `packages/shared/types/entities.ts` (`Entities.Billing` gains `EventPrice`, `EventCharge`; `Config.ChargeStatus`)
- `packages/shared/ports/i-event-charge-repository.ts` (new port — the parallel ledger of a charge)
- `packages/shared/domain/billing/receivable.ts` (new — the rail-tagged `Receivable` shape and `resolveRailStanding`, which resolves one rail at a time)
- `apps/api/src/adapters/db/d1-event-charge-repository.ts` (new adapter)
- `apps/api/src/core/billing/event-charge-service.ts` (new — price, issue, adjust, pay, reverse, void)
- `apps/api/src/core/billing/billing-service.ts` (contract standing unchanged; roster shows contract and extras standing side by side and includes buyers with no contract)
- `apps/api/src/core/billing/accounting-service.ts` (movement, aging and statement partitioned by rail; extras reported in their own block)
- `apps/api/src/routes/admin/billing.ts` (new `/event-prices/*` and `/charges/*` routes, under the existing billing `requireRole(ROLES.ADMIN)`)
- `apps/api/src/routes/me/billing.ts` (the caller's own charges appear in `GET /v1/me/billing`)
- `apps/web/src/app/(protected)/admin/billing/*` (Extras tab, roster and statement changes)
- `apps/web/src/app/(protected)/admin/events/*` (read-only "Charges" panel on an event, linking to billing)
- `apps/web/src/app/(protected)/settings/billing/page.tsx` (the student's own extras)
- `apps/web/src/i18n/dict-{en,pt}.ts` (new keys)

---

## Summary

The administrator needs to charge for **extras** — a seminar, a belt grading, an open
class — and to know, at any moment, who owes what for which event. RFC 0013's billing
model cannot express that: every invoice belongs to a recurring contract and is keyed on
a billing period. This RFC adds an **event charge**: a one-off receivable issued to one
user for one event, with its own append-only ledger of adjustments and payments, living
in **new tables beside** RFC 0013's rather than inside them. Nothing in RFC 0013's schema
is altered and the monthly invoice run is not touched. The single most important
consequence is that billing now runs on **two rails that are never merged**: the
**contract rail** (RFC 0013's invoices, and the only input to *contract standing* — the
number the administrator reads when deciding, by hand, whether a late monthly fee
warrants disabling access) and the **extras rail** (event charges, with their own
*extras standing* — a payment-control view of who paid for what event). An unpaid
seminar never makes a student look late on their monthly fee, and a paid-up monthly fee
never hides an unpaid seminar. A buyer with no contract appears on the roster with no
contract standing and an extras standing. As with RFC 0013, a charge **grants nothing
and revokes nothing**: it is money, never access.

## Motivation

The `budo` tenant runs paid seminars, gradings and open classes several times a year.
RFC 0014 made them announceable; today they are still charged in a notebook, outside the
system that already tracks every monthly fee. The administrator's words: *"those who have
no contract are still students — potential students of the future — and they can be
charged; I have to keep control of what I have to collect."*

| Case | Reachable today? |
|---|---|
| Charge R$ 150 to 20 enrolled students for the March seminar | No. `POST /v1/admin/billing/invoices` requires a `subscriptionId` (`routes/admin/billing.ts:403`) and occupies that contract's period slot. |
| Charge the same student for two extras in the same month | No. `UNIQUE (subscription_id, period_start)` (`0026_create_billing_tables.sql:109`) makes the second one collide. |
| Charge a visitor who has an account but no contract | No. Every invoice needs a contract (`0026:95`), and the roster only lists "a student with a contract" (`billing-service.ts:173`). |
| Create a plan called "Seminário" to sell one seminar | Technically yes — and it is then billed **every month forever**, because `cycle` only accepts `monthly`/`quarterly`/`yearly` (`0026:43`). M19 task 09 guards the copy against exactly this. |
| See who still owes for last month's grading | No. There is no event-level view of money anywhere. |

The decision to do this as its own RFC, rather than amending RFC 0013, was taken on
2026-09-12; the number was moved from 0014 to 0015 on 2026-09-16 because this proposal
depends on the `events` entity RFC 0014 defines.

## Goals & Non-Goals

**Goals**
- An administrator can set a **list price** for an event, and issue a **charge** for that
  event to one or many users in one request, with the price pre-filled and overridable.
- A charge has the same accounting guarantees as an invoice: amount **snapshot** at issue,
  minor units, one currency, append-only adjustments and payments, reversal by a
  mirror row, voiding as a recorded decision.
- Issuing is **idempotent**: at most one live charge per `(event, user)`; re-submitting the
  same batch creates nothing new and reports the duplicates as *absorbed*.
- **Two rails, two standings.** *Contract standing* is resolved from contract invoices
  only — exactly as RFC 0013 defines it today, unchanged. *Extras standing* is resolved
  from event charges only, by the same pure `resolveStanding` fed a different input.
  No code path ever resolves one standing over both kinds.
- The roster answers, per student and side by side: *is the monthly fee late?* and *is
  any extra late, or did one slip through?* — filterable by either rail independently.
- A user with charges and **no contract** appears on the roster (contract standing
  empty, extras standing resolved), in the extras aging report and in their own
  `/v1/me/billing`.
- Every report keeps the rails apart: contract receivables and extras receivables are
  separate sections, never summed into one number the administrator cannot take apart.
- An event-level view: for one event, who was charged, what was paid, what is still owed.

**Non-Goals**
- **Access of any kind.** A charge does not enroll, does not unlock a topic, and does not
  add the buyer to the event's audience. Widening an extra to "purchase unlocks a topic"
  is a recorded reversal of RFC 0013 Alternative 10, not a patch to this RFC.
- **Self-service purchase / checkout / payment gateway.** Charges are issued by an
  administrator; money is recorded by hand exactly as in RFC 0013. A gateway reuses
  `external_reference` + `method = 'gateway'`, as RFC 0013 #9 already prescribes.
- **Charging someone with no account.** A charge references `users`. A lead who is not
  yet a user is created through the existing admin user flow first (see §6).
- **Quantities, tickets, seat limits, waitlists.** One charge is one user's participation.
  Bringing a guest is a second user or a negotiated amount.
- **Automatic charging on RSVP or audience membership.** No trigger issues a charge;
  the scheduled run issues **none**.
- **Installments of one extra.** A charge has one due date. Splitting is a future RFC if
  ever needed; partial payments are already supported by the ledger.
- **Any change to RFC 0013's tables, its invoice run, or its idempotency key.**

## Current State (for reference)

**Receivables are contract-shaped at every layer.**
- Schema: `invoices.subscription_id TEXT NOT NULL REFERENCES subscriptions(id)`
  (`0026:95`), `period_start`/`period_end NOT NULL` (`0026:98-99`), and the run's
  idempotency key `UNIQUE (subscription_id, period_start)` (`0026:109`).
- The ledger hangs off invoices only: `invoice_adjustments.invoice_id NOT NULL` and
  `payments.invoice_id NOT NULL`, both `REFERENCES invoices(id)`. **A payment cannot be
  recorded against anything that is not an invoice** — which is why "a separate table
  for charges" necessarily means a separate ledger too (Alternative 1 discusses the cost).
- `cycle CHECK (cycle IN ('monthly','quarterly','yearly'))` on both `billing_plans` and
  `subscriptions` (`0026:43,68`); SQLite cannot relax a `CHECK` without rebuilding the
  table.
- API: `IssueInvoiceBodySchema.subscriptionId: z.string().min(1)` (`billing.ts:403`).

**Standing is already receivable-agnostic.** `resolveStanding`
(`packages/shared/domain/billing/standing-resolver.ts`) is pure and reads only
`{ dueDate, graceDays, balanceMinor }` per open item plus an optional hold. It has no idea
what a contract is — so it can be called **twice**, once per rail, without modification.
That is the seam this RFC uses.

**The roster and the reports are contract-driven.** `listStudentRoster`
(`billing-service.ts:1037`) iterates `contractsByUser`, so a user with no subscription is
never visited. `AccountingService` (`accounting-service.ts`) builds every report from
`listInvoices({})` + `listLedger(...)`, and its `LedgerIndex` is keyed by `invoiceId`.

**Events carry no money, by design.** Migration `0027_create_events.sql` states "an event
is an announcement, not a product. It has no price, no invoice and no enrollment", and
RFC 0014's risk table says "anything charged goes through the extras RFC, which reads
`events.id`". There is **no hard delete** of an event (`routes/admin/events.ts:17`), so a
`RESTRICT` foreign key to `events` never blocks an existing flow.

## Proposed Design

### 1. Schema (migration `0028_create_event_charges.sql`)

Purely additive: four new tables, their indexes, no `ALTER`, no backfill. Rollback is
dropping the four.

```sql
-- The price tag. Kept OUT of `events` so RFC 0014's invariant ("events has no money
-- column") survives: an event with no row here is simply not for sale. Like
-- billing_plans it is a catalogue — freely editable, never read once a charge copied it.
CREATE TABLE IF NOT EXISTS event_prices (
  event_id      TEXT NOT NULL PRIMARY KEY REFERENCES events(id) ON DELETE RESTRICT,
  amount_minor  INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency      TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  -- Days after issue the charge falls due, when the admin does not pick a date.
  due_in_days   INTEGER NOT NULL DEFAULT 0 CHECK (due_in_days >= 0),
  grace_days    INTEGER NOT NULL DEFAULT 5 CHECK (grace_days >= 0),
  updated_by    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One user's participation in one event, as money owed. The event-shaped twin of
-- `invoices`: amount, currency, due date and grace are SNAPSHOT at issue.
CREATE TABLE IF NOT EXISTS event_charges (
  id            TEXT NOT NULL PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  -- RESTRICT: a user with financial history cannot be deleted (RFC 0013 §1).
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Snapshot of the event title at issue, so a renamed event does not rewrite a receipt.
  description   TEXT NOT NULL,
  amount_minor  INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency      TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  terms_source  TEXT NOT NULL DEFAULT 'standard'
                  CHECK (terms_source IN ('standard','negotiated')),
  terms_note    TEXT NOT NULL DEFAULT '',   -- mandatory (service-enforced) when negotiated
  due_date      TEXT NOT NULL,              -- YYYY-MM-DD
  grace_days    INTEGER NOT NULL CHECK (grace_days >= 0),
  status        TEXT NOT NULL CHECK (status IN ('open','paid','void')),  -- cache, as invoices
  issued_by     TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at     TEXT NOT NULL DEFAULT (datetime('now')),
  voided_at     TEXT,
  void_reason   TEXT
);

-- The idempotency key: one LIVE charge per buyer per event. Partial, so a voided
-- charge (issued by mistake) can be re-issued with the right terms.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_charges_one_live
  ON event_charges(event_id, user_id) WHERE status <> 'void';
CREATE INDEX IF NOT EXISTS idx_event_charges_user_status ON event_charges(user_id, status);
CREATE INDEX IF NOT EXISTS idx_event_charges_due ON event_charges(due_date) WHERE status = 'open';

-- Same shape and rules as invoice_adjustments: append-only, signed, by hand.
CREATE TABLE IF NOT EXISTS event_charge_adjustments (
  id            TEXT NOT NULL PRIMARY KEY,
  charge_id     TEXT NOT NULL REFERENCES event_charges(id) ON DELETE RESTRICT,
  kind          TEXT NOT NULL CHECK (kind IN ('discount','credit','waiver','surcharge')),
  amount_minor  INTEGER NOT NULL CHECK (amount_minor <> 0),
  reason        TEXT NOT NULL,
  applied_by    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  applied_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_charge_adjustments_charge
  ON event_charge_adjustments(charge_id);

-- Same shape and rules as payments: append-only, reversal by a negative mirror row.
CREATE TABLE IF NOT EXISTS event_charge_payments (
  id                 TEXT NOT NULL PRIMARY KEY,
  charge_id          TEXT NOT NULL REFERENCES event_charges(id) ON DELETE RESTRICT,
  amount_minor       INTEGER NOT NULL CHECK (amount_minor <> 0),
  currency           TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  method             TEXT NOT NULL CHECK (method IN ('cash','pix','bank_transfer','card','gateway','other')),
  paid_at            TEXT NOT NULL,
  external_reference TEXT,
  note               TEXT NOT NULL DEFAULT '',
  reverses_id        TEXT REFERENCES event_charge_payments(id) ON DELETE RESTRICT,
  recorded_by        TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_charge_payments_charge ON event_charge_payments(charge_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_charge_payments_one_reversal
  ON event_charge_payments(reverses_id) WHERE reverses_id IS NOT NULL;
```

Notes on the choices:
- **`event_id` is `NOT NULL`.** Every extra is a charge *for an event* (product decision,
  2026-09-12). A charge that is "for nothing" is a manual note, not a receivable. A
  one-off class that nobody wants announced is an event with `audience = 'restricted'`
  and no granted users — it never reaches the board.
- **`event_prices` is optional.** Issuing without a price row is allowed if the request
  carries an amount and currency; the charge is then `negotiated` by definition and the
  note is mandatory. The price row is a convenience that makes the common case one click.
- **The currency is the tenant's active one.** As in RFC 0013 §1, a charge in a currency
  other than the active row is refused at the service; the reports stay single-currency.
- **`status` is a cache,** refreshed in the same `batch` as each ledger write, with the
  same `REFRESH_*_STATUS` statement shape `d1-billing-repository.ts:285` uses. No report
  ever sums it (RFC 0013 accounting rule 1).

### 2. Two rails, and the `Receivable` shape that keeps them apart

**The rule:** a *rail* is the unit of standing. `contract` is RFC 0013's invoices;
`extras` is this RFC's charges. Each rail has its own standing, its own aging, its own
reminders and its own crossings. The administrator's manual access policy (RFC 0013 §3:
standing is reported, the decision is a person's) reads the **contract rail only**; the
extras rail is a payment-control view. Nothing sums, compares or falls back between the
two — a student can be `good` on one and `delinquent` on the other, and that is the
information the roster exists to show.

A new pure module, `packages/shared/domain/billing/receivable.ts`, gives both kinds one
shape so reports and the resolver read them the same way — **always tagged, always
partitioned by rail before any arithmetic**:

```ts
export type BillingRail = 'contract' | 'extras';
export type ReceivableKind = 'invoice' | 'event_charge';   // 1:1 with rail in v1

/** What every report and the standing resolver need from a receivable, and nothing more. */
export interface Receivable {
  rail: BillingRail;
  kind: ReceivableKind;
  id: string;
  userId: string;
  /** The event for a charge; the contract group for an invoice. */
  sourceId: string;
  label: string;           // period "2026-09" for an invoice, event title for a charge
  issuedAt: string;
  dueDate: string;         // YYYY-MM-DD
  graceDays: number;       // the item's own snapshot
  amountMinor: number;
  currency: string;
  status: 'open' | 'paid' | 'void';
  balanceMinor: number;    // amount + Σ adjustments − Σ payments, computed by the adapter
}

export function fromInvoice(i: InvoiceWithBalanceRecord): Receivable;
export function fromCharge(c: EventChargeWithBalanceRecord, eventTitle?: string): Receivable;

/** The only way a caller reaches resolveStanding with receivables: one rail at a time. */
export function resolveRailStanding(
  rail: BillingRail,
  items: Receivable[],
  hold: { expiresAt: string | null } | null,
  today: string,
): StandingResult;   // throws if any item's rail !== rail — a mixed input is a bug
```

`resolveStanding` itself is **not changed**. `resolveRailStanding` filters out voids,
asserts every item belongs to the requested rail, and delegates. The assertion is the
guard against the failure this design exists to prevent: a future caller that
concatenates both lists "for convenience" fails loudly in tests instead of silently
making a student look late on their monthly fee because of a seminar.

The ledger rows get the same tag (`LedgerEntry` gains `target: { rail, kind, id }`), so
`LedgerIndex` in `AccountingService` is keyed by `${kind}:${id}`, and every report
partitions by `rail` before totalling.

The `Receivable` lists are built in the **service** layer from two ports. It is not a SQL `UNION ALL`
view: keeping the two repositories independent means the Postgres swap RFC 0013 §4 keeps
open still needs one adapter per port and no cross-port query.

### 3. Ports

A new port, `IEventChargeRepository`, deliberately a **sibling** of `IBillingRepository`
rather than a set of methods added to it — the two ledgers share rules, not rows:

```ts
export interface IEventChargeRepository {
  getPrice(eventId: string): Promise<EventPriceRecord | null>;
  setPrice(input: SetEventPriceInput): Promise<EventPriceRecord>;
  clearPrice(eventId: string): Promise<void>;

  listCharges(filter: EventChargeFilter): Promise<EventChargeWithBalanceRecord[]>;
  getCharge(id: string): Promise<EventChargeWithBalanceRecord | null>;
  /** Idempotent: returns the charges created and the (eventId,userId) pairs absorbed. */
  issueCharges(input: IssueChargesInput): Promise<{ created: EventChargeRecord[]; absorbed: string[] }>;
  voidCharge(id: string, reason: string, voidedBy: string): Promise<EventChargeRecord | null>;

  recordPayment(input: RecordChargePaymentInput): Promise<EventChargePaymentRecord>;
  getPayment(id: string): Promise<EventChargePaymentRecord | null>;
  applyAdjustment(input: ApplyChargeAdjustmentInput): Promise<EventChargeAdjustmentRecord>;
  listLedger(filter: ChargeLedgerFilter): Promise<ChargeLedgerEntryRecord[]>;
}
```

`issueCharges` uses `INSERT ... ON CONFLICT DO NOTHING` against
`idx_event_charges_one_live` inside one `batch`, and reports absorbed pairs rather than
failing — the same "a retry is a no-op" contract as RFC 0013 §6.

`EventChargeService` (new) owns the write rules and mirrors `BillingService` method for
method: positive payment amounts only, reversal by mirror row with a mandatory reason,
no reversal of a reversal, no payment on a void charge, currency equality, mandatory
`terms_note` on a negotiated amount, mandatory `void_reason`, and issuing only against a
`published` event (`409` otherwise). Voiding a charge that has
net payments is refused with `409` — reverse the payments first, so the refund is visible
in the ledger. Every write emits the same `audit(...)` line shape (`billing.charge.*`).

Container wiring: `D1EventChargeRepository` is instantiated per request inside
`buildApp(env)`, next to `D1BillingRepository`, never in module scope.

### 4. Standing, roster and holds — one column per rail

- **Contract standing is untouched.** `BillingService.getStanding(userId)` keeps reading
  `listInvoices({ userId })` only and means exactly what RFC 0013 says. It is the value
  the administrator consults when applying the manual access policy; no charge can move
  it.
- **Extras standing is new and separate.** `EventChargeService.getExtrasStanding(userId)`
  reads `listCharges({ userId })` and resolves through `resolveRailStanding('extras', …)`.
  Same four labels (`good` · `due` · `delinquent` · `exempt`), same arithmetic, different
  input.
- `listStudentRoster` fetches invoices, charges, contracts and holds — **four aggregate
  reads**, still independent of the number of students (the query-count test goes from
  3 to 4, not per-student). It iterates the **union of user ids** from contracts and
  charges, and resolves **each rail separately**. `RosterEntry` becomes:

  ```ts
  export interface RosterEntry {
    userId: string;
    asOf: string;
    currency: string;
    /** RFC 0013's standing, from contract invoices only. null = no contract ever. */
    contract: {
      id: string; groupId: string; status: ContractStatus;
      nextDueDate: string | null; negotiatedTerms: boolean;
      standing: BillingStanding; oldestOverdueDate: string | null; outstandingMinor: number;
    } | null;
    /** From event charges only. null = never charged for an extra. */
    extras: {
      standing: BillingStanding; oldestOverdueDate: string | null; outstandingMinor: number;
      openCharges: number;          // live charges with a positive balance
      overdueCharges: number;       // of those, already past their due date
    } | null;
    hold: BillingStandingHoldRecord | null;
  }
  ```

  There is deliberately **no top-level `standing` or `outstandingMinor`** on the entry: a
  single number would invite exactly the merge this RFC forbids. `RosterFilter` gains
  `contractStanding` and `extrasStanding` (either, both or neither), so "late on the
  monthly fee" and "has an extra that slipped through" are separate one-click filters.
  The default sort is contract outstanding, then extras outstanding.
- **Holds apply to monthly fees only** (Resolved #9). `billing_standing_holds` keeps its
  RFC 0013 meaning — "stop chasing this student's monthly fee" — and does **not** turn
  the extras standing `exempt` nor suppress an extras reminder. The extras rail has no
  hold: an arrangement about an extra is recorded as an adjustment or a note on the
  charge. If that is ever revisited it is a new `event_charge_holds` table;
  `billing_standing_holds` is keyed on `user_id` alone and is not rebuilt.
- A user whose charges are all paid or void and who has no contract **stays** on the
  roster while any charge exists — `contract: null`, extras `good` — because the roster
  is "people with financial history", which is what the administrator asked to control.

### 5. The daily run

The run **issues nothing** for extras: charges are always issued by a person. It changes
in two read-only ways, **each kept on its own rail**:
- **Reminders** — the e-mails the run already sends *to the student* — cover charges with
  the **same two triggers** as invoices (Resolved #8): on the due date, and when the grace
  period lapses. The message names the event ("your charge of R$ 150 for *Seminário de
  Março* is due today") and never says "membership". Extras reminders have their own
  `BillingReminderKind` values (`extras_due_date`, `extras_grace_lapsed`), so the audit
  log and the digest never mix them, and a contract hold does **not** suppress them.
- **Standing crossings** are resolved per rail. The admin digest gets two sections —
  "crossed on the monthly fee" and "crossed on extras" — and a student can appear in
  one, the other, or both.

Rule 1 of the run ("it writes no money") is unchanged and now covers two ledgers.

### 6. Buyers with no contract

The product owner's position is that a buyer without a contract **is a student** — a
current or future one — and is charged like one. Concretely:
- A charge needs a `users` row. For a lead who has none, the administrator creates the
  account through the existing admin user flow (`routes/admin/users.ts`) — no new
  identity path is added, and no anonymous or guest charge exists.
- A new user with no enrollment grant sees **no content**: access is purely grant-based
  (RFC 0013, Current State), so creating an account to charge someone opens nothing.
- The charge-issuing dialog searches users as the contract dialog does, and offers a
  "create user" shortcut that returns to the dialog with the new id.
- A buyer later signing a contract changes nothing about their charges. From then on
  they have **two** standings, and an unpaid extra from before the contract never makes
  the new contract look late.

### 7. HTTP surface

All under the existing billing sub-router and its `requireRole(ROLES.ADMIN)`. Money stays
out of `routes/admin/events.ts`, per RFC 0014's boundary.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/admin/billing/event-prices/{eventId}` | The event's list price, or `404` if not for sale |
| `PUT` | `/v1/admin/billing/event-prices/{eventId}` | Set/replace price, due-in days, grace |
| `DELETE` | `/v1/admin/billing/event-prices/{eventId}` | Stop offering; existing charges untouched |
| `GET` | `/v1/admin/billing/charges?eventId&userId&status` | List with balances |
| `POST` | `/v1/admin/billing/charges` | Issue to `userIds[]` (1–200) for one `eventId`; optional `amountMinor`, `dueDate`, `graceDays`, `termsNote`. Returns `{ created, absorbed, outsideAudience }` |
| `POST` | `/v1/admin/billing/charges/{id}/void` | Void with reason; `409` with net payments |
| `POST` | `/v1/admin/billing/charges/{id}/adjustments` | Discount / credit / waiver / surcharge |
| `POST` | `/v1/admin/billing/charges/{id}/payments` | Record a payment |
| `POST` | `/v1/admin/billing/charge-payments/{id}/reverse` | Reverse a payment |
| `GET` | `/v1/admin/billing/events/{eventId}/summary` | Charged / received / outstanding / count by status for one event |

Changed:
- `GET /v1/admin/billing/students` — the `RosterEntry` shape in §4, plus the
  `contractStanding` and `extrasStanding` query filters. The old `standing` filter is
  kept as an alias of `contractStanding` so its meaning does not silently change.
- `GET /v1/admin/billing/students/{userId}/statement` and `GET /v1/me/billing` — the
  existing `standing` and `outstandingMinor` keep their meaning (**contract rail only**);
  a new sibling object `extras: { standing, outstandingMinor, charges: StatementCharge[] }`
  carries the extras rail. No field is a sum of both.
- `GET /v1/admin/billing/reports/movement` — every existing field keeps its meaning
  (contracts only). A new sibling `extras: { chargedMinor, adjustmentsMinor, receivedMinor,
  chargesIssued, receivableAtCloseMinor }` reports the extras rail. The only cross-rail
  number is an explicit `cashReceivedMinor` (money that entered the till, both rails),
  named so nobody reads it as a standing or a receivable.
- `GET /v1/admin/billing/reports/aging` — gains `?rail=contract|extras`, default
  `contract` so the existing screen means what it meant. The two agings are never
  bucketed together.

**`outsideAudience` is a warning, never a write** (Resolved #7). For a `restricted` event,
the service lists the charged users who are not in its audience — neither granted
directly (`event_audience_user`) nor through a group (`event_audience_group`) — so the
administrator learns that the buyer cannot see what they are paying for. The charge is
still issued; nothing is added to the audience. A dry-run form of the same check,
`GET /v1/admin/billing/events/{eventId}/audience-check?userIds=…`, lets the dialog warn
*before* submitting. For `public` and `members` events the list is always empty.

Validation is `@hono/zod-openapi` `createRoute` schemas returning `ControllerResult`, as
the rest of the billing router.

### 8. Web

- **Admin billing → new "Extras" tab.** Pick a **published** event (draft and archived events cannot be charged, Resolved #6);
  shows its price (editable), its summary (charged, received, outstanding) and the charge
  list with the same payment / adjustment / reverse / void actions the invoice list has,
  reusing `payment-form.tsx`, `adjustment-form.tsx` and `void-invoice-form.tsx` by
  parametrising the target kind. "Charge participants" opens a multi-select of users
  (with a group filter that expands to its members client-side) and a "create user"
  shortcut. When the event is `restricted`, every selected user outside its audience is
  flagged inline ("this person does not see this event on the board") with a link to the
  event's audience in the events backoffice; submitting is still allowed.
- **Roster — two badges, never one.** Each row shows a *Monthly fee* badge (contract
  standing, or "no contract") and an *Extras* badge (extras standing, or "—"), each with
  its own outstanding amount and overdue count. Two independent filters sit above the
  table. The screen the administrator uses before a manual access decision is "Monthly
  fee: delinquent"; "Extras: delinquent" answers "which seminar payments slipped through".
- **Reports tab.** A rail switch on the aging report; the movement report shows the
  contract block and the extras block one under the other, with the till total apart.
- **Statement panel and `/settings/billing`.** The existing contract section is
  unchanged; a separate "Extras" section lists each charge with event title, event date,
  due date, balance and its own standing badge.
- **Plans tab.** The M19 task 09 copy that warns against creating a "seminar" plan gains a
  link to the Extras tab — the footgun is closed by giving the admin the right door,
  not only a warning.
- **Admin events page.** A read-only "Charges" panel on an event with the summary and a
  link into the Extras tab. No money is written from the events backoffice.
- All strings through the dictionaries; `dict-en.ts` and `dict-pt.ts` keep identical keys.

## Alternatives Considered

1. **Parallel ledger vs. rebuilding `invoices` to accept charges (option "A").** Making
   `invoices.subscription_id` nullable, adding `event_id`, relaxing the period columns
   and replacing the `UNIQUE (subscription_id, period_start)` key requires rebuilding
   `invoices` — a table two other tables reference by foreign key — on D1, where the
   rebuild must run with deferred foreign keys over live financial data, and where the
   monthly run's idempotency key would be redefined. *Rejected (owner, 2026-09-27)* in
   favour of the additive option. **The cost of the additive option is named here
   honestly:** because `payments.invoice_id` and `invoice_adjustments.invoice_id` are
   `NOT NULL`, a charge needs its **own** adjustment and payment tables. That
   duplication is bounded by §2 (one `Receivable` shape, one standing resolver called
   per rail) and by the write rules living in one service each. The separate tables
   also make the two rails physically distinct, which the owner's two-rail decision
   (Resolved #5) requires anyway.
2. **A single `receivables` supertype table that both invoices and charges point at.**
   Cleanest model, but it means migrating every existing invoice and ledger row into it.
   *Rejected* for the same reason as 1: it is a rewrite of RFC 0013's accounting data.
3. **Generic `payments.target_kind` + `target_id` on new tables (one polymorphic ledger
   for charges and anything future).** Loses the foreign key — SQLite cannot reference
   two tables from one column — so an orphan payment becomes possible. *Rejected:* the
   database, not convention, must arbitrate ledger integrity (RFC 0013 §1).
4. **A price column on `events`.** Simplest, but breaks RFC 0014's written invariant and
   puts money into a table read anonymously. *Rejected;* `event_prices` is its own table.
5. **A one-off `cycle = 'once'` on plans and contracts.** Needs a table rebuild for the
   `CHECK`, still hits the period-based key, and turns a seminar into a "contract" the
   student has to sign. *Rejected.*
6. **Allow a charge with no event ("misc. charge").** *Deferred, not rejected.* Every
   case the owner described is an event; a free-standing charge would need its own
   idempotency story. If it is ever wanted, `event_id` becomes nullable in a later
   migration (adding nullability to a new table is cheap — this is the reason not to
   build it now rather than a reason it is impossible).
7. **One merged standing over invoices and charges.** Drafted first (2026-09-27) and
   *rejected by the owner the same day*: an unpaid seminar would make a student look late
   on their monthly fee, and the manual access policy reads that standing. It would also
   hide an unpaid extra behind a paid-up contract. Replaced by the two rails of §2.
8. **Auto-grant event visibility to buyers.** *Rejected for v1* — visibility is a form of
   access and this RFC grants none. Also rejected (owner, 2026-09-27): an opt-in
   "add to audience" checkbox in the charge dialog. Chosen instead: a **warning only**
   (Resolved #7); the admin adds the buyer to the audience in the events backoffice.

## Implementation Plan

Total **~7.5 dev days**, as milestone [M22](../milestones/22-event-extras-one-off-charges/milestone.md)
derived from this RFC (M21 is reserved by RFC 0016).

### Phase 0 — Domain and contracts (~1 d)
`Entities.Billing.EventPrice/EventCharge`, `Config.ChargeStatus`, the
`IEventChargeRepository` port, and `receivable.ts` (`Receivable`, `fromInvoice`,
`fromCharge`, `resolveRailStanding`) with unit tests proving the contract rail gives
exactly RFC 0013's answer and that a mixed-rail input throws.

### Phase 1 — Persistence (~1 d)
Migration `0028` (renumber if RFC 0016 lands first), `D1EventChargeRepository` with the
balance expression, the status-refresh-in-batch, idempotent `issueCharges`, and local
seed rows (one priced event, a paid and an overdue charge, one extras-only buyer).

### Phase 2 — Charge service and admin API (~1.5 d)
`EventChargeService` with every write rule in §3, the routes in §7 (prices, charges,
ledger, event summary), audit lines, and route tests including the idempotent re-issue
and the `409` on voiding a paid charge.

### Phase 3 — Standing, roster, reports, statement (~1.5 d)
`getExtrasStanding`, `listStudentRoster` with one standing per rail (four aggregate
reads; query-count test), `RosterEntry` reshape and the two filters, `AccountingService`
partitioned by rail (movement `extras` block, aging `?rail=`), statement and
`/v1/me/billing` `extras` object, per-rail reminders and crossings.

### Phase 4 — Web (~2 d)
Extras tab, roster and statement changes, `/settings/billing` extras, plans-tab link,
events "Charges" panel, dictionaries. Ships with Phase 3 so the roster shape change never
reaches production without its consumer.

### Phase 5 — Rollout (~0.5 d)
Migrate staging, walk the `budo` seminar case end to end, migrate production for every
label (the migration is additive and empty tables are inert for tenants not using it).

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| **Two ledgers drift in their rules** (e.g. a reversal rule fixed in one only). | The rules are few and enumerated in §3; `EventChargeService` tests reuse the `BillingService` ledger test table. `Receivable` makes every *read* single-path. |
| **The rails get merged later "for convenience"** — someone sums both into one standing. | `resolveRailStanding` throws on mixed input; no response field is a sum of both except the explicitly named `cashReceivedMinor`; a test asserts an overdue charge leaves contract standing `good`. |
| **An unpaid extra goes unseen** because every screen defaults to the contract rail. | The roster shows both badges on every row; the extras rail has its own reminders and its own digest section. |
| **Roster shape change breaks the web console.** | Shipped in the same deploy as Phase 4; the admin console is the only consumer. |
| **Migration `0028` collides with RFC 0016.** | Whichever lands second renumbers; recorded in both RFCs' Affected lists. |
| **An admin issues a charge twice by double-clicking.** | `idx_event_charges_one_live` makes the second insert a no-op reported as *absorbed*. |
| **Charging creates pressure to gate the event on payment.** | Non-Goal; the seam would be a new RFC reversing RFC 0013 #2. Tests assert no access or audience row is written by any charge path. |
| **Leads are created as users just to be charged**, inflating user counts. | Accepted: the owner treats them as students. A user with no grants sees nothing. |
| **Multi-currency** if a tenant ever switches its active currency. | Same as RFC 0013 rule 4: refused with `409`, never converted. |

## Success Criteria

- (P1) Issuing the same `(eventId, userIds)` twice creates each charge once; the second
  response lists every pair under `absorbed`.
- (P2) A payment equal to the balance flips the charge to `paid` in the same batch; a
  reversal flips it back to `open`; a reversal of a reversal is `409`.
- (P2) A charge cannot be voided while its net payments are positive (`409`).
- (P3) **Rail isolation:** a student with a paid-up contract and one overdue charge is
  contract `good` / extras `delinquent`; a student with a late monthly fee and every
  extra paid is contract `delinquent` / extras `good`. Neither value moves the other.
- (P3) A user with **no contract** and one overdue charge appears on the roster with
  `contract: null` and extras `delinquent`, in the extras aging's matching bucket, and in
  their `/v1/me/billing` `extras` object.
- (P3) Filtering the roster by `contractStanding=delinquent` returns exactly the students
  RFC 0013 returned before this RFC shipped, whatever charges exist.
- (P3) A hold turns the contract standing `exempt` and leaves the extras standing — and
  the extras reminders — as they are.
- (P3) An overdue charge produces one `extras_due_date` e-mail on its due date and one
  `extras_grace_lapsed` e-mail when its grace lapses, each naming the event.
- (P2) Charging a user outside a `restricted` event's audience returns them in
  `outsideAudience` and writes no `event_audience_*` row.
- (P3) The roster issues a constant number of queries (4) regardless of the number of
  students.
- (P3) The movement report for a month with R$ 300 of fees and R$ 150 of extras received
  reports `receivedMinor = 30000`, `extras.receivedMinor = 15000`,
  `cashReceivedMinor = 45000`.
- (P3) The scheduled run creates **zero** rows in any `event_charge*` table.
- (all) No code path touched by this RFC writes `enrollments_*`, `event_audience_*` or
  reads `getEffectiveAccessTopicIds`.
- (P4) An administrator can, from one screen, price the March seminar, charge 20 students,
  record payments, and see who still owes — without creating a billing plan.

## Resolved Decisions

| # | Decision | Date | Decider |
|---|---|---|---|
| 1 | An extra is a charge **for an event** and grants **no content access**. RFC 0013's invariant and its Alternative 10 stand. | 2026-09-12 | Product owner |
| 2 | Extras are their own RFC (this one), numbered 0015 because it depends on RFC 0014's `events`. | 2026-09-16 | Product owner |
| 3 | Additive model: new tables beside RFC 0013's; no rebuild of `invoices` (Alternative 1). | 2026-09-27 | Product owner |
| 4 | Buyers without a contract are students (current or future), are charged like any student, and appear on the roster and reports. | 2026-09-27 | Product owner |
| 5 | **Two rails, never merged.** An extra is not a contract pending payment. Contract standing reads contract invoices only and is what the manual access policy consults; extras have their own standing as a payment-control view. Supersedes the merged-standing draft (Alternative 7). | 2026-09-27 | Product owner |
| 6 | **Charges only on `published` events.** No pre-sale on a `draft`; an `archived` event cannot be charged either (`409`). Existing charges are unaffected if the event is later archived. | 2026-09-27 | Product owner |
| 7 | **Restricted audience: warn only.** Charging a user who cannot see a `restricted` event flags it (`outsideAudience`, inline warning) but neither blocks the charge nor adds the user to the audience. | 2026-09-27 | Product owner |
| 8 | **Extras reminders:** the student gets the same two e-mails as for a monthly fee — on the due date and when grace lapses — worded for the event. | 2026-09-27 | Product owner |
| 9 | **Holds apply to monthly fees only.** No hold on the extras rail; a contract hold neither exempts extras standing nor suppresses extras reminders. | 2026-09-27 | Product owner |

## Open Questions

None. Every question raised in drafting is recorded above under Resolved Decisions.

## References

- Relevant code: `apps/api/migrations/0026_create_billing_tables.sql:43,68,95,109`,
  `apps/api/migrations/0027_create_events.sql`,
  `apps/api/src/routes/admin/billing.ts:403`,
  `apps/api/src/core/billing/billing-service.ts:173,1037`,
  `apps/api/src/core/billing/accounting-service.ts`,
  `apps/api/src/adapters/db/d1-billing-repository.ts:270-293`,
  `packages/shared/domain/billing/standing-resolver.ts`,
  `apps/api/src/routes/admin/events.ts:17`
- Related RFCs: RFC 0013 (billing, contracts and receivables — the model this sits
  beside), RFC 0014 (events board — the `events` entity a charge points at), RFC 0016
  (student notes — shares the `0028` migration number reservation)
- Milestones: M19 task 09 (plan-catalogue footgun copy), M20 (events board)
