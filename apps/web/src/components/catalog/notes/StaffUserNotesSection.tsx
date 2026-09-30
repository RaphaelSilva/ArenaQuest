'use client';

import { useCallback, useMemo } from 'react';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { SectionEmpty } from '../SectionEmpty';
import { LoadMoreButton } from './LoadMoreButton';
import { groupNotesByTopic } from './MyNotesList';
import { NoteCard } from './NoteCard';
import { NotesListError, NotesListLoading } from './NotesListStatus';
import { StaffNoteActions, staffActionFor } from './StaffNoteActions';
import { StaffNoteBadges } from './StaffNoteBadges';
import { useNotePages } from './useNotePages';

/**
 * The user backoffice *Notes* section: every note one student wrote, private
 * included, grouped by topic, with the staff badges and moderation actions.
 * Self-contained — its own fetch through the staff route and its own
 * loading/error states — so it does not depend on how the page loads the user.
 * Read-only for text: no edit, no delete.
 */
export function StaffUserNotesSection({ userId }: { userId: string }) {
  const dict = useDict();
  const client = useApiClient();
  const t = dict.notes.staff.userSection;

  const fetchPage = useCallback(
    (cursor: string | null) => client.notes.listForUser(userId, cursor),
    [client, userId],
  );
  const pages = useNotePages(fetchPage);
  const groups = useMemo(() => groupNotesByTopic(pages.items), [pages.items]);

  let content;
  if (pages.state === 'loading') content = <NotesListLoading label={t.loading} />;
  else if (pages.state === 'error') content = <NotesListError message={t.loadError} onRetry={pages.reload} />;
  else if (groups.length === 0) content = <SectionEmpty title={t.empty} description={t.emptyHint} icon="📝" />;
  else {
    content = (
      <div>
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.topicNodeId} aria-labelledby={`staff-topic-${group.topicNodeId}`}>
              <h3
                id={`staff-topic-${group.topicNodeId}`}
                className="mb-2 text-[15px] font-bold"
                style={{ fontFamily: 'var(--font-space-grotesk), sans-serif', color: 'var(--aq-text)' }}
              >
                {group.topicTitle}
              </h3>
              <ul className="flex flex-col gap-3">
                {group.notes.map((note) => (
                  <li key={note.id}>
                    <NoteCard
                      note={note}
                      date="edited"
                      showAuthor={false}
                      badges={<StaffNoteBadges note={note} />}
                      actions={
                        staffActionFor(note) ? (
                          <StaffNoteActions note={note} onChange={(patch) => pages.update(note.id, patch)} />
                        ) : undefined
                      }
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

  return (
    <section aria-labelledby="staff-user-notes" className="mt-8">
      <h2
        id="staff-user-notes"
        className="mb-4 text-[13px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--aq-text3)' }}
      >
        {t.title}
      </h2>
      {content}
    </section>
  );
}
