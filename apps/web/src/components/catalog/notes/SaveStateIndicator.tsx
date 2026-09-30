'use client';

import { useDict } from '@web/context/dict-context';
import type { NoteSaveState } from './useNoteAutosave';

const TONE: Record<NoteSaveState, string> = {
  idle: 'var(--aq-text3)',
  saving: 'var(--aq-text2)',
  saved: 'var(--aq-accent3)',
  conflict: 'var(--aq-error)',
  error: 'var(--aq-error)',
  overLimit: 'var(--aq-error)',
};

export function SaveStateIndicator({ state }: { state: NoteSaveState }) {
  const dict = useDict();
  const labels: Record<NoteSaveState, string> = {
    idle: dict.notes.saveState.idle,
    saving: dict.notes.saveState.saving,
    saved: dict.notes.saveState.saved,
    conflict: dict.notes.saveState.conflict,
    error: dict.notes.saveState.error,
    overLimit: dict.notes.saveState.overLimit,
  };

  return (
    <span
      role="status"
      data-state={state}
      className="text-[12px] font-semibold"
      style={{ color: TONE[state] }}
    >
      {labels[state]}
    </span>
  );
}
