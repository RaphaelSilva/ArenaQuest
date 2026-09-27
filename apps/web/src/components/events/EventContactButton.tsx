'use client';

import { useDict } from '@web/context/dict-context';
import { whatsappLink } from '@web/lib/whatsapp';
import type { EventContact } from '@web/lib/events-api';

function WhatsappIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.18 8.18 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.69 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.53.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.47c-.17 0-.43.06-.66.31-.22.25-.87.85-.87 2.07 0 1.22.89 2.4 1.02 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.68-1.18.2-.58.2-1.08.14-1.18-.06-.11-.22-.17-.47-.29Z" />
    </svg>
  );
}

/**
 * The per-event WhatsApp call-to-action.
 *
 * **This layer applies no fallback of any kind** (RFC 0014, decision of
 * 2026-09-22):
 *
 * - *Number* — the button renders only when the API resolved a `contact`. The
 *   tenant's `brand.whatsapp` is deliberately not imported here: a visitor who
 *   clicks an event's button must reach the instructor who runs *that* event,
 *   and an event with no number renders no button rather than quietly routing
 *   the conversation to the front desk.
 * - *Message* — `contact.message` verbatim, empty included. An empty message
 *   opens the chat with nothing typed; no sentence is composed here. Composing
 *   the suggestion belongs to the admin form, where it is persisted and where
 *   the build language is known.
 * - *Label* — `contact.label` when the admin stored one, otherwise the
 *   dictionary default. This is the one contact field the web resolves,
 *   because it is a translated UI string and the API has no locale.
 */
export function EventContactButton({ contact }: { contact: EventContact | null }) {
  const dict = useDict();

  if (contact === null) return null;

  const href = whatsappLink(contact.number, contact.message);
  if (href === null) return null;

  const label = contact.label || dict.events.detail.contactDefaultLabel;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // `min-h-11` keeps the tap target at the 44px floor on a phone, which is
      // where most of this board's traffic opens a WhatsApp link.
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[12px] px-6 py-3 text-sm font-semibold transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{
        background: 'var(--aq-accent)',
        color: '#0B0E17',
        outlineColor: 'var(--aq-accent)',
        boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)',
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <WhatsappIcon />
      {label}
    </a>
  );
}
