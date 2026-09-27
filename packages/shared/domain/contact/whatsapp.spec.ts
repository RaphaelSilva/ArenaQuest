import { describe, expect, it } from 'vitest';
import { normalizeWhatsapp } from './whatsapp';

describe('normalizeWhatsapp', () => {
  it('accepts a number inside the 10-15 digit range', () => {
    expect(normalizeWhatsapp('5519999991155')).toBe('5519999991155');
    expect(normalizeWhatsapp('1234567890')).toBe('1234567890'); // exactly 10
    expect(normalizeWhatsapp('123456789012345')).toBe('123456789012345'); // exactly 15
  });

  it('strips every non-digit before measuring', () => {
    expect(normalizeWhatsapp('+55 (19) 99999-1155')).toBe('5519999991155');
    expect(normalizeWhatsapp('+55.19.99999.1155')).toBe('5519999991155');
  });

  it('treats a too-short number as unset', () => {
    expect(normalizeWhatsapp('123456789')).toBe(''); // 9 digits
    expect(normalizeWhatsapp('+55 19 9999')).toBe('');
  });

  it('treats a too-long number as unset', () => {
    expect(normalizeWhatsapp('1234567890123456')).toBe(''); // 16 digits
  });

  it('treats undefined, empty and digitless input as unset', () => {
    expect(normalizeWhatsapp(undefined)).toBe('');
    expect(normalizeWhatsapp('')).toBe('');
    expect(normalizeWhatsapp('   ')).toBe('');
    expect(normalizeWhatsapp('not a number')).toBe('');
  });
});
