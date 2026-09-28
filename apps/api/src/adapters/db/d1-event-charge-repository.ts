import type {
  IEventChargeRepository,
  EventPriceRecord,
  SetEventPriceInput,
  EventChargeRecord,
  EventChargeWithBalanceRecord,
  EventChargeFilter,
  IssueChargesInput,
  IssueChargesResult,
  EventChargePair,
  EventChargeAdjustmentRecord,
  ApplyChargeAdjustmentInput,
  EventChargePaymentRecord,
  RecordChargePaymentInput,
  ChargeLedgerEntryRecord,
  ChargeLedgerFilter,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

/**
 * D1EventChargeRepository — the SQLite side of `IEventChargeRepository`
 * (RFC 0015 §1, §3).
 *
 * It is the extras-rail twin of `D1BillingRepository` and follows the same
 * three rules, on its own four tables and never on RFC 0013's:
 *
 * 1. **Balance is recomputed, never read.** `event_charges.status` is a cache
 *    of "the balance reached zero", refreshed in the same `batch` as each
 *    ledger write. The balance itself is always
 *    `amount_minor + SUM(adjustments) - SUM(payments)`, computed in SQL.
 * 2. **Snapshot at issue.** A charge's amount, currency, due date and grace are
 *    its own columns. `event_prices` is a catalogue: it is read by the service
 *    before issuing, and never joined back to resolve what somebody owes.
 * 3. **Append-only ledger.** No method issues `UPDATE` or `DELETE` against
 *    `event_charge_payments` or `event_charge_adjustments`. The only charge
 *    mutations are the `status` cache refresh and voiding.
 *
 * Business rules (published-only events, the negotiated-terms note, refusing to
 * void a charge with net payments, currency equality) belong to the service,
 * not here.
 */

// ---------------------------------------------------------------------------
// Rows — the on-disk shape, snake_case
// ---------------------------------------------------------------------------

interface EventPriceRow {
  event_id: string;
  amount_minor: number;
  currency: string;
  due_in_days: number;
  grace_days: number;
  updated_by: string;
  updated_at: string;
}

interface EventChargeRow {
  id: string;
  event_id: string;
  user_id: string;
  description: string;
  amount_minor: number;
  currency: string;
  terms_source: string;
  terms_note: string;
  due_date: string;
  grace_days: number;
  status: string;
  issued_by: string;
  issued_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

interface EventChargeWithBalanceRow extends EventChargeRow {
  balance_minor: number;
}

interface EventChargeAdjustmentRow {
  id: string;
  charge_id: string;
  kind: string;
  amount_minor: number;
  reason: string;
  applied_by: string;
  applied_at: string;
}

interface EventChargePaymentRow {
  id: string;
  charge_id: string;
  amount_minor: number;
  currency: string;
  method: string;
  paid_at: string;
  external_reference: string | null;
  note: string;
  reverses_id: string | null;
  recorded_by: string;
  recorded_at: string;
}

// ---------------------------------------------------------------------------
// Row → record mappers
// ---------------------------------------------------------------------------

function rowToPrice(row: EventPriceRow): EventPriceRecord {
  return {
    eventId: row.event_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    dueInDays: row.due_in_days,
    graceDays: row.grace_days,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function rowToCharge(row: EventChargeRow): EventChargeRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    description: row.description,
    amountMinor: row.amount_minor,
    currency: row.currency,
    termsSource: row.terms_source as Entities.Config.ContractTermsSource,
    termsNote: row.terms_note,
    dueDate: row.due_date,
    graceDays: row.grace_days,
    status: row.status as Entities.Config.ChargeStatus,
    issuedBy: row.issued_by,
    issuedAt: row.issued_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
  };
}

function rowToChargeWithBalance(row: EventChargeWithBalanceRow): EventChargeWithBalanceRecord {
  return { ...rowToCharge(row), balanceMinor: row.balance_minor };
}

function rowToAdjustment(row: EventChargeAdjustmentRow): EventChargeAdjustmentRecord {
  return {
    id: row.id,
    chargeId: row.charge_id,
    kind: row.kind as Entities.Config.AdjustmentKind,
    amountMinor: row.amount_minor,
    reason: row.reason,
    appliedBy: row.applied_by,
    appliedAt: row.applied_at,
  };
}

function rowToPayment(row: EventChargePaymentRow): EventChargePaymentRecord {
  return {
    id: row.id,
    chargeId: row.charge_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    method: row.method as Entities.Config.PaymentMethod,
    paidAt: row.paid_at,
    externalReference: row.external_reference,
    note: row.note,
    reversesId: row.reverses_id,
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at,
  };
}

// ---------------------------------------------------------------------------
// Shared SQL fragments
// ---------------------------------------------------------------------------

/**
 * The balance expression, as correlated subqueries over the two ledger tables,
 * in the same `SELECT` that reads the charge — a list of N charges costs one
 * query rather than N.
 */
const CHARGE_BALANCE_EXPR = `
  c.amount_minor
  + COALESCE((SELECT SUM(a.amount_minor) FROM event_charge_adjustments a WHERE a.charge_id = c.id), 0)
  - COALESCE((SELECT SUM(p.amount_minor) FROM event_charge_payments p WHERE p.charge_id = c.id), 0)
`;

const SELECT_CHARGE_WITH_BALANCE =
  `SELECT c.*, (${CHARGE_BALANCE_EXPR}) AS balance_minor FROM event_charges c`;

/**
 * Rewrites one charge's cached `status` from its recomputed balance — the same
 * statement shape as `REFRESH_INVOICE_STATUS`.
 *
 * A voided charge is excluded: voiding is a decision, not an arithmetic
 * outcome, and no later ledger row may resurrect it as `open` or `paid`.
 */
const REFRESH_CHARGE_STATUS = `
  UPDATE event_charges
     SET status = CASE
       WHEN amount_minor
          + COALESCE((SELECT SUM(a.amount_minor) FROM event_charge_adjustments a WHERE a.charge_id = event_charges.id), 0)
          - COALESCE((SELECT SUM(p.amount_minor) FROM event_charge_payments p WHERE p.charge_id = event_charges.id), 0) <= 0
       THEN 'paid' ELSE 'open' END
   WHERE id = ? AND status <> 'void'
`;

/** Default grace when the price row does not name one, matching the column default. */
const DEFAULT_GRACE_DAYS = 5;

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class D1EventChargeRepository implements IEventChargeRepository {
  constructor(private readonly db: D1Database) {}

  // -------------------------------------------------------------------------
  // Price — optional per event
  // -------------------------------------------------------------------------

  async getPrice(eventId: string): Promise<EventPriceRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM event_prices WHERE event_id = ?')
      .bind(eventId)
      .first<EventPriceRow>();
    return row ? rowToPrice(row) : null;
  }

  /**
   * Creates or replaces the event's price row. A replace is total: an omitted
   * `dueInDays` / `graceDays` falls back to the column default rather than
   * keeping the previous value, so the row always equals the last request.
   */
  async setPrice(input: SetEventPriceInput): Promise<EventPriceRecord> {
    await this.db
      .prepare(
        `INSERT INTO event_prices
           (event_id, amount_minor, currency, due_in_days, grace_days, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(event_id) DO UPDATE SET
           amount_minor = excluded.amount_minor,
           currency     = excluded.currency,
           due_in_days  = excluded.due_in_days,
           grace_days   = excluded.grace_days,
           updated_by   = excluded.updated_by,
           updated_at   = datetime('now')`,
      )
      .bind(
        input.eventId,
        input.amountMinor,
        input.currency,
        input.dueInDays ?? 0,
        input.graceDays ?? DEFAULT_GRACE_DAYS,
        input.updatedBy,
      )
      .run();

    const price = await this.getPrice(input.eventId);
    if (!price) throw new Error('D1EventChargeRepository: price not found after upsert');
    return price;
  }

  async clearPrice(eventId: string): Promise<void> {
    await this.db.prepare('DELETE FROM event_prices WHERE event_id = ?').bind(eventId).run();
  }

  // -------------------------------------------------------------------------
  // Charges
  // -------------------------------------------------------------------------

  async listCharges(filter: EventChargeFilter): Promise<EventChargeWithBalanceRecord[]> {
    const where: string[] = [];
    const binds: unknown[] = [];

    if (filter.eventId !== undefined) {
      where.push('c.event_id = ?');
      binds.push(filter.eventId);
    }
    if (filter.userId !== undefined) {
      where.push('c.user_id = ?');
      binds.push(filter.userId);
    }
    if (filter.status !== undefined) {
      where.push('c.status = ?');
      binds.push(filter.status);
    }
    if (filter.dueFrom !== undefined) {
      where.push('c.due_date >= ?');
      binds.push(filter.dueFrom);
    }
    if (filter.dueTo !== undefined) {
      where.push('c.due_date <= ?');
      binds.push(filter.dueTo);
    }

    const sql =
      SELECT_CHARGE_WITH_BALANCE +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY c.due_date ASC, c.issued_at ASC, c.id ASC';

    const { results } = await this.db.prepare(sql).bind(...binds).all<EventChargeWithBalanceRow>();
    return results.map(rowToChargeWithBalance);
  }

  async getCharge(id: string): Promise<EventChargeWithBalanceRecord | null> {
    const row = await this.db
      .prepare(`${SELECT_CHARGE_WITH_BALANCE} WHERE c.id = ?`)
      .bind(id)
      .first<EventChargeWithBalanceRow>();
    return row ? rowToChargeWithBalance(row) : null;
  }

  /**
   * Issues one charge per item, in a single atomic `batch`.
   *
   * Idempotency is `idx_event_charges_one_live` and nothing else: each insert
   * is `ON CONFLICT DO NOTHING`, and what was created is read back from the
   * database's own `changes` count — there is no "does it already exist"
   * `SELECT` in front of it, which is the shape that races two concurrent
   * submits into a duplicate. `ON CONFLICT DO NOTHING` rather than
   * `INSERT OR IGNORE` is deliberate: only a uniqueness conflict is absorbed,
   * so a CHECK or foreign-key failure still throws and rolls the batch back
   * instead of being misreported as a duplicate.
   *
   * Each insert is followed by the status refresh for the id it tried to
   * write: that settles a zero-amount charge at issue, and is a no-op for an
   * absorbed item because its id never landed.
   */
  async issueCharges(input: IssueChargesInput): Promise<IssueChargesResult> {
    if (input.items.length === 0) return { created: [], absorbed: [] };

    const ids = input.items.map(() => crypto.randomUUID());
    const statements = input.items.flatMap((item, index) => [
      this.db
        .prepare(
          `INSERT INTO event_charges
             (id, event_id, user_id, description, amount_minor, currency,
              terms_source, terms_note, due_date, grace_days, status, issued_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(
          ids[index],
          input.eventId,
          item.userId,
          input.description,
          item.amountMinor,
          item.currency,
          item.termsSource,
          item.termsNote ?? '',
          item.dueDate,
          item.graceDays,
          input.issuedBy,
        ),
      this.db.prepare(REFRESH_CHARGE_STATUS).bind(ids[index]),
    ]);

    const results = await this.db.batch(statements);

    const createdIds: string[] = [];
    const absorbed: EventChargePair[] = [];
    input.items.forEach((item, index) => {
      // Inserts sit at the even positions; each is followed by its refresh.
      if ((results[index * 2]?.meta.changes ?? 0) > 0) {
        createdIds.push(ids[index]);
      } else {
        absorbed.push({ eventId: input.eventId, userId: item.userId });
      }
    });

    if (createdIds.length === 0) return { created: [], absorbed };

    // One bound JSON array rather than one `?` per id, so a large roster does
    // not run into D1's per-statement parameter limit.
    const { results: rows } = await this.db
      .prepare('SELECT * FROM event_charges WHERE id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(createdIds))
      .all<EventChargeRow>();
    const byId = new Map(rows.map((row) => [row.id, rowToCharge(row)]));
    const created = createdIds
      .map((id) => byId.get(id))
      .filter((charge): charge is EventChargeRecord => charge !== undefined);

    return { created, absorbed };
  }

  /**
   * Voiding is final: only a live charge is flipped, so a second void keeps the
   * first reason and timestamp. The actor is not a column — who voided is an
   * audit event (Task 03), exactly as for `voidInvoice`.
   */
  async voidCharge(id: string, reason: string, _voidedBy: string): Promise<EventChargeRecord | null> {
    await this.db
      .prepare(
        `UPDATE event_charges
            SET status = 'void', voided_at = datetime('now'), void_reason = ?
          WHERE id = ? AND status <> 'void'`,
      )
      .bind(reason, id)
      .run();

    const row = await this.db
      .prepare('SELECT * FROM event_charges WHERE id = ?')
      .bind(id)
      .first<EventChargeRow>();
    return row ? rowToCharge(row) : null;
  }

  // -------------------------------------------------------------------------
  // Ledger — append-only on both tables
  // -------------------------------------------------------------------------

  async recordPayment(input: RecordChargePaymentInput): Promise<EventChargePaymentRecord> {
    const id = crypto.randomUUID();

    // Insert and cache refresh in one batch: a charge whose balance reached
    // zero must never be observable as `open` with a settled ledger behind it.
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO event_charge_payments
             (id, charge_id, amount_minor, currency, method, paid_at,
              external_reference, note, reverses_id, recorded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.chargeId,
          input.amountMinor,
          input.currency,
          input.method,
          input.paidAt,
          input.externalReference ?? null,
          input.note ?? '',
          input.reversesId ?? null,
          input.recordedBy,
        ),
      this.db.prepare(REFRESH_CHARGE_STATUS).bind(input.chargeId),
    ]);

    const created = await this.getPayment(id);
    if (!created) throw new Error('D1EventChargeRepository: payment not found after insert');
    return created;
  }

  async getPayment(id: string): Promise<EventChargePaymentRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM event_charge_payments WHERE id = ?')
      .bind(id)
      .first<EventChargePaymentRow>();
    return row ? rowToPayment(row) : null;
  }

  async applyAdjustment(input: ApplyChargeAdjustmentInput): Promise<EventChargeAdjustmentRecord> {
    const id = crypto.randomUUID();

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO event_charge_adjustments
             (id, charge_id, kind, amount_minor, reason, applied_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, input.chargeId, input.kind, input.amountMinor, input.reason, input.appliedBy),
      this.db.prepare(REFRESH_CHARGE_STATUS).bind(input.chargeId),
    ]);

    const row = await this.db
      .prepare('SELECT * FROM event_charge_adjustments WHERE id = ?')
      .bind(id)
      .first<EventChargeAdjustmentRow>();
    if (!row) throw new Error('D1EventChargeRepository: adjustment not found after insert');
    return rowToAdjustment(row);
  }

  async listLedger(filter: ChargeLedgerFilter): Promise<ChargeLedgerEntryRecord[]> {
    const paymentWhere: string[] = [];
    const paymentBinds: unknown[] = [];
    const adjustmentWhere: string[] = [];
    const adjustmentBinds: unknown[] = [];

    /** Adds one filter to both queries, each with its own table alias. */
    const both = (paymentClause: string, adjustmentClause: string, value: string) => {
      paymentWhere.push(paymentClause);
      paymentBinds.push(value);
      adjustmentWhere.push(adjustmentClause);
      adjustmentBinds.push(value);
    };

    if (filter.chargeId !== undefined) {
      both('p.charge_id = ?', 'a.charge_id = ?', filter.chargeId);
    }
    if (filter.eventId !== undefined) both('c.event_id = ?', 'c.event_id = ?', filter.eventId);
    if (filter.userId !== undefined) both('c.user_id = ?', 'c.user_id = ?', filter.userId);
    // `date()` normalises both a `YYYY-MM-DD` and a `YYYY-MM-DD HH:MM:SS`
    // column, so an inclusive `to` bound keeps same-day entries with a time.
    if (filter.from !== undefined) {
      both('date(p.paid_at) >= date(?)', 'date(a.applied_at) >= date(?)', filter.from);
    }
    if (filter.to !== undefined) {
      both('date(p.paid_at) <= date(?)', 'date(a.applied_at) <= date(?)', filter.to);
    }

    const paymentSql =
      'SELECT p.* FROM event_charge_payments p JOIN event_charges c ON c.id = p.charge_id' +
      (paymentWhere.length ? ` WHERE ${paymentWhere.join(' AND ')}` : '');
    const adjustmentSql =
      'SELECT a.* FROM event_charge_adjustments a JOIN event_charges c ON c.id = a.charge_id' +
      (adjustmentWhere.length ? ` WHERE ${adjustmentWhere.join(' AND ')}` : '');

    const [payments, adjustments] = await Promise.all([
      this.db.prepare(paymentSql).bind(...paymentBinds).all<EventChargePaymentRow>(),
      this.db.prepare(adjustmentSql).bind(...adjustmentBinds).all<EventChargeAdjustmentRow>(),
    ]);

    const entries: ChargeLedgerEntryRecord[] = [
      ...payments.results.map((row): ChargeLedgerEntryRecord => {
        const payment = rowToPayment(row);
        return { entry: 'payment', payment, occurredAt: payment.paidAt };
      }),
      ...adjustments.results.map((row): ChargeLedgerEntryRecord => {
        const adjustment = rowToAdjustment(row);
        return { entry: 'adjustment', adjustment, occurredAt: adjustment.appliedAt };
      }),
    ];

    entries.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));
    return entries;
  }
}
