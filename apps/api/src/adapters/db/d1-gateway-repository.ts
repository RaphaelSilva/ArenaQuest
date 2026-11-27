import type {
  IGatewayRepository,
  GatewayCheckoutRecord,
  GatewayEventRecord,
  GatewayExceptionRecord,
  GatewayExceptionRef,
  GatewayWorkList,
  CreateGatewayCheckoutInput,
  UpdateGatewayCheckoutInput,
  CloseGatewayCheckoutInput,
  RecordGatewayEventInput,
  RecordGatewayEventResult,
  MarkGatewayEventInput,
  DismissGatewayExceptionInput,
  GatewayPaidMethodRecord,
  PaymentProviderName,
  ProviderPaymentMethod,
} from '@arenaquest/shared/ports';
import type { ReceivableKind } from '@arenaquest/shared/domain/billing/receivable';
import type { Entities } from '@arenaquest/shared/types/entities';

/**
 * The `users` row that records machine-written payments (RFC 0026 R8). Inserted
 * by migration 0033 with `status = 'system'`, an empty password hash and no
 * role; it cannot log in and appears on no human surface.
 */
export const SYSTEM_PAYMENT_ACTOR_ID = 'system:payment-gateway';

/**
 * A checkout is "under dispute" when its `failure_detail` starts with this
 * prefix (`dispute opened`, `dispute lost`, `dispute won` — RFC 0026 section 5).
 * The schema has no dispute column, so the prefix is the convention
 * `listExceptions` reads and the landing service writes.
 */
export const GATEWAY_DISPUTE_DETAIL_PREFIX = 'dispute ';

/** `gateway_events.error` never holds more than this (RFC 0026 section 2). */
export const GATEWAY_EVENT_ERROR_MAX_LENGTH = 1024;

/** An unexpired `open` checkout is asked about once it is this old (RFC section 6). */
const CONFIRM_AFTER = '-30 minutes';
/** An unsettled event is retried between these two ages (RFC section 6). */
const RETRY_EVENT_AFTER = '-15 minutes';
const RETRY_EVENT_UNTIL = '-72 hours';
/** An event left `received` this long is an exception (RFC section 6). */
const RECEIVED_STALE_AFTER = '-1 hour';
/** Bound parameters per statement when loading the checkouts exception events name. */
const LINKED_CHECKOUT_CHUNK = 50;

type CheckoutRow = {
  id: string;
  provider: string;
  receivable_kind: string;
  receivable_id: string;
  user_id: string;
  created_by: string;
  amount_minor: number;
  currency: string;
  status: string;
  provider_session_id: string | null;
  provider_payment_id: string | null;
  invoice_payment_id: string | null;
  charge_payment_id: string | null;
  paid_method: string | null;
  paid_method_label: string | null;
  checkout_url: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  last_checked_at: string | null;
  failure_detail: string | null;
  dismissed_at: string | null;
  dismissed_by: string | null;
  dismiss_note: string | null;
};

type EventRow = {
  provider: string;
  event_id: string;
  type: string;
  provider_payment_id: string | null;
  checkout_id: string | null;
  received_at: string;
  processed_at: string | null;
  outcome: string;
  attempts: number;
  error: string | null;
  dismissed_at: string | null;
  dismissed_by: string | null;
  dismiss_note: string | null;
};

function rowToCheckout(row: CheckoutRow): GatewayCheckoutRecord {
  return {
    id: row.id,
    provider: row.provider as PaymentProviderName,
    receivableKind: row.receivable_kind as ReceivableKind,
    receivableId: row.receivable_id,
    userId: row.user_id,
    createdBy: row.created_by,
    amountMinor: row.amount_minor,
    currency: row.currency,
    status: row.status as Entities.Config.CheckoutStatus,
    providerSessionId: row.provider_session_id,
    providerPaymentId: row.provider_payment_id,
    invoicePaymentId: row.invoice_payment_id,
    chargePaymentId: row.charge_payment_id,
    paidMethod: row.paid_method as ProviderPaymentMethod | null,
    paidMethodLabel: row.paid_method_label,
    checkoutUrl: row.checkout_url,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    lastCheckedAt: row.last_checked_at,
    failureDetail: row.failure_detail,
    dismissedAt: row.dismissed_at,
    dismissedBy: row.dismissed_by,
    dismissNote: row.dismiss_note,
  };
}

function rowToEvent(row: EventRow): GatewayEventRecord {
  return {
    provider: row.provider as PaymentProviderName,
    eventId: row.event_id,
    type: row.type,
    providerPaymentId: row.provider_payment_id,
    checkoutId: row.checkout_id,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    outcome: row.outcome as Entities.Config.GatewayEventOutcome,
    attempts: row.attempts,
    error: row.error,
    dismissedAt: row.dismissed_at,
    dismissedBy: row.dismissed_by,
    dismissNote: row.dismiss_note,
  };
}

function capLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
}

/**
 * D1 adapter for the gateway's two tables (RFC 0026 sections 2 and 9).
 *
 * Idempotency is decided by the database, never by a read followed by a write:
 * `recordEvent` is one `INSERT … ON CONFLICT DO NOTHING`, and `closeCheckout`,
 * `markEvent` and `dismissException` are conditional `UPDATE`s whose
 * changed-row count says whether this call was the one that changed the row.
 *
 * Every timestamp this adapter writes is an ISO-8601 UTC string taken from the
 * injected clock; every time comparison wraps both sides in `datetime()`, so a
 * row written with SQLite's `datetime('now')` default compares correctly too.
 */
export class D1GatewayRepository implements IGatewayRepository {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private stamp(): string {
    return this.now().toISOString();
  }

  // -------------------------------------------------------------------------
  // Checkouts
  // -------------------------------------------------------------------------

  /**
   * Throws when the receivable already has an `open` checkout: the partial
   * unique index `idx_gateway_checkouts_one_open` refuses the insert, and the
   * error message carries SQLite's `UNIQUE constraint failed`.
   */
  async createCheckout(input: CreateGatewayCheckoutInput): Promise<GatewayCheckoutRecord> {
    const at = this.stamp();
    await this.db
      .prepare(
        `INSERT INTO gateway_checkouts
           (id, provider, receivable_kind, receivable_id, user_id, created_by,
            amount_minor, currency, status, checkout_url, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.provider,
        input.receivableKind,
        input.receivableId,
        input.userId,
        input.createdBy,
        input.amountMinor,
        input.currency,
        input.checkoutUrl,
        input.expiresAt,
        at,
        at,
      )
      .run();

    const created = await this.getCheckout(input.id);
    if (!created) throw new Error('D1GatewayRepository: checkout not found after insert');
    return created;
  }

  async getCheckout(id: string): Promise<GatewayCheckoutRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM gateway_checkouts WHERE id = ?')
      .bind(id)
      .first<CheckoutRow>();
    return row ? rowToCheckout(row) : null;
  }

  async findOpenCheckout(
    receivableKind: ReceivableKind,
    receivableId: string,
  ): Promise<GatewayCheckoutRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM gateway_checkouts
          WHERE receivable_kind = ? AND receivable_id = ? AND status = 'open'`,
      )
      .bind(receivableKind, receivableId)
      .first<CheckoutRow>();
    return row ? rowToCheckout(row) : null;
  }

  async listOpenCheckouts(): Promise<GatewayCheckoutRecord[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM gateway_checkouts WHERE status = 'open' ORDER BY created_at, id`)
      .all<CheckoutRow>();
    return results.map(rowToCheckout);
  }

  async listPaidMethods(
    receivableKind: ReceivableKind,
    paymentIds: ReadonlyArray<string>,
  ): Promise<GatewayPaidMethodRecord[]> {
    // The column is chosen from two literals, never from input.
    const column = receivableKind === 'invoice' ? 'invoice_payment_id' : 'charge_payment_id';
    const ids = [...new Set(paymentIds)];
    const records: GatewayPaidMethodRecord[] = [];
    for (let i = 0; i < ids.length; i += LINKED_CHECKOUT_CHUNK) {
      const chunk = ids.slice(i, i + LINKED_CHECKOUT_CHUNK);
      const { results } = await this.db
        .prepare(
          `SELECT ${column} AS payment_id, paid_method, paid_method_label
             FROM gateway_checkouts
            WHERE receivable_kind = ? AND status = 'paid'
              AND ${column} IN (${chunk.map(() => '?').join(', ')})`,
        )
        .bind(receivableKind, ...chunk)
        .all<{ payment_id: string; paid_method: string | null; paid_method_label: string | null }>();
      for (const row of results) {
        records.push({
          paymentId: row.payment_id,
          method: row.paid_method as ProviderPaymentMethod | null,
          methodLabel: row.paid_method_label,
        });
      }
    }
    return records;
  }

  async updateCheckout(
    id: string,
    patch: UpdateGatewayCheckoutInput,
  ): Promise<GatewayCheckoutRecord | null> {
    const sets: string[] = [];
    const binds: unknown[] = [];

    if (patch.providerSessionId !== undefined) {
      sets.push('provider_session_id = ?');
      binds.push(patch.providerSessionId);
    }
    if (patch.checkoutUrl !== undefined) {
      sets.push('checkout_url = ?');
      binds.push(patch.checkoutUrl);
    }
    if (patch.expiresAt !== undefined) {
      sets.push('expires_at = ?');
      binds.push(patch.expiresAt);
    }
    if (patch.failureDetail !== undefined) {
      sets.push('failure_detail = ?');
      binds.push(patch.failureDetail);
    }
    if (patch.clearDismissal) {
      sets.push('dismissed_at = NULL', 'dismissed_by = NULL', 'dismiss_note = NULL');
    }

    if (sets.length > 0) {
      sets.push('updated_at = ?');
      binds.push(this.stamp(), id);
      await this.db
        .prepare(`UPDATE gateway_checkouts SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...binds)
        .run();
    }

    return this.getCheckout(id);
  }

  async closeCheckout(
    id: string,
    input: CloseGatewayCheckoutInput,
  ): Promise<GatewayCheckoutRecord | null> {
    const from = input.from ?? ['open'];
    if (from.length === 0) return null;

    const at = this.stamp();
    const sets = [
      'status = ?',
      'closed_at = ?',
      'updated_at = ?',
      'provider_payment_id = COALESCE(?, provider_payment_id)',
      'invoice_payment_id = COALESCE(?, invoice_payment_id)',
      'charge_payment_id = COALESCE(?, charge_payment_id)',
      // First writer wins, like the payment ids: the label describes the
      // payment that closed the row.
      'paid_method = COALESCE(paid_method, ?)',
      'paid_method_label = COALESCE(paid_method_label, ?)',
    ];
    const binds: unknown[] = [
      input.status,
      at,
      at,
      input.providerPaymentId ?? null,
      input.invoicePaymentId ?? null,
      input.chargePaymentId ?? null,
      input.paidMethod ?? null,
      input.paidMethodLabel ?? null,
    ];
    if (input.failureDetail !== undefined) {
      sets.push('failure_detail = ?');
      binds.push(input.failureDetail);
    }

    const placeholders = from.map(() => '?').join(', ');
    const result = await this.db
      .prepare(
        `UPDATE gateway_checkouts SET ${sets.join(', ')}
          WHERE id = ? AND status IN (${placeholders})`,
      )
      .bind(...binds, id, ...from)
      .run();

    if ((result.meta.changes ?? 0) !== 1) return null;
    return this.getCheckout(id);
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  async recordEvent(input: RecordGatewayEventInput): Promise<RecordGatewayEventResult> {
    const result = await this.db
      .prepare(
        `INSERT INTO gateway_events
           (provider, event_id, type, provider_payment_id, received_at, outcome, attempts)
         VALUES (?, ?, ?, ?, ?, 'received', 1)
         ON CONFLICT (provider, event_id) DO NOTHING`,
      )
      .bind(
        input.provider,
        input.eventId,
        input.type,
        input.providerPaymentId ?? null,
        this.stamp(),
      )
      .run();

    const event = await this.getEvent(input.provider, input.eventId);
    if (!event) throw new Error('D1GatewayRepository: event not found after insert');
    return { inserted: (result.meta.changes ?? 0) === 1, event };
  }

  async markEvent(
    provider: PaymentProviderName,
    eventId: string,
    input: MarkGatewayEventInput,
  ): Promise<GatewayEventRecord | null> {
    const sets = ['outcome = ?'];
    const binds: unknown[] = [input.outcome];

    if (input.countAttempt) sets.push('attempts = attempts + 1');
    // `received` re-opens the event: the attempt has started, not ended.
    if (input.outcome !== 'received') {
      sets.push('processed_at = ?');
      binds.push(this.stamp());
    }
    if (input.checkoutId !== undefined) {
      sets.push('checkout_id = ?');
      binds.push(input.checkoutId);
    }
    if (input.providerPaymentId !== undefined) {
      sets.push('provider_payment_id = ?');
      binds.push(input.providerPaymentId);
    }
    if (input.error !== undefined) {
      sets.push('error = ?');
      binds.push(input.error === null ? null : input.error.slice(0, GATEWAY_EVENT_ERROR_MAX_LENGTH));
    }

    const result = await this.db
      .prepare(
        `UPDATE gateway_events SET ${sets.join(', ')}
          WHERE provider = ? AND event_id = ? AND outcome IN ('received', 'failed')`,
      )
      .bind(...binds, provider, eventId)
      .run();

    if ((result.meta.changes ?? 0) !== 1) return null;
    return this.getEvent(provider, eventId);
  }

  private async getEvent(provider: string, eventId: string): Promise<GatewayEventRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM gateway_events WHERE provider = ? AND event_id = ?')
      .bind(provider, eventId)
      .first<EventRow>();
    return row ? rowToEvent(row) : null;
  }

  // -------------------------------------------------------------------------
  // Exceptions
  // -------------------------------------------------------------------------

  async listExceptions(): Promise<GatewayExceptionRecord[]> {
    const at = this.stamp();
    const [events, checkouts] = await Promise.all([
      this.db
        .prepare(
          `SELECT e.*, datetime(e.received_at) AS sort_key
             FROM gateway_events e
            WHERE e.dismissed_at IS NULL
              AND (
                e.outcome IN ('orphan', 'mismatch', 'failed')
                OR (e.outcome = 'received' AND datetime(e.received_at) < datetime(?, '${RECEIVED_STALE_AFTER}'))
              )`,
        )
        .bind(at)
        .all<EventRow & { sort_key: string }>(),
      this.db
        .prepare(
          `SELECT c.*, datetime(c.updated_at) AS sort_key
             FROM gateway_checkouts c
            WHERE c.dismissed_at IS NULL
              AND (c.status = 'mismatch' OR c.failure_detail LIKE ?)`,
        )
        .bind(`${GATEWAY_DISPUTE_DETAIL_PREFIX}%`)
        .all<CheckoutRow & { sort_key: string }>(),
    ]);

    // The checkout an event names, dismissed or not: it is context, not a row.
    const linkedIds = [...new Set(events.results.map((e) => e.checkout_id).filter((v): v is string => v !== null))];
    const linked = new Map<string, GatewayCheckoutRecord>();
    for (let i = 0; i < linkedIds.length; i += LINKED_CHECKOUT_CHUNK) {
      const chunk = linkedIds.slice(i, i + LINKED_CHECKOUT_CHUNK);
      const { results } = await this.db
        .prepare(`SELECT * FROM gateway_checkouts WHERE id IN (${chunk.map(() => '?').join(', ')})`)
        .bind(...chunk)
        .all<CheckoutRow>();
      for (const row of results) linked.set(row.id, rowToCheckout(row));
    }

    type Sortable = { sortKey: string; raw: string; tie: string; record: GatewayExceptionRecord };
    const rows: Sortable[] = [
      ...events.results.map((row): Sortable => ({
        sortKey: row.sort_key ?? '',
        raw: row.received_at,
        tie: `event:${row.provider}:${row.event_id}`,
        record: {
          kind: 'event',
          event: rowToEvent(row),
          checkout: row.checkout_id ? linked.get(row.checkout_id) ?? null : null,
          occurredAt: row.received_at,
        },
      })),
      ...checkouts.results.map((row): Sortable => ({
        sortKey: row.sort_key ?? '',
        raw: row.updated_at,
        tie: `checkout:${row.id}`,
        record: { kind: 'checkout', checkout: rowToCheckout(row), occurredAt: row.updated_at },
      })),
    ];

    const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    rows.sort((a, b) => compare(a.sortKey, b.sortKey) || compare(a.raw, b.raw) || compare(a.tie, b.tie));
    return rows.map((row) => row.record);
  }

  async dismissException(
    ref: GatewayExceptionRef,
    input: DismissGatewayExceptionInput,
  ): Promise<boolean> {
    const at = this.stamp();
    const statement =
      ref.kind === 'event'
        ? this.db
            .prepare(
              `UPDATE gateway_events
                  SET dismissed_at = ?, dismissed_by = ?, dismiss_note = ?
                WHERE provider = ? AND event_id = ? AND dismissed_at IS NULL`,
            )
            .bind(at, input.dismissedBy, input.note, ref.provider, ref.eventId)
        : this.db
            .prepare(
              `UPDATE gateway_checkouts
                  SET dismissed_at = ?, dismissed_by = ?, dismiss_note = ?
                WHERE id = ? AND dismissed_at IS NULL`,
            )
            .bind(at, input.dismissedBy, input.note, ref.checkoutId);

    const result = await statement.run();
    return (result.meta.changes ?? 0) === 1;
  }

  // -------------------------------------------------------------------------
  // Reconciliation work lists
  // -------------------------------------------------------------------------

  async listCheckoutsToConfirm(limit: number): Promise<GatewayWorkList<GatewayCheckoutRecord>> {
    const at = this.stamp();
    // ?1 = now. "Due" is: open past expiry; open and older than 30 minutes;
    // closed without a payment (expired / cancelled) and not asked since.
    const due = `(
        (status = 'open' AND datetime(expires_at) <= datetime(?1))
        OR (status = 'open' AND datetime(created_at) < datetime(?1, '${CONFIRM_AFTER}'))
        OR (status IN ('expired', 'cancelled')
            AND (last_checked_at IS NULL OR datetime(last_checked_at) < datetime(closed_at)))
      )`;

    const [page, count] = await Promise.all([
      this.db
        .prepare(
          `SELECT * FROM gateway_checkouts
            WHERE ${due}
            ORDER BY
              CASE WHEN status <> 'open' OR datetime(expires_at) <= datetime(?1) THEN 0 ELSE 1 END,
              CASE WHEN last_checked_at IS NULL THEN 0 ELSE 1 END,
              datetime(last_checked_at),
              datetime(created_at),
              id
            LIMIT ?2`,
        )
        .bind(at, capLimit(limit))
        .all<CheckoutRow>(),
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM gateway_checkouts WHERE ${due}`)
        .bind(at)
        .first<{ n: number }>(),
    ]);

    return { items: page.results.map(rowToCheckout), total: Number(count?.n ?? 0) };
  }

  async markChecked(id: string): Promise<void> {
    await this.db
      .prepare('UPDATE gateway_checkouts SET last_checked_at = ? WHERE id = ?')
      .bind(this.stamp(), id)
      .run();
  }

  async listUnsettledEvents(limit: number): Promise<GatewayWorkList<GatewayEventRecord>> {
    const at = this.stamp();
    const due = `outcome IN ('received', 'failed')
        AND datetime(received_at) < datetime(?1, '${RETRY_EVENT_AFTER}')
        AND datetime(received_at) > datetime(?1, '${RETRY_EVENT_UNTIL}')`;

    const [page, count] = await Promise.all([
      this.db
        .prepare(
          `SELECT * FROM gateway_events
            WHERE ${due}
            ORDER BY attempts, datetime(received_at), provider, event_id
            LIMIT ?2`,
        )
        .bind(at, capLimit(limit))
        .all<EventRow>(),
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM gateway_events WHERE ${due}`)
        .bind(at)
        .first<{ n: number }>(),
    ]);

    return { items: page.results.map(rowToEvent), total: Number(count?.n ?? 0) };
  }
}
