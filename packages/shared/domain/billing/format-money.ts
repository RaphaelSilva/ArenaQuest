/**
 * formatMoney — renders an integer count of minor units for display.
 *
 * Pure: no I/O, no clock, no ambient locale beyond the one passed in.
 *
 * This module exists because `Intl.NumberFormat`'s `style: 'currency'` does not
 * throw on a code it renders badly: given `BTC` it accepts the three-letter code
 * and formats to two decimals, so a 0.001 BTC amount renders as `BTC 0,00` — a
 * wrong number on an accounting screen with no error anywhere. The bug is not
 * crypto-specific; `JPY` has exponent 0. So the exponent is carried as data
 * (`currencies.exponent`, RFC 0013 section 1) and the number is formatted with
 * `style: 'decimal'` with its fraction digits pinned to that exponent.
 *
 * The whole and fractional parts are split off the integer *before* any
 * division, so nothing here can drift: `amountMinor / 1e8` is a float operation
 * and an exponent-8 currency is exactly where it would show.
 */

/** Highest exponent the schema accepts: `CHECK (exponent BETWEEN 0 AND 18)`. */
const MAX_EXPONENT = 18;

export interface MoneyFormatOptions {
  /** Minor units per whole = 10 ** exponent. 2 for BRL, 0 for JPY, 8 for BTC. */
  exponent: number;
  /** The currency's display symbol, e.g. `R$`, `¥`, `₿`. */
  symbol: string;
  /** BCP 47 tag deciding grouping and the decimal separator. */
  locale?: string;
}

const DEFAULT_LOCALE = 'pt-BR';

/**
 * Formats `amountMinor` as `<symbol> <number>`, with a negative amount rendering
 * its sign before the symbol (`-R$ 50,00`) — which is what an accounting screen
 * expects for a reversal row.
 *
 * Exponent 0 emits no decimal separator at all. Grouping always applies, so
 * 100000 minor units at exponent 0 is `¥ 100.000` under `pt-BR`.
 */
export function formatMoney(amountMinor: number, options: MoneyFormatOptions): string {
  const { exponent, symbol } = options;
  const locale = options.locale ?? DEFAULT_LOCALE;

  if (!Number.isInteger(amountMinor)) {
    throw new RangeError(`amountMinor must be an integer count of minor units, got ${amountMinor}`);
  }
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > MAX_EXPONENT) {
    throw new RangeError(`exponent must be an integer between 0 and ${MAX_EXPONENT}, got ${exponent}`);
  }

  const negative = amountMinor < 0;
  const absolute = Math.abs(amountMinor);

  // Split on the integer. `absolute % divisor` is exact for any safe integer,
  // and subtracting the remainder before dividing makes the quotient exact too,
  // so no rounding error can reach the string.
  const divisor = 10 ** exponent;
  const fraction = exponent === 0 ? 0 : absolute % divisor;
  const whole = (absolute - fraction) / divisor;

  const formatter = new Intl.NumberFormat(locale, {
    style: 'decimal',
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  });

  // The whole part is formatted on its own — it is an integer, so it is exact —
  // and the placeholder fraction digits the formatter emits are swapped for the
  // digits taken off the integer above. When the exponent is 0 the formatter
  // emits no fraction part and therefore no separator.
  const fractionDigits = exponent === 0 ? '' : String(fraction).padStart(exponent, '0');
  const rendered = formatter
    .formatToParts(whole)
    .map((part) => (part.type === 'fraction' ? fractionDigits : part.value))
    .join('');

  return `${negative ? '-' : ''}${symbol} ${rendered}`;
}
