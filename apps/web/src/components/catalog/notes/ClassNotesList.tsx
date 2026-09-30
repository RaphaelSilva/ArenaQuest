'use client';

import { useCallback, type ReactNode } from 'react';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { ClassNote } from '@web/lib/notes-api';
import { SectionEmpty } from '../SectionEmpty';
import { LoadMoreButton } from './LoadMoreButton';
import { NoteCard } from './NoteCard';
import { NotesListError, NotesListLoading } from './NotesListStatus';
import { useNotePages } from './useNotePages';

export type ClassNotesListProps = {
  topicId: string;
  /** Extra chips for a card (Task 07: staff badges). */
  renderBadges?: (note: ClassNote) => ReactNode;
  /** Footer actions for a card (Task 07: Unshare / Allow sharing again). */
  renderActions?: (note: ClassNote, reload: () => void, update: (patch: Partial<ClassNote>) => void) => ReactNode;
};

/**
 * The *Class notes* tab: the topic's notes exactly as the API returns them
 * (shared, newest first, twenty per page). No client-side privacy filtering.
 */
export function ClassNotesList({ topicId, renderBadges, renderActions }: ClassNotesListProps) {
  const dict = useDict();
  const client = useApiClient();
  const t = dict.notes.classList;

  const fetchPage = useCallback(
    (cursor: string | null) => client.notes.listForTopic(topicId, cursor),
    [client, topicId],
  );
  const pages = useNotePages(fetchPage);

  if (pages.state === 'loading') return <NotesListLoading label={t.loading} />;
  if (pages.state === 'error') return <NotesListError message={t.loadError} onRetry={pages.reload} />;
  if (pages.items.length === 0) return <SectionEmpty title={t.empty} description={t.emptyHint} icon="📝" />;

  return (
    <div>
      <ul aria-label={t.label} className="flex flex-col gap-3">
        {pages.items.map((note) => (
          <li key={note.id}>
            <NoteCard
              note={note}
              date="shared"
              isMine={note.isMine}
              badges={renderBadges?.(note)}
              actions={renderActions?.(note, pages.reload, (patch) => pages.update(note.id, patch))}
            />
          </li>
        ))}
      </ul>
      {pages.hasMore && (
        <LoadMoreButton
          label={t.loadMore}
          loadingLabel={t.loadingMore}
          errorLabel={t.loadMoreError}
          loading={pages.loadingMore}
          failed={pages.loadMoreFailed}
          onClick={pages.loadMore}
        />
      )}
    </div>
  );
}
