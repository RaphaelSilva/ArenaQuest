import { Entities } from '../../types/entities';
import { addDays } from './billing-cycle';

/**
 * standing-resolver — derives a student's billing standing from their open
 * invoices, an optional hold and a calendar date.
 *
 * Pure: no I/O, no clock. `today` arrives as a `YYYY-MM-DD` string already
 * resolved in the student's timezone.
 *
 * Standing is never stored (RFC 0013 section 2). A stored flag goes stale at
 * midnight when nothing is running, and it is exactly the kind of state that
 * drifts from its inputs after a manual database fix — so it is recomputed on
 * every read from the rows that decide it.
 *
 * Standing is reported, never enforced: it is a label on a report and on a
 * banner, and it changes nothing about what a student can open.
 */

/**
 * One open invoice, reduced to what standing depends on.
 *
 * `balanceMinor` is
 * `amount_minor + SUM(adjustments.amount_minor) - SUM(payments.amount_minor)`,
 * computed by the adapter. Because both corrections are signed rows, a discount
 * and a reversal move the standing through this same arithmetic.
 */
export interface StandingInvoice {
  /** YYYY-MM-DD. */
  dueDate: string;
  /** The invoice's **own** snapshot — never a plan or contract value. */
  graceDays: number;
  balanceMinor: number;
}

export interface StandingInput {
  openInvoices: StandingInvoice[];
  /** Suppresses the alert, not the debt. `null` when no hold is set. */
  hold: { expiresAt: string | null } | null;
  /** YYYY-MM-DD in the student's timezone. */
  today: string;
}

export interface StandingResult {
  standing: Entities.Config.BillingStanding;
  /** Due date of the oldest unpaid invoice already past due; null if none is. */
  oldestOverdueDate: string | null;
  /** Total still owed. A hold never changes this. */
  outstandingMinor: number;
}

/**
 * Resolves standing, in this precedence:
 *
 * 1. `outstandingMinor` is summed first and unconditionally — a hold must not
 *    change what a student owes, only whether anyone chases them for it.
 * 2. An unexpired hold reports `exempt`. An expired hold is treated as no hold
 *    at all, and `oldestOverdueDate` is reported either way.
 * 3. Otherwise the **oldest** invoice with a positive balance decides, against
 *    **its own** snapshotted `graceDays`: before the due date is `good`, within
 *    grace (inclusive of the last day) is `due`, past it is `delinquent`.
 * 4. No open invoice, or none with a positive balance — the free contract's
 *    case — is `good`.
 *
 * Dates are compared lexicographically, which is exact for `YYYY-MM-DD`.
 */
export function resolveStanding(input: StandingInput): StandingResult {
  const { today, hold } = input;

  // A zero or negative balance is settled: a free contract's invoice is paid on
  // arrival, and an overpaid one is not a debt.
  const unpaid = input.openInvoices.filter((invoice) => invoice.balanceMinor > 0);
  const outstandingMinor = unpaid.reduce((total, invoice) => total + invoice.balanceMinor, 0);

  const oldest = unpaid.reduce<StandingInvoice | null>(
    (candidate, invoice) =>
      candidate === null || invoice.dueDate < candidate.dueDate ? invoice : candidate,
    null,
  );

  // Reported whether or not a hold suppresses the label.
  const oldestOverdueDate = oldest !== null && today >= oldest.dueDate ? oldest.dueDate : null;

  const holdIsActive = hold !== null && (hold.expiresAt === null || hold.expiresAt >= today);
  if (holdIsActive) {
    return {
      standing: Entities.Config.BillingStanding.EXEMPT,
      oldestOverdueDate,
      outstandingMinor,
    };
  }

  if (oldest === null) {
    return {
      standing: Entities.Config.BillingStanding.GOOD,
      oldestOverdueDate: null,
      outstandingMinor: 0,
    };
  }

  const graceEnds = addDays(oldest.dueDate, oldest.graceDays);
  const standing =
    today < oldest.dueDate
      ? Entities.Config.BillingStanding.GOOD
      : today <= graceEnds
        ? Entities.Config.BillingStanding.DUE
        : Entities.Config.BillingStanding.DELINQUENT;

  return { standing, oldestOverdueDate, outstandingMinor };
}
