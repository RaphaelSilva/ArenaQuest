/**
 * CORS Origin Policy — core module
 *
 * Cloud-agnostic: no `hono` imports. The router layer thinly adapts this module
 * to the `hono/cors` `origin` option signature.
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
 * A discriminated union representing a single parsed CORS origin rule.
 *
 * - `exact`         — matches only this specific origin string (O(1) `Set` lookup).
 * - `wildcard-host` — matches any **single-label** subdomain of `suffix` over `scheme`.
 *                     e.g. `{ scheme: 'https', suffix: '.pages.dev' }` matches
 *                     `https://foo.pages.dev` but NOT `https://a.b.pages.dev`
 *                     (deep-subdomain) or `http://foo.pages.dev` (scheme mismatch).
 * - `any`           — matches any origin. When `credentials: true` is in effect the
 *                     matcher echoes the **request** origin rather than returning the
 *                     literal `'*'`, because browsers reject `ACAO: *` with credentialed
 *                     requests (CORS spec §7.1.5).
 */
export type OriginRule =
  | { kind: 'exact'; origin: string }
  | { kind: 'wildcard-host'; scheme: string; suffix: string }
  | { kind: 'any' };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a wildcard host pattern (e.g., `https://*.pages.dev`) into a `wildcard-host`
 * OriginRule. Returns `null` in non-strict mode on failure; throws in strict mode.
 */
function parseWildcardPattern(pattern: string, strict: boolean): OriginRule | null {
  function reject(reason: string): OriginRule | null {
    if (strict) {
      throw new OriginPolicyError(
        `ALLOWED_ORIGINS contains an invalid wildcard pattern "${pattern}": ${reason}`,
      );
    }
    console.warn(
      `[CORS] Skipping invalid wildcard pattern in ALLOWED_ORIGINS: "${pattern}" — ${reason}`,
    );
    return null;
  }

  const schemeSep = pattern.indexOf('://');
  if (schemeSep === -1) {
    return reject('missing scheme — use the form https://*.example.com');
  }

  const scheme = pattern.slice(0, schemeSep).toLowerCase();
  const host = pattern.slice(schemeSep + 3).replace(/\/$/, '');

  const wildcardCount = (host.match(/\*/g) ?? []).length;
  if (wildcardCount > 1) {
    return reject('only one wildcard label is allowed (e.g. https://*.example.com)');
  }

  if (!host.startsWith('*.')) {
    return reject(
      'the wildcard must be in the leading label position (e.g. https://*.example.com)',
    );
  }

  const suffix = host.slice(1); // ".pages.dev"
  const rest = suffix.slice(1); // "pages.dev"

  if (!rest) {
    return reject('host cannot be bare "*" — specify a concrete suffix like https://*.example.com');
  }

  // Validate suffix via URL constructor
  try {
    new URL(`${scheme}://dummy${suffix}`);
  } catch {
    return reject(`"${host}" is not a valid wildcard host pattern`);
  }

  return { kind: 'wildcard-host', scheme, suffix };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a comma-separated `ALLOWED_ORIGINS` string into an array of `OriginRule` objects.
 *
 * Supported entry forms:
 *   - Exact origin:   `https://app.arenaquest.com`
 *   - Host wildcard:  `https://*.pages.dev`   (single leading label only)
 *   - Full wildcard:  `*`
 *
 * Rejected patterns (strict → throw; non-strict → warn + skip):
 *   - `*.pages.dev`          — no scheme
 *   - `https://*`            — host is bare `*`
 *   - `https://*.*.com`      — multiple wildcard labels
 *   - `https://foo.*.com`    — wildcard not in leading position
 *
 * In **strict mode** throws `OriginPolicyError` on any invalid entry or empty result.
 * In **non-strict mode** skips bad entries with a `console.warn` and falls back to
 * `[{ kind: 'exact', origin: 'http://localhost:3000' }]` when the list is empty.
 */
export function parseAllowedOrigins(raw: string | undefined, opts: ParseOptions): OriginRule[] {
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
    return [{ kind: 'exact', origin: DEV_FALLBACK }];
  }

  const rules: OriginRule[] = [];

  for (const candidate of candidates) {
    // Full wildcard
    if (candidate === '*') {
      rules.push({ kind: 'any' });
      continue;
    }

    // Host wildcard (entry contains '*' but is not bare '*')
    if (candidate.includes('*')) {
      const rule = parseWildcardPattern(candidate, opts.strict);
      if (rule) rules.push(rule);
      continue;
    }

    // Exact origin
    try {
      const url = new URL(candidate);
      rules.push({ kind: 'exact', origin: url.origin });
    } catch {
      if (opts.strict) {
        throw new OriginPolicyError(
          `ALLOWED_ORIGINS contains an invalid URL: "${candidate}". All entries must be valid URLs.`,
        );
      }
      console.warn(`[CORS] Skipping invalid URL in ALLOWED_ORIGINS: "${candidate}"`);
    }
  }

  if (rules.length === 0) {
    if (opts.strict) {
      throw new OriginPolicyError(
        'ALLOWED_ORIGINS produced an empty origin list after validation. Check the configured values.',
      );
    }
    console.warn(
      '[CORS] ALLOWED_ORIGINS yielded no valid origins — falling back to http://localhost:3000',
    );
    return [{ kind: 'exact', origin: DEV_FALLBACK }];
  }

  return rules;
}

/**
 * Returns `true` when the rule list contains a full-wildcard (`*`) rule.
 *
 * Useful at boot to emit a single warning when `*` is combined with
 * `credentials: true` (see router wiring in `routes/index.ts`).
 */
export function hasAnyRule(rules: OriginRule[]): boolean {
  return rules.some((r) => r.kind === 'any');
}

/**
 * Build an origin matcher function compatible with `hono/cors`'s `origin` option.
 *
 * Accepts the `OriginRule[]` array produced by `parseAllowedOrigins`.
 *
 * Returns `(requestOrigin: string) => string | null`:
 *   - Matching rule found → returns the **request** origin string (echoed, never `'*'`).
 *   - No match → returns `null`, causing hono/cors to omit `Access-Control-Allow-Origin`.
 *
 * Matching order (precedence): exact → wildcard-host → any.
 *
 * Performance notes:
 *   - Exact origins are stored in a `Set` for O(1) lookup.
 *   - Wildcard rules are kept in a small array (iterated only when no exact hit).
 *   - The `any` flag is a single boolean checked last.
 */
export function buildOriginMatcher(rules: OriginRule[]): (origin: string) => string | null {
  const exactSet = new Set<string>();
  const wildcardRules: Array<{ scheme: string; suffix: string }> = [];
  let hasAny = false;

  for (const rule of rules) {
    if (rule.kind === 'exact') {
      exactSet.add(rule.origin.toLowerCase());
    } else if (rule.kind === 'wildcard-host') {
      wildcardRules.push({ scheme: rule.scheme, suffix: rule.suffix });
    } else {
      hasAny = true;
    }
  }

  return (requestOrigin: string): string | null => {
    let parsedUrl: URL;
    let normalizedOrigin: string;
    try {
      parsedUrl = new URL(requestOrigin);
      normalizedOrigin = parsedUrl.origin;
    } catch {
      return null;
    }

    // 1. Exact match — O(1)
    if (exactSet.has(normalizedOrigin.toLowerCase())) {
      return normalizedOrigin;
    }

    // 2. Wildcard-host match
    if (wildcardRules.length > 0) {
      const reqScheme = parsedUrl.protocol.replace(':', '').toLowerCase();
      const reqHost = parsedUrl.hostname.toLowerCase();

      for (const rule of wildcardRules) {
        if (rule.scheme !== reqScheme) continue;
        if (!reqHost.endsWith(rule.suffix)) continue;

        // The label preceding the suffix must be a single label (no dots)
        const label = reqHost.slice(0, reqHost.length - rule.suffix.length);
        if (label.length > 0 && !label.includes('.')) {
          return normalizedOrigin;
        }
      }
    }

    // 3. Full wildcard — echo request origin.
    //    Never return the literal '*': browsers reject ACAO: * with credentials: true.
    if (hasAny) {
      return normalizedOrigin;
    }

    return null;
  };
}
