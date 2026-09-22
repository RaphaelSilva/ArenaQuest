'use client';

import { useState } from 'react';
import { useDict } from '@web/context/dict-context';

type SlugFieldProps = {
  slug: string;
  onSlugChange: (value: string) => void;
  /**
   * `create` derives the slug from the title and lets it be typed over freely —
   * nothing has been shared yet. `edit` freezes it behind an acknowledged
   * warning.
   */
  mode: 'create' | 'edit';
  /** Whether the edit-mode override has been accepted. Owned by the form. */
  unlocked: boolean;
  onUnlock: () => void;
};

/**
 * The public link.
 *
 * Derived from the title **once**, at creation, and never re-derived on rename:
 * a URL already pasted into a WhatsApp group, printed on a flyer or shared in a
 * post cannot be recalled, so the slug outlives the title that produced it.
 *
 * The manual override exists — sometimes a link really must move — but it is
 * not a plain input. The warning is read and accepted *before* the field
 * becomes editable, so breaking live links is a decision rather than a
 * side effect of clicking into a box.
 */
export function SlugField({ slug, onSlugChange, mode, unlocked, onUnlock }: SlugFieldProps) {
  const dict = useDict();
  const d = dict.admin.events.slug;
  const [confirming, setConfirming] = useState(false);

  const editable = mode === 'create' || unlocked;

  return (
    <div>
      <label htmlFor="event-slug" className="mb-1 block text-xs" style={{ color: 'var(--text2)' }}>
        {d.label}
      </label>
      <input
        id="event-slug"
        type="text"
        value={slug}
        onChange={(event) => onSlugChange(event.target.value)}
        readOnly={!editable}
        aria-readonly={!editable}
        maxLength={120}
        className="w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none disabled:opacity-60"
        style={{
          borderColor: 'var(--border)',
          background: editable ? 'var(--bg)' : 'var(--bg3)',
          color: 'var(--text)',
        }}
      />
      <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
        {mode === 'create' ? d.generatedHint : d.frozenHint}
      </p>

      {mode === 'edit' && !unlocked && (
        <div className="mt-2">
          {confirming ? (
            <div
              className="space-y-2 rounded-lg px-3 py-2"
              style={{ background: 'var(--error-bg)' }}
            >
              <p role="alert" className="text-xs" style={{ color: 'var(--error)' }}>
                {d.overrideWarning}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    onUnlock();
                  }}
                  className="rounded border px-2 py-1 text-xs"
                  style={{ borderColor: 'var(--error)', color: 'var(--error)' }}
                >
                  {d.overrideConfirm}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded border px-2 py-1 text-xs"
                  style={{ borderColor: 'var(--border2)', color: 'var(--text2)' }}
                >
                  {d.overrideCancel}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--border2)', color: 'var(--text2)' }}
            >
              {d.overrideButton}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
