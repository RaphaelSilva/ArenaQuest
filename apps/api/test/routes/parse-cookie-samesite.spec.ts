import { describe, it, expect, vi } from 'vitest';
import { parseCookieSameSite } from '@api/routes/auth/login';

describe('parseCookieSameSite', () => {
  it('returns "None" when input is undefined', () => {
    expect(parseCookieSameSite(undefined)).toBe('None');
  });

  it('parses "Strict" correctly', () => {
    expect(parseCookieSameSite('Strict')).toBe('Strict');
  });

  it('parses "Lax" correctly', () => {
    expect(parseCookieSameSite('Lax')).toBe('Lax');
  });

  it('falls back to "None" on unrecognised value and logs warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseCookieSameSite('invalid')).toBe('None');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown COOKIE_SAMESITE value'),
    );
    warnSpy.mockRestore();
  });
});
