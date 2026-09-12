import { describe, it, expect } from 'vitest';
import { fromMinorUnits, toMinorUnits } from '../minor-units';

describe('toMinorUnits', () => {
  it('round-trips an exponent-2 amount', () => {
    expect(toMinorUnits('1500.00', 2)).toEqual({ ok: true, amountMinor: 150000 });
    expect(fromMinorUnits(150000, 2)).toBe('1500.00');
  });

  it('round-trips an exponent-0 amount with no decimal separator', () => {
    expect(toMinorUnits('1500', 0)).toEqual({ ok: true, amountMinor: 1500 });
    expect(fromMinorUnits(1500, 0)).toBe('1500');
  });

  // The case a float conversion gets wrong: reading `0.001` as a float and
  // scaling it by 1e8 yields 100000.00000000001, which is not an integer count
  // of minor units.
  it('round-trips an exponent-8 amount without floating-point drift', () => {
    expect(toMinorUnits('0.001', 8)).toEqual({ ok: true, amountMinor: 100000 });
    expect(fromMinorUnits(100000, 8)).toBe('0.00100000');
    expect(toMinorUnits(fromMinorUnits(100000, 8), 8)).toEqual({ ok: true, amountMinor: 100000 });
  });

  it('pads a fraction shorter than the exponent', () => {
    expect(toMinorUnits('19.9', 2)).toEqual({ ok: true, amountMinor: 1990 });
    expect(toMinorUnits('1.5', 8)).toEqual({ ok: true, amountMinor: 150000000 });
  });

  it('keeps a cent exact where a float multiplication would not', () => {
    expect(toMinorUnits('19.99', 2)).toEqual({ ok: true, amountMinor: 1999 });
  });

  it('accepts a whole number with no separator at a non-zero exponent', () => {
    expect(toMinorUnits('250', 2)).toEqual({ ok: true, amountMinor: 25000 });
  });

  it('accepts zero — a free plan is a plan', () => {
    expect(toMinorUnits('0', 2)).toEqual({ ok: true, amountMinor: 0 });
  });

  it('rejects a fraction longer than the exponent rather than rounding it', () => {
    expect(toMinorUnits('4.567', 2)).toEqual({ ok: false, reason: 'too-precise' });
    expect(toMinorUnits('4.5', 0)).toEqual({ ok: false, reason: 'too-precise' });
  });

  it('rejects empty input', () => {
    expect(toMinorUnits('', 2)).toEqual({ ok: false, reason: 'empty' });
    expect(toMinorUnits('   ', 2)).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects non-numeric input', () => {
    expect(toMinorUnits('abc', 2)).toEqual({ ok: false, reason: 'not-a-number' });
    expect(toMinorUnits('1,500.00', 2)).toEqual({ ok: false, reason: 'not-a-number' });
    expect(toMinorUnits('1.5.0', 2)).toEqual({ ok: false, reason: 'not-a-number' });
    expect(toMinorUnits('.', 2)).toEqual({ ok: false, reason: 'not-a-number' });
  });

  it('rejects a negative amount', () => {
    expect(toMinorUnits('-1', 2)).toEqual({ ok: false, reason: 'negative' });
    expect(toMinorUnits(' -0.50 ', 2)).toEqual({ ok: false, reason: 'negative' });
  });

  it('refuses an amount that would not survive the round trip as an integer', () => {
    expect(toMinorUnits('99999999999999999999', 2)).toEqual({
      ok: false,
      reason: 'not-a-number',
    });
  });
});

describe('fromMinorUnits', () => {
  it('emits no decimal separator at exponent 0', () => {
    expect(fromMinorUnits(0, 0)).toBe('0');
    expect(fromMinorUnits(100000, 0)).toBe('100000');
  });

  it('pads the whole part when the amount is smaller than one unit', () => {
    expect(fromMinorUnits(5, 2)).toBe('0.05');
    expect(fromMinorUnits(0, 2)).toBe('0.00');
  });
});
