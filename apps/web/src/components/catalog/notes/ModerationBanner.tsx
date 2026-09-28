'use client';

import { useDict } from '@web/context/dict-context';

/** Shown while a staff force-unshare blocks re-sharing the note. */
export function ModerationBanner() {
  const dict = useDict();
  return (
    <p
      role="note"
      className="mb-3 rounded-[12px] border px-3 py-2 text-[13px] font-semibold"
      style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text2)' }}
    >
      {dict.notes.moderated}
    </p>
  );
}
