import { describe, it, expect } from 'vitest';
import { whatsappLink } from '../whatsapp';

describe('whatsappLink', () => {
  it('builds a wa.me link for a normalised number', () => {
    expect(whatsappLink('5519999991155')).toBe('https://wa.me/5519999991155');
  });

  it('percent-encodes the pre-filled message', () => {
    expect(whatsappLink('5519999991155', 'Olá! Quero uma aula.')).toBe(
      'https://wa.me/5519999991155?text=Ol%C3%A1!%20Quero%20uma%20aula.'
    );
  });

  it('returns null without a number, so callers render their disabled state', () => {
    expect(whatsappLink('', 'Olá!')).toBeNull();
  });
});
