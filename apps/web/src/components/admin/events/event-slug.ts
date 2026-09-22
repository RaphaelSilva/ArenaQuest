/**
 * Slug derivation for the admin events form.
 *
 * **Derived once, at creation, and never again.** Renaming an event leaves its
 * slug alone — the public page is keyed on it and a URL already pasted into a
 * WhatsApp group cannot be recalled (RFC 0014). The form enforces that by only
 * calling this while creating; the API enforces it by forwarding `slug` only
 * when a caller names one explicitly.
 *
 * This mirrors the API's own derivation closely enough to show the admin what
 * they are about to get, but it is not authoritative: the server derives the
 * slug it stores, and a collision comes back as `409`.
 */

/** Longest slug the API accepts (`CreateEventSchema.slug.max(120)`). */
const MAX_SLUG_LENGTH = 120;

/**
 * Turn a title into a URL-safe slug.
 *
 * Accents are folded rather than dropped (`Graduação` → `graduacao`), because
 * dropping them would collapse distinct titles onto the same slug.
 */
export function slugifyTitle(title: string): string {
  return title
    .normalize('NFD')
    // Strip the combining marks NFD just separated out.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}
