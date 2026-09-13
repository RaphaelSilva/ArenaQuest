import { describe, expect, it } from 'vitest';
import { Entities } from '../../types/entities';
import { addDays, computePeriod, nextPeriod, type CyclePeriod } from './billing-cycle';

const { MONTHLY, QUARTERLY, YEARLY } = Entities.Config.BillingCycle;

/** Walks `count` consecutive periods from the one containing `anchorDate`. */
function series(
  cycle: Entities.Config.BillingCycle,
  anchorDate: string,
  dueDay: number,
  count: number,
): CyclePeriod[] {
  const periods: CyclePeriod[] = [computePeriod(cycle, anchorDate, dueDay, anchorDate)];
  for (let i = 1; i < count; i += 1) {
    periods.push(nextPeriod(cycle, anchorDate, dueDay, periods[i - 1]));
  }
  return periods;
}

function expectContiguous(periods: CyclePeriod[]): void {
  for (let i = 1; i < periods.length; i += 1) {
    expect(periods[i - 1].periodEnd).toBe(periods[i].periodStart);
    expect(periods[i].periodStart < periods[i].periodEnd).toBe(true);
  }
}

describe('computePeriod / nextPeriod', () => {
  describe('contiguity across a year', () => {
    it('produces twelve contiguous monthly periods', () => {
      const periods = series(MONTHLY, '2026-01-10', 10, 12);
      expectContiguous(periods);
      expect(periods[0].periodStart).toBe('2026-01-10');
      expect(periods[11].periodStart).toBe('2026-12-10');
      expect(periods[11].periodEnd).toBe('2027-01-10');
    });

    it('produces four contiguous quarterly periods', () => {
      const periods = series(QUARTERLY, '2026-01-10', 10, 4);
      expectContiguous(periods);
      expect(periods.map((p) => p.periodStart)).toEqual([
        '2026-01-10',
        '2026-04-10',
        '2026-07-10',
        '2026-10-10',
      ]);
      expect(periods[3].periodEnd).toBe('2027-01-10');
    });

    it('produces a yearly period spanning exactly one year', () => {
      const [first, second] = series(YEARLY, '2026-01-10', 10, 2);
      expect(first).toEqual({
        periodStart: '2026-01-10',
        periodEnd: '2027-01-10',
        dueDate: '2026-01-10',
      });
      expect(second.periodStart).toBe('2027-01-10');
      expect(second.periodEnd).toBe('2028-01-10');
    });
  });

  describe('the period containing a reference date', () => {
    it('returns the period the reference date falls inside', () => {
      expect(computePeriod(MONTHLY, '2026-01-10', 10, '2026-03-09')).toEqual({
        periodStart: '2026-02-10',
        periodEnd: '2026-03-10',
        dueDate: '2026-02-10',
      });
    });

    it('treats periodStart as inclusive and periodEnd as exclusive', () => {
      const onStart = computePeriod(MONTHLY, '2026-01-10', 10, '2026-02-10');
      expect(onStart.periodStart).toBe('2026-02-10');

      const dayBefore = computePeriod(MONTHLY, '2026-01-10', 10, '2026-02-09');
      expect(dayBefore.periodEnd).toBe('2026-02-10');
      expect(dayBefore.periodStart).toBe('2026-01-10');
    });

    it('anchors the series to the contract, not to the calendar month', () => {
      expect(computePeriod(MONTHLY, '2026-01-15', 5, '2026-02-14').periodStart).toBe('2026-01-15');
    });
  });

  describe('due dates', () => {
    it('resolves a due_day of 28 inside February without rolling into March', () => {
      const period = computePeriod(MONTHLY, '2026-01-10', 28, '2026-02-15');
      expect(period.periodStart).toBe('2026-02-10');
      expect(period.dueDate).toBe('2026-02-28');
    });

    it('places the due day in the period start month for every month of a year', () => {
      for (const period of series(MONTHLY, '2026-01-10', 28, 12)) {
        expect(period.dueDate.slice(0, 7)).toBe(period.periodStart.slice(0, 7));
        expect(period.dueDate.slice(8)).toBe('28');
      }
    });

    it('rejects a due day outside the 1..28 schema CHECK', () => {
      expect(() => computePeriod(MONTHLY, '2026-01-10', 0, '2026-01-10')).toThrow(RangeError);
      expect(() => computePeriod(MONTHLY, '2026-01-10', 29, '2026-01-10')).toThrow(RangeError);
      expect(() => computePeriod(MONTHLY, '2026-01-10', 31, '2026-01-10')).toThrow(RangeError);
      expect(() => computePeriod(MONTHLY, '2026-01-10', 10.5, '2026-01-10')).toThrow(RangeError);
    });
  });

  describe('month-end clamping', () => {
    it('clamps a day-31 anchor into February and recovers in March', () => {
      const periods = series(MONTHLY, '2026-01-31', 28, 4);
      expect(periods.map((p) => p.periodStart)).toEqual([
        '2026-01-31',
        '2026-02-28',
        '2026-03-31',
        '2026-04-30',
      ]);
      expectContiguous(periods);
    });

    it('clamps a day-31 anchor into a leap February', () => {
      expect(computePeriod(MONTHLY, '2028-01-31', 28, '2028-02-29').periodStart).toBe('2028-02-29');
    });

    it('clamps a day-29 anchor on a yearly cycle out of a leap year', () => {
      const [first, second] = series(YEARLY, '2028-02-29', 28, 2);
      expect(first.periodEnd).toBe('2029-02-28');
      expect(second.periodStart).toBe('2029-02-28');
    });
  });

  describe('input guards', () => {
    it('rejects a date that is not YYYY-MM-DD', () => {
      expect(() => computePeriod(MONTHLY, '10/01/2026', 10, '2026-01-10')).toThrow(RangeError);
      expect(() => computePeriod(MONTHLY, '2026-01-10', 10, '2026-1-10')).toThrow(RangeError);
    });

    it('rejects a date that is not a real calendar day', () => {
      expect(() => computePeriod(MONTHLY, '2026-02-30', 10, '2026-03-01')).toThrow(RangeError);
    });

    it('rejects an unknown cycle arriving from a database row', () => {
      const unknown = 'fortnightly' as Entities.Config.BillingCycle;
      expect(() => computePeriod(unknown, '2026-01-10', 10, '2026-01-10')).toThrow(RangeError);
    });
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-01-28', 5)).toBe('2026-02-02');
  });

  it('crosses a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('crosses a year boundary in both directions', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('is a no-op for zero days', () => {
    expect(addDays('2026-06-15', 0)).toBe('2026-06-15');
  });
});
