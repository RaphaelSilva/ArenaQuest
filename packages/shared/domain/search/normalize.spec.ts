import { describe, it, expect } from 'vitest';
import { normalizeText, tokenize } from './normalize';

describe('normalizeText', () => {
  it('folds case, diacritics and squeezes whitespace', () => {
    expect(normalizeText('  Chūdan   TSUKI ')).toBe('chudan tsuki');
  });

  it('normalises NFC and NFD spellings identically', () => {
    const nfc = 'Chūdan'.normalize('NFC');
    const nfd = 'Chūdan'.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(normalizeText(nfd)).toBe(normalizeText(nfc));
    expect(normalizeText(nfc)).toBe('chudan');
  });

  it('maps Unicode dashes to ASCII hyphen', () => {
    expect(normalizeText('Ro Ryu – Taki')).toBe('ro ryu - taki');
    expect(normalizeText('a—b')).toBe('a-b');
    expect(normalizeText('a−b')).toBe('a-b');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeText('')).toBe('');
  });
});

describe('tokenize', () => {
  it('splits on whitespace and separators', () => {
    expect(tokenize('Kata  básica/2')).toEqual(['kata', 'basica', '2']);
    expect(tokenize('a_b-c.d,e;f:g')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('returns [] for empty or separator-only input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(' - / ')).toEqual([]);
  });
});

describe('tokenize punctuation', () => {
  it('drops tokens made only of punctuation', () => {
    expect(tokenize('!!!')).toEqual([]);
    expect(tokenize('kata (2)!')).toEqual(['kata', '2']);
  });
});
