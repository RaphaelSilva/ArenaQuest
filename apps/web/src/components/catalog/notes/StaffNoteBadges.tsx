'use client';

import { useDict } from '@web/context/dict-context';
import type { Note } from '@web/lib/notes-api';
import { NoteBadge } from './NoteBadge';

/** Staff-only chips on a note card: its visibility and, when set, the moderation flag. */
export function StaffNoteBadges({ note }: { note: Pick<Note, 'visibility' | 'moderated'> }) {
  const dict = useDict();
  const shared = note.visibility === 'shared';
  return (
    <>
      <NoteBadge tone={shared ? 'accent' : 'neutral'}>
        {shared ? dict.notes.badges.shared : dict.notes.badges.private}
      </NoteBadge>
      {note.moderated && <NoteBadge tone="warning">{dict.notes.badges.moderated}</NoteBadge>}
    </>
  );
}
