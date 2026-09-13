import type {
  IBillingRepository,
  CurrencyRecord,
  BillingPlanRecord,
  BillingPlanFilter,
  CreateBillingPlanInput,
  UpdateBillingPlanInput,
  SubscriptionRecord,
  SubscriptionFilter,
  CreateSubscriptionInput,
  AmendSubscriptionInput,
  InvoiceRecord,
  InvoiceWithBalanceRecord,
  InvoiceFilter,
  CreateInvoiceInput,
  IssueInvoicesInput,
  InvoiceAdjustmentRecord,
  ApplyAdjustmentInput,
  PaymentRecord,
  RecordPaymentInput,
  LedgerEntryRecord,
  LedgerFilter,
  BillingStandingHoldRecord,
  SetHoldInput,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { computePeriod } from '@arenaquest/shared/domain/billing/billing-cycle';

/**
 * D1BillingRepository — the SQLite side of `IBillingRepository` (RFC 0013 §1).
 *
 * Three rules shape almost every method here:
 *
 * 1. **Balance is recomputed, never read.** `invoices.status` is a cache of
 *    "the balance reached zero", so it is written after a ledger row lands and
 *    is never summed, and never used as a filter that could hide a row from a
 *    total. The balance itself is always
 *    `amount_minor + SUM(adjustments) - SUM(payments)`, computed in SQL.
 * 2. **Snapshot, never join for terms.** A contract's and an invoice's
 *    `amount_minor`, `currency`, `cycle` and `grace_days` are read from that
 *    row's own columns. The `billing_plans` table appears in this file only in
 *    the plan CRUD methods — `plan_id` on a contract is provenance, and is
 *    never joined back to resolve what a student owes.
 * 3. **Append-only ledger.** No method issues `UPDATE` or `DELETE` against
 *    `payments` or `invoice_adjustments`. A correction is a new signed row. The
 *    only invoice mutations are the `status` cache flip and the void fields.
 */

// ---------------------------------------------------------------------------
// Rows — the on-disk shape, snake_case, integers for booleans
// ---------------------------------------------------------------------------

type CurrencyRow = {
  code: string;
  exponent: number;
  symbol: string;
  name: string;
  active: number;
};

type BillingPlanRow = {
  id: string;
  name: string;
  description: string;
  amount_minor: number;
  currency: string;
  cycle: string;
  grace_days: number;
  scope_topic_id: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  plan_id: string;
  contract_group_id: string;
  supersedes_id: string | null;
  terms_source: string;
  amount_minor: number;
  currency: string;
  cycle: string;
  grace_days: number;
  due_day: number;
  status: string;
  start_date: string;
  end_date: string | null;
  terms_note: string;
  signed_by: string;
  signed_at: string;
  updated_at: string;
};

type InvoiceRow = {
  id: string;
  subscription_id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  due_date: string;
  amount_minor: number;
  currency: string;
  grace_days: number;
  status: string;
  issued_at: string;
  voided_at: string | null;
  void_reason: string | null;
};

type InvoiceWithBalanceRow = InvoiceRow & { balance_minor: number };

type InvoiceAdjustmentRow = {
  id: string;
  invoice_id: string;
  kind: string;
  amount_minor: number;
  reason: string;
  applied_by: string;
  applied_at: string;
};

type PaymentRow = {
  id: string;
  invoice_id: string;
  amount_minor: number;
  currency: string;
  method: string;
  paid_at: string;
  external_reference: string | null;
  note: string;
  reverses_id: string | null;
  recorded_by: string;
  recorded_at: string;
};

type BillingStandingHoldRow = {
  user_id: string;
  reason: string;
  expires_at: string | null;
  set_by: string;
  set_at: string;
};

// ---------------------------------------------------------------------------
// Row → record mappers
// ---------------------------------------------------------------------------

function rowToCurrency(row: CurrencyRow): CurrencyRecord {
  return {
    code: row.code,
    exponent: row.exponent,
    symbol: row.symbol,
    name: row.name,
    active: row.active === 1,
  };
}

function rowToPlan(row: BillingPlanRow): BillingPlanRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    amountMinor: row.amount_minor,
    currency: row.currency,
    cycle: row.cycle as Entities.Config.BillingCycle,
    graceDays: row.grace_days,
    scopeTopicId: row.scope_topic_id,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSubscription(row: SubscriptionRow): SubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    contractGroupId: row.contract_group_id,
    supersedesId: row.supersedes_id,
    termsSource: row.terms_source as Entities.Config.ContractTermsSource,
    amountMinor: row.amount_minor,
    currency: row.currency,
    cycle: row.cycle as Entities.Config.BillingCycle,
    graceDays: row.grace_days,
    dueDay: row.due_day,
    status: row.status as Entities.Config.ContractStatus,
    startDate: row.start_date,
    endDate: row.end_date,
    termsNote: row.terms_note,
    signedBy: row.signed_by,
    signedAt: row.signed_at,
    updatedAt: row.updated_at,
  };
}

function rowToInvoice(row: InvoiceRow): InvoiceRecord {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    userId: row.user_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    dueDate: row.due_date,
    amountMinor: row.amount_minor,
    currency: row.currency,
    graceDays: row.grace_days,
    status: row.status as Entities.Config.InvoiceStatus,
    issuedAt: row.issued_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
  };
}

function rowToInvoiceWithBalance(row: InvoiceWithBalanceRow): InvoiceWithBalanceRecord {
  return { ...rowToInvoice(row), balanceMinor: row.balance_minor };
}

function rowToAdjustment(row: InvoiceAdjustmentRow): InvoiceAdjustmentRecord {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    kind: row.kind as Entities.Config.AdjustmentKind,
    amountMinor: row.amount_minor,
    reason: row.reason,
    appliedBy: row.applied_by,
    appliedAt: row.applied_at,
  };
}

function rowToPayment(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
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

function rowToHold(row: BillingStandingHoldRow): BillingStandingHoldRecord {
  return {
    userId: row.user_id,
    reason: row.reason,
    expiresAt: row.expires_at,
    setBy: row.set_by,
    setAt: row.set_at,
  };
}

// ---------------------------------------------------------------------------
// Shared SQL fragments
// ---------------------------------------------------------------------------

/**
 * The balance expression, as correlated subqueries over the two ledger tables.
 *
 * It is a single scalar in the same `SELECT` that reads the invoice, so a list
 * of N invoices costs one query rather than N — `listOpenInvoices` and
 * `listLedger` are called once per roster render.
 */
const BALANCE_EXPR = `
  i.amount_minor
  + COALESCE((SELECT SUM(a.amount_minor) FROM invoice_adjustments a WHERE a.invoice_id = i.id), 0)
  - COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.invoice_id = i.id), 0)
`;

const SELECT_INVOICE_WITH_BALANCE = `SELECT i.*, (${BALANCE_EXPR}) AS balance_minor FROM invoices i`;

/**
 * Rewrites one invoice's cached `status` from its recomputed balance.
 *
 * A voided invoice is excluded: voiding is a decision, not an arithmetic
 * outcome, and no later ledger row may resurrect it as `open` or `paid`.
 */
const REFRESH_INVOICE_STATUS = `
  UPDATE invoices
     SET status = CASE
       WHEN amount_minor
          + COALESCE((SELECT SUM(a.amount_minor) FROM invoice_adjustments a WHERE a.invoice_id = invoices.id), 0)
          - COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.invoice_id = invoices.id), 0) <= 0
       THEN 'paid' ELSE 'open' END
   WHERE id = ? AND status <> 'void'
`;

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class D1BillingRepository implements IBillingRepository {
  constructor(private readonly db: D1Database) {}

  // -------------------------------------------------------------------------
  // Currencies — the table is the source of truth
  // -------------------------------------------------------------------------

  /**
   * The whole point of this method: a code is known because the `currencies`
   * table holds a row for it, not because a constant in the service lists it.
   * A tenant who adds a currency with `wrangler d1 execute` is therefore able
   * to price a plan in it without a deploy (RFC 0013 §1, decision #13).
   */
  async getCurrency(code: string): Promise<CurrencyRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM currencies WHERE code = ?')
      .bind(code)
      .first<CurrencyRow>();
    return row ? rowToCurrency(row) : null;
  }

  /**
   * Active first, so the tenant's live currency is `results[0]` when one is
   * set — `idx_currencies_one_active` guarantees there is at most one.
   */
  async listCurrencies(): Promise<CurrencyRecord[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM currencies ORDER BY active DESC, code ASC')
      .all<CurrencyRow>();
    return results.map(rowToCurrency);
  }

  // -------------------------------------------------------------------------
  // Plans — the catalogue
  // -------------------------------------------------------------------------

  async listPlans(filter: BillingPlanFilter = {}): Promise<BillingPlanRecord[]> {
    const where: string[] = [];
    const binds: unknown[] = [];

    if (filter.archived !== undefined) {
      where.push('archived = ?');
      binds.push(filter.archived ? 1 : 0);
    }
    if (filter.cycle !== undefined) {
      where.push('cycle = ?');
      binds.push(filter.cycle);
    }

    const sql =
      'SELECT * FROM billing_plans' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY name ASC';

    const { results } = await this.db.prepare(sql).bind(...binds).all<BillingPlanRow>();
    return results.map(rowToPlan);
  }

  async getPlan(id: string): Promise<BillingPlanRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM billing_plans WHERE id = ?')
      .bind(id)
      .first<BillingPlanRow>();
    return row ? rowToPlan(row) : null;
  }

  async createPlan(input: CreateBillingPlanInput): Promise<BillingPlanRecord> {
    const id = crypto.randomUUID();

    await this.db
      .prepare(
        `INSERT INTO billing_plans
           (id, name, description, amount_minor, currency, cycle, grace_days, scope_topic_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.name,
        input.description ?? '',
        input.amountMinor,
        input.currency,
        input.cycle,
        input.graceDays,
        input.scopeTopicId ?? null,
      )
      .run();

    const created = await this.getPlan(id);
    if (!created) throw new Error('D1BillingRepository: billing plan not found after insert');
    return created;
  }

  async updatePlan(id: string, patch: UpdateBillingPlanInput): Promise<BillingPlanRecord | null> {
    const sets: string[] = [];
    const binds: unknown[] = [];

    if (patch.name !== undefined) {
      sets.push('name = ?');
      binds.push(patch.name);
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      binds.push(patch.description);
    }
    if (patch.amountMinor !== undefined) {
      sets.push('amount_minor = ?');
      binds.push(patch.amountMinor);
    }
    if (patch.cycle !== undefined) {
      sets.push('cycle = ?');
      binds.push(patch.cycle);
    }
    if (patch.graceDays !== undefined) {
      sets.push('grace_days = ?');
      binds.push(patch.graceDays);
    }
    if (patch.scopeTopicId !== undefined) {
      sets.push('scope_topic_id = ?');
      binds.push(patch.scopeTopicId);
    }
    if (patch.archived !== undefined) {
      sets.push('archived = ?');
      binds.push(patch.archived ? 1 : 0);
    }

    // `currency` is absent from the patch type on purpose: re-denominating a
    // catalogue item would silently change what its amount means.
    if (sets.length === 0) return this.getPlan(id);

    sets.push("updated_at = datetime('now')");
    binds.push(id);

    await this.db
      .prepare(`UPDATE billing_plans SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();

    return this.getPlan(id);
  }

  // -------------------------------------------------------------------------
  // Subscriptions — the signed contracts
  // -------------------------------------------------------------------------

  async listSubscriptions(filter: SubscriptionFilter = {}): Promise<SubscriptionRecord[]> {
    const where: string[] = [];
    const binds: unknown[] = [];

    if (filter.userId !== undefined) {
      where.push('user_id = ?');
      binds.push(filter.userId);
    }
    if (filter.planId !== undefined) {
      where.push('plan_id = ?');
      binds.push(filter.planId);
    }
    if (filter.status !== undefined) {
      where.push('status = ?');
      binds.push(filter.status);
    }
    if (filter.contractGroupId !== undefined) {
      where.push('contract_group_id = ?');
      binds.push(filter.contractGroupId);
    }

    const sql =
      'SELECT * FROM subscriptions' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY start_date DESC, rowid DESC';

    const { results } = await this.db.prepare(sql).bind(...binds).all<SubscriptionRow>();
    return results.map(rowToSubscription);
  }

  async getSubscription(id: string): Promise<SubscriptionRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM subscriptions WHERE id = ?')
      .bind(id)
      .first<SubscriptionRow>();
    return row ? rowToSubscription(row) : null;
  }

  async getActiveSubscription(userId: string): Promise<SubscriptionRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active'")
      .bind(userId)
      .first<SubscriptionRow>();
    return row ? rowToSubscription(row) : null;
  }

  async listContractGroup(contractGroupId: string): Promise<SubscriptionRecord[]> {
    // Oldest first. `rowid` breaks the tie because two versions amended within
    // the same second share a `signed_at`, and insertion order is the chain.
    const { results } = await this.db
      .prepare(
        `SELECT * FROM subscriptions
          WHERE contract_group_id = ?
          ORDER BY start_date ASC, rowid ASC`,
      )
      .bind(contractGroupId)
      .all<SubscriptionRow>();
    return results.map(rowToSubscription);
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
    const id = crypto.randomUUID();

    await this.db
      .prepare(
        `INSERT INTO subscriptions
           (id, user_id, plan_id, contract_group_id, supersedes_id, terms_source,
            amount_minor, currency, cycle, grace_days, due_day, status,
            start_date, end_date, terms_note, signed_by)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, ?)`,
      )
      .bind(
        id,
        input.userId,
        input.planId,
        // The first version of a chain is its own group, so every report groups
        // on one column with no COALESCE.
        id,
        input.termsSource,
        input.amountMinor,
        input.currency,
        input.cycle,
        input.graceDays,
        input.dueDay,
        input.startDate,
        input.termsNote ?? '',
        input.signedBy,
      )
      .run();

    const created = await this.getSubscription(id);
    if (!created) throw new Error('D1BillingRepository: subscription not found after insert');
    return created;
  }

  async updateSubscriptionStatus(
    id: string,
    status: Entities.Config.ContractStatus,
    endDate?: string | null,
  ): Promise<SubscriptionRecord | null> {
    const sets = ['status = ?'];
    const binds: unknown[] = [status];

    // `undefined` leaves the column alone; an explicit `null` clears it.
    if (endDate !== undefined) {
      sets.push('end_date = ?');
      binds.push(endDate);
    }

    sets.push("updated_at = datetime('now')");
    binds.push(id);

    await this.db
      .prepare(`UPDATE subscriptions SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();

    return this.getSubscription(id);
  }

  async amendSubscription(input: AmendSubscriptionInput): Promise<SubscriptionRecord> {
    const current = await this.getSubscription(input.subscriptionId);
    if (!current) {
      throw new Error(
        `D1BillingRepository: cannot amend unknown subscription "${input.subscriptionId}"`,
      );
    }

    const id = crypto.randomUUID();

    // Both writes go in one batch: `idx_subscriptions_one_active` would reject
    // the insert if the predecessor were still active, and a half-applied
    // amendment would leave the student with no live contract at all. The
    // UPDATE must precede the INSERT inside the batch for the same reason.
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE subscriptions
              SET status = 'superseded', end_date = ?, updated_at = datetime('now')
            WHERE id = ?`,
        )
        .bind(input.startDate, current.id),
      this.db
        .prepare(
          `INSERT INTO subscriptions
             (id, user_id, plan_id, contract_group_id, supersedes_id, terms_source,
              amount_minor, currency, cycle, grace_days, due_day, status,
              start_date, end_date, terms_note, signed_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, ?)`,
        )
        .bind(
          id,
          current.userId,
          current.planId,
          current.contractGroupId,
          current.id,
          input.termsSource ?? current.termsSource,
          input.amountMinor ?? current.amountMinor,
          // Currency is not amendable: re-denominating a live contract would
          // restate every invoice already issued under it.
          current.currency,
          input.cycle ?? current.cycle,
          input.graceDays ?? current.graceDays,
          input.dueDay ?? current.dueDay,
          input.startDate,
          input.termsNote,
          input.signedBy,
        ),
    ]);

    const created = await this.getSubscription(id);
    if (!created) throw new Error('D1BillingRepository: amended subscription not found after insert');
    return created;
  }

  // -------------------------------------------------------------------------
  // Invoices
  // -------------------------------------------------------------------------

  async listOpenInvoices(userId: string): Promise<InvoiceWithBalanceRecord[]> {
    const { results } = await this.db
      .prepare(
        `${SELECT_INVOICE_WITH_BALANCE}
          WHERE i.user_id = ? AND i.status = 'open'
          ORDER BY i.due_date ASC`,
      )
      .bind(userId)
      .all<InvoiceWithBalanceRow>();
    return results.map(rowToInvoiceWithBalance);
  }

  async listInvoices(filter: InvoiceFilter): Promise<InvoiceWithBalanceRecord[]> {
    const where: string[] = [];
    const binds: unknown[] = [];

    if (filter.userId !== undefined) {
      where.push('i.user_id = ?');
      binds.push(filter.userId);
    }
    if (filter.subscriptionId !== undefined) {
      where.push('i.subscription_id = ?');
      binds.push(filter.subscriptionId);
    }
    if (filter.status !== undefined) {
      where.push('i.status = ?');
      binds.push(filter.status);
    }
    if (filter.dueFrom !== undefined) {
      where.push('i.due_date >= ?');
      binds.push(filter.dueFrom);
    }
    if (filter.dueTo !== undefined) {
      where.push('i.due_date <= ?');
      binds.push(filter.dueTo);
    }

    const sql =
      SELECT_INVOICE_WITH_BALANCE +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY i.due_date ASC, i.period_start ASC';

    const { results } = await this.db.prepare(sql).bind(...binds).all<InvoiceWithBalanceRow>();
    return results.map(rowToInvoiceWithBalance);
  }

  async getInvoice(id: string): Promise<InvoiceWithBalanceRecord | null> {
    const row = await this.db
      .prepare(`${SELECT_INVOICE_WITH_BALANCE} WHERE i.id = ?`)
      .bind(id)
      .first<InvoiceWithBalanceRow>();
    return row ? rowToInvoiceWithBalance(row) : null;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceRecord> {
    const id = crypto.randomUUID();

    // The refresh is what settles a zero-amount invoice: its balance is already
    // zero at issue, so the cache has to read `paid` with no payment row behind
    // it. For every other amount the same statement is a no-op.
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO invoices
             (id, subscription_id, user_id, period_start, period_end, due_date,
              amount_minor, currency, grace_days, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
        )
        .bind(
          id,
          input.subscriptionId,
          input.userId,
          input.periodStart,
          input.periodEnd,
          input.dueDate,
          input.amountMinor,
          input.currency,
          input.graceDays,
        ),
      this.db.prepare(REFRESH_INVOICE_STATUS).bind(id),
    ]);

    const row = await this.db
      .prepare('SELECT * FROM invoices WHERE id = ?')
      .bind(id)
      .first<InvoiceRow>();
    if (!row) throw new Error('D1BillingRepository: invoice not found after insert');
    return rowToInvoice(row);
  }

  /**
   * Issues the period containing `referenceDate` for every `active` contract.
   *
   * Idempotency is `UNIQUE (subscription_id, period_start)` and nothing else:
   * the insert is `INSERT OR IGNORE` and the return value is built from the
   * rows the database reports as actually written. There is deliberately no
   * "does it already exist" `SELECT` in front of it — that is the shape that
   * races two concurrent runs into a duplicate.
   */
  async issueInvoices(period: IssueInvoicesInput): Promise<InvoiceRecord[]> {
    const { referenceDate } = period;

    const { results: contracts } = await this.db
      .prepare(
        `SELECT * FROM subscriptions
          WHERE status = 'active'
            AND start_date <= ?
            AND (end_date IS NULL OR end_date > ?)`,
      )
      .bind(referenceDate, referenceDate)
      .all<SubscriptionRow>();

    const created: InvoiceRecord[] = [];

    for (const row of contracts) {
      const contract = rowToSubscription(row);
      const cyclePeriod = computePeriod(
        contract.cycle,
        contract.startDate,
        contract.dueDay,
        referenceDate,
      );

      const id = crypto.randomUUID();
      const result = await this.db
        .prepare(
          `INSERT OR IGNORE INTO invoices
             (id, subscription_id, user_id, period_start, period_end, due_date,
              amount_minor, currency, grace_days, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
        )
        .bind(
          id,
          contract.id,
          contract.userId,
          cyclePeriod.periodStart,
          cyclePeriod.periodEnd,
          cyclePeriod.dueDate,
          contract.amountMinor,
          contract.currency,
          contract.graceDays,
        )
        .run();

      // `changes === 0` is the period already having a row. That is the whole
      // idempotency story, and it is the database's answer rather than a
      // pre-flight SELECT that two concurrent runs could both pass.
      if (result.meta.changes === 0) continue;

      // Settles a free contract's zero-amount invoice at issue; a no-op
      // otherwise.
      await this.db.prepare(REFRESH_INVOICE_STATUS).bind(id).run();

      const inserted = await this.db
        .prepare('SELECT * FROM invoices WHERE id = ?')
        .bind(id)
        .first<InvoiceRow>();
      if (inserted) created.push(rowToInvoice(inserted));
    }

    return created;
  }

  /**
   * Voiding is the one invoice mutation besides the `status` cache flip. The
   * actor is not persisted — the schema records `voided_at` and `void_reason`
   * only, and who did it is an audit event (Task 03), not a column.
   */
  async voidInvoice(id: string, reason: string, _voidedBy: string): Promise<InvoiceRecord | null> {
    await this.db
      .prepare(
        `UPDATE invoices
            SET status = 'void', voided_at = datetime('now'), void_reason = ?
          WHERE id = ?`,
      )
      .bind(reason, id)
      .run();

    const row = await this.db
      .prepare('SELECT * FROM invoices WHERE id = ?')
      .bind(id)
      .first<InvoiceRow>();
    return row ? rowToInvoice(row) : null;
  }

  // -------------------------------------------------------------------------
  // Ledger — append-only on both tables
  // -------------------------------------------------------------------------

  async recordPayment(input: RecordPaymentInput): Promise<PaymentRecord> {
    const id = crypto.randomUUID();

    // Insert and cache flip in one batch: an invoice whose balance reached zero
    // must never be observable as `open` with a settled ledger behind it.
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO payments
             (id, invoice_id, amount_minor, currency, method, paid_at,
              external_reference, note, reverses_id, recorded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.invoiceId,
          input.amountMinor,
          input.currency,
          input.method,
          input.paidAt,
          input.externalReference ?? null,
          input.note ?? '',
          input.reversesId ?? null,
          input.recordedBy,
        ),
      this.db.prepare(REFRESH_INVOICE_STATUS).bind(input.invoiceId),
    ]);

    const created = await this.getPayment(id);
    if (!created) throw new Error('D1BillingRepository: payment not found after insert');
    return created;
  }

  async getPayment(id: string): Promise<PaymentRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM payments WHERE id = ?')
      .bind(id)
      .first<PaymentRow>();
    return row ? rowToPayment(row) : null;
  }

  async applyAdjustment(input: ApplyAdjustmentInput): Promise<InvoiceAdjustmentRecord> {
    const id = crypto.randomUUID();

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO invoice_adjustments
             (id, invoice_id, kind, amount_minor, reason, applied_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, input.invoiceId, input.kind, input.amountMinor, input.reason, input.appliedBy),
      this.db.prepare(REFRESH_INVOICE_STATUS).bind(input.invoiceId),
    ]);

    const row = await this.db
      .prepare('SELECT * FROM invoice_adjustments WHERE id = ?')
      .bind(id)
      .first<InvoiceAdjustmentRow>();
    if (!row) throw new Error('D1BillingRepository: adjustment not found after insert');
    return rowToAdjustment(row);
  }

  async listLedger(filter: LedgerFilter): Promise<LedgerEntryRecord[]> {
    const paymentWhere: string[] = [];
    const paymentBinds: unknown[] = [];
    const adjustmentWhere: string[] = [];
    const adjustmentBinds: unknown[] = [];

    if (filter.invoiceId !== undefined) {
      paymentWhere.push('p.invoice_id = ?');
      paymentBinds.push(filter.invoiceId);
      adjustmentWhere.push('a.invoice_id = ?');
      adjustmentBinds.push(filter.invoiceId);
    }
    if (filter.userId !== undefined) {
      paymentWhere.push('i.user_id = ?');
      paymentBinds.push(filter.userId);
      adjustmentWhere.push('i.user_id = ?');
      adjustmentBinds.push(filter.userId);
    }
    // `date()` normalises both a `YYYY-MM-DD` and a `YYYY-MM-DD HH:MM:SS`
    // column, so an inclusive `to` bound does not drop same-day entries that
    // carry a time.
    if (filter.from !== undefined) {
      paymentWhere.push('date(p.paid_at) >= date(?)');
      paymentBinds.push(filter.from);
      adjustmentWhere.push('date(a.applied_at) >= date(?)');
      adjustmentBinds.push(filter.from);
    }
    if (filter.to !== undefined) {
      paymentWhere.push('date(p.paid_at) <= date(?)');
      paymentBinds.push(filter.to);
      adjustmentWhere.push('date(a.applied_at) <= date(?)');
      adjustmentBinds.push(filter.to);
    }

    const paymentSql =
      'SELECT p.* FROM payments p JOIN invoices i ON i.id = p.invoice_id' +
      (paymentWhere.length ? ` WHERE ${paymentWhere.join(' AND ')}` : '');
    const adjustmentSql =
      'SELECT a.* FROM invoice_adjustments a JOIN invoices i ON i.id = a.invoice_id' +
      (adjustmentWhere.length ? ` WHERE ${adjustmentWhere.join(' AND ')}` : '');

    const [payments, adjustments] = await Promise.all([
      this.db.prepare(paymentSql).bind(...paymentBinds).all<PaymentRow>(),
      this.db.prepare(adjustmentSql).bind(...adjustmentBinds).all<InvoiceAdjustmentRow>(),
    ]);

    const entries: LedgerEntryRecord[] = [
      ...payments.results.map((row): LedgerEntryRecord => {
        const payment = rowToPayment(row);
        return { entry: 'payment', payment, occurredAt: payment.paidAt };
      }),
      ...adjustments.results.map((row): LedgerEntryRecord => {
        const adjustment = rowToAdjustment(row);
        return { entry: 'adjustment', adjustment, occurredAt: adjustment.appliedAt };
      }),
    ];

    entries.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));
    return entries;
  }

  // -------------------------------------------------------------------------
  // Holds — "stop chasing this one"
  // -------------------------------------------------------------------------

  /**
   * Returns the row as stored, expired or not. Whether an `expiresAt` in the
   * past still suppresses a reminder is `resolveStanding`'s decision, and this
   * adapter owns no clock with which to make it.
   */
  async getHold(userId: string): Promise<BillingStandingHoldRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM billing_standing_holds WHERE user_id = ?')
      .bind(userId)
      .first<BillingStandingHoldRow>();
    return row ? rowToHold(row) : null;
  }

  async listHolds(): Promise<BillingStandingHoldRecord[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM billing_standing_holds ORDER BY set_at DESC')
      .all<BillingStandingHoldRow>();
    return results.map(rowToHold);
  }

  async setHold(input: SetHoldInput): Promise<BillingStandingHoldRecord> {
    await this.db
      .prepare(
        `INSERT INTO billing_standing_holds (user_id, reason, expires_at, set_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           reason     = excluded.reason,
           expires_at = excluded.expires_at,
           set_by     = excluded.set_by,
           set_at     = datetime('now')`,
      )
      .bind(input.userId, input.reason, input.expiresAt ?? null, input.setBy)
      .run();

    const created = await this.getHold(input.userId);
    if (!created) throw new Error('D1BillingRepository: hold not found after upsert');
    return created;
  }

  async clearHold(userId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM billing_standing_holds WHERE user_id = ?')
      .bind(userId)
      .run();
  }
}
