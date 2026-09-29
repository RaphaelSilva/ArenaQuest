/**
 * Shared text normaliser. Catalog search and tag slugs both rely on it so a tag
 * named `Chūdan` and a query typed `chudan` can never disagree.
 * Pure, dependency-free, never throws.
 */

/** Folds diacritics, maps Unicode dashes to `-`, lowercases, squeezes whitespace, trims. */
export function normalizeText(s: string): string {
  if (typeof s !== 'string' || s.length === 0) return '';
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[\p{Pd}−]/gu, '-')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Splits normalised text on whitespace and `- _ / . , ; :`, stripping any remaining non-alphanumeric characters and dropping empty tokens. */
export function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/[\s\-_/.,;:]+/u)
    .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter(Boolean);
}
