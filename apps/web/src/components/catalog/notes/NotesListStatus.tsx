'use client';

import { useDict } from '@web/context/dict-context';
import { SectionError } from '../SectionError';

/** Spinner shown while a notes list loads its first page. */
export function NotesListLoading({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-8" role="status" aria-label={label}>
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--aq-accent)] border-t-transparent" />
    </div>
  );
}

/** First-page failure with a retry. */
export function NotesListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const dict = useDict();
  return (
    <div className="flex flex-col items-center gap-3">
      <SectionError message={message} />
      <button
        type="button"
        onClick={onRetry}
        className="cursor-pointer rounded-[8px] border px-3 py-1.5 text-[12px] font-bold"
        style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
      >
        {dict.common.retry}
      </button>
    </div>
  );
}
