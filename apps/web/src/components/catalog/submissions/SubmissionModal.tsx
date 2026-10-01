'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useDict } from '@web/context/dict-context';

type SubmissionModalProps = {
  label: string;
  onClose: () => void;
  children: ReactNode;
};

/** A centred dialog over a dimmed backdrop; Escape and the close button dismiss it. */
export function SubmissionModal({ label, onClose, children }: SubmissionModalProps) {
  const dict = useDict();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ background: 'rgba(0, 0, 0, 0.6)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="max-h-dvh w-full overflow-y-auto rounded-t-[12px] border p-4 sm:max-w-[720px] sm:rounded-[12px]"
        style={{ borderColor: 'var(--aq-border)', background: 'var(--aq-bg2)' }}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="min-w-0 break-words text-[15px] font-bold" style={{ color: 'var(--aq-text)' }}>
            {label}
          </h3>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex-shrink-0 cursor-pointer rounded-[8px] border px-3 py-1 text-[12px] font-bold"
            style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
          >
            {dict.submissions.viewer.close}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
