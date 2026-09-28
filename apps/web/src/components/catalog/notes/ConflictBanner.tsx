'use client';

import { useDict } from '@web/context/dict-context';
import type { NoteConflict } from './useNoteAutosave';

type ConflictBannerProps = {
  conflict: NoteConflict | null;
  /** A one-line follow-up announced in the same live region (e.g. "copied to clipboard"). */
  notice?: string;
  onLoadLatest: () => void;
  onKeepMine: () => void;
  onRecreate: () => void;
  onDiscard: () => void;
};

const actionClass =
  'cursor-pointer rounded-[8px] border px-3 py-1.5 text-[12px] font-bold transition-colors duration-150 hover:border-[var(--aq-border3)]';

/**
 * Announces a `409 NOTE_STALE`. The live region is always mounted so screen
 * readers pick up the banner when it appears.
 */
export function ConflictBanner({
  conflict,
  notice,
  onLoadLatest,
  onKeepMine,
  onRecreate,
  onDiscard,
}: ConflictBannerProps) {
  const dict = useDict();

  return (
    <div role="status" aria-live="polite">
      {conflict && (
        <div
          className="mb-3 rounded-[12px] border p-3"
          style={{ borderColor: 'var(--aq-error)', background: 'var(--aq-error-bg)' }}
        >
          <p className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--aq-text)' }}>
            {conflict.current ? dict.notes.conflict.stale : dict.notes.conflict.deleted}
          </p>
          <div className="flex flex-wrap gap-2">
            {conflict.current ? (
              <>
                <button
                  type="button"
                  onClick={onLoadLatest}
                  className={actionClass}
                  style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text)' }}
                >
                  {dict.notes.conflict.loadLatest}
                </button>
                <button
                  type="button"
                  onClick={onKeepMine}
                  className={actionClass}
                  style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text)' }}
                >
                  {dict.notes.conflict.keepMine}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onRecreate}
                  className={actionClass}
                  style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text)' }}
                >
                  {dict.notes.conflict.recreate}
                </button>
                <button
                  type="button"
                  onClick={onDiscard}
                  className={actionClass}
                  style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text)' }}
                >
                  {dict.notes.conflict.discard}
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {!conflict && notice && (
        <p className="mb-3 text-[12px]" style={{ color: 'var(--aq-text2)' }}>
          {notice}
        </p>
      )}
    </div>
  );
}
