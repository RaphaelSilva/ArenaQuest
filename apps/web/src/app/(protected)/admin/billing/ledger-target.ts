/**
 * What a ledger write form acts on.
 *
 * The payment, adjustment, reversal and void forms were written for invoices
 * (RFC 0013) and are reused as-is for event charges (RFC 0015 §8): the two
 * ledgers have the same accounting rules and differ only in the endpoint the
 * write goes to and in the noun the copy uses. The forms therefore take the
 * kind as a parameter instead of being duplicated per rail.
 */
export type LedgerTargetKind = 'invoice' | 'charge';

/** The three fields a write form reads from its target. */
export type LedgerTarget = {
  id: string;
  currency: string;
  balanceMinor: number;
};
