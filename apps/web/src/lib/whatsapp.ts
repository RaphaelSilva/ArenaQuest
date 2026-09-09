/**
 * WhatsApp click-to-chat links.
 *
 * `wa.me` is WhatsApp's own short domain: it opens the native app on mobile and
 * WhatsApp Web on desktop, so no number ever has to be typed by hand. The
 * number must already be normalised to international digits — see
 * `normalizeWhatsapp` in `./brand`, the single place that reads the brand var.
 */

/** Base of the click-to-chat endpoint. */
const WA_BASE = 'https://wa.me';

/**
 * Build a click-to-chat URL, optionally pre-filling the first message.
 *
 * The pre-filled text is the only attribution we get for free: a distinct
 * message per CTA tells us which button started the conversation without any
 * tracker. Returns `null` when the tenant has no number, so callers can render
 * their disabled state instead of a dead link.
 */
export function whatsappLink(number: string, message?: string): string | null {
  if (!number) return null;
  const query = message ? `?text=${encodeURIComponent(message)}` : '';
  return `${WA_BASE}/${number}${query}`;
}
