import type { InvoiceWithBalanceRecord } from '../../ports/i-billing-repository';
import type { EventChargeWithBalanceRecord } from '../../ports/i-event-charge-repository';
import { resolveStanding, type StandingInvoice, type StandingResult } from './standing-resolver';

/**
 * receivable — one rail-tagged shape for everything a student can owe
 * (RFC 0015 section 2).
 *
 * A *rail* is the unit of standing. `contract` is RFC 0013's invoices;
 * `extras` is RFC 0015's event charges. Each rail has its own standing, and
 * nothing sums, compares or falls back between the two: a student can be
 * `good` on one and `delinquent` on the other (RFC 0015 Resolved #5).
 *
 * Pure: no I/O, no clock.
 */

export type BillingRail = 'contract' | 'extras';

/** 1:1 with the rail in v1. */
export type ReceivableKind = 'invoice' | 'event_charge';

export const RAIL_OF_KIND: Readonly<Record<ReceivableKind, BillingRail>> = Object.freeze({
  invoice: 'contract',
  event_charge: 'extras',
});

/** What every report and the standing resolver need from a receivable, and nothing more. */
export interface Receivable {
  rail: BillingRail;
  kind: ReceivableKind;
  id: string;
  userId: string;
  /** The event for a charge; the subscription (contract version) for an invoice. */
  sourceId: string;
  /** `YYYY-MM` of the period for an invoice; the event title for a charge. */
  label: string;
  issuedAt: string;
  /** YYYY-MM-DD. */
  dueDate: string;
  /** The item's own snapshot — never a plan, contract or price value. */
  graceDays: number;
  amountMinor: number;
  currency: string;
  status: 'open' | 'paid' | 'void';
  /** amount + Σ adjustments − Σ payments, computed by the adapter. */
  balanceMinor: number;
}

export function fromInvoice(invoice: InvoiceWithBalanceRecord): Receivable {
  return {
    rail: RAIL_OF_KIND.invoice,
    kind: 'invoice',
    id: invoice.id,
    userId: invoice.userId,
    sourceId: invoice.subscriptionId,
    label: invoice.periodStart.slice(0, 7),
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate,
    graceDays: invoice.graceDays,
    amountMinor: invoice.amountMinor,
    currency: invoice.currency,
    status: invoice.status,
    balanceMinor: invoice.balanceMinor,
  };
}

/**
 * `eventTitle` is the event's current title when the caller has it; without it
 * the charge's own `description` — the title snapshotted at issue — is used.
 */
export function fromCharge(charge: EventChargeWithBalanceRecord, eventTitle?: string): Receivable {
  return {
    rail: RAIL_OF_KIND.event_charge,
    kind: 'event_charge',
    id: charge.id,
    userId: charge.userId,
    sourceId: charge.eventId,
    label: eventTitle ?? charge.description,
    issuedAt: charge.issuedAt,
    dueDate: charge.dueDate,
    graceDays: charge.graceDays,
    amountMinor: charge.amountMinor,
    currency: charge.currency,
    status: charge.status,
    balanceMinor: charge.balanceMinor,
  };
}

/**
 * The only sanctioned way to reach `resolveStanding` with receivables: one
 * rail at a time.
 *
 * Throws when any item — void or not — belongs to another rail. A caller that
 * concatenates both lists "for convenience" is a bug, and it must fail loudly
 * rather than make a student look late on a monthly fee because of a seminar.
 * Void items are then dropped: a voided charge is owed by no one.
 */
export function resolveRailStanding(
  rail: BillingRail,
  items: Receivable[],
  hold: { expiresAt: string | null } | null,
  today: string,
): StandingResult {
  for (const item of items) {
    if (item.rail !== rail || RAIL_OF_KIND[item.kind] !== rail) {
      throw new Error(
        `resolveRailStanding: ${item.kind} ${item.id} is on the '${item.rail}' rail, ` +
          `not '${rail}' — rails are never merged`,
      );
    }
  }

  const openInvoices: StandingInvoice[] = items
    .filter((item) => item.status !== 'void')
    .map((item) => ({
      dueDate: item.dueDate,
      graceDays: item.graceDays,
      balanceMinor: item.balanceMinor,
    }));

  return resolveStanding({ openInvoices, hold, today });
}
