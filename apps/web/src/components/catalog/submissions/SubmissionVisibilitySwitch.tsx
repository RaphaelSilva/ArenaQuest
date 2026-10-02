'use client';

import { useId, useState } from 'react';
import { useDict } from '@web/context/dict-context';
import type { SubmissionVisibility } from '@web/lib/submissions-api';

type SubmissionVisibilitySwitchProps = {
  visibility: SubmissionVisibility;
  disabled?: boolean;
  onChange: (visibility: SubmissionVisibility) => void;
};

/**
 * Private/shared switch with its audience line. Going private applies at once;
 * going shared first asks a confirmation naming that classmates will see the
 * author's name. Callers render it only while the label's sharing is on.
 */
export function SubmissionVisibilitySwitch({ visibility, disabled = false, onChange }: SubmissionVisibilitySwitchProps) {
  const dict = useDict();
  const t = dict.submissions.visibility;
  const labelId = useId();
  const audienceId = useId();
  const [confirming, setConfirming] = useState(false);
  const shared = visibility === 'shared';

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={shared}
          aria-labelledby={labelId}
          aria-describedby={audienceId}
          disabled={disabled || confirming}
          onClick={() => (shared ? onChange('private') : setConfirming(true))}
          className="relative h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: shared ? 'var(--aq-accent)' : 'var(--aq-bg4)', borderColor: 'var(--aq-border2)' }}
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
          {t.label}
        </span>
        <span className="text-[12px]" style={{ color: 'var(--aq-text3)' }}>
          {shared ? t.shared : t.private}
        </span>
      </div>
      <p id={audienceId} className="mt-1.5 text-[12px]" style={{ color: 'var(--aq-text2)' }}>
        {shared ? t.audienceShared : t.audiencePrivate}
      </p>
      {confirming && (
        <div role="group" className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[12px]" style={{ color: 'var(--aq-text)' }}>
            {t.confirmShare}
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
            {t.confirm}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="cursor-pointer rounded-[8px] border px-3 py-1 text-[12px] font-bold"
            style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
          >
            {t.cancel}
          </button>
        </div>
      )}
    </div>
  );
}
