import { describe, it, expect } from 'vitest';
import {
  parseAllowedOrigins,
  buildOriginMatcher,
  hasAnyRule,
  OriginPolicyError,
  type OriginRule,
} from '@api/core/cors/origin-policy';

// ── Helpers ───────────────────────────────────────────────────────────────────

const exact = (origin: string): OriginRule => ({ kind: 'exact', origin });
const wildcardHost = (scheme: string, suffix: string): OriginRule => ({
  kind: 'wildcard-host',
  scheme,
  suffix,
});
const any = (): OriginRule => ({ kind: 'any' });

// ── parseAllowedOrigins ───────────────────────────────────────────────────────

describe('parseAllowedOrigins', () => {
  // ── Exact origins ────────────────────────────────────────────────────────────

  it('parses a comma-separated list with surrounding whitespace', () => {
    const result = parseAllowedOrigins('https://a.com, https://b.com ,', { strict: true });
    expect(result).toEqual([exact('https://a.com'), exact('https://b.com')]);
  });

  it('trims whitespace and filters empty entries', () => {
    const result = parseAllowedOrigins(' https://a.com ,, , https://b.com ', { strict: true });
    expect(result).toEqual([exact('https://a.com'), exact('https://b.com')]);
  });

  it('normalizes origin (strips path/query)', () => {
    const result = parseAllowedOrigins('https://a.com/some/path?q=1', { strict: true });
    expect(result).toEqual([exact('https://a.com')]);
  });

  // ── Wildcard parsing — happy paths ───────────────────────────────────────────

  it('parses a host-wildcard pattern', () => {
    const result = parseAllowedOrigins('https://*.pages.dev', { strict: true });
    expect(result).toEqual([wildcardHost('https', '.pages.dev')]);
  });

  it('parses the full wildcard "*"', () => {
    const result = parseAllowedOrigins('*', { strict: true });
    expect(result).toEqual([any()]);
  });

  it('parses a mixed list of all three rule kinds', () => {
    const result = parseAllowedOrigins(
      'https://app.arenaquest.com, https://*.pages.dev, *',
      { strict: true },
    );
    expect(result).toEqual([
      exact('https://app.arenaquest.com'),
      wildcardHost('https', '.pages.dev'),
      any(),
    ]);
  });

  // ── Wildcard rejection ───────────────────────────────────────────────────────

  it('throws OriginPolicyError for "*.pages.dev" (no scheme)', () => {
    expect(() =>
      parseAllowedOrigins('*.pages.dev', { strict: true }),
    ).toThrow(OriginPolicyError);
  });

  it('throws OriginPolicyError for "https://*" (bare host wildcard)', () => {
    expect(() =>
      parseAllowedOrigins('https://*', { strict: true }),
    ).toThrow(OriginPolicyError);
  });

  it('throws OriginPolicyError for "https://*.*.com" (multiple wildcard labels)', () => {
    expect(() =>
      parseAllowedOrigins('https://*.*.com', { strict: true }),
    ).toThrow(OriginPolicyError);
  });

  it('throws OriginPolicyError for "https://foo.*.com" (wildcard not in leading label)', () => {
    expect(() =>
      parseAllowedOrigins('https://foo.*.com', { strict: true }),
    ).toThrow(OriginPolicyError);
  });

  it('OriginPolicyError message quotes the bad input', () => {
    try {
      parseAllowedOrigins('*.pages.dev', { strict: true });
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('*.pages.dev');
    }
  });

  // ── Strict mode errors ────────────────────────────────────────────────────────

  it('throws OriginPolicyError for an invalid URL in strict mode', () => {
    expect(() => parseAllowedOrigins('not a url', { strict: true })).toThrow(OriginPolicyError);
  });

  it('throws OriginPolicyError for undefined input in strict mode', () => {
    expect(() => parseAllowedOrigins(undefined, { strict: true })).toThrow(OriginPolicyError);
  });

  it('throws OriginPolicyError for empty string in strict mode', () => {
    expect(() => parseAllowedOrigins('', { strict: true })).toThrow(OriginPolicyError);
  });

  it('throws OriginPolicyError for whitespace-only string in strict mode', () => {
    expect(() => parseAllowedOrigins('  ,  ', { strict: true })).toThrow(OriginPolicyError);
  });

  // ── Non-strict mode (dev fallback) ────────────────────────────────────────────

  it('returns localhost fallback for undefined input in non-strict mode', () => {
    const result = parseAllowedOrigins(undefined, { strict: false });
    expect(result).toEqual([exact('http://localhost:3000')]);
  });

  it('returns localhost fallback for empty string in non-strict mode', () => {
    const result = parseAllowedOrigins('', { strict: false });
    expect(result).toEqual([exact('http://localhost:3000')]);
  });

  it('returns localhost fallback for whitespace/commas-only string in non-strict mode', () => {
    const result = parseAllowedOrigins('  ,  ', { strict: false });
    expect(result).toEqual([exact('http://localhost:3000')]);
  });

  it('skips invalid URL entries in non-strict mode and returns only valid ones', () => {
    const result = parseAllowedOrigins('https://a.com,not-a-url', { strict: false });
    expect(result).toEqual([exact('https://a.com')]);
  });

  it('skips invalid wildcard entries in non-strict mode', () => {
    const result = parseAllowedOrigins('https://a.com,*.pages.dev', { strict: false });
    expect(result).toEqual([exact('https://a.com')]);
  });
});

// ── hasAnyRule ────────────────────────────────────────────────────────────────

describe('hasAnyRule', () => {
  it('returns true when rules contain an any rule', () => {
    expect(hasAnyRule([exact('https://a.com'), any()])).toBe(true);
  });

  it('returns false when no any rule is present', () => {
    expect(hasAnyRule([exact('https://a.com'), wildcardHost('https', '.pages.dev')])).toBe(false);
  });

  it('returns false for an empty list', () => {
    expect(hasAnyRule([])).toBe(false);
  });
});

// ── buildOriginMatcher ────────────────────────────────────────────────────────

describe('buildOriginMatcher', () => {
  // ── Exact match ───────────────────────────────────────────────────────────────

  it('returns the request origin when it is in the allowed list', () => {
    const matcher = buildOriginMatcher([exact('https://a.com')]);
    expect(matcher('https://a.com')).toBe('https://a.com');
  });

  it('returns null for an origin not in the allowed list', () => {
    const matcher = buildOriginMatcher([exact('https://a.com')]);
    expect(matcher('https://evil.com')).toBeNull();
  });

  it('returns null for an empty string origin', () => {
    const matcher = buildOriginMatcher([exact('https://a.com')]);
    expect(matcher('')).toBeNull();
  });

  it('returns null for a malformed origin string', () => {
    const matcher = buildOriginMatcher([exact('https://a.com')]);
    expect(matcher('not-a-url')).toBeNull();
  });

  it('matches any origin in a multi-origin list', () => {
    const matcher = buildOriginMatcher([exact('https://a.com'), exact('https://b.com')]);
    expect(matcher('https://a.com')).toBe('https://a.com');
    expect(matcher('https://b.com')).toBe('https://b.com');
    expect(matcher('https://c.com')).toBeNull();
  });

  it('matches case-insensitively by normalizing the request origin host', () => {
    const matcher = buildOriginMatcher([exact('https://a.com')]);
    expect(matcher('https://A.COM')).toBe('https://a.com');
  });

  it('strips path/query from the request origin before matching', () => {
    const matcher = buildOriginMatcher([exact('https://a.com')]);
    expect(matcher('https://a.com/some/path')).toBe('https://a.com');
  });

  // ── Wildcard-host match ───────────────────────────────────────────────────────

  it('matches a single-label subdomain against a wildcard-host rule', () => {
    const matcher = buildOriginMatcher([wildcardHost('https', '.pages.dev')]);
    expect(matcher('https://abc.pages.dev')).toBe('https://abc.pages.dev');
  });

  it('returns null for a deep subdomain (two labels before suffix)', () => {
    const matcher = buildOriginMatcher([wildcardHost('https', '.pages.dev')]);
    expect(matcher('https://a.b.pages.dev')).toBeNull();
  });

  it('returns null for a scheme mismatch', () => {
    const matcher = buildOriginMatcher([wildcardHost('https', '.pages.dev')]);
    expect(matcher('http://abc.pages.dev')).toBeNull();
  });

  it('returns null for a suffix-injection attack (evil.com suffix)', () => {
    const matcher = buildOriginMatcher([wildcardHost('https', '.pages.dev')]);
    expect(matcher('https://abc.pages.dev.evil.com')).toBeNull();
  });

  it('returns null for the apex domain (no subdomain)', () => {
    const matcher = buildOriginMatcher([wildcardHost('https', '.pages.dev')]);
    expect(matcher('https://pages.dev')).toBeNull();
  });

  it('echoes the request origin string (not the pattern)', () => {
    const matcher = buildOriginMatcher([wildcardHost('https', '.pages.dev')]);
    expect(matcher('https://preview.pages.dev')).toBe(
      'https://preview.pages.dev',
    );
  });

  // ── Full wildcard (*) match ───────────────────────────────────────────────────

  it('echoes any origin when the any rule is set', () => {
    const matcher = buildOriginMatcher([any()]);
    expect(matcher('https://anything.example')).toBe('https://anything.example');
    expect(matcher('http://localhost:9999')).toBe('http://localhost:9999');
  });

  it('never returns the literal "*" for an any rule', () => {
    const matcher = buildOriginMatcher([any()]);
    expect(matcher('https://random.example')).not.toBe('*');
  });

  // ── Precedence ───────────────────────────────────────────────────────────────

  it('prefers the exact rule when both exact and wildcard-host would match', () => {
    const matcher = buildOriginMatcher([
      exact('https://app.arenaquest.com'),
      wildcardHost('https', '.arenaquest.com'),
    ]);
    // Both rules technically match; exact must win and return the normalised exact origin.
    const result = matcher('https://app.arenaquest.com');
    expect(result).toBe('https://app.arenaquest.com');
  });

  // ── Performance ───────────────────────────────────────────────────────────────

  it('completes 10 000 calls well under 50 ms', () => {
    const matcher = buildOriginMatcher([
      exact('https://app.arenaquest.com'),
      wildcardHost('https', '.pages.dev'),
    ]);
    const start = Date.now();
    for (let i = 0; i < 10_000; i++) {
      matcher('https://pr-123.arenaquest-web.pages.dev');
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
