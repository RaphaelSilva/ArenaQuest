import { Entities } from '../../types/entities';

/**
 * billing-cycle — period boundaries and due dates for a contract.
 *
 * Pure: no I/O, no clock. Every date crosses the boundary as a `YYYY-MM-DD`
 * string, and every calculation runs on UTC year/month/day components. A
 * `new Date('2026-03-01')` parsed in a negative-offset zone is February 28, and
 * a series anchored on that would desynchronise from the one the invoice run
 * computed on a server in UTC — so no local `Date` is ever constructed here.
 *
 * This module exists so the invoice run and every report compute the same
 * boundaries from the same inputs. `toLocalDateString`
 * (`domain/time/local-date.ts`) is the helper a caller uses to turn its clock
 * into the `YYYY-MM-DD` these functions take; this module calls no clock itself.
 */

/** A single billing period. `periodStart` is inclusive, `periodEnd` exclusive. */
export interface CyclePeriod {
  /** YYYY-MM-DD, inclusive. */
  periodStart: string;
  /** YYYY-MM-DD, exclusive — equal to the next period's `periodStart`. */
  periodEnd: string;
  /** YYYY-MM-DD — `dueDay` within the period's start month. */
  dueDate: string;
}

/** Lowest `due_day` the schema accepts: `CHECK (due_day BETWEEN 1 AND 28)`. */
const MIN_DUE_DAY = 1;
/**
 * Highest `due_day` the schema accepts. The 28 bound is what makes a February
 * due date always a real day — but it is validated here too, so an out-of-range
 * value throws rather than silently rolling a February due date into March.
 */
const MAX_DUE_DAY = 28;

const MS_PER_DAY = 86_400_000;

const MONTHS_PER_CYCLE: Record<Entities.Config.BillingCycle, number> = {
  [Entities.Config.BillingCycle.MONTHLY]: 1,
  [Entities.Config.BillingCycle.QUARTERLY]: 3,
  [Entities.Config.BillingCycle.YEARLY]: 12,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface DateParts {
  year: number;
  /** 1-based, as it is written in the string. */
  month: number;
  day: number;
}

function parseIsoDate(value: string, label: string): DateParts {
  if (!ISO_DATE.test(value)) {
    throw new RangeError(`${label} must be a YYYY-MM-DD date, got "${value}"`);
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`${label} is not a real calendar date: "${value}"`);
  }
  return { year, month, day };
}

function toIsoDate(parts: DateParts): string {
  const year = String(parts.year).padStart(4, '0');
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

/**
 * Adds whole months to a date, clamping the day to the target month's length:
 * the 31st plus one month is the 30th or the 28th, never the 1st of the month
 * after. Clamping never accumulates here, because every period start is derived
 * from the anchor rather than from the period before it.
 */
function addMonths(parts: DateParts, months: number): DateParts {
  const totalMonths = parts.year * 12 + (parts.month - 1) + months;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths - year * 12 + 1;
  return { year, month, day: Math.min(parts.day, daysInMonth(year, month)) };
}

/**
 * Adds whole days to a `YYYY-MM-DD` date and returns the same shape.
 *
 * Exported because `standing-resolver` needs exactly this arithmetic to place a
 * grace boundary, and two implementations of calendar addition in one bounded
 * context is one too many.
 */
export function addDays(date: string, days: number): string {
  const parts = parseIsoDate(date, 'date');
  if (!Number.isInteger(days)) {
    throw new RangeError(`days must be an integer, got ${days}`);
  }
  // Date.UTC takes a 0-based month and returns an epoch millisecond count; the
  // result is read back through the UTC accessors only, so no local offset ever
  // enters the calculation.
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + days * MS_PER_DAY);
  return toIsoDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

function monthsPerCycle(cycle: Entities.Config.BillingCycle): number {
  // Annotated as possibly undefined on purpose: the argument reaches this
  // module from a database row, where a value outside the enum is possible.
  const months: number | undefined = MONTHS_PER_CYCLE[cycle];
  if (months === undefined) {
    throw new RangeError(`unknown billing cycle "${cycle}"`);
  }
  return months;
}

function assertDueDay(dueDay: number): void {
  if (!Number.isInteger(dueDay) || dueDay < MIN_DUE_DAY || dueDay > MAX_DUE_DAY) {
    throw new RangeError(
      `dueDay must be an integer between ${MIN_DUE_DAY} and ${MAX_DUE_DAY}, got ${dueDay}`,
    );
  }
}

/**
 * Returns the period containing `referenceDate` for a contract anchored at
 * `anchorDate`.
 *
 * The series is anchored to the contract, not to the calendar month: a contract
 * starting on the 15th bills the 15th to the 15th. Period length is 1, 3 or 12
 * months by cycle, and `dueDate` is `dueDay` within the period's start month.
 *
 * @param cycle         the contract's billing cycle
 * @param anchorDate    the contract's `start_date` — the anchor of the series
 * @param dueDay        1..28
 * @param referenceDate the period to return is the one containing this date
 */
export function computePeriod(
  cycle: Entities.Config.BillingCycle,
  anchorDate: string,
  dueDay: number,
  referenceDate: string,
): CyclePeriod {
  const step = monthsPerCycle(cycle);
  assertDueDay(dueDay);

  const anchor = parseIsoDate(anchorDate, 'anchorDate');
  const reference = parseIsoDate(referenceDate, 'referenceDate');

  const startOf = (index: number): DateParts => addMonths(anchor, index * step);

  // Estimate the index from the month difference, then walk it into place. The
  // estimate can only be off by a period or so (a day-of-month that falls
  // before the anchor's), so the walk is bounded in practice.
  const monthsApart = (reference.year - anchor.year) * 12 + (reference.month - anchor.month);
  let index = Math.floor(monthsApart / step);

  while (toIsoDate(startOf(index)) > referenceDate) index -= 1;
  while (toIsoDate(startOf(index + 1)) <= referenceDate) index += 1;

  const start = startOf(index);
  const end = startOf(index + 1);

  return {
    periodStart: toIsoDate(start),
    periodEnd: toIsoDate(end),
    dueDate: toIsoDate({ year: start.year, month: start.month, day: dueDay }),
  };
}

/**
 * Returns the period immediately after `period`.
 *
 * `period.periodEnd` is exclusive, so it is by definition the first day of the
 * next period — which makes this the same computation with that date as the
 * reference, and guarantees `period.periodEnd === next.periodStart`.
 */
export function nextPeriod(
  cycle: Entities.Config.BillingCycle,
  anchorDate: string,
  dueDay: number,
  period: CyclePeriod,
): CyclePeriod {
  return computePeriod(cycle, anchorDate, dueDay, period.periodEnd);
}
