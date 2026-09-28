'use client';

import { useId, useState } from 'react';
import { useDict } from '@web/context/dict-context';
import type { NoteVisibility } from '@web/lib/notes-api';

type VisibilitySwitchProps = {
  visibility: NoteVisibility;
  disabled: boolean;
  onChange: (visibility: NoteVisibility) => void;
};

/**
 * Private/shared switch with its audience line. Going private applies at once;
 * going shared asks a one-line confirmation first.
 */
export function VisibilitySwitch({ visibility, disabled, onChange }: VisibilitySwitchProps) {
  const dict = useDict();
  const labelId = useId();
  const audienceId = useId();
  const [confirming, setConfirming] = useState(false);
  const shared = visibility === 'shared';

  const toggle = () => {
    if (shared) {
      onChange('private');
    } else {
      setConfirming(true);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={shared}
          aria-labelledby={labelId}
          aria-describedby={audienceId}
          disabled={disabled || confirming}
          onClick={toggle}
          className="relative h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: shared ? 'var(--aq-accent)' : 'var(--aq-bg4)',
            borderColor: 'var(--aq-border2)',
          }}
        >
          <span
            aria-hidden
            className="absolute top-0.5 rounded-full transition-all duration-150"
            style={{
              left: shared ? 'calc(100% - 1.25rem)' : '0.125rem',
              width: '1.125rem',
              height: '1.125rem',
              background: 'var(--aq-text)',
            }}
          />
        </button>
        <span id={labelId} className="text-[13px] font-semibold" style={{ color: 'var(--aq-text)' }}>
          {dict.notes.visibility.label}
        </span>
        <span className="text-[12px]" style={{ color: 'var(--aq-text3)' }}>
          {shared ? dict.notes.visibility.shared : dict.notes.visibility.private}
        </span>
      </div>
      <p id={audienceId} className="mt-1.5 text-[12px]" style={{ color: 'var(--aq-text2)' }}>
        {shared ? dict.notes.visibility.audienceShared : dict.notes.visibility.audiencePrivate}
      </p>
      {confirming && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[12px]" style={{ color: 'var(--aq-text)' }}>
            {dict.notes.visibility.confirmShare}
          </span>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              onChange('shared');
            }}
            className="cursor-pointer rounded-[8px] px-3 py-1 text-[12px] font-bold"
            style={{ background: 'var(--aq-accent)', color: 'var(--aq-bg)' }}
          >
            {dict.notes.visibility.confirm}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="cursor-pointer rounded-[8px] border px-3 py-1 text-[12px] font-bold"
            style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
          >
            {dict.notes.visibility.cancel}
          </button>
        </div>
      )}
    </div>
  );
}
