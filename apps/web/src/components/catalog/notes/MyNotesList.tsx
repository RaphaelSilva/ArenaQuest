'use client';

import { useCallback, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { AuthoredNote } from '@web/lib/notes-api';
import { SectionEmpty } from '../SectionEmpty';
import { LoadMoreButton } from './LoadMoreButton';
import { NoteBadge } from './NoteBadge';
import { NoteCard } from './NoteCard';
import { NotesListError, NotesListLoading } from './NotesListStatus';
import { useNotePages } from './useNotePages';

export type AuthoredNoteGroup = {
  topicNodeId: string;
  topicTitle: string;
  topicAccessible: boolean;
  notes: AuthoredNote[];
};

/** Groups notes by topic, ordered by each topic's first appearance in the API order. */
export function groupNotesByTopic(notes: readonly AuthoredNote[]): AuthoredNoteGroup[] {
  const groups = new Map<string, AuthoredNoteGroup>();
  for (const note of notes) {
    let group = groups.get(note.topicNodeId);
    if (!group) {
      group = {
        topicNodeId: note.topicNodeId,
        topicTitle: note.topicTitle,
        topicAccessible: note.topicAccessible,
        notes: [],
      };
      groups.set(note.topicNodeId, group);
    }
    group.notes.push(note);
  }
  return [...groups.values()];
}

export type MyNotesListProps = {
  /** Extra chips for a card, after the visibility and moderation badges. */
  renderBadges?: (note: AuthoredNote) => ReactNode;
  /** Footer actions for a card. */
  renderActions?: (note: AuthoredNote, reload: () => void) => ReactNode;
};

/**
 * Every note the caller wrote, grouped by topic. Read-only: editing stays in
 * the topic's *My note* tab, and a topic the caller can no longer read gets
 * no link, only the reason.
 */
export function MyNotesList({ renderBadges, renderActions }: MyNotesListProps) {
  const dict = useDict();
  const client = useApiClient();
  const t = dict.notes.myNotes;

  const fetchPage = useCallback((cursor: string | null) => client.notes.listMine(cursor), [client]);
  const pages = useNotePages(fetchPage);
  const groups = useMemo(() => groupNotesByTopic(pages.items), [pages.items]);

  if (pages.state === 'loading') return <NotesListLoading label={t.loading} />;
  if (pages.state === 'error') return <NotesListError message={t.loadError} onRetry={pages.reload} />;
  if (groups.length === 0) return <SectionEmpty title={t.empty} description={t.emptyHint} icon="📝" />;

  return (
    <div>
      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.topicNodeId} aria-labelledby={`topic-${group.topicNodeId}`}>
            <h2
              id={`topic-${group.topicNodeId}`}
              className="mb-2 text-[15px] font-bold"
              style={{ fontFamily: 'var(--font-space-grotesk), sans-serif', color: 'var(--aq-text)' }}
            >
              {group.topicAccessible ? (
                <Link
                  href={`/catalog/${group.topicNodeId}`}
                  className="transition-colors duration-150 hover:text-[var(--aq-accent)]"
                >
                  {group.topicTitle}
                </Link>
              ) : (
                group.topicTitle
              )}
            </h2>
            <ul className="flex flex-col gap-3">
              {group.notes.map((note) => (
                <li key={note.id}>
                  <NoteCard
                    note={note}
                    date="edited"
                    showAuthor={false}
                    badges={
                      <>
                        <NoteBadge tone={note.visibility === 'shared' ? 'accent' : 'neutral'}>
                          {note.visibility === 'shared' ? dict.notes.badges.shared : dict.notes.badges.private}
                        </NoteBadge>
                        {note.moderated && <NoteBadge tone="warning">{dict.notes.badges.moderated}</NoteBadge>}
                        {renderBadges?.(note)}
                      </>
                    }
                    footer={
                      note.topicAccessible ? undefined : (
                        <p
                          role="note"
                          className="mt-3 rounded-[8px] border px-3 py-2 text-[12px] font-semibold"
                          style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text2)' }}
                        >
                          {t.inaccessible}
                        </p>
                      )
                    }
                    actions={renderActions?.(note, pages.reload)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
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
