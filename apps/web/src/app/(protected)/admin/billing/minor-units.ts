/**
 * Conversion between the decimal string an administrator types and the integer
 * count of minor units the billing API accepts.
 *
 * Pure: no clock, no locale, no I/O. It sits beside `ledger-csv.ts` for the
 * same reason — it is logic worth testing on its own.
 *
 * The whole point is that no floating-point operation ever touches the amount.
 * Reading `0.001` as a float and scaling it by 1e8 gives
 * `100000.00000000001` on an exponent-8 currency, and scaling a float by 100
 * is off by a cent on values as ordinary as `19.99`. Both would post a wrong
 * integer to the ledger with no error anywhere, which is the same class of bug
 * `format-money.ts` exists to prevent on the way out. So the fraction is padded
 * as *text* and the integer is built by concatenating digits.
 *
 * The number of decimal places is never assumed: it is the currency's recorded
 * exponent (0 for JPY, 2 for BRL, 8 for BTC), so a fraction longer than the
 * currency can hold is rejected rather than silently rounded — `4.567` is not a
 * whole number of cents and the administrator, not the client, decides what it
 * should have been.
 */

/** Why a typed amount could not become an integer count of minor units. */
export type MinorUnitsFailure = 'empty' | 'not-a-number' | 'negative' | 'too-precise';

export type ToMinorUnitsResult =
  | { ok: true; amountMinor: number }
  | { ok: false; reason: MinorUnitsFailure };

/** Digits, with at most one dot separating them. No sign, no grouping. */
const DECIMAL = /^\d*\.?\d*$/;

export function toMinorUnits(input: string, exponent: number): ToMinorUnitsResult {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };
  // A negative price is reported as such rather than as gibberish: the API
  // requires `amountMinor >= 0` and the message can say so.
  if (trimmed.startsWith('-')) return { ok: false, reason: 'negative' };
  if (!DECIMAL.test(trimmed) || !/\d/.test(trimmed)) return { ok: false, reason: 'not-a-number' };

  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > exponent) return { ok: false, reason: 'too-precise' };

  const digits = `${whole}${fraction.padEnd(exponent, '0')}`;
  const amountMinor = Number(digits);
  // Beyond 2^53 the digit string no longer survives the round trip, so it is
  // refused instead of being posted as an approximation.
  if (!Number.isSafeInteger(amountMinor)) return { ok: false, reason: 'not-a-number' };
  return { ok: true, amountMinor };
}

/**
 * The inverse, used to pre-fill the edit form with the amount already stored.
 *
 * Built by splitting the integer's digits rather than dividing by `10 **
 * exponent`, so the value shown in the form is exactly the value in the ledger.
 * Exponent 0 emits no separator at all.
 */
export function fromMinorUnits(amountMinor: number, exponent: number): string {
  const sign = amountMinor < 0 ? '-' : '';
  const digits = String(Math.abs(amountMinor));
  if (exponent === 0) return `${sign}${digits}`;

  const padded = digits.padStart(exponent + 1, '0');
  const cut = padded.length - exponent;
  return `${sign}${padded.slice(0, cut)}.${padded.slice(cut)}`;
}
