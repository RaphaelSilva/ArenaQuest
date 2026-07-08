/**
 * Brand configuration — the single source of truth for the white-label identity.
 *
 * Values are read **once at build time** from `NEXT_PUBLIC_BRAND_*` environment
 * variables (threaded through `next.config.ts`), so each static export is baked
 * with one brand exactly like `NEXT_PUBLIC_LANGUAGE`. With no overrides the
 * defaults reproduce today's ArenaQuest mark byte-for-byte.
 */

/** The platform name, kept out of the dictionaries (used by the "Powered by" line in task 02). */
export const PLATFORM_NAME = 'ArenaQuest';

/** ArenaQuest stock defaults — a half-configured deploy still renders these. */
const DEFAULT_SIGLA = 'AQ';
const DEFAULT_NAME_PREFIX = 'Arena';
const DEFAULT_NAME_ACCENT = 'Quest';
/** sRGB hex equivalent of `oklch(0.74 0.19 52)` (= `--aq-accent`). Favicon-only; not used on screen. */
const DEFAULT_ACCENT_HEX = '#ff8101';
/** On-accent foreground (matches the badge text color today, `--aq-bg`). */
const ON_ACCENT_HEX = '#0B0E17';

/**
 * Resolve a string env var, falling back to `fallback` only when `undefined`.
 *
 * Note: an explicit empty string is preserved (see `nameAccent`, where `''`
 * means a single-tone wordmark). For env vars where empty means "unset", the
 * caller passes the empty default and lets `||` collapse it.
 */
function readEnv(value: string | undefined, fallback: string): string {
  return value === undefined ? fallback : value;
}

/** A brand is "custom" when any identity field diverges from the ArenaQuest default. */
export function computeIsCustom(sigla: string, namePrefix: string, nameAccent: string): boolean {
  return (
    sigla !== DEFAULT_SIGLA ||
    namePrefix !== DEFAULT_NAME_PREFIX ||
    nameAccent !== DEFAULT_NAME_ACCENT
  );
}

/**
 * "Powered by" visibility resolution:
 * - `'true'`  → forced on
 * - `'false'` → forced off
 * - anything else (unset/empty) → follow `isCustom`
 */
export function resolveShowPoweredBy(poweredBy: string | undefined, isCustom: boolean): boolean {
  if (poweredBy === 'true') return true;
  if (poweredBy === 'false') return false;
  return isCustom;
}

const sigla = readEnv(process.env.NEXT_PUBLIC_BRAND_SIGLA, DEFAULT_SIGLA);
const namePrefix = readEnv(process.env.NEXT_PUBLIC_BRAND_NAME_PREFIX, DEFAULT_NAME_PREFIX);
// `nameAccent` treats '' as a valid single-tone value; only `undefined` falls back.
const nameAccent = readEnv(process.env.NEXT_PUBLIC_BRAND_NAME_ACCENT, DEFAULT_NAME_ACCENT);
// An empty `_ACCENT` means "use the ArenaQuest accent hex default".
const accentHex = process.env.NEXT_PUBLIC_BRAND_ACCENT || DEFAULT_ACCENT_HEX;

const isCustom = computeIsCustom(sigla, namePrefix, nameAccent);

export interface Brand {
  /** Short badge text (e.g. `AQ`). */
  sigla: string;
  /** Leading, non-accented wordmark segment (e.g. `Arena`). */
  namePrefix: string;
  /** Trailing, accented wordmark segment (e.g. `Quest`). Empty string ⇒ single-tone. */
  nameAccent: string;
  /** sRGB accent hex — for the favicon only; on-screen uses `var(--aq-accent)`. */
  accentHex: string;
  /** Foreground color rendered on top of the accent. */
  onAccentHex: string;
  /** Full brand name (`namePrefix + nameAccent`). */
  fullName: string;
  /** Whether a brand override is in effect. */
  isCustom: boolean;
  /** Whether to render the "Powered by ArenaQuest" line. */
  showPoweredBy: boolean;
}

export const brand: Brand = {
  sigla,
  namePrefix,
  nameAccent,
  accentHex,
  onAccentHex: ON_ACCENT_HEX,
  fullName: namePrefix + nameAccent,
  isCustom,
  showPoweredBy: resolveShowPoweredBy(process.env.NEXT_PUBLIC_BRAND_POWERED_BY, isCustom),
};
