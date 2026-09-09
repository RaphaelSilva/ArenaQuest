import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  brand,
  PLATFORM_NAME,
  computeIsCustom,
  normalizeWhatsapp,
  resolveShowPoweredBy,
} from '../brand';

describe('brand config — pure resolution', () => {
  it('PLATFORM_NAME is ArenaQuest', () => {
    expect(PLATFORM_NAME).toBe('ArenaQuest');
  });

  it('computeIsCustom is false for stock ArenaQuest values', () => {
    expect(computeIsCustom('AQ', 'Arena', 'Quest')).toBe(false);
  });

  it('computeIsCustom is true when any identity field diverges', () => {
    expect(computeIsCustom('XX', 'Arena', 'Quest')).toBe(true);
    expect(computeIsCustom('AQ', 'Foo', 'Quest')).toBe(true);
    expect(computeIsCustom('AQ', 'Arena', '')).toBe(true);
  });

  it('resolveShowPoweredBy forces true/false and otherwise follows isCustom', () => {
    expect(resolveShowPoweredBy('true', false)).toBe(true);
    expect(resolveShowPoweredBy('false', true)).toBe(false);
    expect(resolveShowPoweredBy(undefined, true)).toBe(true);
    expect(resolveShowPoweredBy(undefined, false)).toBe(false);
    expect(resolveShowPoweredBy('', true)).toBe(true);
    expect(resolveShowPoweredBy('yes', false)).toBe(false);
  });

  it('normalizeWhatsapp keeps only digits, so a readable profile value works', () => {
    expect(normalizeWhatsapp('5519999991155')).toBe('5519999991155');
    expect(normalizeWhatsapp('+55 (19) 99999-1155')).toBe('5519999991155');
  });

  it('normalizeWhatsapp treats unset or implausible values as "no number"', () => {
    expect(normalizeWhatsapp(undefined)).toBe('');
    expect(normalizeWhatsapp('')).toBe('');
    expect(normalizeWhatsapp('<fill>')).toBe('');
    expect(normalizeWhatsapp('999991155')).toBe(''); // 9 digits — no country code
    expect(normalizeWhatsapp('1'.repeat(16))).toBe(''); // longer than E.164
  });
});

describe('brand config — default (no env)', () => {
  it('reproduces the ArenaQuest identity', () => {
    expect(brand.sigla).toBe('AQ');
    expect(brand.namePrefix).toBe('Arena');
    expect(brand.nameAccent).toBe('Quest');
    expect(brand.fullName).toBe('ArenaQuest');
    expect(brand.accentHex).toBe('#ff8101');
    expect(brand.onAccentHex).toBe('#0B0E17');
    expect(brand.isCustom).toBe(false);
    expect(brand.showPoweredBy).toBe(false);
    expect(brand.whatsapp).toBe('');
  });
});

describe('brand config — env resolution (module reload)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadBrand() {
    vi.resetModules();
    return (await import('../brand')).brand;
  }

  it('applies custom sigla/prefix/accent and flags isCustom', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND_SIGLA', 'MX');
    vi.stubEnv('NEXT_PUBLIC_BRAND_NAME_PREFIX', 'Max');
    vi.stubEnv('NEXT_PUBLIC_BRAND_NAME_ACCENT', 'Quiz');
    const b = await loadBrand();
    expect(b.sigla).toBe('MX');
    expect(b.fullName).toBe('MaxQuiz');
    expect(b.isCustom).toBe(true);
    // No POWERED_BY override → follows isCustom.
    expect(b.showPoweredBy).toBe(true);
  });

  it('exposes NEXT_PUBLIC_BRAND_WHATSAPP as wa.me digits', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND_WHATSAPP', '+55 19 99999-1155');
    const b = await loadBrand();
    expect(b.whatsapp).toBe('5519999991155');
  });

  it('treats empty NAME_ACCENT as a valid single-tone value', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND_NAME_PREFIX', 'Mono');
    vi.stubEnv('NEXT_PUBLIC_BRAND_NAME_ACCENT', '');
    const b = await loadBrand();
    expect(b.nameAccent).toBe('');
    expect(b.fullName).toBe('Mono');
    expect(b.isCustom).toBe(true);
  });

  it('honors POWERED_BY=false even for a custom brand', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND_SIGLA', 'ZZ');
    vi.stubEnv('NEXT_PUBLIC_BRAND_POWERED_BY', 'false');
    const b = await loadBrand();
    expect(b.isCustom).toBe(true);
    expect(b.showPoweredBy).toBe(false);
  });

  it('honors POWERED_BY=true even for the stock brand', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND_POWERED_BY', 'true');
    const b = await loadBrand();
    expect(b.isCustom).toBe(false);
    expect(b.showPoweredBy).toBe(true);
  });

  it('uses a custom accent hex when provided', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND_ACCENT', '#123456');
    const b = await loadBrand();
    expect(b.accentHex).toBe('#123456');
  });
});
