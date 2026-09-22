'use client';

import { normalizeWhatsapp } from '@arenaquest/shared/domain/contact/whatsapp';
import { useDict } from '@web/context/dict-context';
import { whatsappLink } from '@web/lib/whatsapp';

type WhatsappFieldsProps = {
  number: string;
  onNumberChange: (value: string) => void;
  message: string;
  onMessageChange: (value: string) => void;
  contactLabel: string;
  onContactLabelChange: (value: string) => void;
  /** The message the dictionary template composes from the current title and date. */
  suggestedMessage: string;
  /** Replaces the message with {@link suggestedMessage} — always human-initiated. */
  onUseSuggestion: () => void;
  /** True when the title moved after this message was authored. */
  titleChanged: boolean;
};

/**
 * Where the event's WhatsApp contact is **authored**.
 *
 * Both value fields are pre-filled once and then persisted onto the event. They
 * are not resolved at read time: the API stores what is submitted here and
 * serves exactly that, and the web layer composes nothing on the way out
 * either (RFC 0014, decisions of 2026-09-22). The consequence the preview has
 * to make unmissable is that **neither field falls back to anything** —
 * clearing the number removes the public button outright, and clearing the
 * message opens the chat with nothing typed in it.
 *
 * The button *text* is the one contact field that does fall back, to a
 * dictionary default, because it is a translated UI string rather than content.
 */
export function WhatsappFields({
  number,
  onNumberChange,
  message,
  onMessageChange,
  contactLabel,
  onContactLabelChange,
  suggestedMessage,
  onUseSuggestion,
  titleChanged,
}: WhatsappFieldsProps) {
  const dict = useDict();
  const d = dict.admin.events.contact;

  const normalized = normalizeWhatsapp(number);
  const effectiveLabel = contactLabel.trim() || dict.events.detail.contactDefaultLabel;
  const link = whatsappLink(normalized, message.trim() || undefined);

  const fieldStyle = {
    borderColor: 'var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>
        {d.sectionTitle}
      </h2>
      <p className="text-xs" style={{ color: 'var(--text2)' }}>
        {d.sectionHint}
      </p>

      <div>
        <label htmlFor="event-whatsapp-number" className="mb-1 block text-xs" style={{ color: 'var(--text2)' }}>
          {d.numberLabel}
        </label>
        <input
          id="event-whatsapp-number"
          type="text"
          value={number}
          onChange={(event) => onNumberChange(event.target.value)}
          placeholder={d.numberPlaceholder}
          maxLength={32}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
          style={fieldStyle}
        />
        <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
          {d.numberHint}
        </p>
      </div>

      <div>
        <label htmlFor="event-whatsapp-message" className="mb-1 block text-xs" style={{ color: 'var(--text2)' }}>
          {d.messageLabel}
        </label>
        <textarea
          id="event-whatsapp-message"
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          rows={3}
          maxLength={1000}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
          style={fieldStyle}
        />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            {d.messageHint}
          </p>
          <button
            type="button"
            onClick={onUseSuggestion}
            disabled={message === suggestedMessage}
            className="rounded border px-2 py-1 text-xs disabled:opacity-50"
            style={{ borderColor: 'var(--border2)', color: 'var(--text2)' }}
          >
            {d.useSuggestion}
          </button>
        </div>
        {titleChanged && (
          <p
            role="alert"
            className="mt-2 rounded-lg px-3 py-2 text-xs"
            style={{ background: 'var(--error-bg)', color: 'var(--error)' }}
          >
            {d.titleChangedWarning}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="event-contact-label" className="mb-1 block text-xs" style={{ color: 'var(--text2)' }}>
          {d.labelLabel}
        </label>
        <input
          id="event-contact-label"
          type="text"
          value={contactLabel}
          onChange={(event) => onContactLabelChange(event.target.value)}
          placeholder={d.labelPlaceholder}
          maxLength={80}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
          style={fieldStyle}
        />
        <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
          {d.labelHint}
        </p>
      </div>

      {/* The live preview: the exact thing a visitor gets, read before publishing
          rather than discovered afterwards. */}
      <div
        className="rounded-lg border p-4"
        style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>
          {d.previewTitle}
        </p>

        {normalized === '' ? (
          <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
            {d.previewNoNumber}
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              {d.previewButton(effectiveLabel)}
            </p>
            {message.trim() === '' ? (
              <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
                {d.previewNoMessage}
              </p>
            ) : (
              <div>
                <p className="text-xs" style={{ color: 'var(--text3)' }}>
                  {d.previewMessageLabel}
                </p>
                <p
                  className="mt-1 whitespace-pre-wrap rounded border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                >
                  {message}
                </p>
              </div>
            )}
            {link && (
              <p className="break-all font-mono text-xs" style={{ color: 'var(--text3)' }}>
                {link}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
