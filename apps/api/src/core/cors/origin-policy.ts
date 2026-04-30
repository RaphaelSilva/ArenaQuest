/**
 * CORS Origin Policy — core module
 *
 * Cloud-agnostic: no `hono` imports. The router layer thinly adapts this module
 * to the `hono/cors` `origin` option signature.
 *
 * Task 02 can extend `buildOriginMatcher` with wildcard/glob matching
 * without changing any of the parsing/validation logic here.
 */

const DEV_FALLBACK = 'http://localhost:3000';

/**
 * Thrown at app construction time when the origin list is invalid or empty
 * and `strict: true` was requested.
 */
export class OriginPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OriginPolicyError';
  }
}

export interface ParseOptions {
  /** When true, throw on empty/invalid input instead of falling back to localhost. */
  strict: boolean;
}

/**
 * Parse a comma-separated `ALLOWED_ORIGINS` string into a clean array of origin strings.
 *
 * - Splits on `,`
 * - Trims each entry
 * - Filters empty strings
 * - Lowercases scheme + host (via `new URL()` normalization)
 * - Validates that every entry is a valid URL
 *
 * In **strict mode** (`opts.strict = true`):
 *   - Throws `OriginPolicyError` if the result would be empty.
 *   - Throws `OriginPolicyError` for any entry that is not a valid URL.
 *
 * In **non-strict mode** (`opts.strict = false`):
 *   - Invalid URL entries emit a `console.warn` and are skipped.
 *   - An empty result falls back to `['http://localhost:3000']` with a single `console.warn`.
 */
export function parseAllowedOrigins(raw: string | undefined, opts: ParseOptions): string[] {
  const candidates = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (candidates.length === 0) {
    if (opts.strict) {
      throw new OriginPolicyError(
        'ALLOWED_ORIGINS is missing or empty. Set it to a comma-separated list of allowed origins.',
      );
    }
    console.warn(
      '[CORS] ALLOWED_ORIGINS is not set — falling back to http://localhost:3000 (development only)',
    );
    return [DEV_FALLBACK];
  }

  const parsed: string[] = [];

  for (const candidate of candidates) {
    try {
      // `new URL()` normalizes scheme+host to lowercase and validates format.
      const url = new URL(candidate);
      // Keep only origin (scheme + host + optional port), strip path/query.
      parsed.push(url.origin);
    } catch {
      if (opts.strict) {
        throw new OriginPolicyError(
          `ALLOWED_ORIGINS contains an invalid URL: "${candidate}". All entries must be valid URLs.`,
        );
      }
      console.warn(`[CORS] Skipping invalid URL in ALLOWED_ORIGINS: "${candidate}"`);
    }
  }

  if (parsed.length === 0) {
    if (opts.strict) {
      throw new OriginPolicyError(
        'ALLOWED_ORIGINS produced an empty origin list after validation. Check the configured values.',
      );
    }
    console.warn(
      '[CORS] ALLOWED_ORIGINS yielded no valid origins — falling back to http://localhost:3000',
    );
    return [DEV_FALLBACK];
  }

  return parsed;
}

/**
 * Build an origin matcher function compatible with `hono/cors`'s `origin` option.
 *
 * Returns a function `(requestOrigin: string) => string | null`:
 *   - Returns the request origin string when it is in the allowed set.
 *   - Returns `null` when it is not, causing hono/cors to omit the ACAO header.
 *
 * Current implementation: exact `Set` lookup (O(1)). Task 02 will replace this
 * with wildcard/pattern matching behind the same function signature.
 */
export function buildOriginMatcher(origins: string[]): (origin: string) => string | null {
  const allowed = new Set(origins);

  return (requestOrigin: string): string | null => {
    // Normalize the incoming origin the same way we normalized the config values.
    let normalizedRequest: string;
    try {
      normalizedRequest = new URL(requestOrigin).origin;
    } catch {
      return null;
    }

    return allowed.has(normalizedRequest) ? normalizedRequest : null;
  };
}
