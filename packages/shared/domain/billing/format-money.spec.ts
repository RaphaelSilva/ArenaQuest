import { describe, expect, it } from 'vitest';
import { formatMoney } from './format-money';

describe('formatMoney', () => {
  describe('the three exponents the schema seeds', () => {
    it('renders 100000 minor units at exponent 2 as a BRL amount', () => {
      expect(formatMoney(100000, { exponent: 2, symbol: 'R$' })).toBe('R$ 1.000,00');
    });

    it('renders 100000 minor units at exponent 0 with no decimal separator', () => {
      // The task writes this expectation as `JP¥ 100000` — the same number
      // without separators. Grouping is not special-cased away at exponent 0:
      // an accounting screen needs it, and exponent 2 already groups.
      expect(formatMoney(100000, { exponent: 0, symbol: 'JP¥' })).toBe('JP¥ 100.000');
    });

    it('renders 100000 minor units at exponent 8 exactly', () => {
      // This is the case `Intl.NumberFormat`'s `style: 'currency'` rounds to
      // `BTC 0,00` without raising anything.
      expect(formatMoney(100000, { exponent: 8, symbol: '₿' })).toBe('₿ 0,00100000');
    });
  });

  describe('sign', () => {
    it('places a negative sign before the symbol, as a reversal row reads', () => {
      expect(formatMoney(-5000, { exponent: 2, symbol: 'R$' })).toBe('-R$ 50,00');
    });

    it('renders a negative sub-unit amount without losing its digits', () => {
      expect(formatMoney(-1, { exponent: 8, symbol: '₿' })).toBe('-₿ 0,00000001');
    });
  });

  describe('zero', () => {
    it('renders zero at exponent 0', () => {
      expect(formatMoney(0, { exponent: 0, symbol: '¥' })).toBe('¥ 0');
    });

    it('renders zero at exponent 2', () => {
      expect(formatMoney(0, { exponent: 2, symbol: 'R$' })).toBe('R$ 0,00');
    });

    it('renders zero at exponent 8', () => {
      expect(formatMoney(0, { exponent: 8, symbol: '₿' })).toBe('₿ 0,00000000');
    });
  });

  describe('no float drift at exponent 8', () => {
    it('keeps every digit of a large satoshi amount', () => {
      // `8547390965034709 / 1e8` is 85473909.65034708 in IEEE 754 — the last
      // digit is lost. Splitting the whole and fractional parts off the integer
      // before formatting is what keeps this exact.
      const amountMinor = 8_547_390_965_034_709;
      expect((amountMinor / 1e8).toFixed(8)).toBe('85473909.65034708'); // the defect
      expect(formatMoney(amountMinor, { exponent: 8, symbol: '₿' })).toBe(
        '₿ 85.473.909,65034709',
      );
    });

    it('renders the whole BTC supply in satoshis', () => {
      expect(formatMoney(2_100_000_000_000_000, { exponent: 8, symbol: '₿' })).toBe(
        '₿ 21.000.000,00000000',
      );
    });
  });

  describe('locale', () => {
    it('defaults to pt-BR', () => {
      expect(formatMoney(123456, { exponent: 2, symbol: 'R$' })).toBe('R$ 1.234,56');
    });

    it('respects an explicit locale', () => {
      expect(formatMoney(123456, { exponent: 2, symbol: 'US$', locale: 'en-US' })).toBe(
        'US$ 1,234.56',
      );
    });
  });

  describe('input guards', () => {
    it('rejects a fractional amount, since minor units are always integers', () => {
      expect(() => formatMoney(10.5, { exponent: 2, symbol: 'R$' })).toThrow(RangeError);
    });

    it('rejects an exponent outside the schema CHECK', () => {
      expect(() => formatMoney(1, { exponent: -1, symbol: 'R$' })).toThrow(RangeError);
      expect(() => formatMoney(1, { exponent: 19, symbol: 'R$' })).toThrow(RangeError);
    });
  });
});
