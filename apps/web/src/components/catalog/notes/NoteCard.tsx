'use client';

import type { ReactNode } from 'react';
import { useDict } from '@web/context/dict-context';
import type { Note } from '@web/lib/notes-api';
import { MarkdownViewer } from '../MarkdownViewer';
import { NoteBadge } from './NoteBadge';

export type NoteCardDate = 'shared' | 'edited';

export type NoteCardProps = {
  note: Note;
  /** Which timestamp the card shows: when the note was shared (class list) or last edited (My notes). */
  date: NoteCardDate;
  /** Adds the *yours* marker. */
  isMine?: boolean;
  /** Hide the author line where every note is the same author's (My notes). Defaults to true. */
  showAuthor?: boolean;
  /** Extra chips next to the author line (visibility, moderation, staff badges). */
  badges?: ReactNode;
  /** Buttons rendered in the card footer (Task 07 moderation actions). */
  actions?: ReactNode;
  /** A note rendered under the body, e.g. why the card is read-only. */
  footer?: ReactNode;
};

/**
 * Formats the API's `YYYY-MM-DD HH:MM:SS` (or ISO) timestamp in the
 * locale-agnostic `YYYY-MM-DD HH:MM` shape (i18n-spec section 3.5).
 */
export function formatNoteTimestamp(value: string): string {
  return value.replace('T', ' ').slice(0, 16);
}

/** A read-only note: author, date, optional badges and the sanitised Markdown body. */
export function NoteCard({
  note,
  date,
  isMine = false,
  showAuthor = true,
  badges,
  actions,
  footer,
}: NoteCardProps) {
  const dict = useDict();
  const stamp = date === 'shared' ? (note.sharedAt ?? note.updatedAt) : note.updatedAt;
  const formatted = formatNoteTimestamp(stamp);

  return (
    <article
      className="rounded-[12px] border p-4"
      style={{
        borderColor: isMine ? 'var(--aq-accent)' : 'var(--aq-border)',
        background: 'var(--aq-bg2)',
      }}
    >
      <header className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {showAuthor && (
          <span className="text-[13px] font-bold" style={{ color: 'var(--aq-text)' }}>
            {note.authorName}
          </span>
        )}
        {isMine && <NoteBadge tone="accent">{dict.notes.card.yours}</NoteBadge>}
        {badges}
        <time
          dateTime={stamp.replace(' ', 'T')}
          className="text-[12px] sm:ml-auto"
          style={{ color: 'var(--aq-text3)' }}
        >
          {date === 'shared' ? dict.notes.card.sharedOn(formatted) : dict.notes.card.editedOn(formatted)}
        </time>
      </header>

      <MarkdownViewer content={note.body} className="break-words text-[14px]" />

      {footer}

      {actions && <div className="mt-3 flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: 'var(--aq-border)' }}>{actions}</div>}
    </article>
  );
}
