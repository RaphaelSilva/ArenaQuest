'use client';

import { useState } from 'react';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { Note, StaffNote } from '@web/lib/notes-api';

type StaffAction = 'unshare' | 'clear';

/** The one action a note offers the staff, or `null` for a private, unmoderated note. */
export function staffActionFor(note: Pick<Note, 'visibility' | 'moderated'>): StaffAction | null {
  if (note.moderated) return 'clear';
  return note.visibility === 'shared' ? 'unshare' : null;
}

export type StaffNoteActionsProps = {
  note: Pick<Note, 'id' | 'visibility' | 'moderated'>;
  /** Applies the server's answer to the card in place. */
  onChange: (patch: Partial<StaffNote>) => void;
};

/**
 * The staff's only moderation controls on someone else's note: *Unshare* on a
 * shared, unmoderated note and *Allow sharing again* on a moderated one, each
 * behind an inline confirmation. Deliberately no edit and no delete — staff
 * never change another user's text. The API stays the authority (403 otherwise).
 */
export function StaffNoteActions({ note, onChange }: StaffNoteActionsProps) {
  const dict = useDict();
  const client = useApiClient();
  const t = dict.notes.staff;
  const [confirming, setConfirming] = useState<StaffAction | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const action = staffActionFor(note);
  if (!action) return null;

  const run = async (which: StaffAction) => {
    setPending(true);
    setError('');
    try {
      if (which === 'unshare') {
        const updated = await client.notes.unshare(note.id);
        onChange(updated);
      } else {
        await client.notes.clearModeration(note.id);
        onChange({ moderated: false, moderatedAt: null, moderatedBy: null });
      }
      setConfirming(null);
    } catch {
      setError(which === 'unshare' ? t.unshareError : t.clearError);
    } finally {
      setPending(false);
    }
  };

  const label = action === 'unshare' ? t.unshare : t.allowSharing;
  const prompt = action === 'unshare' ? t.confirmUnshare : t.confirmAllowSharing;

  return (
    <div className="flex w-full flex-col gap-2">
      {confirming === action ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px]" style={{ color: 'var(--aq-text)' }}>
            {prompt}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => void run(action)}
            className="cursor-pointer rounded-[8px] px-3 py-1 text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: 'var(--aq-accent)', color: 'var(--aq-bg)' }}
          >
            {pending ? t.pending : t.confirm}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(null)}
            className="cursor-pointer rounded-[8px] border px-3 py-1 text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
            style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
          >
            {t.cancel}
          </button>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => {
              setError('');
              setConfirming(action);
            }}
            className="cursor-pointer rounded-[8px] border px-3 py-1.5 text-[12px] font-bold"
            style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text)' }}
          >
            {label}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[12px] font-semibold" style={{ color: 'var(--aq-error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
