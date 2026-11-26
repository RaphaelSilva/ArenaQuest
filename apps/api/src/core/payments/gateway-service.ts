/**
 * GatewayService — the collection path of RFC 0026 §4 and §5.
 *
 * `handleEvent` takes one **verified** provider event and treats it as a
 * trigger only: it records the event idempotently, fetches the payment from
 * the provider over the adapter's authenticated call, and lets the *fetched*
 * state decide. Nothing in the delivery but the payment id is believed.
 *
 * Money reaches the ledger only through the rails' gateway entry points
 * (`recordGatewayPayment`, `recordGatewayRefund`), which are idempotent on the
 * `<provider>:<id>` reference — so two deliveries, a retry and the reconcile
 * run can all race here and the ledger still admits one row per provider
 * payment and one per provider refund.
 *
 * The ledger write, the checkout close and the event outcome are **three
 * separate conditional writes**, not one database batch: they live behind
 * three ports. Each is idempotent, the order is ledger → checkout → event, and
 * an attempt that dies between two of them leaves the event unsettled, so the
 * provider's redelivery (or the reconcile run) finishes the rest.
 *
 * It never gates: no enrollment, no access, no `user`. The only hold it may
 * raise is the contract-rail dispute hold; an event charge never gets one.
 *
 * Logs carry ids and outcomes only — never a body, a secret or a provider
 * message.
 */
import type {
  PaymentProviderName,
  ProviderDisputeOutcome,
  ProviderEvent,
  ProviderPayment,
} from '@arenaquest/shared/ports/i-payment-gateway';
import type {
  GatewayCheckoutRecord,
  GatewayEventRecord,
  IGatewayRepository,
} from '@arenaquest/shared/ports/i-gateway-repository';
import { Entities } from '@arenaquest/shared/types/entities';
import { buildGatewayReference } from '@arenaquest/shared/domain/billing/gateway-money';
import { RAIL_OF_KIND } from '@arenaquest/shared/domain/billing/receivable';
import {
  GATEWAY_DISPUTE_DETAIL_PREFIX,
  SYSTEM_PAYMENT_ACTOR_ID,
} from '@api/adapters/db/d1-gateway-repository';
import type { GatewayRegistry } from '@api/core/payments/gateway-registry';
import type { BillingService } from '@api/core/billing/billing-service';
import type { EventChargeService } from '@api/core/billing/event-charge-service';

const { CheckoutStatus, GatewayEventOutcome } = Entities.Config;

/** What one call to `handleEvent` answers. `failed` is the service's own error: the route answers `503`. */
export type GatewayHandleOutcome = 'applied' | 'duplicate' | 'ignored' | 'orphan' | 'mismatch' | 'failed';

export interface GatewayHandleResult {
  outcome: GatewayHandleOutcome;
  provider: PaymentProviderName;
  eventId: string;
  /** The checkout the fetched payment named, when one was resolved. */
  checkoutId: string | null;
  /** The provider payment the event pointed at (bare id); `null` for an ignored kind. */
  providerPaymentId: string | null;
}

/** The outcome of acting on one fetched payment — also what the reconcile run reads. */
export interface GatewayPaymentOutcome {
  outcome: Exclude<GatewayHandleOutcome, 'failed'>;
  checkoutId: string | null;
}

/** The contract rail, as far as the gateway may reach into it. */
export type GatewayContractLedger = Pick<
  BillingService,
  'recordGatewayPayment' | 'recordGatewayRefund' | 'raiseDisputeHold' | 'releaseDisputeHold'
>;

/** The extras rail: money only — an event charge never gets a hold. */
export type GatewayExtrasLedger = Pick<EventChargeService, 'recordGatewayPayment' | 'recordGatewayRefund'>;

export interface GatewayServiceDeps {
  gateways: Pick<GatewayRegistry, 'get'>;
  gatewayRepo: IGatewayRepository;
  billing: GatewayContractLedger;
  charges: GatewayExtrasLedger;
  /** The clock a payment with no `paidAt` falls back to. */
  now?: () => Date;
}

/** `gateway_events.type` of a dispute event: the kind plus its outcome, so a stored row can be replayed. */
const DISPUTE_TYPE_PREFIX = 'dispute.';

/** A checkout in one of these still takes a late payment (RFC 0026 §5). */
const PAYABLE_FROM = [CheckoutStatus.OPEN, CheckoutStatus.EXPIRED, CheckoutStatus.CANCELLED] as const;

const SETTLED: ReadonlySet<string> = new Set([
  GatewayEventOutcome.APPLIED,
  GatewayEventOutcome.DUPLICATE,
  GatewayEventOutcome.IGNORED,
  GatewayEventOutcome.ORPHAN,
  GatewayEventOutcome.MISMATCH,
]);

const STORED_OUTCOME: Readonly<Record<GatewayPaymentOutcome['outcome'], Entities.Config.GatewayEventOutcome>> = {
  applied: GatewayEventOutcome.APPLIED,
  duplicate: GatewayEventOutcome.DUPLICATE,
  ignored: GatewayEventOutcome.IGNORED,
  orphan: GatewayEventOutcome.ORPHAN,
  mismatch: GatewayEventOutcome.MISMATCH,
};

/** `true` when a stored event outcome is final (anything but `received` / `failed`). */
export function isSettledEventOutcome(outcome: string): boolean {
  return SETTLED.has(outcome);
}

/** What `gateway_events.type` holds for an event. */
export function storedEventType(event: ProviderEvent): string {
  if (event.kind === 'ignored') return event.type;
  if (event.kind === 'dispute') return `${DISPUTE_TYPE_PREFIX}${event.outcome}`;
  return event.kind;
}

/**
 * Rebuilds the event a stored, unsettled row stands for, so the reconcile run
 * can hand it back to `handleEvent`. `null` when the row carries no payment id
 * or a type this service never stores for a retryable event. A `refund` comes
 * back as a `payment` event: the refund id is not stored and is not needed —
 * every refund of the fetched payment lands whatever the event called itself.
 */
export function eventFromRecord(record: GatewayEventRecord): ProviderEvent | null {
  if (record.providerPaymentId === null) return null;
  const base = { eventId: record.eventId, paymentId: record.providerPaymentId, occurredAt: record.receivedAt };
  if (record.type === 'payment' || record.type === 'refund') return { kind: 'payment', ...base };
  if (record.type.startsWith(DISPUTE_TYPE_PREFIX)) {
    const outcome = record.type.slice(DISPUTE_TYPE_PREFIX.length);
    if (outcome === 'opened' || outcome === 'won' || outcome === 'lost') {
      return { kind: 'dispute', outcome, ...base };
    }
  }
  return null;
}

/** The ledger reference of a lost dispute: its own id space inside the provider's, keyed on the payment. */
export function disputeReference(provider: PaymentProviderName, paymentId: string): string {
  return buildGatewayReference(provider, `dispute-${paymentId}`);
}

/** A failure description that can never carry a body: the error's class name and nothing else. */
function describeFailure(error: unknown): string {
  const name = error instanceof Error && error.name ? error.name : 'Error';
  return `processing failed (${name})`;
}

export class GatewayService {
  private readonly now: () => Date;

  constructor(private readonly deps: GatewayServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * One verified delivery. Never throws: the service's own failure is the
   * outcome `failed`, with the event left unsettled so a redelivery is
   * processed again.
   */
  async handleEvent(provider: PaymentProviderName, event: ProviderEvent): Promise<GatewayHandleResult> {
    const providerPaymentId = event.kind === 'ignored' ? null : event.paymentId;
    const result = (outcome: GatewayHandleOutcome, checkoutId: string | null = null): GatewayHandleResult => {
      const answer = { outcome, provider, eventId: event.eventId, checkoutId, providerPaymentId };
      console.info(JSON.stringify({ event: 'payments.webhook_event', ...answer, at: this.now().toISOString() }));
      return answer;
    };

    const repo = this.deps.gatewayRepo;
    try {
      const recorded = await repo.recordEvent({
        provider,
        eventId: event.eventId,
        type: storedEventType(event),
        providerPaymentId,
      });
      if (!recorded.inserted) {
        // The stored outcome answers a known event: a settled one is a
        // duplicate and nothing is written; an unsettled one is tried again.
        if (isSettledEventOutcome(recorded.event.outcome)) {
          return result('duplicate', recorded.event.checkoutId);
        }
        await repo.markEvent(provider, event.eventId, {
          outcome: GatewayEventOutcome.RECEIVED,
          countAttempt: true,
        });
      }
    } catch {
      // Not even recorded: the provider's redelivery starts from nothing.
      return result('failed');
    }

    try {
      if (event.kind === 'ignored') {
        await repo.markEvent(provider, event.eventId, { outcome: GatewayEventOutcome.IGNORED, error: null });
        return result('ignored');
      }

      const gateway = this.deps.gateways.get(provider);
      if (!gateway) throw new Error(`no adapter is bound for ${provider}`);

      const payment = await gateway.getPayment(event.paymentId);
      const acted: GatewayPaymentOutcome = payment
        ? await this.applyPayment(provider, payment, {
            occurredAt: event.occurredAt,
            dispute: event.kind === 'dispute' ? event.outcome : null,
          })
        : { outcome: 'orphan', checkoutId: null };

      await repo.markEvent(provider, event.eventId, {
        outcome: STORED_OUTCOME[acted.outcome],
        checkoutId: acted.checkoutId,
        error: null,
      });
      return result(acted.outcome, acted.checkoutId);
    } catch (error) {
      try {
        await repo.markEvent(provider, event.eventId, {
          outcome: GatewayEventOutcome.FAILED,
          error: describeFailure(error),
        });
      } catch {
        // The row stays `received`; it is retried the same way.
      }
      return result('failed');
    }
  }

  /**
   * Acts on one payment **as fetched from the provider**. The webhook reaches
   * it through `handleEvent`; the reconcile run calls it with what
   * `findPaymentsForCheckout` returned. Throws on the service's own failure.
   *
   * @param context.occurredAt The date a payment without `paidAt`, and a lost
   *   dispute, are booked on; defaults to now.
   * @param context.dispute The outcome a verified dispute event carried.
   */
  async applyPayment(
    provider: PaymentProviderName,
    payment: ProviderPayment,
    context: { occurredAt?: string | null; dispute?: ProviderDisputeOutcome | null } = {},
  ): Promise<GatewayPaymentOutcome> {
    const repo = this.deps.gatewayRepo;

    // The back-reference must name a checkout of this very provider.
    const checkout = payment.checkoutId === null ? null : await repo.getCheckout(payment.checkoutId);
    if (!checkout || checkout.provider !== provider) return { outcome: 'orphan', checkoutId: null };

    if (payment.currency !== checkout.currency) {
      await repo.closeCheckout(checkout.id, {
        status: CheckoutStatus.MISMATCH,
        from: PAYABLE_FROM,
        failureDetail: `currency mismatch: the payment is in ${payment.currency}, the checkout in ${checkout.currency}`,
      });
      return { outcome: 'mismatch', checkoutId: checkout.id };
    }

    if (payment.status === 'pending') return { outcome: 'ignored', checkoutId: checkout.id };

    if (payment.status === 'failed' || payment.status === 'expired') {
      // The student may try again inside the same session; keep the last status.
      if (checkout.status === CheckoutStatus.OPEN) {
        await repo.updateCheckout(checkout.id, { failureDetail: `payment ${payment.status}` });
      }
      return { outcome: 'ignored', checkoutId: checkout.id };
    }

    // `paid`, `refunded` or `disputed`: the money was captured, so it lands
    // first if it never did — also on a checkout already expired or cancelled.
    const fallbackDate = context.occurredAt ?? this.now().toISOString();
    const landed = await this.landPayment(provider, checkout, payment, payment.paidAt ?? fallbackDate);
    if (landed === 'refused') return { outcome: 'mismatch', checkoutId: checkout.id };
    let changed = landed === 'created';

    // Every refund the provider holds, whatever the event called itself.
    for (const refund of payment.refunds) {
      const written = await this.ledgerRefund(checkout, {
        amountMinor: refund.amountMinor,
        currency: payment.currency,
        paidAt: refund.createdAt,
        externalReference: buildGatewayReference(provider, refund.id),
      });
      changed ||= written;
    }

    const dispute = context.dispute ?? (payment.status === 'disputed' ? 'opened' : null);
    if (dispute) changed = (await this.applyDispute(provider, checkout, payment, dispute, fallbackDate)) || changed;

    return { outcome: changed ? 'applied' : 'duplicate', checkoutId: checkout.id };
  }

  /** Lands the captured amount and closes the checkout as `paid`. */
  private async landPayment(
    provider: PaymentProviderName,
    checkout: GatewayCheckoutRecord,
    payment: ProviderPayment,
    paidAt: string,
  ): Promise<'created' | 'existing' | 'refused'> {
    const command = {
      // What the provider captured, not what the checkout asked for (R14).
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      paidAt,
      externalReference: buildGatewayReference(provider, payment.id),
    };
    const isInvoice = checkout.receivableKind === 'invoice';
    const written = isInvoice
      ? await this.deps.billing.recordGatewayPayment(checkout.receivableId, command)
      : await this.deps.charges.recordGatewayPayment(checkout.receivableId, command);

    if (!written.ok) {
      // The ledger refused what an admin payment would be refused too (a void
      // receivable, a currency the receivable is not in). The money is at the
      // provider and not on the ledger: an exception an admin resolves, and
      // nothing a redelivery could change.
      await this.deps.gatewayRepo.closeCheckout(checkout.id, {
        status: CheckoutStatus.MISMATCH,
        from: PAYABLE_FROM,
        providerPaymentId: payment.id,
        failureDetail:
          written.status === 409
            ? 'payment not landed: the receivable is void'
            : `payment not landed: refused by the ledger (${written.status})`,
      });
      return 'refused';
    }

    // Also on `created: false`: an earlier attempt may have written the row
    // and died before closing the checkout. A second payment on a checkout
    // that is already `paid` changes nothing here — the write is conditional.
    await this.deps.gatewayRepo.closeCheckout(checkout.id, {
      status: CheckoutStatus.PAID,
      from: PAYABLE_FROM,
      providerPaymentId: payment.id,
      ...(isInvoice
        ? { invoicePaymentId: written.data.payment.id }
        : { chargePaymentId: written.data.payment.id }),
    });
    return written.data.created ? 'created' : 'existing';
  }

  /** One negative gateway row; `true` when this call wrote it. Throws when the ledger refuses it. */
  private async ledgerRefund(
    checkout: GatewayCheckoutRecord,
    command: {
      amountMinor: number;
      currency: string;
      paidAt: string;
      externalReference: string;
      kind?: 'refund' | 'dispute';
    },
  ): Promise<boolean> {
    const written =
      checkout.receivableKind === 'invoice'
        ? await this.deps.billing.recordGatewayRefund(checkout.receivableId, command)
        : await this.deps.charges.recordGatewayRefund(checkout.receivableId, command);
    if (!written.ok) throw new Error(`the ledger refused a provider refund (${written.status})`);
    return written.data.created;
  }

  /**
   * A dispute's state on the checkout, the contract-rail hold and — when lost —
   * the money that left. `true` when this call changed anything.
   */
  private async applyDispute(
    provider: PaymentProviderName,
    checkout: GatewayCheckoutRecord,
    payment: ProviderPayment,
    outcome: ProviderDisputeOutcome,
    occurredAt: string,
  ): Promise<boolean> {
    const detail = `${GATEWAY_DISPUTE_DETAIL_PREFIX}${outcome}`;
    // Re-read: the landing above may have just closed the checkout.
    const current = (await this.deps.gatewayRepo.getCheckout(checkout.id)) ?? checkout;
    const known = current.failureDetail;
    const closed =
      known === `${GATEWAY_DISPUTE_DETAIL_PREFIX}won` || known === `${GATEWAY_DISPUTE_DETAIL_PREFIX}lost`;
    // A late `opened` never reopens a dispute the provider already closed.
    const isNewState = known !== detail && !(outcome === 'opened' && closed);
    const onContractRail = RAIL_OF_KIND[checkout.receivableKind] === 'contract';
    let changed = false;

    if (outcome === 'opened') {
      // Hold first, note second: a retry after a crash in between raises it
      // again (idempotent), while a redelivery of a recorded state does not
      // re-raise a hold an admin lifted early.
      if (isNewState && onContractRail) {
        const hold = await this.deps.billing.raiseDisputeHold(checkout.userId);
        if (!hold.ok) throw new Error(`the dispute hold could not be raised (${hold.status})`);
      }
    } else {
      if (outcome === 'lost') {
        const refunded = payment.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
        const lostMinor = payment.amountMinor - refunded;
        if (lostMinor > 0) {
          changed = await this.ledgerRefund(checkout, {
            amountMinor: lostMinor,
            currency: payment.currency,
            paidAt: occurredAt,
            externalReference: disputeReference(provider, payment.id),
            kind: 'dispute',
          });
        }
      }
      if (onContractRail) {
        const released = await this.deps.billing.releaseDisputeHold(checkout.userId);
        if (!released.ok) throw new Error(`the dispute hold could not be released (${released.status})`);
      }
    }

    if (isNewState) {
      await this.deps.gatewayRepo.updateCheckout(checkout.id, { failureDetail: detail, clearDismissal: true });
      console.info(
        JSON.stringify({
          event: outcome === 'opened' ? 'payments.dispute_opened' : 'payments.dispute_closed',
          actor: SYSTEM_PAYMENT_ACTOR_ID,
          provider,
          rail: RAIL_OF_KIND[checkout.receivableKind],
          outcome,
          userId: checkout.userId,
          checkoutId: checkout.id,
          at: this.now().toISOString(),
        }),
      );
      changed = true;
    }
    return changed;
  }
}
