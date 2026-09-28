# Plan — Task 02: Event-charge schema, D1 repository and local seed

**Task:** [02-event-charge-schema-d1-repository-and-seed.task.md](../02-event-charge-schema-d1-repository-and-seed.task.md)
**RFC:** [RFC 0015](../../../RFCs/0015-event-extras-one-off-charges-for-events.md) §1, §3, Phase 1
**Branch:** `feature/m22/02-event-charge-schema-d1-repository-and-seed.task`
**Depends on:** Task 01 (`IEventChargeRepository`, `Entities.Config.ChargeStatus`) — already merged.

## Goal

Make the extras ledger persistent: a purely additive migration with the four RFC 0015 §1
tables, a `D1EventChargeRepository` implementing Task 01's port, per-request container
wiring, a local-only seed, and adapter + schema tests.

## Migration number

`git fetch origin && git ls-tree origin/main apps/api/migrations/` → highest is
`0027_create_events.sql`; RFC 0016's `0028_create_topic_notes.sql` has not landed. The file
is therefore `apps/api/migrations/0028_create_event_charges.sql`.

## Files to touch

| File | Change |
|---|---|
| `apps/api/migrations/0028_create_event_charges.sql` | New. The RFC §1 SQL verbatim in substance: `event_prices`, `event_charges`, `event_charge_adjustments`, `event_charge_payments`; indexes `idx_event_charges_one_live` (partial unique, `WHERE status <> 'void'`), `idx_event_charges_user_status`, `idx_event_charges_due` (partial), `idx_event_charge_adjustments_charge`, `idx_event_charge_payments_charge`, `idx_event_charge_payments_one_reversal` (partial unique). Every FK to `users`/`events`/`currencies`/own tables is `ON DELETE RESTRICT`. `IF NOT EXISTS` everywhere. No `;` inside comments (the test splitter splits on `;`). |
| `apps/api/src/adapters/db/d1-event-charge-repository.ts` | New `D1EventChargeRepository implements IEventChargeRepository`. |
| `apps/api/src/container.ts` | `BillingContext.eventChargeRepo: IEventChargeRepository`, instantiated in `buildContainer(env)` next to `D1BillingRepository`. |
| `apps/api/migrations/seed/0004_event_charges_local.sql` | New local-only seed. |
| `Makefile` | One added `wrangler d1 execute --file ./migrations/seed/0004_event_charges_local.sql` step under `db-seed-local`. |
| `apps/api/test/db/d1-event-charge-repository.spec.ts` | New adapter spec. |
| `apps/api/test/db/event-charges-schema.spec.ts` | New schema/constraint spec. |

### Deviations from the task text (both forced by the code as it is)

1. **Wiring is in `apps/api/src/container.ts`, not `index.ts`.** `buildApp(env)` in
   `index.ts` delegates to `buildContainer(env)`; `D1BillingRepository` is constructed in
   `container.ts:253`. "Next to `D1BillingRepository`" therefore means `container.ts`. It is
   still built per call of `buildContainer`, never in module scope.
2. **`Makefile` gets two lines.** `db-seed-local` lists each seed file explicitly; "wired into
   the existing `db-seed-local` flow" is impossible without adding the new file there. No other
   target or seed file changes.

## Adapter contract (`D1EventChargeRepository`)

```ts
export class D1EventChargeRepository implements IEventChargeRepository {
  constructor(private readonly db: D1Database) {}
  getPrice(eventId): Promise<EventPriceRecord | null>;
  setPrice(input: SetEventPriceInput): Promise<EventPriceRecord>;        // upsert ON CONFLICT(event_id); dueInDays ?? 0, graceDays ?? 5
  clearPrice(eventId): Promise<void>;                                      // DELETE
  listCharges(filter: EventChargeFilter): Promise<EventChargeWithBalanceRecord[]>; // eventId/userId/status/dueFrom/dueTo, ORDER BY due_date, issued_at, id
  getCharge(id): Promise<EventChargeWithBalanceRecord | null>;
  issueCharges(input: IssueChargesInput): Promise<IssueChargesResult>;
  voidCharge(id, reason, voidedBy): Promise<EventChargeRecord | null>;     // only flips a non-void row; void is final
  recordPayment(input): Promise<EventChargePaymentRecord>;                 // batch [INSERT, REFRESH]
  getPayment(id): Promise<EventChargePaymentRecord | null>;
  applyAdjustment(input): Promise<EventChargeAdjustmentRecord>;            // batch [INSERT, REFRESH]
  listLedger(filter: ChargeLedgerFilter): Promise<ChargeLedgerEntryRecord[]>; // chargeId/eventId/userId/from/to, sorted by occurredAt
}
```

SQL shapes (mirroring `d1-billing-repository.ts`):

- `CHARGE_BALANCE_EXPR` = `c.amount_minor + COALESCE(SUM adjustments) - COALESCE(SUM payments)`
  as correlated subqueries; `SELECT c.*, (expr) AS balance_minor FROM event_charges c`.
- `REFRESH_CHARGE_STATUS` = `UPDATE event_charges SET status = CASE WHEN <balance> <= 0 THEN
  'paid' ELSE 'open' END WHERE id = ? AND status <> 'void'` — a void is never resurrected.
- `issueCharges`: one `db.batch` of, per item, `INSERT INTO event_charges (...) VALUES (...,
  'open') ON CONFLICT DO NOTHING` followed by `REFRESH_CHARGE_STATUS` for the new id (settles
  a zero-amount charge at issue; a no-op for an absorbed id because that id never landed).
  `ON CONFLICT DO NOTHING` (not `INSERT OR IGNORE`) so that only a uniqueness conflict is
  absorbed — a CHECK violation still throws and rolls the whole batch back. Created vs
  absorbed is read from each insert's `meta.changes` (the database's answer, not a pre-flight
  `SELECT`). Two items for the same user in one call: the second conflicts with the first
  inside the batch and is reported absorbed. Created rows are re-read with one
  `WHERE id IN (SELECT value FROM json_each(?))` query (one bind, no 100-parameter limit),
  returned in input order. Empty `items` → `{ created: [], absorbed: [] }` without a query.
- `voidCharge`: `UPDATE ... SET status='void', voided_at=datetime('now'), void_reason=? WHERE
  id=? AND status <> 'void'`; returns the row (or `null` if unknown). Actor is not a column
  (audit is Task 03's), same as `voidInvoice`.

## Seed (`0004_event_charges_local.sql`)

Local only, `INSERT OR IGNORE` throughout, relative dates (`date('now', ...)`), all ids
`seed-...`:

- User `seed-student-extras-0000-0000-00000005` / `student3@arenaquest.dev`, the same
  `Student1234!` hash as the other students, role `student`, **no subscription** — the
  extras-only buyer. Picked up by `check-no-dev-seed.ts` automatically (it parses every
  `INSERT INTO users` in `migrations/seed/*.sql`).
- `event_prices` for `seed-event-public-upcoming-00000001` (published): 8000 BRL,
  `due_in_days` 7, `grace_days` 5.
- Charges on that event:
  1. `student@` (paid contract) — 8000 standard, due 10 days ago, one 8000 `pix` payment → `paid`.
  2. `student2@` (free contract) — 8000 standard, due 20 days ago, grace 5, no payment → overdue `open`.
  3. `student3@` (extras-only) — 5000 negotiated with a note, due in 7 days → `open`.
- Status: inserted `open`, then the same refresh expression as the adapter is run for the three
  seed ids, so the cache is derived, not typed.

## Tests → acceptance criteria

`test/db/event-charges-schema.spec.ts` (PRAGMA foreign_keys = ON):

| AC | Test |
|---|---|
| Migration applies after 0027, no statement on a pre-existing table | Every statement parsed from 0028 matches `CREATE TABLE IF NOT EXISTS <new>` or `CREATE [UNIQUE] INDEX IF NOT EXISTS ... ON <new>`; applying it a second time succeeds. |
| Partial unique index | Two live rows for one pair rejected; a live row after a void one accepted. |
| One reversal per payment | Second row with the same `reverses_id` rejected. |
| RESTRICT | Deleting a user referenced by a charge fails; deleting an event referenced by a charge fails; deleting an event with a price row fails. |
| Money safety | Unknown currency rejected (FK); negative amount rejected (CHECK); zero payment/adjustment rejected. |

`test/db/d1-event-charge-repository.spec.ts`:

| AC | Test |
|---|---|
| Price get/set/clear | set → get round trip with defaults; set again replaces; clear → null. |
| Idempotent issue | Issue `(event, [u1,u2])` twice: first creates 2 / absorbs 0; second creates 0, absorbs both pairs; row count unchanged. Duplicate user inside one call → one created, one absorbed. |
| Re-issue after void | Void, then issue again → a new live charge with a new id; the voided row remains. |
| Payment → paid, reversal → open, second reversal rejected | Pay full balance → `paid`; negative mirror with `reversesId` → `open`; a second reversal of the same payment throws; status unchanged. |
| Void is final | Payment and adjustment on a void charge leave `status = 'void'`; void again does not change the reason. |
| Balance | `amount + Σadj − Σpay` checked on `getCharge` and `listCharges` with mixed rows. |
| Zero-amount charge | Issued already `paid`. |
| Filters | `listCharges` by event/user/status/due range; `listLedger` by charge/event/user/date. |
| CHECK not absorbed | Issue with a non-existent currency throws (not reported absorbed). |

"No D1 import in a port or service": `grep -rn "D1\|d1-" packages/shared/ports apps/api/src/core` shows nothing new.

## Verification commands

```bash
make lint
make test-api                              # alone, never `make test`
cd packages/shared && pnpm test
make db-reset-local                        # migration + all four seeds apply
pnpm --filter api exec wrangler d1 execute arenaquest-db --local --command "SELECT ... FROM event_charges"
pnpm --filter api exec tsx scripts/check-no-dev-seed.ts --db arenaquest-db --local   # must report the seed (expected exit 1 locally) incl. student3
git diff --stat feature/m22/candidate
```
