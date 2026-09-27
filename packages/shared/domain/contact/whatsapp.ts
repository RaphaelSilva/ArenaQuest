/**
 * WhatsApp contact normalisation.
 *
 * Pure: no I/O, no environment read, no framework import. It lived in
 * `apps/web/src/lib/brand.ts`, where only the web build could reach it; it moves
 * here so the API can reject at write time exactly what the web would refuse to
 * render (RFC 0014 section 5). The rule is unchanged — a different digit range
 * here would change which numbers the landing page links to.
 */

/**
 * Normalise a public WhatsApp number to the digits `wa.me` expects.
 *
 * Everything that is not a digit is dropped, so the profile may carry the
 * number in any readable form (`+55 19 99999-1155`). A result shorter than a
 * plausible international number (country code + area + subscriber) is treated
 * as unset rather than rendered as a broken link — a half-filled placeholder
 * must not ship a CTA that opens an empty chat.
 */
export function normalizeWhatsapp(value: string | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : '';
}
